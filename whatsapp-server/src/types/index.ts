export enum SessionStatus {
  STARTING = 'STARTING',
  QR_READY = 'QR_READY',
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
}

export interface IAgentPhoneNumber {
  id: string;
  phone_number: string;
  is_active: boolean;
  createdAt: string;
}

export interface IWhatsAppSessionData {
  id: string;
  session_id: string;
  status: SessionStatus;
  qr_code?: string;
  phone_number?: string;
  push_name?: string;
  alias?: string;
  labels?: string[];
  max_message_count_per_day: number;
  current_message_count: number;
  current_day?: string;
  warmup_schedule?: number[];
  agent_phone_numbers: IAgentPhoneNumber[];
  min_interval_seconds: number;
  max_interval_seconds: number;
  active_start_time: string;
  active_end_time: string;
  cross_chat_enabled?: boolean;
  last_phone_activity_at?: string;
  last_physical_phone_sent_message_at?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InboundMessageEvent {
  sessionId: string;
  messageId: string;
  fromJid: string;
  senderPhone: string;
  pushName: string;
  text?: string;
  hasMedia: boolean;
  mediaType?: 'image' | 'document' | 'video' | 'audio';
  fileName?: string;
  mimetype?: string;
  fileBuffer?: Buffer;
  timestamp: Date;
  replySender?: (toPhone: string, text: string) => Promise<any>;
}
