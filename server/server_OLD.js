const express = require("express");require("dotenv").config();
const path = require("path");
const cors = require("cors");
const https = require("https");
const querystring = require("querystring");

const app = express();
app.use(express.json());
app.use(cors());

const distPath = path.join(__dirname, "dist/frontend/browser");

const airtableBaseId = process.env.AIRTABLE_BASE_ID;
const airtableTableId = process.env.AIRTABLE_TABLE_ID;
const airtableBearerToken = process.env.AIRTABLE_TOKEN;
const airtableApi = process.env.AIRTABLE_API;

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const basicAuth = btoa(`${accountSid}:${authToken}`);
const twilioApi = process.env.TWILIO_API;
const twilio_phone_number = process.env.TWILIO_PHONE_NUMBER;

// Serve static files (js, css, images) from the dist folder
app.use(express.static(distPath));

app.get("/api/messages", (req, res) => {
  let toPhoneNumber = req.query.toPhoneNumber;

  const requestOptions = {
    method: "GET",
    headers: {
      Authorization: `Basic ${basicAuth}`,
    },
  };

  fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json?To=${toPhoneNumber}`,
    requestOptions
  )
    .then(response => {
      if (!response.ok) {
        throw new Error(`Twilio error: ${response.statusText}`);
      }
      return response.json();
    })
    .then(data => {
      res.json(data);
    })
    .catch(error => {
      console.error("Error fetching from Twilio:", error);
      res
        .status(500)
        .json({ error: "Internal Server Error", details: error.message });
    });
});

async function fetchContactMessages(phone) {
  const requestOptions = {
    method: "GET",
    headers: {
      Authorization: `Basic ${basicAuth}`,
    },
  };

  try {
    const [sentRes, receivedRes] = await Promise.all([
      fetch(
        `${twilioApi}/${accountSid}/Messages.json?To=${phone}`,
        requestOptions
      ),
      fetch(
        `${twilioApi}/${accountSid}/Messages.json?From=${phone}`,
        requestOptions
      ),
    ]);

    const sentData = await sentRes.json();
    const receivedData = await receivedRes.json();
    const allMessages = [...sentData.messages, ...receivedData.messages];

    allMessages.sort(
      (a, b) => new Date(a.date_created) - new Date(b.date_created)
    );
    const lastMessage = allMessages.at(-1);

    return {
      allMessages: allMessages,
      lastMessage: lastMessage || null,
    };
  } catch (error) {
    console.error(`Error fetching history for ${phone}:`, error);
    return [];
  }
}

app.get("/api/airtable_contacts", async (req, res) => {
  const requestOptions = {
    method: "GET",
    headers: {
      Authorization: `Bearer ${airtableBearerToken}`,
      "Content-Type": "application/json",
    },
  };

  try {
    const airtableRes = await fetch(
      `${airtableApi}/${airtableBaseId}/${airtableTableId}`,
      requestOptions
    );
    if (!airtableRes.ok)
      throw new Error(`Airtable error: ${airtableRes.statusText}`);

    const airtableData = await airtableRes.json();

    // Map records to an array of Promises
    const contactsWithData = await Promise.all(
      airtableData.records.map(async contact => {
        const { allMessages, lastMessage } = await fetchContactMessages(
          contact.fields.Phone
        );

        const latestTimestamp =
          allMessages.length > 0
            ? new Date(allMessages.at(-1).date_created).getTime()
            : 0;

        return {
          ...contact,
          messages: allMessages,
          last_message: lastMessage
            ? lastMessage
            : { from: "", to: "", body: "", date_created: "" },
          lastMessageTimestamp: latestTimestamp,
          is_selected: false,
        };
      })
    );

    contactsWithData.sort(
      (a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp
    );

    res.json(contactsWithData);
  } catch (error) {
    console.error("Server Error:", error);
    res
      .status(500)
      .json({ error: "Internal Server Error", details: error.message });
  }
});

app.post("/api/send_sms", (req, res) => {
  const { to, text } = req.body;

  const postData = querystring.stringify({
    From: twilio_phone_number,
    To: to,
    Body: text,
  });

  const options = {
    hostname: "api.twilio.com",
    path: `/2010-04-01/Accounts/${accountSid}/Messages.json`,
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
      "Content-Length": Buffer.byteLength(postData),
    },
  };

  const request = https.request(options, response => {
    let data = "";

    response.on("data", chunk => {
      data += chunk;
    });

    response.on("end", () => {
      console.log("Twilio response:", data);
    });
  });

  request.on("error", err => {
    console.error("Request error:", err);
  });

  request.write(postData);
  request.end();
});

async function fetchAllTwilioMessages() {
  const requestOptions = {
    method: "GET",
    headers: {
      Authorization: `Basic ${basicAuth}`,
    },
  };

  let allMessages = [];
  let nextUrl = `${twilioApi}/${accountSid}/Messages.json?PageSize=100`;

  while (nextUrl) {
    const res = await fetch(nextUrl, requestOptions);
    if (!res.ok) {
      throw new Error(`Twilio error: ${res.statusText}`);
    }

    const data = await res.json();
    allMessages.push(...data.messages);

    nextUrl = data.next_page_uri
      ? `https://api.twilio.com${data.next_page_uri}`
      : null;
  }

  return allMessages;
}

function groupMessagesByContact(messages) {
  const conversations = {};

  for (const msg of messages) {
    const contactPhone =
      msg.from === twilio_phone_number ? msg.to : msg.from;

    if (!conversations[contactPhone]) {
      conversations[contactPhone] = [];
    }

    conversations[contactPhone].push(msg);
  }

  // sort each conversation chronologically
  Object.values(conversations).forEach(list => {
    list.sort(
      (a, b) => new Date(a.date_created) - new Date(b.date_created)
    );
  });

  return conversations;
}

async function fetchAirtableContacts() {
  const res = await fetch(
    `${airtableApi}/${airtableBaseId}/${airtableTableId}`,
    {
      headers: {
        Authorization: `Bearer ${airtableBearerToken}`,
      },
    }
  );

  if (!res.ok) {
    throw new Error(`Airtable error: ${res.statusText}`);
  }

  const data = await res.json();

  return Object.fromEntries(
    data.records.map(r => [r.fields.Phone, r])
  );
}

app.get("/api/conversations", async (req, res) => {
  try {
    const [messages, airtableContacts] = await Promise.all([
      fetchAllTwilioMessages(),
      fetchAirtableContacts(),
    ]);

    const grouped = groupMessagesByContact(messages);

    const conversations = Object.entries(grouped).map(
      ([phone, msgs]) => {
        const lastMessage = msgs.at(-1);

        return {
          phone,
          contact: airtableContacts[phone] || null, // null = not registered
          messages: msgs,
          last_message: lastMessage,
          lastMessageTimestamp: new Date(
            lastMessage.date_created
          ).getTime(),
          is_registered: Boolean(airtableContacts[phone]),
          is_selected: false,
        };
      }
    );

    conversations.sort(
      (a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp
    );

    res.json(conversations);
  } catch (err) {
    console.error("Conversation fetch error:", err);
    res.status(500).json({ error: err.message });
  }
});


// Redirect all other requests to index.html
app.get(/^(?!\/api).+/, (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
