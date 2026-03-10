import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
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

  saveContact(name: string, phone: string): Observable<any> {
    return this.http.post(`${environment.apiUrl}/save_contact`, { name, phone });
  }

  startChat(name: string, phone: string): Observable<any> {
    return this.http.post(`${environment.apiUrl}/start_chat`, { name, phone });
  }
}