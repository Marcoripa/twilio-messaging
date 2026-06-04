import { Injectable, inject, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { environment } from '../../environment';
import { Client, Conversation, Message } from '@twilio/conversations';
import { ChatMessage } from '../shared/models/chatMessage';

@Injectable({providedIn: 'root'})
export class TwilioService {
  private readonly http = inject(HttpClient);
  private readonly zone = inject(NgZone);
  private client: Client | undefined;
  private conversation: Conversation | undefined;
  private conversations = new Map<string, Conversation>();

  private messagesSubject = new BehaviorSubject<ChatMessage[]>([]);
  public messages$ = this.messagesSubject.asObservable();
  private unreadCounts = new BehaviorSubject<Record<string, number>>({});
  public unreadCounts$ = this.unreadCounts.asObservable();
  private messageEvents = new BehaviorSubject<{ sid: string, author: string | null } | null>(null);
  public messageEvents$ = this.messageEvents.asObservable();
  

  getAccessToken(): Observable<{ token: string }> {
    return this.http.get<{ token: string }>(`${environment.apiUrl}/token`);
  }

  getIdentity(): string {
    return this.client?.user?.identity || '';
  }

  private normalizeMessage(msg: any, source: 'conversation' | 'messages-api'): ChatMessage {
    const author = msg.author || msg.from;
    return {
      sid: msg.sid,
      body: msg.body,
      dateCreated: new Date(msg.dateCreated),
      author: author === environment.twilio_Phone ? 'system' : author,
      source
    };
  }

  async initialize(token: string) {
    console.log('[TwilioService] Initializing with token...');
    try {
      this.client = new Client(token);

      this.client.on('stateChanged', (state) => {
        console.log(`[TwilioService] Client state changed: ${state}`);
      });

      this.client.on('connectionStateChanged', (state) => {
        console.log(`[TwilioService] Connection state: ${state}`);
      });

      // SINGLE GLOBAL LISTENER for all messages
      this.client.on("messageAdded", (message: Message) => {
        console.log(`[TwilioService] GLOBAL messageAdded: conv=${message.conversation.sid}, author=${message.author}`);
        
        this.zone.run(() => {
          const sid = message.conversation.sid;

          // 1. Notify listeners for sidebar updates (move to top, unread dots)
          this.messageEvents.next({ sid, author: message.author ?? 'system' });

          // 2. If this is the ACTIVE conversation, update the messages stream
          if (this.conversation?.sid === sid) {
            console.log(`[TwilioService] Updating active conversation messages for ${sid}`);
            const normalized = this.normalizeMessage(message, 'conversation');
            const current = this.messagesSubject.value;

            const isDuplicate = current.some(existing => 
              existing.body === normalized.body && 
              Math.abs(existing.dateCreated.getTime() - normalized.dateCreated.getTime()) < 2000
            );

            if (!isDuplicate) {
              this.messagesSubject.next([...current, normalized].sort(
                (a, b) => a.dateCreated.getTime() - b.dateCreated.getTime()
              ));
            }
          }

          // 3. Update unread counts if not from me
          if (message.author !== this.client?.user?.identity) {
            const counts = { ...this.unreadCounts.value };
            counts[sid] = (counts[sid] || 0) + 1;
            this.unreadCounts.next(counts);
          }
        });
      });

      const paginator = await this.client.getSubscribedConversations();
      paginator.items.forEach((conv: Conversation) => {
        this.conversations.set(conv.sid, conv);
      });
      
      console.log('[TwilioService] Initialization complete.');

    } catch (error) {
      console.error("[TwilioService] Initialization Error:", error);
    }
  }

  async getSubscribedConversations() {
    if (!this.client) return [];
    const paginator = await this.client.getSubscribedConversations();
    return paginator.items;
  }

  async openConversation(conversationSid: string, phoneNumber: string) {
    console.log(`[TwilioService] Opening conversation: ${phoneNumber}, sid: ${conversationSid}`);
    if (!this.client) return;

    // 1. Get the conversation object
    const conversation =
      this.conversations.get(conversationSid) ||
      await this.client.getConversationBySid(conversationSid);

    this.conversations.set(conversationSid, conversation);
    this.conversation = conversation; // Mark as currently active

    // 2. Fetch messages from Twilio Conversations
    const paginator = await conversation.getMessages();
    const conversationMessages = paginator.items;

    // 3. Fetch historical messages from SMS API
    let apiMessages: any[] = [];
    try {
      const res = await fetch(`${environment.apiUrl}/messages?phone=${phoneNumber}`);
      if (res.ok) {
        apiMessages = await res.json();
      }
    } catch (err) {
      console.warn('Failed to fetch messages API', err);
    }

    // 4. Merge and de-duplicate
    const merged = [
      ...conversationMessages.map(m => this.normalizeMessage(m, 'conversation')),
      ...apiMessages.map(m => this.normalizeMessage(m, 'messages-api'))
    ].sort((a, b) => a.dateCreated.getTime() - b.dateCreated.getTime());

    const deduped: ChatMessage[] = [];
    for (const msg of merged) {
      const isDuplicate = deduped.some(existing => 
        existing.body === msg.body && 
        Math.abs(existing.dateCreated.getTime() - msg.dateCreated.getTime()) < 2000
      );
      if (!isDuplicate) deduped.push(msg);
    }

    this.messagesSubject.next(deduped);

    // 5. Mark as read
    try {
      await conversation.setAllMessagesRead();
      const counts = { ...this.unreadCounts.value };
      counts[conversationSid] = 0;
      this.unreadCounts.next(counts);
    } catch (err) {
      console.warn('Failed to mark messages as read', err);
    }
  }

  async findConversationByPhone(phoneNumber: string): Promise<Conversation | null> {
    console.log('Searching phone number ', phoneNumber)
    const conversations = await this.getSubscribedConversations();
    
    for (const conv of conversations) {
      const participants = await conv.getParticipants();
      // Check if any participant identity or address matches the phone number
      const isMatch = participants.some(p => 
        p.identity === phoneNumber || 
        (p.attributes as any)?.phoneNumber === phoneNumber
      );
      
      if (isMatch) return conv;
    }
    return null;
  }

  sendSms(conversationSid: string, text: string): Observable<any> {
    console.log(`Sending an sms to conversation sid ${conversationSid}`)
    return this.http.post(`${environment.apiUrl}/send_sms`, { conversationSid, text });
  }
}

