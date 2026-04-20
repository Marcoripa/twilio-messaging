export interface ChatMessage {
  sid: string;
  body: string;
  dateCreated: Date;
  author: string;
  direction: string;
  source: 'conversation' | 'messages-api';
}