# TWILIO-MESSAGING

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.0.4.

## Development server
Before running the show, dont forget to update the environmental variables.
- For the frontend, update environments.ts
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

## Deploy as Desktop app with Electron

## Deploy on Firebase

First things first: build the frontend. This will create a folder named dist

```bash
ng build
```

Next, deploy onto firebase with:

```bash
firebase deploy
```

