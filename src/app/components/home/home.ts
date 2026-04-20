import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
  loadingConversation = false;
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
    private cd: ChangeDetectorRef
  ) {
    this.messages$ = this.twilioService.messages$;
    this.unreadCounts$ = this.twilioService.unreadCounts$;
  }

  async ngOnInit() {
    try {
      // 1. Upload contacts from server and wait for it
      const serverContacts = await firstValueFrom(this.contactService.getAll());
      this.contacts = [...serverContacts];
      this.filteredContacts = [...serverContacts];
      console.log('Contacts loaded:', this.contacts.length);

      // 2. Get the token and initialize Twilio
      const res = await firstValueFrom(this.twilioService.getAccessToken());
      await this.twilioService.initialize(res.token);

      // 3. Sort contacts based on activity
      await this.sortContactsByConversationActivity();

      // 4. Listen for new messages
      this.twilioService.messageEvents$.subscribe(async (conversationSid) => {
        if (!conversationSid) return;
        console.log('Received a new message on conversation ', conversationSid);
        await this.updateContactAndMoveToTop(conversationSid);
      });
    } catch (err) {
      console.error('Inizializzazione fallita:', err);
    } finally {
      this.cd.detectChanges();
    }
  }

  async updateContactAndMoveToTop(conversationSid: string) {
      // 1. Find the contact index
      const index = this.contacts.findIndex((c) => c.contact.conversation_sid === conversationSid);
      if (index === -1) return;

      // 2. Fetch the specific conversation data to get the latest indices
      const conversations = await this.twilioService.getSubscribedConversations();
      const conv = conversations.find((c) => c.sid === conversationSid);

      if (!conv) {
        return
      }

      const lastIndex = conv.lastMessage?.index ?? 0;
      const lastReadIndex = conv.lastReadMessageIndex ?? 0;

      // 3. Update the specific contact's properties
      const updatedContact = {
        ...this.contacts[index],
        lastActivity: conv?.lastMessage?.dateCreated || new Date(),
        hasUnread: true,
      };

      // 4. Move to top: Remove from old position and unshift to start
      const otherContacts = this.contacts.filter((_, i) => i !== index);
      this.contacts = [updatedContact, ...otherContacts];
      this.filteredContacts = [...this.contacts];

      // 5. Update UI
      this.cd.detectChanges();
  }

  moveContactToTop(conversationSid: string) {
    const index = this.contacts.findIndex((c) => c.contact.conversation_sid === conversationSid);

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

    const conversationMap = new Map(conversations.map((c) => [c.sid, c]));

    this.contacts = this.contacts.map((contactObj) => {
      const conv = conversationMap.get(contactObj.contact.conversation_sid);

      const lastIndex = conv?.lastMessage?.index ?? 0;
      const lastReadIndex = conv?.lastReadMessageIndex ?? 0;
      const hasUnread = lastIndex > lastReadIndex;

      return {
        ...contactObj,
        lastActivity: conv?.lastMessage?.dateCreated || null,
        hasUnread: hasUnread,
      };
    });

    // 2. Ordiniamo i contatti usando la nuova proprietà lastActivity
    this.contacts.sort((a, b) => {
      const aTime = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
      const bTime = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
      return bTime - aTime;
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

  async onContactSelect(contact: Contact) {
    this.selectedContact = undefined
    this.loadingConversation = true;
    this.filteredContacts.forEach((filteredContact) => (filteredContact.is_selected = false));
    
    setTimeout(() => {
      const container = document.querySelector('.messages');
      if (container) container.scrollTop = container.scrollHeight;
    }, 0);

    let conversationSid = contact.contact.conversation_sid;

    if (!conversationSid && contact.phone) {
      console.warn('No conversation SID for this contact');
      const existingConv = await this.twilioService.findConversationByPhone(contact.phone);

      if (existingConv) {
        this.twilioService.openConversation(existingConv.sid, contact.phone);
      } else {
        console.warn('No conversation found for this phone number');
        this.contactService.startChat(contact.contact.fields.Name, contact.phone).subscribe({
          next: (sid: string) => {
            console.log('Received SID:', sid);
            // Update the local object
            if (sid) {
              contact.contact.conversation_sid = sid;
              this.twilioService.openConversation(sid, contact.phone);
            }
          },
          error: (err) => {
            console.error('Failed to get SID:', err);
            alert(`${err.error.msg}`)
          },
        });
      }
    } else {
      this.twilioService.openConversation(conversationSid, contact.phone);
    }

    contact.is_selected = true;
    contact.hasUnread = false;
    this.loadingConversation = false;
    this.selectedContact = contact;
  }

  calculateTimeDifference(contact: Contact): string {
    if (!contact.lastActivity) return '';
    const date_created = contact.lastActivity;

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

    this.twilioService.sendSms(this.selectedContact.contact.conversation_sid, this.newMessage.trim()).subscribe({
      next: (res) => console.log('SMS inviato con successo'),
      error: (err) => console.error('Errore invio:', err)
    });

    this.newMessage = '';

    // Scroll to bottom
    setTimeout(() => {
      const container = document.querySelector('.messages');
      if (container) container.scrollTop = container.scrollHeight;
    }, 0);
  }

  handleNewTextModal(isOpen: boolean) {
    this.isModalOpen = isOpen;
  }

  async goToChat(contactData: any) {
    if (!contactData.phone || !contactData.name) {
      alert('Please provide both name and phone number');
      return;
    }
    if (!contactData.phone.startsWith('+') && !contactData.phone.startsWith('00')) {
      alert('Please make sure the phone number starts with + or 00 followed by the country code');
      return;
    }

    console.log(
      `Searching for existing contact with phone number ${contactData.phone} or name ${contactData.name}`,
    );

    const existingContact = this.contacts.find(
      (contact) =>
        contact.phone?.toLowerCase() == contactData.phone ||
        contact.contact?.fields?.Name?.toLowerCase().includes(contactData.name.toLowerCase()),
    );
    console.log(existingContact);

    if (existingContact) {
      this.onContactSelect(existingContact);
    } else {
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
        hasUnread: false,
      };

      this.onContactSelect(tempContact);
    }

    this.handleNewTextModal(false);
    //TODO REFRESH CONTACTS LIST
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
