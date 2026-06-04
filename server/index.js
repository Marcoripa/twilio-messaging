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
 * Airtable Helper: Fetch all contacts (handles pagination)
 */
async function fetchAirtableContacts() {
  if (!airtableBaseId || !airtableTableId || !airtableToken) {
    throw new Error('Airtable configuration missing');
  }

  let allRecords = [];
  let offset = '';

  do {
    const url = `https://api.airtable.com/v0/${airtableBaseId}/${airtableTableId}${offset ? `?offset=${offset}` : ''}`;
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

  console.log(`Totally fetched ${allRecords.length} contacts from Airtable`)

  return Object.fromEntries(
    allRecords
      .filter(r => r.fields?.Phone)
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

/**
 * Twilio Helper: Start or find a conversation
 */
async function startTwilioChat(recipientPhone) {
  console.log(`[Twilio] Starting/Finding chat for: ${recipientPhone}`);
  try {
    // 1. Check for existing conversation with this participant
    const participantConversations = await client.conversations.v1.participantConversations
      .list({ address: recipientPhone, limit: 1 });

    if (participantConversations.length > 0) {
      console.log(`[Twilio] Found existing conversation: ${participantConversations[0].conversationSid}`);
      return participantConversations[0].conversationSid;
    }

    // 2. Create new conversation
    const conversation = await client.conversations.v1.conversations.create({
      friendlyName: `Chat with ${recipientPhone}`,
    });

    // 3. Add SMS participant
    await client.conversations.v1.conversations(conversation.sid).participants.create({
      'messagingBinding.address': recipientPhone,
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

app.post('/api/create_conversation', async (req, res) => {
  const { name, phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number is required' });

  try {
    const conversationSid = await startTwilioChat(phone);
    
    // Update Airtable if a name was provided
    if (name && conversationSid) {
      const nameParts = name.trim().split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      console.log(`Saving new contact ${firstName} ${lastName}; Phone: ${phone}`);

      const response = await fetch(`https://api.airtable.com/v0/${airtableBaseId}/${airtableTableId}`, {
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
              'Phone': phone,
              'Conversation_SID': conversationSid
            }
          }]
        })
      });
    }

    res.json({ conversationSid });
  } catch (err) {
    console.error('[API] Failed to create conversation:', err);
    
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
    await client.conversations.v1.conversations(conversationSid).messages.create({ body: text });
    res.json({ success: true });
  } catch (err) {
    console.error('[API] Failed to send SMS:', err);
    res.status(500).json({ error: 'Failed to send SMS' });
  }
});

app.get('/api/messages', async (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: 'Phone is required' });

  try {
    const [sent, received] = await Promise.all([
      client.messages.list({ from: phone, limit: 50 }),
      client.messages.list({ to: phone, limit: 50 })
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

