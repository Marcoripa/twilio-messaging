import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Contact } from '../../shared/models/contact';
import { ContactService } from '../../services/contact';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './home.html',
  styleUrls: ['./home.scss'],
})
export class Home {
  contacts: Contact[] = [];
  filteredContacts: Contact[] = [];
  searchTerm: string = '';
  selectedContact?: Contact;
  newMessage = '';
  twilioPhone = environment.twilioPhone;

  constructor(
    private contactService: ContactService,
    private http: HttpClient,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.refreshData();

    // Refresh every 5 seconds
    setInterval(() => {
      this.refreshData();
    }, 5000);
  }

  refreshData() {
    this.contactService.getAll().subscribe((serverContacts) => {
      // Replace arrays to trigger change detection
      this.contacts = [...serverContacts];
      this.filteredContacts = [...serverContacts];

      // Preserve selected contact
      if (this.selectedContact) {
        this.selectedContact = this.contacts.find(
          (c) => c.phone === this.selectedContact?.phone
        );
      }

      // Force Angular to detect changes
      this.cd.detectChanges();
    });
  }

  search(term: string): void {
    const trimmed = term.trim().toLowerCase();
    if (!trimmed) {
      this.filteredContacts = [...this.contacts];
      this.cd.detectChanges();
      return;
    }

    this.filteredContacts = this.contacts.filter((contact) => {
      const phoneMatches = contact.phone?.toLowerCase().includes(trimmed);
      const nameMatches = contact.contact?.fields?.Name?.toLowerCase().includes(trimmed);
      return phoneMatches || nameMatches;
    });

    this.cd.detectChanges();
  }

  getContactLabel(contact: Contact): string {
    const fields = contact.contact?.fields;
    if (!fields?.Name) return contact.phone;

    return fields['Shoot Date'] ? `${fields.Name} | ${fields['Shoot Date']}` : fields.Name;
  }

  trackByPhone(index: number, contact: Contact): string {
    return contact.phone;
  }

  onContactSelect(contact: Contact) {
    this.contacts.forEach((c) => (c.is_selected = false));
    contact.is_selected = true;
    this.selectedContact = contact;

    setTimeout(() => {
      const container = document.querySelector('.messages');
      if (container) container.scrollTop = container.scrollHeight;
    }, 0);
  }

  calculateTimeDifference(date_created: string): string {
    if (!date_created) return '';

    const past = new Date(date_created);
    const now = new Date();
    const diff = now.getTime() - past.getTime();

    const units = [
      { label: 'year', ms: 1000 * 60 * 60 * 24 * 365 },
      { label: 'month', ms: 1000 * 60 * 60 * 24 * 30 },
      { label: 'day', ms: 1000 * 60 * 60 * 24 },
      { label: 'hour', ms: 1000 * 60 * 60 },
      { label: 'minute', ms: 1000 * 60 },
    ];

    for (const u of units) {
      const value = Math.floor(diff / u.ms);
      if (value > 0) return `${value} ${u.label}${value > 1 ? 's' : ''} ago`;
    }

    return 'just now';
  }

  sendMessage() {
    if (!this.newMessage.trim() || !this.selectedContact) return;

    const payload = {
      to: this.selectedContact.phone,
      text: this.newMessage.trim(),
    };

    this.selectedContact.messages = [
      ...this.selectedContact.messages,
      {
        from: this.twilioPhone,
        to: this.selectedContact.phone,
        body: this.newMessage.trim(),
        date_created: new Date().toISOString(),
      },
    ];

    this.http.post(`${environment.apiUrl}/api/send_sms`, payload).subscribe({
      next: (res) => console.log('SMS sent:', res),
      error: (err) => console.error('Error sending SMS:', err)
    });
   

    this.newMessage = '';
    this.refreshData();

    // Scroll to bottom
    setTimeout(() => {
      const container = document.querySelector('.messages');
      if (container) container.scrollTop = container.scrollHeight;
    }, 0);
  }
}
