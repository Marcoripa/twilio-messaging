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
  private messageEvents = new BehaviorSubject<{ sid: string, author: string | null, dateCreated?: Date } | null>(null);
  public messageEvents$ = this.messageEvents.asObservable();
  private activeConversationSid: string | null = null;
  

  getAccessToken(): Observable<{ token: string }> {
    return this.http.get<{ token: string }>(`${environment.apiUrl}/token`);
  }

  getIdentity(): string {
    return this.client?.user?.identity || '';
  }

  get currentMessages(): ChatMessage[] {
    return this.messagesSubject.value;
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
    
    // Clean up existing client to prevent duplicate event handlers and socket connections
    if (this.client) {
      try {
        console.log('[TwilioService] Shutting down existing client...');
        await this.client.shutdown();
      } catch (err) {
        console.error('[TwilioService] Error shutting down client:', err);
      }
      this.client = undefined;
    }

    this.conversations.clear();
    this.unreadCounts.next({});
    this.messagesSubject.next([]);
    this.messageEvents.next(null);
    this.activeConversationSid = null;
    this.conversation = undefined;

    return new Promise<void>((resolve, reject) => {
      try {
        this.client = new Client(token);

        this.client.on('stateChanged', async (state) => {
          console.log(`[TwilioService] Client state changed: ${state}`);
          if (state === 'initialized') {
            const paginator = await this.client!.getSubscribedConversations();
            const initialCounts: Record<string, number> = {};
            
            paginator.items.forEach((conv: Conversation) => {
              this.conversations.set(conv.sid, conv);
              
              const lastIndex = conv.lastMessage?.index;
              const lastReadIndex = conv.lastReadMessageIndex;
              const lastAuthor = (conv.lastMessage as any)?.author;
              
              if (lastIndex !== undefined && lastIndex !== null && lastAuthor !== this.client?.user?.identity) {
                const readIndex = lastReadIndex ?? -1;
                if (lastIndex > readIndex) {
                  initialCounts[conv.sid] = lastIndex - readIndex;
                }
              }
            });
            
            this.zone.run(() => {
              this.unreadCounts.next(initialCounts);
              console.log('[TwilioService] Initialization complete and synced.');
              resolve();
            });
          } else if (state === 'failed') {
            this.zone.run(() => {
              reject(new Error('Twilio Client initialization failed'));
            });
          }
        });

        this.client.on('tokenAboutToExpire', async () => {
          console.log('[TwilioService] Access token is about to expire. Refreshing...');
          this.getAccessToken().subscribe({
            next: async (res) => {
              if (this.client) {
                await this.client.updateToken(res.token);
                console.log('[TwilioService] Access token updated successfully.');
              }
            },
            error: (err) => console.error('[TwilioService] Failed to refresh token:', err)
          });
        });

        this.client.on('connectionStateChanged', (state) => {
          console.log(`[TwilioService] Connection state: ${state}`);
        });

        // Listen for new messages globally
        this.client.on("messageAdded", (message: Message) => {
          console.log(`[TwilioService] GLOBAL messageAdded: conv=${message.conversation.sid}, author=${message.author}`);
          
          this.zone.run(() => {
            const sid = message.conversation.sid;

            // 1. Notify listeners for sidebar updates (move to top, unread dots, timestamp)
            this.messageEvents.next({ 
              sid, 
              author: message.author ?? 'system',
              dateCreated: message.dateCreated || new Date()
            });

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

        // Listen for conversation joined/created
        this.client.on('conversationJoined', (conversation) => {
          this.zone.run(() => {
            console.log(`[TwilioService] conversationJoined: sid=${conversation.sid}`);
            this.conversations.set(conversation.sid, conversation);
            
            this.messageEvents.next({
              sid: conversation.sid,
              author: (conversation.lastMessage as any)?.author ?? null,
              dateCreated: conversation.lastMessage?.dateCreated || new Date()
            });
          });
        });

        // Listen for conversation left/removed
        this.client.on('conversationLeft', (conversation) => {
          this.zone.run(() => {
            console.log(`[TwilioService] conversationLeft: sid=${conversation.sid}`);
            this.conversations.delete(conversation.sid);
          });
        });

        // Listen for conversation updates (e.g., last message or unread states loading asynchronously)
        this.client.on('conversationUpdated', (event) => {
          this.zone.run(() => {
            const conversation = event.conversation;
            const reasons = event.updateReasons;
            console.log(`[TwilioService] conversationUpdated: sid=${conversation.sid}, reasons=${reasons.join(', ')}`);
            
            this.conversations.set(conversation.sid, conversation);

            if (reasons.includes('lastMessage') || reasons.includes('lastReadMessageIndex')) {
              this.messageEvents.next({ 
                sid: conversation.sid, 
                author: (conversation.lastMessage as any)?.author ?? null,
                dateCreated: conversation.lastMessage?.dateCreated || new Date()
              });
            }
          });
        });

      } catch (error) {
        console.error("[TwilioService] Initialization Error:", error);
        reject(error);
      }
    });
  }

  async getSubscribedConversations(): Promise<Conversation[]> {
    if (!this.client) return [];
    let paginator = await this.client.getSubscribedConversations();
    const conversations = [...paginator.items];
    
    while (paginator.hasNextPage) {
      paginator = await paginator.nextPage();
      conversations.push(...paginator.items);
    }
    
    return conversations;
  }

  async openConversation(conversationSid: string, phoneNumber: string) {
    console.log(`[TwilioService] Opening conversation: ${phoneNumber}, sid: ${conversationSid}`);
    if (!this.client) return;

    // 0. Track this as the latest request and clear current state
    this.activeConversationSid = conversationSid;
    this.messagesSubject.next([]);
    this.conversation = undefined; // Temporarily unset to avoid mixing messages until ready

    // 1. Get the conversation object
    let conversation;
    try {
      conversation = await this.client.getConversationBySid(conversationSid);
    } catch (err) {
      console.warn(`[TwilioService] Failed to fetch conversation ${conversationSid} directly:`, err);
      // Fallback to cache if network fetch fails
      conversation = this.conversations.get(conversationSid);
    }

    if (!conversation) {
      throw new Error(`Conversation ${conversationSid} could not be loaded.`);
    }

    // const conversation =
    //   this.conversations.get(conversationSid) ||
    //   await this.client.getConversationBySid(conversationSid);

    if (this.activeConversationSid !== conversationSid) return;

    this.conversations.set(conversationSid, conversation);
    this.conversation = conversation; // Mark as currently active

    // 2. Fetch messages from Twilio Conversations
    const paginator = await conversation.getMessages();
    if (this.activeConversationSid !== conversationSid) return;
    const conversationMessages = paginator.items;

    // 3. Fetch historical messages from SMS API
    let apiMessages: any[] = [];
    try {
      const res = await fetch(`${environment.apiUrl}/messages?phone=${phoneNumber}`);
      if (this.activeConversationSid !== conversationSid) return;
      if (res.ok) {
        apiMessages = await res.json();
      }
    } catch (err) {
      console.warn('Failed to fetch messages API', err);
    }

    if (this.activeConversationSid !== conversationSid) return;

    // 4. Merge and de-duplicate
    // We include current messagesSubject.value in case any real-time messages arrived while fetching history
    const merged = [
      ...conversationMessages.map(m => this.normalizeMessage(m, 'conversation')),
      ...apiMessages.map(m => this.normalizeMessage(m, 'messages-api')),
      ...this.messagesSubject.value
    ].sort((a, b) => a.dateCreated.getTime() - b.dateCreated.getTime());

    const deduped: ChatMessage[] = [];
    for (const msg of merged) {
      const isDuplicate = deduped.some(existing => 
        (existing.sid && msg.sid && existing.sid === msg.sid) ||
        (existing.body === msg.body && 
         Math.abs(existing.dateCreated.getTime() - msg.dateCreated.getTime()) < 2000)
      );
      if (!isDuplicate) deduped.push(msg);
    }

    this.messagesSubject.next(deduped);

    // 5. Mark as read
    try {
      await conversation.setAllMessagesRead();
      if (this.activeConversationSid !== conversationSid) return;
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
        (p.attributes as any)?.phoneNumber === phoneNumber ||
        (p as any).messagingBinding?.address === phoneNumber
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

