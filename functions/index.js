const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/https");
const admin = require('firebase-admin');
const { defineSecret } = require("firebase-functions/params");
const express = require('express');
const cors = require('cors');
const twilio = require('twilio');

admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

const { AccessToken } = twilio.jwt;
const { VoiceGrant, ChatGrant } = AccessToken;
const {
  twiml: { VoiceResponse },
} = twilio;

const TWILIO_ACCOUNT_ID = defineSecret("TWILIO_ACCOUNT_ID");
const TWILIO_AUTH_TOKEN = defineSecret("TWILIO_AUTH_TOKEN");
const TWILIO_API_KEY = defineSecret("TWILIO_API_KEY");
const TWILIO_API_SECRET = defineSecret("TWILIO_API_SECRET");
const TWILIO_APP_SID = defineSecret("TWILIO_APP_SID");
const TWILIO_PHONE = defineSecret("TWILIO_PHONE");
const AIRTABLE_TOKEN = defineSecret("AIRTABLE_TOKEN");
const AIRTABLE_BASE_ID = defineSecret("AIRTABLE_BASE_ID");
const AIRTABLE_TABLE_ID = defineSecret("AIRTABLE_TABLE_ID");
const TWILIO_CONVERSATIONS_SERVICE_SID = defineSecret("TWILIO_CONVERSATIONS_SERVICE_SID");
const TWILIO_IDENTITY = defineSecret("TWILIO_IDENTITY");

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const getTwilioClient = () => {
  return twilio(TWILIO_ACCOUNT_ID.value(), TWILIO_AUTH_TOKEN.value());
};

const validateToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log("Blocking: No token found in header");
    return res.status(401).send('Unauthorized: No token');
  }

  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error("Blocking: Token invalid", error.message);
    return res.status(403).send('Unauthorized: Bad token');
  }
};

/**
 * Phone Formatter Helper: Standardize to E.164 (+61...)
 */
function formatPhone(phone) {
  if (!phone) return '';
  
  let p = phone.trim();
  if (p.startsWith('00')) {
    p = '+' + p.substring(2);
  }
  
  let cleaned = p.replace(/(?!^\+)\D/g, '');
  
  if (cleaned.startsWith('0') && !cleaned.startsWith('00')) {
    return '+61' + cleaned.substring(1);
  }
  
  if (cleaned.startsWith('61') && !cleaned.startsWith('+')) {
    return '+' + cleaned;
  }
  
  if (!cleaned.startsWith('+')) {
    return '+61' + cleaned;
  }
  
  return cleaned;
}

/**
 * Airtable Helper: Fetch all contacts (handles pagination)
 */
