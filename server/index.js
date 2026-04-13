const functions = require('firebase-functions');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const twilio = require('twilio');
const path = require('path');

const { AccessToken } = twilio.jwt;
const { VoiceGrant, ChatGrant } = AccessToken;
const {
  twiml: { VoiceResponse },
} = twilio;

dotenv.config({
  path: path.resolve(__dirname, '../.env'),
});

const PRODUCTION = process.env.PRODUCTION;
const PORT = process.env.PORT;
const airtableBaseId = process.env.AIRTABLE_BASE_ID;
const airtableTableId = process.env.AIRTABLE_TABLE_ID;
const airtableToken = process.env.AIRTABLE_TOKEN;
const twilioAccountId = process.env.TWILIO_ACCOUNT_ID;
const twilioPhone = process.env.TWILIO_PHONE;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const twilioApiKey = process.env.TWILIO_API_KEY;
const twilioApiSecret = process.env.TWILIO_API_SECRET;
const twilioAppSid = process.env.TWILIO_APP_SID;
const twilioConvServiceSid = process.env.TWILIO_CONVERSATIONS_SERVICE_SID;
const twilioIdentity = process.env.TWILIO_IDENTITY;

const client = twilio(twilioAccountId, twilioAuthToken);
const basicAuth = btoa(`${twilioAccountId}:${twilioAuthToken}`);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));


async function fetchAirtableContacts() {
  const res = await fetch(`https://api.airtable.com/v0/${airtableBaseId}/${airtableTableId}`, {
    headers: {
      Authorization: `Bearer ${airtableToken}`,
    },
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

app.get('/api/token', (req, res) => {
  const token = new AccessToken(twilioAccountId, twilioApiKey, twilioApiSecret, { identity: twilioIdentity });

  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: twilioAppSid,
    incomingAllow: true,
  });
  token.addGrant(voiceGrant);

  const chatGrant = new ChatGrant({
    serviceSid: twilioConvServiceSid,
  });
  token.addGrant(chatGrant);

  res.json({ token: token.toJwt() });
});

async function startTwilioChat(recipientPhone) {
  console.log('Starting chat with phone number', recipientPhone)
  try {
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
      'messagingBinding.proxyAddress': twilioPhone,
    });

    await client.conversations.v1.conversations(conversation.sid).participants.create({
      identity: twilioIdentity,
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

// TwiML endpoint
app.post('/api/voice', (req, res) => {
  const to = req.body.To;
  const response = new VoiceResponse();
  response.dial({ callerId: twilioPhone }, to);
  res.type('text/xml');
  res.send(response.toString());
});

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
        `https://api.airtable.com/v0/${airtableBaseId}/${airtableTableId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${airtableToken}`,
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

app.get('/api/messages', async (req, res) => {
  const { phone } = req.query;
  console.log(phone)

  const [sent, received] = await Promise.all([
    client.messages.list({ from: phone, limit: 50 }),
    client.messages.list({ to: phone, limit: 50 })
  ]);

  res.json([...sent, ...received]);
});


if (PRODUCTION == 'desktop') {
  module.exports = app;
} else if (PRODUCTION == 'firebase') {
  exports.api = functions.https.onRequest(app);
} else {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
