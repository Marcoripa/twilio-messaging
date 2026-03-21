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
const TWILIO_CONVERSATIONS_SERVICE_SID = defineSecret("TWILIO_CONVERSATIONS_SERVICE_SID")
const TWILIO_IDENTITY = defineSecret("TWILIO_IDENTITY")

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

async function fetchAirtableContacts() {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID.value()}/${AIRTABLE_TABLE_ID.value()}`, {
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN.value()}` },
  });
  if (!res.ok) {
    throw new Error(`Airtable error: ${res.statusText}`);
  }

  const data = await res.json();

  return Object.fromEntries(
    data.records
      .filter(r => r.fields?.Phone) // only keep records with a phone number
      .map(r => [
        r.fields.Phone,
        {
          id: r.id,
          conversation_sid: r.fields['Conversation_SID'] ?? '',
          createdTime: r.createdTime,
          fields: r.fields,
        }
      ])
  );
}

// --- Proteced Routes --- 

app.get('/api/contacts', async (req, res) => {
  const [airtableContacts] = await Promise.all([fetchAirtableContacts()]);

  const contacts = Object.entries(airtableContacts).map(([phone, contact]) => {
      return {
        phone,
        contact,
        is_registered: true,
        is_selected: false
      };
    });

  res.json(contacts);
});

app.post('/api/create_conversation', async (req, res) => {
  try {
    const { name, phone } = req.body;
    
    const conversationSid = await startTwilioChat(phone);

    if (name && conversationSid) {
      const nameParts = (name || '').split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      const postData = {
        records: [{
          fields: {
            'First Name': firstName,
            'Last Name': lastName,
            'Phone': phone,
            'Conversation_SID': conversationSid
          }
        }]
      };

      const airtableResponse = await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID.value()}/${AIRTABLE_TABLE_ID.value()}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${AIRTABLE_TOKEN.value()}`,
          },
          body: JSON.stringify(postData)
        }
      );

      const airtableData = await airtableResponse.json();
      console.log('Airtable saved:', airtableData);

      res.status(200).json({ conversationSid });
    } else {
      console.warn('Name missing, impossible to initialize conversation');
      res.status(500).json({ error: 'Failed to initialize conversation' });
    }
  } catch (error) {
    console.error('Failed to initialize conversation:', error);
    res.status(500).json({ error: 'Failed to initialize conversation' });
  }
});

app.post('/api/send_sms', async (req, res) => {
  const { conversationSid, text } = req.body;

  console.log(conversationSid)
  console.log(text)

  try {
    const client = getTwilioClient();

    await client.conversations.v1
      .conversations(conversationSid)
      .messages
      .create({
        body: text
      });

    res.status(200).json({ conversationSid });
  } catch(err) {
    console.error('Failed to send sms:', err);
    res.status(500).json({ err: 'Failed to send sms' });
  }
});

app.get('/api/token', validateToken, (req, res) => {
  const token = new AccessToken(TWILIO_ACCOUNT_ID.value(), TWILIO_API_KEY.value(), TWILIO_API_SECRET.value(), { identity: TWILIO_IDENTITY.value() });

  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: TWILIO_APP_SID.value(),
    incomingAllow: true,
  });
  token.addGrant(voiceGrant);

  const chatGrant = new ChatGrant({
    serviceSid: TWILIO_CONVERSATIONS_SERVICE_SID.value(),
  });
  token.addGrant(chatGrant);

  res.json({ token: token.toJwt() });
});

async function startTwilioChat(recipientPhone) {
  console.log('Starting chat with phone number', recipientPhone)
  try {
    const client = getTwilioClient();
    // 1. Look for existing conversations for this phone number
    const participantConversations = await client.conversations.v1.participantConversations
      .list({ address: recipientPhone, limit: 1 });

    if (participantConversations.length > 0) {
      console.log('Existing conversation found:', participantConversations[0].conversationSid);
      return participantConversations[0].conversationSid;
    }

    const conversation = await client.conversations.v1.conversations.create({
      friendlyName: recipientPhone,
    });

    await client.conversations.v1.conversations(conversation.sid).participants.create({
      'messagingBinding.address': recipientPhone,
      'messagingBinding.proxyAddress': TWILIO_PHONE.value(),
    });

    await client.conversations.v1.conversations(conversation.sid).participants.create({
      identity: TWILIO_IDENTITY.value(),
    });

    return conversation.sid
  } catch (err) {
    if (err.code === 50404 || err.message.includes('already exists in Conversation')) {
    const sidMatch = err.message.match(/CH[a-fA-F0-9]{32}/);
    
      if (sidMatch) {
        const existingSid = sidMatch[0];
        console.log('Found existing conversation SID:', existingSid);
        return existingSid;
      }
    }

    console.error('An actual error occurred:', err);
    return null;
  }
}

// -- Public Routes --

app.post('/api/voice', (req, res) => {
  const to = req.body.To;
  const response = new VoiceResponse();
  response.dial({ callerId: TWILIO_PHONE.value() }, to);
  res.type('text/xml');
  res.send(response.toString());
});

// --- Firebase Export ---

exports.api = onRequest({ 
  secrets: [
    "TWILIO_ACCOUNT_ID", "TWILIO_AUTH_TOKEN", "TWILIO_API_KEY", 
    "TWILIO_API_SECRET", "TWILIO_APP_SID", "TWILIO_PHONE", 
    "AIRTABLE_TOKEN", "AIRTABLE_BASE_ID", "AIRTABLE_TABLE_ID", 
    "TWILIO_CONVERSATIONS_SERVICE_SID", "TWILIO_IDENTITY"
  ],
  enforceAppCheck: true
}, app);
