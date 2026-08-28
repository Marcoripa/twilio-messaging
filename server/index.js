const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const twilio = require('twilio');
const path = require('path');
const { first } = require('rxjs');

// Load environment variables
dotenv.config();

const { AccessToken } = twilio.jwt;
const { VoiceGrant, ChatGrant } = AccessToken;
const { twiml: { VoiceResponse } } = twilio;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Config
const PRODUCTION = process.env.PRODUCTION;
const airtableBaseId = process.env.AIRTABLE_BASE_ID;
const airtableTableId = process.env.AIRTABLE_TABLE_ID;
const airtableToken = process.env.AIRTABLE_TOKEN;
const twilioAccountId = process.env.TWILIO_ACCOUNT_ID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const twilioApiKey = process.env.TWILIO_API_KEY;
const twilioApiSecret = process.env.TWILIO_API_SECRET;
const twilioAppSid = process.env.TWILIO_APP_SID;
const twilioConvServiceSid = process.env.TWILIO_CONVERSATIONS_SERVICE_SID;
const twilioPhone = process.env.TWILIO_PHONE;
const twilioIdentity = process.env.TWILIO_IDENTITY || 'browser_user';

const client = twilio(twilioAccountId, twilioAuthToken);

/**
 * Phone Formatter Helper: Standardize to E.164 (+61...)
 */
function formatPhone(phone) {
  if (!phone) return '';
  
  // Replace leading 00 with +
  let p = phone.trim();
  if (p.startsWith('00')) {
    p = '+' + p.substring(2);
  }
  
  // Remove all non-digit characters except a leading +
  let cleaned = p.replace(/(?!^\+)\D/g, '');
  
  // If it's a local AU number starting with 0
  if (cleaned.startsWith('0') && !cleaned.startsWith('00')) {
    return '+61' + cleaned.substring(1);
  }
  
  // If it starts with 61 but no +, add it
  if (cleaned.startsWith('61') && !cleaned.startsWith('+')) {
    return '+' + cleaned;
  }
  
  // If no prefix, assume it needs +61
  if (!cleaned.startsWith('+')) {
    return '+61' + cleaned;
  }
  
  return cleaned;
}

/**
 * Airtable Helper: Fetch contacts pre-sorted by Last_Interaction descending
 */
async function fetchAirtableContacts() {
  if (!airtableBaseId || !airtableTableId || !airtableToken) {
    throw new Error('Airtable configuration missing');
  }

  let allRecords = [];
  let offset = '';
  const sortQuery = 'sort[0][field]=Last_Interaction&sort[0][direction]=desc';

  do {
    const url = `https://api.airtable.com/v0/${airtableBaseId}/${airtableTableId}?${sortQuery}${offset ? `&offset=${offset}` : ''}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${airtableToken}` },
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Airtable error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    allRecords = allRecords.concat(data.records);
    offset = data.offset;
  } while (offset);

  console.log(`Totally fetched ${allRecords.length} contacts from Airtable (sorted by Last_Interaction desc)`);

  const seenPhones = new Set();
  const contacts = [];

  for (const r of allRecords) {
    if (!r.fields?.Phone) continue;
    const formatted = formatPhone(r.fields.Phone);
    if (seenPhones.has(formatted)) continue;
    seenPhones.add(formatted);

    const lastInteraction = r.fields['Last_Interaction'];
    contacts.push({
      phone: formatted,
      contact: {
        id: r.id,
        conversation_sid: r.fields['Conversation_SID'] ?? '',
        createdTime: r.createdTime,
        fields: { ...r.fields, Phone: formatted },
      },
      lastActivity: lastInteraction ? new Date(lastInteraction) : (r.createdTime ? new Date(r.createdTime) : null),
      is_registered: true,
      is_selected: false,
      hasUnread: false
    });
  }

  return contacts;
}

/**
 * Twilio Helper: Start or find a conversation
 */
async function startTwilioChat(recipientPhone) {
  const formattedPhone = formatPhone(recipientPhone);
  console.log(`[Twilio] Starting/Finding chat for: ${formattedPhone} (original: ${recipientPhone})`);
  
  try {
    // 1. Check for existing conversation with this participant
    const participantConversations = await client.conversations.v1.participantConversations
      .list({ address: formattedPhone, limit: 1 });

    if (participantConversations.length > 0) {
      console.log(`[Twilio] Found existing conversation: ${participantConversations[0].conversationSid}`);
      return participantConversations[0].conversationSid;
    }

    // 2. Create new conversation
    const conversation = await client.conversations.v1.conversations.create({
      friendlyName: `Chat with ${formattedPhone}`,
    });

    // 3. Add SMS participant
    await client.conversations.v1.conversations(conversation.sid).participants.create({
      'messagingBinding.address': formattedPhone,
      'messagingBinding.proxyAddress': twilioPhone,
    });

    // 4. Add identity participant (the browser user)
    await client.conversations.v1.conversations(conversation.sid).participants.create({
      identity: twilioIdentity,
    });

    return conversation.sid;
  } catch (err) {
    // Handle "Already exists" error by extracting SID from message if possible
    if (err.code === 50404 || err.message.includes('already exists')) {
      const sidMatch = err.message.match(/CH[a-fA-F0-9]{32}/);
      if (sidMatch) return sidMatch[0];
    }
    console.error('[Twilio] Error starting chat:', err);
    throw err;
  }
}

/**
 * Airtable Helper: Update last interaction timestamp
 */
