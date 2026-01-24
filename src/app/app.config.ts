import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideAuth, getAuth } from '@angular/fire/auth';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './auth-interceptor';

const firebaseConfig = {
  apiKey: "AIzaSyBp2jGsZKZMtj1NyT_ZDNdvFo0FRX0s-fA",
  authDomain: "twilio-messaging-8183c.firebaseapp.com",
  projectId: "twilio-messaging-8183c",
  storageBucket: "twilio-messaging-8183c.firebasestorage.app",
  messagingSenderId: "589640940481",
  appId: "1:589640940481:web:89defb3fca75c118a00d40",
  measurementId: "G-DZF1YLY099"
};


export const appConfig: ApplicationConfig = {
  providers: [
    provideFirebaseApp(() => initializeApp(firebaseConfig)),
    provideAuth(() => getAuth()),
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(
      withInterceptors([authInterceptor])
    ),
  ]
};
