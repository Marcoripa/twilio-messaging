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

---

## ☁️ Firebase Backend Deployment

The backend is fully prepared to run as a **Firebase Cloud Function** (configured in [functions/index.js](file:///home/marco/Desktop/Projects/twilio-messaging/functions/index.js)). Follow these steps to deploy it:

### 1. Install & Log In to Firebase CLI
Make sure you have the Firebase CLI tools installed:
```bash
npm install -g firebase-tools
firebase login
```

### 2. Configure Twilio & Airtable Secrets
Since the cloud function runs in a secure sandbox, you must store your API keys and tokens in Google Cloud Secret Manager via the Firebase CLI:
```bash
firebase functions:secrets:set TWILIO_ACCOUNT_ID="your_account_sid"
firebase functions:secrets:set TWILIO_AUTH_TOKEN="your_auth_token"
firebase functions:secrets:set TWILIO_API_KEY="your_api_key"
firebase functions:secrets:set TWILIO_API_SECRET="your_api_secret"
firebase functions:secrets:set TWILIO_APP_SID="your_voice_app_sid"
firebase functions:secrets:set TWILIO_PHONE="your_twilio_phone_number"
firebase functions:secrets:set TWILIO_CONVERSATIONS_SERVICE_SID="your_conversations_sid"
firebase functions:secrets:set TWILIO_IDENTITY="mobile_user"
firebase functions:secrets:set AIRTABLE_TOKEN="your_airtable_token"
firebase functions:secrets:set AIRTABLE_BASE_ID="your_base_id"
firebase functions:secrets:set AIRTABLE_TABLE_ID="your_table_id"
```

### 3. Deploy the Functions
Deploy only the functions codebase to your Firebase project:
```bash
firebase deploy --only functions
```
Once completed, the CLI will output your Function URL (e.g., `https://api-api-8183c.run.app`). Update your frontend's `environment.ts` `apiUrl` to point to this secure hosted URL.

---

## 📱 Mobile App Wrapper (iOS & Android)

You can wrap the Angular frontend into a native iOS and Android application using **Capacitor**.

### 1. Initialize Capacitor
Initialize Capacitor config in your project root:
```bash
npm run cap:init
```

### 2. Add Mobile Platforms
Add the platforms you want to build for:
```bash
# Add iOS (iPhone/iPad) support
npm run cap:add-ios

# Add Android support
npm run cap:add-android
```

### 3. Sync Angular Code to Mobile
Build the Angular frontend for production and sync it to the native projects:
```bash
npm run cap:sync
```

---

## 🍏 Building & Installing onto iPhone (iOS)

To run the app on an iPhone, you need a Mac with **Xcode** installed.

### Method A: Install Directly via USB (Free Apple Developer Account)
1. Plug your iPhone into your Mac using a USB cable.
2. Open the project in Xcode:
   ```bash
   npm run cap:open-ios
   ```
3. In Xcode, select your project in the sidebar, go to the **Signing & Capabilities** tab, and select your Personal Team under "Team".
4. Select your connected iPhone from the scheme/device dropdown at the top.
5. Click the **Play button (Build and Run)**. Xcode will compile the app and install it onto your iPhone.
6. On your iPhone, go to **Settings > General > VPN & Device Management**, find your developer profile, and tap **Trust**.

### Method B: Build IPA for Wireless Distribution (Ad-Hoc / Diawi)
1. Open the project in Xcode (`npm run cap:open-ios`).
2. Go to **Product > Archive**.
3. Once the archive completes, click **Distribute App** in the Organizer.
4. Select **Ad Hoc** (requires registering your iPhone's UDID in Apple Developer Console) or **App Store Connect (TestFlight)**.
5. Export the `.ipa` file.
6. Upload the `.ipa` to [Diawi](https://www.diawi.com/) and scan the QR code with your iPhone to install it over the air.

---

## 🤖 Building & Installing APK (Android)

To build and run on Android, you need **Android Studio** installed.

### 1. Open the Project in Android Studio
```bash
npm run cap:open-android
```

### 2. Build the Debug/Release APK
* **Debug APK (Fastest)**: In Android Studio, go to **Build > Build Bundle(s) / APK(s) > Build APK(s)**. The APK will be generated under `android/app/build/outputs/apk/debug/app-debug.apk`.
* **Release APK**: Go to **Build > Generate Signed Bundle / APK**, create a keystore key, and build a signed release APK.

### 3. Install on Mobile Phone
* **Via USB**: Enable **Developer Options** and **USB Debugging** on your Android phone, plug it into your computer, and click the **Run** button in Android Studio.
* **Via Direct Download**: Transfer the `.apk` file to your phone (via Google Drive, email, or USB), open the file manager on your phone, and tap the APK to install it (enable "Install from Unknown Sources" if prompted).

---

## 📄 License
Private Project - All rights reserved.
