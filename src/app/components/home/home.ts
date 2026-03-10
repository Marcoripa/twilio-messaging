import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Contact } from '../../shared/models/contact';
import { ContactService } from '../../services/contact';
import { TwilioService } from '../../services/twilio';
import { firstValueFrom } from 'rxjs';
import { Device, Call } from '@twilio/voice-sdk';
import { environment } from '../../../environment';

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
  twilioPhone = environment.twilio_Phone;
  isModalOpen = false;
  isPhoneCallModalOpen = false;
  device: Device | undefined;
  twilioCallStatus = '';
  activeCall: Call | null = null;
  messages$;
  unreadCounts$;

  constructor(
    private contactService: ContactService,
    private twilioService: TwilioService,
    private http: HttpClient,
    private cd: ChangeDetectorRef,
  ) {
    this.messages$ = this.twilioService.messages$;
    this.unreadCounts$ = this.twilioService.unreadCounts$;
  }

  async ngOnInit() {
    this.contactService.getAll().subscribe((serverContacts) => {
      console.log(serverContacts)
      this.contacts = [...serverContacts];
      if (this.filteredContacts.length === 0) {
        this.filteredContacts = [...serverContacts];
      }

      // Force Angular to detect changes
      this.cd.detectChanges();
    });

    try {
      const res = await firstValueFrom(this.twilioService.getAccessToken());
      await this.twilioService.initialize(res.token);

      // sort contacts after conversations are available
      await this.sortContactsByConversationActivity();
      this.twilioService.messageEvents$.subscribe((conversationSid) => {
        if (!conversationSid) return;

        this.moveContactToTop(conversationSid);
      });

    } catch (err) {
      console.error('Twilio initialization failed', err);
    }
  }

  moveContactToTop(conversationSid: string) {
    const index = this.contacts.findIndex(
      c => c.contact.conversation_sid === conversationSid
    );

    if (index === -1) return;

    const contact = this.contacts.splice(index, 1)[0];
    this.contacts.unshift(contact);

    this.filteredContacts = [...this.contacts];
    this.cd.detectChanges();
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

  async sortContactsByConversationActivity() {
    const conversations = await this.twilioService.getSubscribedConversations();

    const conversationMap = new Map(
      conversations.map(c => [c.sid, c])
    );

    this.contacts.sort((a, b) => {
      const aConv = conversationMap.get(a.contact.conversation_sid);
      const bConv = conversationMap.get(b.contact.conversation_sid);

      const aTime = aConv?.dateUpdated
        ? new Date(aConv.dateUpdated).getTime()
        : 0;

      const bTime = bConv?.dateUpdated
        ? new Date(bConv.dateUpdated).getTime()
        : 0;

      return bTime - aTime; // newest first
    });

    this.filteredContacts = [...this.contacts];
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
    this.filteredContacts.forEach((filteredContact) => (filteredContact.is_selected = false));
    contact.is_selected = true;
    this.selectedContact = contact;

    setTimeout(() => {
      const container = document.querySelector('.messages');
      if (container) container.scrollTop = container.scrollHeight;
    }, 0);

    const conversationSid = contact.contact.conversation_sid;
    if (!conversationSid) {
      console.warn("No conversation SID for this contact");
      return;
    }

    this.twilioService.openConversation(conversationSid);
  }



  /* calculateTimeDifference(contact: Contact): string {
    if (!contact.last_message) return '';
    const date_created = contact.last_message.date_created;

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
  } */

  /* lastMessageBody(contact: Contact): string {
    if (!contact.last_message) return '';
    return contact.last_message.body;
  } */

  sendMessage() {
    /* if (!this.newMessage.trim() || !this.selectedContact) return;

    this.selectedContact.messages = [
      ...this.selectedContact.messages,
      {
        from: this.twilioPhone,
        to: this.selectedContact.phone,
        body: this.newMessage.trim(),
        date_created: new Date().toISOString(),
      },
    ];

    this.twilioService.sendSms(this.selectedContact.phone, this.newMessage.trim()).subscribe({
      next: (res) => console.log('SMS inviato con successo'),
      error: (err) => console.error('Errore invio:', err)
    });

    this.newMessage = '';

    // Scroll to bottom
    setTimeout(() => {
      const container = document.querySelector('.messages');
      if (container) container.scrollTop = container.scrollHeight;
    }, 0); */
  }

  handleNewTextModal(isOpen: boolean) {
    this.isModalOpen = isOpen;
  }

  async goToChat(contactData: any) {
    const tempContact = {
      phone: contactData.phone,
      conversation_sid: '',
      contact: {
        id: 'temp_contact_id',
        conversation_sid: '',
        createdTime: new Date().toISOString(),
        fields: {
          Name: contactData.name,
          Phone: contactData.phone,
        },
      },
      is_selected: true,
    };

    if (contactData.save) {
      this.contactService.saveContact(contactData.name, contactData.phone).subscribe({
        next: (res) => console.log('Contact saved:', res),
        error: (err) => console.error('Error saving contact:', err),
      });
    } else {
      this.contactService.startChat(contactData.name, contactData.phone).subscribe({
        next: (res) => console.log('New chat started:', res),
        error: (err) => console.error('Error starting new chat:', err),
      });
    }

    this.onContactSelect(tempContact);
    this.handleNewTextModal(false);
  }

  handlePhoneCallModal(isOpen: boolean) {
    this.isPhoneCallModalOpen = isOpen;
    if (isOpen) {
      this.setupDevice();
    }
  }

  async setupDevice() {
    this.twilioCallStatus = 'Loading configuration...';

    try {
      const data = await firstValueFrom(this.twilioService.getAccessToken());

      this.device = new Device(data.token, {
        logLevel: 1,
        edge: 'frankfurt',
      });

      this.device.on('registered', () => {
        this.twilioCallStatus = 'Ready to call!';
      });

      this.device.on('error', (error) => {
        this.twilioCallStatus = 'Error: ' + error.message;
        console.error('Twilio Device Error:', error);
      });

      this.device.register();
    } catch (err) {
      this.twilioCallStatus = 'Setup Error';
      console.error('Setup error:', err);
    }
  }

  async startCall() {
    let toPhoneNumber = this.selectedContact?.phone;
    console.log(toPhoneNumber);
    if (!toPhoneNumber) {
      this.twilioCallStatus = 'Invalid phone number';
      return;
    }

    if (this.device) {
      this.twilioCallStatus = `Calling ${toPhoneNumber}`;
      const params: Record<string, string> = {
        To: toPhoneNumber,
      };

      try {
        const call = await this.device.connect({ params });
        this.activeCall = call;

        this.twilioCallStatus = 'Calling...';

        call.on('accept', () => {
          this.twilioCallStatus = 'In Progress';
        });

        call.on('disconnect', () => {
          this.twilioCallStatus = 'Call ended';
          this.activeCall = null;
        });

        call.on('reject', () => {
          this.twilioCallStatus = 'Call rejected';
          this.activeCall = null;
        });
      } catch (err) {
        console.error('Could not connect call:', err);
        this.twilioCallStatus = 'Call failed';
      }
    } else {
      this.twilioCallStatus = 'Device not initialized';
    }
  }

  hangUp() {
    if (this.activeCall) {
      this.activeCall.disconnect();
      this.activeCall = null;
    }
  }
}
