# TWILIO-MESSAGING

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.0.4.

## Development server
Before running the show, dont forget to update the environmental variables.
- For the frontend, update src/environment.ts:
    - apiUrl:  'http://localhost:5000/api', for local development and desktop app
    - apiUrl: '/api', for deploying onto Firebase
- For the backend, update .env
    - PRODUCTION = local for local development
    - PRODUCTION = firebase for deploying onto Firebase
    - PRODUCTION = desktop for deploying as a desktop app (with Electron)

Install node dependencies with: 
```bash
npm install
```

To start a local development server, make sure you have the Angular cli and the twilio sdk:

```bash
npm install -g @angular/cli
npm install --save @twilio/conversations
```


Then run with:

```bash
ng serve
```

To start the development backend run:

```bash
node server/index.js
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Deploy as Desktop app with Electron


Ensure the frontend is built:
```bash
ng build
```
run a development environment with 
```bash
npm run electron:dev
```

- Windows:
    1. build and start desktop Electron app with:
    ```bash
    npm run build:electron
    ```

- Linux:
    1. ensure chrome-sandbox has the right permissions:
    ```bash
    sudo chown root node_modules/electron/dist/chrome-sandbox
    sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
    ```

    2. build and start desktop Electron app with:
    ```bash
    npm run build:electron-linux
    ```

- Mac:

build and start desktop Electron app with:
```bash
npm run build:electron-mac
```

run a development environment with 
```bash
npm run electron:dev
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



TODOS:
1. Add a loading when conversation is loading
2. Messages are displayed in the wrong conversation when a conversation is open