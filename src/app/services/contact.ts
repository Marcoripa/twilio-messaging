import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map, catchError, tap } from 'rxjs/operators';
import { Contact } from '../shared/models/contact';
import { environment } from '../../environment';

@Injectable({
  providedIn: 'root',
})
export class ContactService {
  private readonly http = inject(HttpClient);

  getAll(): Observable<Contact[]> {
    return this.http.get<Contact[]>(`${environment.apiUrl}/contacts`);
  }

  startChat(name: string, phone: string): Observable<string> {
    console.log(`Creating a new conversation for ${name} with phone number ${phone}`);
    return this.http.post<{ conversationSid: string }>(
      `${environment.apiUrl}/create_conversation`, 
      { name, phone }
    ).pipe(
      map(res => res.conversationSid),
      tap(sid => console.log('Chat initialized with SID:', sid)),
      catchError(err => {
        console.error('Service Error:', err);
        throw err;
      })
    );
  }
}