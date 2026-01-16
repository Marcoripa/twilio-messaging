const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config({ path: '../.env' });
const app = express();

const PRODUCTION = process.env.PRODUCTION;
const PORT = process.env.PORT;
const airtableBaseId = process.env.AIRTABLE_BASE_ID;
const airtableTableId = process.env.AIRTABLE_TABLE_ID;
const airtableToken = process.env.AIRTABLE_TOKEN;
const airtableApi = process.env.AIRTABLE_API;
const twilioAccountId = process.env.TWILIO_ACCOUNT_ID;
const twilioPhone = process.env.TWILIO_PHONE;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
/* const twilioApiKey = process.env.AIRTABLE_BASE_ID
const twilioApiSecret = process.env.AIRTABLE_BASE_ID
const twilioAppSid = process.env.AIRTABLE_BASE_ID */
const basicAuth = btoa(`${twilioAccountId}:${twilioAuthToken}`);

app.use(cors());
app.use(express.json());

app.post('/api/send_sms', (req, res) => {
  const { to, text } = req.body;

  const postData = querystring.stringify({
    From: twilioPhone,
    To: to,
    Body: text,
  });

  const options = {
    hostname: 'api.twilio.com',
    path: `/2010-04-01/Accounts/${twilioAccountId}/Messages.json`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
      'Content-Length': Buffer.byteLength(postData),
    },
  };

  const request = https.request(options, (response) => {
    let data = '';

    response.on('data', (chunk) => {
      data += chunk;
    });

    response.on('end', () => {
      console.log('Twilio response:', data);
    });
  });

  request.on('error', (err) => {
    console.error('Request error:', err);
  });

  request.write(postData);
  request.end();
});

async function fetchAllTwilioMessages() {
  const requestOptions = {
    method: 'GET',
    headers: {
      Authorization: `Basic ${basicAuth}`,
    },
  };

  let allMessages = [];
  let nextUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountId}/Messages.json?PageSize=100`;

  while (nextUrl) {
    const res = await fetch(nextUrl, requestOptions);
    if (!res.ok) {
      throw new Error(`Twilio error: ${res.statusText}`);
    }

    const data = await res.json();
    allMessages.push(...data.messages);

    nextUrl = data.next_page_uri ? `https://api.twilio.com${data.next_page_uri}` : null;
  }

  return allMessages;
}

function groupMessagesByContact(messages) {
  const conversations = {};

  for (const msg of messages) {
    const contactPhone = msg.from === twilioPhone ? msg.to : msg.from;

    if (!conversations[contactPhone]) {
      conversations[contactPhone] = [];
    }

    conversations[contactPhone].push(msg);
  }

  // sort each conversation chronologically
  Object.values(conversations).forEach((list) => {
    list.sort((a, b) => new Date(a.date_created) - new Date(b.date_created));
  });

  return conversations;
}

async function fetchAirtableContacts() {
  const res = await fetch(`${airtableApi}/${airtableBaseId}/${airtableTableId}`, {
    headers: {
      Authorization: `Bearer ${airtableToken}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Airtable error: ${res.statusText}`);
  }

  const data = await res.json();

  return Object.fromEntries(data.records.map((r) => [r.fields.Phone, r]));
}

app.get('/api/conversations', async (req, res) => {
  try {
    const [messages, airtableContacts] = await Promise.all([
      fetchAllTwilioMessages(),
      fetchAirtableContacts(),
    ]);

    const groupedMessages = groupMessagesByContact(messages);

    /* const conversations = Object.entries(grouped).map(([phone, msgs]) => {
      const lastMessage = msgs.at(-1);

      return {
        phone,
        contact: airtableContacts[phone] || null, // null = not registered
        messages: msgs,
        last_message: lastMessage,
        lastMessageTimestamp: new Date(lastMessage.date_created).getTime(),
        is_registered: Boolean(airtableContacts[phone]),
        is_selected: false,
      };
    }); */
    const conversations = Object.entries(airtableContacts).map(
      ([phone, contact]) => {
        const msgs = groupedMessages[phone] || [];
        const lastMessage = msgs.at(-1) || null;

        return {
          phone,
          contact,
          messages: msgs,
          last_message: lastMessage,
          lastMessageTimestamp: lastMessage
            ? new Date(lastMessage.date_created).getTime()
            : 0,
          is_registered: true,
          is_selected: false,
        };
      }
    );

    Object.entries(groupedMessages).forEach(([phone, msgs]) => {
      if (!airtableContacts[phone]) {
        const lastMessage = msgs.at(-1);

        conversations.push({
          phone,
          contact: null,
          messages: msgs,
          last_message: lastMessage,
          lastMessageTimestamp: new Date(lastMessage.date_created).getTime(),
          is_registered: false,
          is_selected: false,
        });
      }
    });

    conversations.sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);

    res.json(conversations);
  } catch (err) {
    console.error('Conversation fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

if (PRODUCTION == 'desktop') {
  module.exports = app;
} else {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
