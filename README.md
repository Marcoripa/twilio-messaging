# TWILIO-MESSAGING

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.0.4.

## Development server
Before running the show, dont forget to update the environmental variables.
- For the frontend, update src/environments.ts
- For the backend, update .env

To start a local development server, run:

```bash
ng serve
```

Then start the development backend with:

```bash
node server/index.js
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Deploy as a desktop app with Electron

Change variable PRODUCTION in .env file to be 'desktop'

# For Windows:
```bash
npm run build:electron
```
# For Mac/Linux:
```bash
npm run build:electron:mac
```

## Deploy on Firebase

First things first: build the frontend. This will create a folder named dist

```bash
ng build
```

In order to deploy on firebase, you must use the file functions/index.js

Next, deploy onto firebase with:

```bash
firebase deploy
```
Firebase/Google saves the secrets here: https://console.cloud.google.com/security/secret-manager?project=twilio-messaging-8183c 



TODO
1. Fetch conversations from unregistered contacts;
2. Refresh contact list after adding a new contact;
3. Make phone ring on incoming call;