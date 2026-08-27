export interface ChatMessage {
  sid: string;
  body: string;
  dateCreated: Date;
  author: string;
  source: 'conversation' | 'messages-api';
}