async function fetchAirtableContacts() {
  let allRecords = [];
  let offset = '';

  do {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID.value()}/${AIRTABLE_TABLE_ID.value()}${offset ? `?offset=${offset}` : ''}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN.value()}` },
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Airtable error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    allRecords = allRecords.concat(data.records);
    offset = data.offset;
  } while (offset);

  console.log(`Totally fetched ${allRecords.length} contacts from Airtable`);

  return Object.fromEntries(
    allRecords
      .filter(r => r.fields?.Phone)
      .map(r => {
        const formatted = formatPhone(r.fields.Phone);
        return [
          formatted,
          {
            id: r.id,
            conversation_sid: r.fields['Conversation_SID'] ?? '',
            createdTime: r.createdTime,
            fields: { ...r.fields, Phone: formatted },
          }
        ];
      })
  );
}

/**
 * Airtable Helper: Update last interaction timestamp and conversation SID
 */
async function updateAirtableLastInteraction(phoneOrSid, lastInteractionTime, conversationSid = null) {
  try {
    const isSid = phoneOrSid.startsWith('CH');
    const formula = isSid 
      ? `{Conversation_SID} = '${phoneOrSid}'`
      : `{Phone} = '${formatPhone(phoneOrSid)}'`;
      
    const filter = encodeURIComponent(formula);
    const searchRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID.value()}/${AIRTABLE_TABLE_ID.value()}?filterByFormula=${filter}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN.value()}` } }
    );

    if (!searchRes.ok) return;
    const data = await searchRes.json();
    if (data.records && data.records.length > 0) {
      const recordId = data.records[0].id;
      
      const fields = {
        'Last_Interaction': lastInteractionTime || new Date().toISOString()
      };
      
      if (conversationSid) {
        fields['Conversation_SID'] = conversationSid;
      }
      
      await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID.value()}/${AIRTABLE_TABLE_ID.value()}/${recordId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AIRTABLE_TOKEN.value()}`
        },
        body: JSON.stringify({ fields })
      });
      console.log(`[Airtable] Updated record ${recordId} (Conversation_SID: ${conversationSid || 'no-change'})`);
    }
  } catch (err) {
    console.error('[Airtable] Error updating Airtable record:', err);
  }
}

/**
 * Twilio Helper: Start or find a conversation
 */
async function startTwilioChat(recipientPhone) {
  const formattedPhone = formatPhone(recipientPhone);
  console.log(`[Twilio] Starting/Finding chat for: ${formattedPhone} (original: ${recipientPhone})`);
  
  try {
    const client = getTwilioClient();
    
    // 1. Check for existing conversation with this participant
    const participantConversations = await client.conversations.v1.participantConversations
      .list({ address: formattedPhone, limit: 1 });

    if (participantConversations.length > 0) {
      const existingSid = participantConversations[0].conversationSid;
      console.log(`[Twilio] Found existing conversation: ${existingSid}`);
      
      // Ensure the browser/desktop identity is a participant
      try {
        const participants = await client.conversations.v1.conversations(existingSid).participants.list();
        const hasIdentity = participants.some(p => p.identity === TWILIO_IDENTITY.value());
        
        if (!hasIdentity) {
          console.log(`[Twilio] Adding user identity ${TWILIO_IDENTITY.value()} to existing conversation ${existingSid}`);
          await client.conversations.v1.conversations(existingSid).participants.create({
            identity: TWILIO_IDENTITY.value(),
          });
        }
      } catch (addErr) {
        console.error('[Twilio] Error verifying/adding identity to existing conversation:', addErr);
      }

      return existingSid;
    }

    // 2. Create new conversation
    const conversation = await client.conversations.v1.conversations.create({
      friendlyName: `Chat with ${formattedPhone}`,
    });

    // 3. Add SMS participant
    await client.conversations.v1.conversations(conversation.sid).participants.create({
      'messagingBinding.address': formattedPhone,
      'messagingBinding.proxyAddress': TWILIO_PHONE.value(),
    });

    // 4. Add identity participant (the browser user)
    await client.conversations.v1.conversations(conversation.sid).participants.create({
      identity: TWILIO_IDENTITY.value(),
    });

    return conversation.sid;
  } catch (err) {
    if (err.code === 50404 || err.message.includes('already exists')) {
      const sidMatch = err.message.match(/CH[a-fA-F0-9]{32}/);
      if (sidMatch) return sidMatch[0];
    }
    console.error('[Twilio] Error starting chat:', err);
    throw err;
  }
}

// --- PROTECTED ROUTES ---

app.get('/api/contacts', validateToken, async (req, res) => {
  try {
    const airtableContacts = await fetchAirtableContacts();
    const contacts = Object.entries(airtableContacts).map(([phone, contact]) => ({
      phone,
      contact,
      is_registered: true,
      is_selected: false
    }));
    res.json(contacts);
  } catch (err) {
    console.error('[API] Failed to fetch contacts:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/create_conversation', validateToken, async (req, res) => {
  const { name, phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number is required' });

  const formattedPhone = formatPhone(phone);

  try {
    const conversationSid = await startTwilioChat(formattedPhone);
    
    if (name && conversationSid) {
      const nameParts = name.trim().split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      // Check if contact already exists in Airtable
      const filter = encodeURIComponent(`{Phone} = '${formattedPhone}'`);
      const searchRes = await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID.value()}/${AIRTABLE_TABLE_ID.value()}?filterByFormula=${filter}`,
        { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN.value()}` } }
      );

      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.records && searchData.records.length > 0) {
          const recordId = searchData.records[0].id;
          console.log(`[Airtable] Contact already exists (ID: ${recordId}). Updating...`);
          
          await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID.value()}/${AIRTABLE_TABLE_ID.value()}/${recordId}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${AIRTABLE_TOKEN.value()}`,
            },
            body: JSON.stringify({
              fields: {
                'Conversation_SID': conversationSid,
                'Last_Interaction': new Date().toISOString()
              }
            })
          });
          
          return res.json({ conversationSid });
        }
      }

      console.log(`[Airtable] Saving new contact ${firstName} ${lastName}; Phone: ${formattedPhone}`);
      await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID.value()}/${AIRTABLE_TABLE_ID.value()}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AIRTABLE_TOKEN.value()}`,
        },
        body: JSON.stringify({
          records: [{
            fields: {
              'First Name': firstName,
              'Last Name': lastName,
              'Phone': formattedPhone,
              'Conversation_SID': conversationSid,
              'Name': name,
              'Last_Interaction': new Date().toISOString()
            }
          }]
        })
      });
    }

    res.json({ conversationSid });
  } catch (err) {
    console.error('[API] Failed to create/update conversation:', err);
    if (err.code === 21211 || err.code === 21608 || err.message.includes('not a valid phone number')) {
      return res.status(400).json({ error: 'Invalid phone number format. Please include country code (e.g. +1...)' });
    }
    res.status(500).json({ error: err.message || 'Failed to initialize conversation' });
  }
});

app.post('/api/send_sms', validateToken, async (req, res) => {
  const { conversationSid, text } = req.body;
  if (!conversationSid || !text) return res.status(400).json({ error: 'Missing parameters' });

  try {
    const client = getTwilioClient();
    const message = await client.conversations.v1.conversations(conversationSid).messages.create({ body: text });
    
    // Update Airtable async
    updateAirtableLastInteraction(conversationSid, message.dateCreated.toISOString());
    
    res.json({ success: true });
  } catch (err) {
    console.error('[API] Failed to send SMS:', err);
    res.status(500).json({ error: 'Failed to send SMS' });
  }
});

app.get('/api/messages', validateToken, async (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: 'Phone is required' });

  const formattedPhone = formatPhone(phone);

  try {
    const client = getTwilioClient();
    const [sent, received] = await Promise.all([
      client.messages.list({ from: formattedPhone, limit: 50 }),
      client.messages.list({ to: formattedPhone, limit: 50 })
    ]);
    res.json([...sent, ...received]);
  } catch (err) {
    console.error('[API] Failed to fetch historical messages:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.get('/api/token', validateToken, (req, res) => {
  try {
    const token = new AccessToken(TWILIO_ACCOUNT_ID.value(), TWILIO_API_KEY.value(), TWILIO_API_SECRET.value(), { identity: TWILIO_IDENTITY.value() });
    
    token.addGrant(new VoiceGrant({
      outgoingApplicationSid: TWILIO_APP_SID.value(),
      incomingAllow: true,
    }));

    token.addGrant(new ChatGrant({
      serviceSid: TWILIO_CONVERSATIONS_SERVICE_SID.value(),
    }));

    res.json({ token: token.toJwt() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

app.post('/api/contacts/update_last_interaction', validateToken, async (req, res) => {
  const { phone, date, conversationSid } = req.body;
  if (!phone || !date) return res.status(400).json({ error: 'Missing parameters' });
  
  try {
    await updateAirtableLastInteraction(phone, date, conversationSid);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -- Public Routes --

app.post('/api/voice', (req, res) => {
  const to = req.body.To;
  const response = new VoiceResponse();
  response.dial({ callerId: TWILIO_PHONE.value() }, to);
  res.type('text/xml');
  res.send(response.toString());
});

app.get('/', (req, res) => {
  res.json({'status': 'Firebase Backend Running'});
});

// --- Firebase Export ---

exports.api = onRequest({ 
  secrets: [
    "TWILIO_ACCOUNT_ID", "TWILIO_AUTH_TOKEN", "TWILIO_API_KEY", 
    "TWILIO_API_SECRET", "TWILIO_APP_SID", "TWILIO_PHONE", 
    "AIRTABLE_TOKEN", "AIRTABLE_BASE_ID", "AIRTABLE_TABLE_ID", 
    "TWILIO_CONVERSATIONS_SERVICE_SID", "TWILIO_IDENTITY"
  ],
  enforceAppCheck: false
}, app);
