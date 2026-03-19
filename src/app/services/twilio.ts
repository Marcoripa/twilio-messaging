import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject,lastValueFrom } from 'rxjs';
import { environment } from '../../environment';
import { Client, Conversation, Message } from '@twilio/conversations';

@Injectable({providedIn: 'root'})
export class TwilioService {
  private readonly http = inject(HttpClient);
  private client: Client | undefined;
  private conversation: Conversation | undefined;
  private conversations = new Map<string, Conversation>();

  private messagesSubject = new BehaviorSubject<Message[]>([]);
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

  async openConversation(conversationSid: string) {
    console.log('Opening conversion for sid', conversationSid)
    if (!this.client) return;

    const conversation =
      this.conversations.get(conversationSid) ||
      await this.client.getConversationBySid(conversationSid);

    this.conversation = conversation;

    const paginator = await conversation.getMessages();
    this.messagesSubject.next(paginator.items);

    conversation.on("messageAdded", (message: Message) => {
      const updated = [...this.messagesSubject.value, message];
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