async function updateAirtableLastInteraction(phoneOrSid, lastInteractionTime, conversationSid = null) {
  console.log('UPDATING LAST INTERACTION:', phoneOrSid, lastInteractionTime, conversationSid);
  if (!airtableBaseId || !airtableTableId || !airtableToken) return;

  try {
    const isSid = phoneOrSid.startsWith('CH');
    if (isSid && !conversationSid) {
      conversationSid = phoneOrSid; // If we're searching by SID, use it for the update
    }
    const formula = isSid 
      ? `{Conversation_SID} = '${phoneOrSid}'`
      : `{Phone} = '${formatPhone(phoneOrSid)}'`;
      
    const filter = encodeURIComponent(formula);
    const searchRes = await fetch(
      `https://api.airtable.com/v0/${airtableBaseId}/${airtableTableId}?filterByFormula=${filter}`,
      { headers: { Authorization: `Bearer ${airtableToken}` } }
    );

    if (!searchRes.ok) return;
    const data = await searchRes.json();
    if (data.records && data.records.length > 0) {
      const recordId = data.records[0].id;
      
      const fields = {
        'Last_Interaction': lastInteractionTime || new Date().toISOString()
      };
      
      // If we got a conversation SID, save it so subsequent lookups work
      if (conversationSid) {
        fields['Conversation_SID'] = conversationSid;
      }
      
      await fetch(`https://api.airtable.com/v0/${airtableBaseId}/${airtableTableId}/${recordId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${airtableToken}`
        },
        body: JSON.stringify({ fields })
      });
      console.log(`[Airtable] Updated record ${recordId} (Conversation_SID: ${conversationSid || 'no-change'})`);
    }
  } catch (err) {
    console.error('[Airtable] Error updating Last_Interaction:', err);
  }
}

// --- API ROUTES ---

app.get('/api/token', (req, res) => {
  try {
    const token = new AccessToken(twilioAccountId, twilioApiKey, twilioApiSecret, { identity: twilioIdentity });
    
    token.addGrant(new VoiceGrant({
      outgoingApplicationSid: twilioAppSid,
      incomingAllow: true,
    }));

    token.addGrant(new ChatGrant({
      serviceSid: twilioConvServiceSid,
    }));

    res.json({ token: token.toJwt() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

app.get('/api/contacts', async (req, res) => {
  try {
    const contacts = await fetchAirtableContacts();
    res.json(contacts);
  } catch (err) {
    console.error('[API] Failed to fetch contacts:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/create_conversation', async (req, res) => {
  const { name, phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number is required' });

  const formattedPhone = formatPhone(phone);

  try {
    const conversationSid = await startTwilioChat(formattedPhone);
    
    // Update Airtable if a name was provided
    console.log(`[API] Conversation SID: ${conversationSid} for phone: ${formattedPhone}, name: ${name || 'N/A'}`);
    if (name && conversationSid) {
      const nameParts = name.trim().split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      // 2. Check if contact already exists in Airtable
      const filter = encodeURIComponent(`{Phone} = '${formattedPhone}'`);
      const searchRes = await fetch(
        `https://api.airtable.com/v0/${airtableBaseId}/${airtableTableId}?filterByFormula=${filter}`,
        { headers: { Authorization: `Bearer ${airtableToken}` } }
      );

      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.records && searchData.records.length > 0) {
          // Contact exists! Update the existing record with Conversation_SID and Last_Interaction (PATCH)
          const recordId = searchData.records[0].id;
          console.log(`[Airtable] Contact already exists (ID: ${recordId}). Updating Conversation_SID...`);
          
          await fetch(`https://api.airtable.com/v0/${airtableBaseId}/${airtableTableId}/${recordId}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${airtableToken}`,
            },
            body: JSON.stringify({
              fields: {
                'Conversation_SID': conversationSid
              }
            })
          });
          
          return res.json({ conversationSid });
        }
      }

      // 3. Contact does not exist. Create new record (POST)
      console.log(`[Airtable] Saving new contact ${firstName} ${lastName}; Phone: ${formattedPhone}`);
      await fetch(`https://api.airtable.com/v0/${airtableBaseId}/${airtableTableId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${airtableToken}`,
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
    
    // Handle Twilio specific errors (e.g. invalid phone number)
    if (err.code === 21211 || err.code === 21608 || err.message.includes('not a valid phone number')) {
      return res.status(400).json({ error: 'Invalid phone number format. Please include country code (e.g. +1...)' });
    }

    res.status(500).json({ error: err.message || 'Failed to initialize conversation' });
  }
});

app.post('/api/send_sms', async (req, res) => {
  const { conversationSid, text } = req.body;
  if (!conversationSid || !text) return res.status(400).json({ error: 'Missing parameters' });

  try {
    const message = await client.conversations.v1.conversations(conversationSid).messages.create({ body: text });
    
    // Update Airtable async
    updateAirtableLastInteraction(conversationSid, message.dateCreated.toISOString());

    res.json({ success: true });
  } catch (err) {
    console.error('[API] Failed to send SMS:', err);
    res.status(500).json({ error: 'Failed to send SMS' });
  }
});

app.get('/api/messages', async (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: 'Phone is required' });

  const formattedPhone = formatPhone(phone);

  try {
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

app.post('/api/voice', (req, res) => {
  const to = req.body.To;
  const response = new VoiceResponse();
  response.dial({ callerId: twilioPhone }, to);
  res.type('text/xml').send(response.toString());
});

app.post('/api/contacts/update_last_interaction', async (req, res) => {
  const { phone, date, conversationSid } = req.body;
  if (!phone || !date) return res.status(400).json({ error: 'Missing parameters' });
  
  try {
    await updateAirtableLastInteraction(phone, date, conversationSid);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.json({'status': 'Backend Running'});
});


// Export or listen
if (PRODUCTION === 'desktop') {
  module.exports = app;
} else {
  const PORT = process.env.PORT || 5001;
  app.listen(PORT, () => {
    console.log(`[Server] Running on http://localhost:${PORT}`);
  });
}
