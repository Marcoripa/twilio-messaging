import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Auth, idToken } from '@angular/fire/auth'; // or your auth provider
import { Observable, switchMap, take } from 'rxjs';
import { Contact } from '../shared/models/contact';
import { environment } from '../../environment';

@Injectable({
  providedIn: 'root',
})
/* export class ContactService {
  private readonly http = inject(HttpClient);
  private readonly API_URL = `${environment.apiUrl}/conversations`;

  getAll(): Observable<Contact[]> {
    return this.http.get<Contact[]>(this.API_URL);
  }
} */

export class ContactService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(Auth);
  private readonly API_URL = `${environment.apiUrl}/conversations`;

  getAll(): Observable<Contact[]> {
    return idToken(this.auth).pipe(
      take(1), // Ensure the observable completes after getting the first token
      switchMap(token => {
        const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
        return this.http.get<Contact[]>(this.API_URL, { headers });
      })
    );
  }
}