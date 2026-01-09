import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Contact } from '../shared/models/contact';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class ContactService {
  private readonly http = inject(HttpClient);
  private readonly API_URL = `${environment.apiUrl}/api/conversations`;

  getAll(): Observable<Contact[]> {
    console.log(`CALLING  ${this.API_URL}`)
    return this.http.get<Contact[]>(this.API_URL);
  }
}
