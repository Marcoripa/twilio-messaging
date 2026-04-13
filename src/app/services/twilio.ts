import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { environment } from '../../environment';
import { Client, Conversation, Message } from '@twilio/conversations';
import { ChatMessage } from '../shared/models/chatMessage';

@Injectable({providedIn: 'root'})
export class TwilioService {
  private readonly http = inject(HttpClient);
  private client: Client | undefined;
  private conversation: Conversation | undefined;
  private conversations = new Map<string, Conversation>();

  private messagesSubject = new BehaviorSubject<ChatMessage[]>([]);
  public messages$ = this.messagesSubject.asObservable();
  private unreadCounts = new BehaviorSubject<Record<string, number>>({});
  public unreadCounts$ = this.unreadCounts.asObservable();
  private messageEvents = new BehaviorSubject<string | null>(null);
  public messageEvents$ = this.messageEvents.asObservable();
  

  getAccessToken(): Observable<{ token: string }> {
    return this.http.get<{ token: string }>(`${environment.apiUrl}/token`);
  }

  async initialize(token: string) {
    try {
      this.client = new Client(token);

      const paginator = await this.client.getSubscribedConversations();

      paginator.items.forEach((conv: Conversation) => {
        this.conversations.set(conv.sid, conv);
      });

      // Global listener for new messages
      this.client.on("messageAdded", (message: Message) => {
        const sid = message.conversation.sid;

        this.messageEvents.next(sid);

        if (message.author !== this.client?.user?.identity) {
          const counts = { ...this.unreadCounts.value };
          counts[sid] = (counts[sid] || 0) + 1;
          this.unreadCounts.next(counts);
        }
      });

    } catch (error) {
      console.error("Twilio Initialization Error:", error);
    }
  }

  async getSubscribedConversations() {
    if (!this.client) return [];

    const paginator = await this.client.getSubscribedConversations();
    return paginator.items;
  }

  async openConversation(conversationSid: string, phoneNumber:string) {
    console.log(`Opening conversion for phone ${phoneNumber}, sid ${conversationSid}`)
    if (!this.client) return;

    const conversation =
      this.conversations.get(conversationSid) ||
      await this.client.getConversationBySid(conversationSid);

    this.conversation = conversation;

    const paginator = await conversation.getMessages();
    const conversationMessages = paginator.items;

    let apiMessages: any[] = [];

    // 3. Fetch Messages API messages
    try {
      const res = await fetch(`${environment.apiUrl}/messages?phone=${phoneNumber}`);
      apiMessages = await res.json();
      console.log('Fetched messages API', apiMessages);
    } catch (err) {
      console.warn('Failed to fetch messages API', err);
    }

    // 4. Normalize both sources
    const normalize = (msg: any, source: 'conversation' | 'messages-api') => {
      const rawAuthor = msg.author || msg.from;

      return {
        sid: msg.sid,
        body: msg.body,
        dateCreated: new Date(msg.dateCreated),
        author: rawAuthor === environment.twilio_Phone ? 'system' : rawAuthor,
        source
      };
    };

    const normalizedConversation = conversationMessages.map(m =>
      normalize(m, 'conversation')
    );

    const normalizedApi = apiMessages.map(m =>
      normalize(m, 'messages-api')
    );

    const merged = [...normalizedConversation, ...normalizedApi];
    merged.sort(
      (a, b) => a.dateCreated.getTime() - b.dateCreated.getTime()
    );

    const deduped: typeof merged = [];

    for (const msg of merged) {
      const isDuplicate = deduped.some(existing => {
        const sameBody = existing.body === msg.body;

        const timeDiffPositive = Math.abs(
          existing.dateCreated.getTime() - msg.dateCreated.getTime()
        );
        const timeDiffNegative = Math.abs(
          msg.dateCreated.getTime() - existing.dateCreated.getTime()
        );

        return sameBody && (timeDiffPositive <= 1000 || timeDiffNegative >= 1000);
      });

      if (!isDuplicate) {
        deduped.push(msg);
      }
    }

    console.log('Merged messages', deduped);

    this.messagesSubject.next(deduped);

     // 7. Real-time updates (conversation only)
    conversation.on("messageAdded", (message: Message) => {
      const normalized = normalize(message, 'conversation');
      const current = this.messagesSubject.value;

      const isDuplicate = current.some(existing => {
        const sameBody = existing.body === normalized.body;

        const timeDiffPositive = Math.abs(
          existing.dateCreated.getTime() - normalized.dateCreated.getTime()
        );
        const timeDiffNegative = Math.abs(
          normalized.dateCreated.getTime() - existing.dateCreated.getTime()
        );

        return sameBody && (timeDiffPositive <= 1000 || timeDiffNegative >= 1000);
      });

      if (isDuplicate) return;

      const updated = [...current, normalized].sort(
        (a, b) => a.dateCreated.getTime() - b.dateCreated.getTime()
      );

      this.messagesSubject.next(updated);
    });

    // mark read
    await conversation.setAllMessagesRead();

    const counts = { ...this.unreadCounts.value };
    counts[conversationSid] = 0;
    this.unreadCounts.next(counts);
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
