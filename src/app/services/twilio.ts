import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environment';

@Injectable({
  providedIn: 'root',
})
export class TwilioService {
  private readonly http = inject(HttpClient);

  getAccessToken(): Observable<{ token: string }> {
    return this.http.get<{ token: string }>(`${environment.apiUrl}/token`);
  }

  sendSms(to: string, text: string): Observable<any> {
    return this.http.post(`${environment.apiUrl}/send_sms`, { to, text });
  }
}
