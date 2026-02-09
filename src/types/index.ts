export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export interface Session {
  id: string;
  createdAt: Date;
  messages: Message[];
  metadata: Record<string, any>;
}
