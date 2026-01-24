const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/https");
const admin = require('firebase-admin');
const { defineSecret } = require("firebase-functions/params");
const express = require('express');
const cors = require('cors');
const twilio = require('twilio');

admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

const TWILIO_ACCOUNT_ID = defineSecret("TWILIO_ACCOUNT_ID");
const TWILIO_AUTH_TOKEN = defineSecret("TWILIO_AUTH_TOKEN");
const TWILIO_API_KEY = defineSecret("TWILIO_API_KEY");
const TWILIO_API_SECRET = defineSecret("TWILIO_API_SECRET");
const TWILIO_APP_SID = defineSecret("TWILIO_APP_SID");
const TWILIO_PHONE = defineSecret("TWILIO_PHONE");
const AIRTABLE_TOKEN = defineSecret("AIRTABLE_TOKEN");
const AIRTABLE_BASE_ID = defineSecret("AIRTABLE_BASE_ID");
const AIRTABLE_TABLE_ID = defineSecret("AIRTABLE_TABLE_ID");

const { AccessToken } = twilio.jwt;
const { VoiceGrant } = AccessToken;
const { twiml: { VoiceResponse } } = twilio;

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const validateToken = async (req, res, next) => {
  const idToken = req.headers.authorization?.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    res.status(403).send('Unauthorized');
  }
};

async function fetchAllTwilioMessages() {
  const auth = Buffer.from(`${TWILIO_ACCOUNT_ID.value()}:${TWILIO_AUTH_TOKEN.value()}`).toString('base64');
  let allMessages = [];
  let nextUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_ID.value()}/Messages.json?PageSize=100`;

  while (nextUrl) {
    const res = await fetch(nextUrl, { headers: { Authorization: `Basic ${auth}` } });
    if (!res.ok) throw new Error(`Twilio error: ${res.statusText}`);
    const data = await res.json();
    allMessages.push(...data.messages);
    nextUrl = data.next_page_uri ? `https://api.twilio.com${data.next_page_uri}` : null;
  }
  return allMessages;
}

async function fetchAirtableContacts() {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID.value()}/${AIRTABLE_TABLE_ID.value()}`, {
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN.value()}` },
  });
  if (!res.ok) throw new Error(`Airtable error: ${res.statusText}`);
  const data = await res.json();
  return Object.fromEntries(data.records.map((r) => [r.fields.Phone, r]));
}

function groupMessagesByContact(messages) {
  const conversations = {};
  for (const msg of messages) {
    const contactPhone = msg.from === TWILIO_PHONE.value() ? msg.to : msg.from;
    if (!conversations[contactPhone]) conversations[contactPhone] = [];
    conversations[contactPhone].push(msg);
  }
  Object.values(conversations).forEach(list => list.sort((a, b) => new Date(a.date_created) - new Date(b.date_created)));
  return conversations;
}

// --- Proteced Routes ---

app.get('/api/conversations', validateToken, async (req, res) => {
  try {
    const [messages, airtableContacts] = await Promise.all([
      fetchAllTwilioMessages(),
      fetchAirtableContacts(),
    ]);

    const groupedMessages = groupMessagesByContact(messages);
    const conversations = Object.entries(airtableContacts).map(([phone, contact]) => {
      const msgs = groupedMessages[phone] || [];
      const lastMessage = msgs.at(-1) || null;
      return {
        phone, contact, messages: msgs, last_message: lastMessage,
        lastMessageTimestamp: lastMessage ? new Date(lastMessage.date_created).getTime() : 0,
        is_registered: true, is_selected: false,
      };
    });

    Object.entries(groupedMessages).forEach(([phone, msgs]) => {
      if (!airtableContacts[phone]) {
        const lastMessage = msgs.at(-1);
        conversations.push({
          phone, contact: null, messages: msgs, last_message: lastMessage,
          lastMessageTimestamp: new Date(lastMessage.date_created).getTime(),
          is_registered: false, is_selected: false,
        });
      }
    });

    conversations.sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
    res.json(conversations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/save_contact', validateToken, async (req, res) => {
  //TODO: check the contact is not listed yet
  const { name, phone } = req.body;

  try {
    const response = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID.value()}/${AIRTABLE_TABLE_ID.value()}`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AIRTABLE_TOKEN.value()}`,
      },
      body: JSON.stringify({
        records: [
                {
                  fields: {
                    Name: name,
                    'Shoot Date': '',
                    Phone: phone,
                    Email: '',
                  },
                },
              ]
      })
    });
    const result = await response.json();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
})

app.post('/api/send_sms', validateToken, async (req, res) => {
  const { to, text } = req.body;
  const auth = Buffer.from(`${TWILIO_ACCOUNT_ID.value()}:${TWILIO_AUTH_TOKEN.value()}`).toString('base64');
  
  const body = new URLSearchParams({
    From: TWILIO_PHONE.value(),
    To: to,
    Body: text,
  });

  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_ID.value()}/Messages.json`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${auth}`
      },
      body: body.toString()
    });
    const result = await response.json();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -- Public Routes --

app.get('/api/token', (req, res) => {
  const identity = 'browser_user';
  const token = new AccessToken(
    TWILIO_ACCOUNT_ID.value(), 
    TWILIO_API_KEY.value(), 
    TWILIO_API_SECRET.value(), 
    { identity }
  );

  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: TWILIO_APP_SID.value(),
    incomingAllow: true,
  });

  token.addGrant(voiceGrant);
  res.json({ token: token.toJwt() });
});

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
    "AIRTABLE_TOKEN", "AIRTABLE_BASE_ID", "AIRTABLE_TABLE_ID"
  ],
  enforceAppCheck: true
}, app);
