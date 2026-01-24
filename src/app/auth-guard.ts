import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth, user } from '@angular/fire/auth';
import { map, take } from 'rxjs';

export const authGuard: CanActivateFn = (route, state) => {
  const auth = inject(Auth);
  const router = inject(Router);

  // We use the user observable to check the current auth state
  return user(auth).pipe(
    take(1), // We only need the current value once to make the decision
    map((currentUser) => {
      if (currentUser) {
        return true; // You are logged in, proceed!
      } else {
        // Not logged in, send them back to the login page
        return router.parseUrl('/login'); 
      }
    })
  );
};