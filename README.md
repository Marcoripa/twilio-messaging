# Twilio Messaging - Desktop Application

A cross-platform desktop application built with **Angular**, **Electron**, **Twilio**, and **Airtable**. It provides a real-time chat interface for managing SMS conversations.

## 🚀 Key Features
- **Real-time Chat**: Integrated with Twilio Conversations SDK.
- **Contact Management**: Synced with Airtable.
- **SMS History**: Merges Twilio Conversations with historical SMS logs.
- **Desktop Ready**: Built with Electron for Linux, Windows, and macOS.
- **Firebase Auth**: Secure login via Firebase Authentication.

---

## 🛠 Prerequisites
- **Node.js**: v18 or higher (v20+ recommended).
- **Twilio Account**: 
  - Account SID and Auth Token.
  - API Key and Secret (for Chat Tokens).
  - A Twilio Phone Number.
  - A Conversations Service SID.
- **Airtable Account**:
  - Personal Access Token (PAT).
  - Base ID and Table ID.
  - Required fields: `First Name`, `Last Name`, `Phone`, `Conversation_SID`.
- **Firebase Account**:
  - A Firebase project for Authentication.

---

## ⚙️ Setup Instructions

### 1. Clone & Install
```bash
npm install
```

### 2. Configuration
Create a `.env` file in the root directory (use `.env.example` as a template):
```env
PRODUCTION=desktop
PORT=5001

AIRTABLE_BASE_ID=your_base_id
AIRTABLE_TABLE_ID=your_table_id
AIRTABLE_TOKEN=your_pat_token

TWILIO_ACCOUNT_ID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_API_KEY=your_api_key
TWILIO_API_SECRET=your_api_secret
TWILIO_APP_SID=your_voice_app_sid
TWILIO_CONVERSATIONS_SERVICE_SID=your_service_sid
TWILIO_PHONE=+1234567890
TWILIO_IDENTITY=desktop_user
```

Update `src/environment.ts` (if needed):
```typescript
export const environment = {
    apiUrl: 'http://localhost:5001/api',
    twilio_Phone: '+1234567890'
};
```

---

## 💻 Development

### Start Angular Dev Server
```bash
npm start
```

### Start Express Backend (Separate process for dev)
```bash
node server/index.js
```

### Run Electron in Dev Mode
```bash
npm run electron:dev
```

---

## 📦 Build & Release

### Windows
```bash
npm run build:electron-win
```
*Creates a portable `.exe` in the `release/` folder.*

### Linux
First, fix sandbox permissions if needed:
```bash
sudo chown root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```
Build:
```bash
npm run build:electron-linux
```
*Creates an `.AppImage` or `.deb` in the `release/` folder.*

### macOS
```bash
npm run build:electron-mac
```

*Creates a `.dmg` or `.zip` in the `release/` folder.*

``` codesign --force --deep -s - release/mac-universal/TwilioMessaging.app ```



---

## 🔧 Technical Details & Optimization
- **TwilioService**: Optimized with listener management to prevent memory leaks and de-duplication logic for consistent message history.
- **Express Backend**: Securely handles Airtable sync and Twilio token generation.
- **Electron**: Configured with `contextIsolation` and `preload` scripts for maximum security.
- **Airtable**: Automatically saves new conversations and maps contacts to phone numbers.

## 📄 License
Private Project - All rights reserved.
