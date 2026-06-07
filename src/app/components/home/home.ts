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
  newMessage = '';
  twilioPhone = environment.twilio_Phone;
  isModalOpen = false;
  isPhoneCallModalOpen = false;
  device: Device | undefined;
  twilioCallStatus = '';
  activeCall: Call | null = null;
  messages$;
  unreadCounts$;
  isCreatingContact = false;
  isRefreshing = false;
  isLoadingMessages = false;
  errorMessage: string | null = null;
  private lastSelectionId = 0;

  constructor(
    private contactService: ContactService,
    private twilioService: TwilioService,
    private cd: ChangeDetectorRef,
  ) {
    this.messages$ = this.twilioService.messages$;
    this.unreadCounts$ = this.twilioService.unreadCounts$;
  }

  async ngOnInit() {
    try {
      // 0. Request notification permission
      if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
      }

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
      this.twilioService.messageEvents$.subscribe(async (event) => {
        if (!event) return;
        console.log(`[Home] Received messageEvents notification for ${event.sid} by ${event.author}`);
        await this.updateContactAndMoveToTop(event.sid, event.author);
      });

      // 5. Auto-scroll when messages update
      this.messages$.subscribe(() => {
        this.scrollToBottom();
      });
    } catch (err) {
      console.error('Inizializzazione fallita:', err);
    } finally {
      this.cd.detectChanges();
    }
  }

  async refreshContacts() {
    this.isRefreshing = true;
    try {
      const serverContacts = await firstValueFrom(this.contactService.getAll());
      this.contacts = [...serverContacts];
      await this.sortContactsByConversationActivity();
      console.log('Contacts refreshed:', this.contacts.length);
    } catch (err) {
      console.error('Refresh failed:', err);
    } finally {
      this.isRefreshing = false;
      this.cd.detectChanges();
    }
  }

  async updateContactAndMoveToTop(conversationSid: string, author: string | null = null) {
    console.log(`[Home] updateContactAndMoveToTop called for SID: ${conversationSid}, Author: ${author}`);
    
    // 1. Find the contact in the master list
    const index = this.contacts.findIndex((c) => c.contact.conversation_sid === conversationSid);
    if (index === -1) {
      console.warn(`[Home] Contact with SID ${conversationSid} not found in master list. (Total contacts: ${this.contacts.length})`);
      return;
    }

    // 2. Determine if it's an external message
    const myIdentity = this.twilioService.getIdentity();
    const isExternal = author && author !== myIdentity;
    const activeSid = this.selectedContact?.contact.conversation_sid;
    
    console.log(`[Home] Context: MyID=${myIdentity}, ActiveSID=${activeSid}, MessageAuthor=${author}`);

    // 3. Update contact properties
    const contact = this.contacts[index];
    const isCurrentlyOpen = activeSid === conversationSid;
    
    const wasUnread = contact.hasUnread;
    const nowUnread = contact.hasUnread || (!!isExternal && !isCurrentlyOpen);

    this.contacts[index] = {
      ...contact,
      lastActivity: new Date(),
      hasUnread: nowUnread,
    };
    
    // 3b. Show native notification if it's a new external unread message
    if (isExternal && !isCurrentlyOpen && !wasUnread) {
      this.showNativeNotification(contact);
    }

    console.log(`[Home] Contact updated: ${this.contacts[index].phone}, hasUnread: ${this.contacts[index].hasUnread}`);

    // 4. Move to top of the master list
    const [movedContact] = this.contacts.splice(index, 1);
    this.contacts.unshift(movedContact);

    // 5. Re-apply search if necessary, otherwise update filtered list
    if (this.searchTerm && this.searchTerm.trim()) {
      console.log(`[Home] Re-applying search for term: "${this.searchTerm}"`);
      this.search(this.searchTerm);
    } else {
      this.filteredContacts = [...this.contacts];
    }

    // 6. Force UI refresh
    this.cd.detectChanges();
    console.log(`[Home] UI Update completed for real-time message`);
  }

  private showNativeNotification(contact: Contact, isStartup = false) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const title = isStartup ? 'Missed Messages' : `New message from ${this.getContactLabel(contact)}`;
    const body = isStartup 
      ? `You have unread messages from ${this.getContactLabel(contact)}.` 
      : `Check your chat with ${this.getContactLabel(contact)}.`;

    const notification = new Notification(title, {
      body,
      icon: 'favicon.ico'
    });

    notification.onclick = () => {
      window.focus();
      this.onContactSelect(contact);
    };
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
    this.searchTerm = term;
    const trimmed = term.trim().toLowerCase();
    
    if (!trimmed) {
      this.filteredContacts = [...this.contacts];
    } else {
      this.filteredContacts = this.contacts.filter((contact) => {
        const phoneMatches = contact.phone?.toLowerCase().includes(trimmed);
        const nameMatches = contact.contact?.fields?.Name?.toLowerCase().includes(trimmed);
        return phoneMatches || nameMatches;
      });
    }

    this.cd.detectChanges();
  }

  async sortContactsByConversationActivity() {
    const conversations = await this.twilioService.getSubscribedConversations();
    const myIdentity = this.twilioService.getIdentity();

    const conversationMap = new Map(conversations.map((c) => [c.sid, c]));
    let unreadCount = 0;
    let firstUnreadContact: Contact | null = null;

    this.contacts = this.contacts.map((contactObj) => {
      const conv = conversationMap.get(contactObj.contact.conversation_sid);

      const lastIndex = conv?.lastMessage?.index;
      const lastReadIndex = conv?.lastReadMessageIndex;
      const lastAuthor = (conv?.lastMessage as any)?.author;

      // Fix: Improved unread detection (handles null lastReadIndex and checks author)
      const hasUnread = 
        lastIndex !== undefined && 
        lastIndex !== null && 
        lastAuthor !== myIdentity &&
        (lastReadIndex === undefined || lastReadIndex === null || lastIndex > lastReadIndex);

      if (hasUnread) {
        unreadCount++;
        if (!firstUnreadContact) firstUnreadContact = contactObj;
      }

      return {
        ...contactObj,
        lastActivity: conv?.lastMessage?.dateCreated || contactObj.contact.createdTime || null,
        hasUnread: hasUnread,
      };
    });

    // Notify about missed messages on startup
    if (unreadCount > 0 && firstUnreadContact) {
      const unreadContact = firstUnreadContact as Contact;
      const summaryContact: Contact = unreadCount === 1 ? unreadContact : {
        ...unreadContact,
        contact: {
          ...unreadContact.contact,
          fields: { ...unreadContact.contact.fields, Name: `${unreadCount} contacts` }
        }
      };
      this.showNativeNotification(summaryContact, true);
    }


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

  isToday(date: Date | string): boolean {
    const d = new Date(date);
    const today = new Date();
    return (
      d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear()
    );
  }

  async onContactSelect(contact: Contact) {
    const selectionId = ++this.lastSelectionId;
    this.filteredContacts.forEach((filteredContact) => (filteredContact.is_selected = false));
    this.errorMessage = null;
    this.isLoadingMessages = true;
    
    // Fix: Set selectedContact immediately to prevent rendering previous contact data
    this.selectedContact = contact;
    contact.is_selected = true;
    contact.hasUnread = false;

    this.scrollToBottom();

    let conversationSid = contact.contact.conversation_sid;

    try {
      if (!conversationSid && contact.phone) {
        console.warn('No conversation SID for this contact');
        const existingConv = await this.twilioService.findConversationByPhone(contact.phone);

        if (selectionId !== this.lastSelectionId) return;

        if (existingConv) {
          await this.twilioService.openConversation(existingConv.sid, contact.phone);
          contact.contact.conversation_sid = existingConv.sid;
        } else {
          console.warn('No conversation found for this phone number');
          this.isCreatingContact = true;
          try {
            const sid = await firstValueFrom(this.contactService.startChat(contact.contact.fields.Name, contact.phone));
            if (selectionId !== this.lastSelectionId) return;
            
            this.isCreatingContact = false;
            console.log('Received SID:', sid);
            if (sid) {
              contact.contact.conversation_sid = sid;
              await this.twilioService.openConversation(sid, contact.phone);
            }
          } catch (err: any) {
            if (selectionId !== this.lastSelectionId) return;
            this.isCreatingContact = false;
            this.errorMessage = err.error?.error || 'Failed to start conversation';
            console.error('Failed to get SID:', err);
          }
        }
      } else if (conversationSid) {
        await this.twilioService.openConversation(conversationSid, contact.phone);
      }
    } catch (err) {
      if (selectionId !== this.lastSelectionId) return;
      console.error('Error selecting contact:', err);
      this.errorMessage = 'Failed to load conversation';
    } finally {
      if (selectionId === this.lastSelectionId) {
        this.isLoadingMessages = false;
        this.cd.detectChanges();
      }
    }
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

    this.scrollToBottom();
  }

  scrollToBottom() {
    setTimeout(() => {
      const container = document.querySelector('.messages');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }, 100);
  }

  handleNewTextModal(isOpen: boolean) {
    this.isModalOpen = isOpen;
    if (!isOpen) {
      this.errorMessage = null;
      this.isCreatingContact = false;
    }
  }

  async goToChat(contactData: any) {
    this.errorMessage = null;
    const phone = contactData.phone?.trim();
    const name = contactData.name?.trim();

    if (!phone) {
      this.errorMessage = 'Phone number is required';
      return;
    }

    // Basic regex for phone validation (e.g. +123456789)
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    if (!phoneRegex.test(phone.replace(/\s/g, ''))) {
      this.errorMessage = 'Invalid phone format. Use E.164 (e.g. +1234567890)';
      return;
    }

    console.log(`Searching for existing contact with phone number ${phone} or name ${name}`);
    const existingContact = this.contacts.find(
      (contact) =>
        contact.phone?.replace(/\s/g, '') === phone.replace(/\s/g, '') ||
        (name && contact.contact?.fields?.Name?.toLowerCase().includes(name.toLowerCase())),
    );

    if (existingContact) {
      this.onContactSelect(existingContact);
      this.handleNewTextModal(false);
    } else {
      this.isCreatingContact = true;
      this.contactService.startChat(name || 'New Contact', phone).subscribe({
        next: (sid) => {
          this.isCreatingContact = false;
          // Refresh contacts to include the new one
          this.contactService.getAll().subscribe(async updatedContacts => {
            this.contacts = [...updatedContacts];
            await this.sortContactsByConversationActivity();
            const newContact = this.contacts.find(c => c.phone === phone);
            if (newContact) {
              this.onContactSelect(newContact);
            }
            this.handleNewTextModal(false);
            this.cd.detectChanges();
          });
        },
        error: (err) => {
          this.isCreatingContact = false;
          this.errorMessage = err.error?.error || 'Failed to create contact';
        }
      });
    }
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
