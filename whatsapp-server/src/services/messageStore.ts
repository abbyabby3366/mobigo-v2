import { getRedisClient, formatRedisKey } from './redisAuthState.js';
import fs from 'fs';
import path from 'path';

const SESSIONS_DIR = process.env.SESSIONS_DIR || './sessions';
const MESSAGES_FILE = path.join(SESSIONS_DIR, 'messages_history.json');

export enum MessageDirection {
  INBOUND = 'INBOUND',
  OUTBOUND = 'OUTBOUND',
}

export enum MessageStatus {
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  READ = 'READ',
  RECEIVED = 'RECEIVED',
  FAILED = 'FAILED',
}

export interface IChatMessage {
  id: string;
  session_id: string;
  direction: MessageDirection;
  from_phone: string;
  to_phone: string;
  contact_phone: string; // The customer's phone number for grouping
  contact_name?: string;
  text?: string;
  has_media?: boolean;
  media_type?: 'document' | 'image' | 'video' | 'audio';
  file_name?: string;
  file_url?: string;
  status: MessageStatus;
  timestamp: string;
}

export interface IChatConversation {
  contact_phone: string;
  contact_name: string;
  session_id: string;
  last_message: string;
  last_timestamp: string;
  unread_count: number;
  total_messages: number;
  is_agent?: boolean;
}

// In-memory list (capped at 5000 recent messages)
let messageCache: IChatMessage[] = [];

function loadLocalMessages(): IChatMessage[] {
  try {
    if (fs.existsSync(MESSAGES_FILE)) {
      const data = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf-8'));
      if (Array.isArray(data)) return data;
    }
  } catch (_) {}
  return [];
}

function saveLocalMessages(msgs: IChatMessage[]): void {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(msgs.slice(-5000), null, 2), 'utf-8');
  } catch (_) {}
}

export class MessageStore {
  private static isInitialized = false;

  static async init(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // Load local
    messageCache = loadLocalMessages();

    // Load from Redis if available
    const redis = getRedisClient();
    if (redis) {
      try {
        const raw = await redis.get(formatRedisKey('wa_chat_history_list'));
        if (raw) {
          const arr: IChatMessage[] = JSON.parse(raw);
          if (Array.isArray(arr) && arr.length > 0) {
            messageCache = arr;
          }
        }
      } catch (_) {}
    }
  }

  static async logMessage(msg: Partial<IChatMessage>): Promise<IChatMessage> {
    await this.init();

    const newMsg: IChatMessage = {
      id: msg.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      session_id: msg.session_id || 'mobigo_main',
      direction: msg.direction || MessageDirection.OUTBOUND,
      from_phone: msg.from_phone || '',
      to_phone: msg.to_phone || '',
      contact_phone: msg.contact_phone || msg.to_phone || msg.from_phone || '',
      contact_name: msg.contact_name || '',
      text: msg.text || '',
      has_media: msg.has_media || false,
      media_type: msg.media_type,
      file_name: msg.file_name,
      file_url: msg.file_url,
      status: msg.status || MessageStatus.SENT,
      timestamp: msg.timestamp || new Date().toISOString(),
    };

    messageCache.push(newMsg);

    // Keep cache capped at 5000 items
    if (messageCache.length > 5000) {
      messageCache = messageCache.slice(-5000);
    }

    // Async persist to disk and Redis
    this.persist();

    return newMsg;
  }

  static async getConversations(sessionId?: string): Promise<IChatConversation[]> {
    await this.init();
    let msgs = messageCache;
    if (sessionId && sessionId !== 'all') {
      msgs = msgs.filter((m) => m.session_id === sessionId);
    }

    const map = new Map<string, IChatConversation>();

    // Process from oldest to newest so last message is up to date
    for (const m of msgs) {
      const phone = m.contact_phone;
      if (!phone) continue;

      const snippet = m.text || (m.has_media ? `[${m.media_type || 'Media'}] ${m.file_name || ''}` : '');
      const isAgentMsg = !!(m.text && (
        m.text.includes('/start') ||
        m.text.includes('/ai') ||
        m.text.includes('/proceed') ||
        m.text.includes('proceed') ||
        m.text.includes('/reset') ||
        m.text.includes('/stop') ||
        m.text.includes('Mobigo AI') ||
        m.text.includes('DocuSeal Submission') ||
        m.text.includes('Extracted Document') ||
        m.text.includes('Phone Rental Service') ||
        m.text.includes('CTOS CBM')
      ));

      const existing = map.get(phone);

      if (!existing) {
        map.set(phone, {
          contact_phone: phone,
          contact_name: m.contact_name || `+${phone}`,
          session_id: m.session_id,
          last_message: snippet,
          last_timestamp: m.timestamp,
          unread_count: m.direction === MessageDirection.INBOUND ? 1 : 0,
          total_messages: 1,
          is_agent: isAgentMsg,
        });
      } else {
        existing.last_message = snippet || existing.last_message;
        existing.last_timestamp = m.timestamp;
        existing.total_messages += 1;
        if (isAgentMsg) {
          existing.is_agent = true;
        }
        if (m.contact_name && !existing.contact_name.startsWith('+')) {
          existing.contact_name = m.contact_name;
        }
      }
    }

    return Array.from(map.values()).sort(
      (a, b) => new Date(b.last_timestamp).getTime() - new Date(a.last_timestamp).getTime()
    );
  }

  static async getMessagesForContact(contactPhone: string, sessionId?: string): Promise<IChatMessage[]> {
    await this.init();
    const cleanPhone = contactPhone.replace(/[^0-9]/g, '');
    let msgs = messageCache.filter((m) => m.contact_phone === cleanPhone);

    if (sessionId && sessionId !== 'all') {
      msgs = msgs.filter((m) => m.session_id === sessionId);
    }

    return msgs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  static async clearConversation(contactPhone: string): Promise<number> {
    await this.init();
    const cleanPhone = contactPhone.replace(/[^0-9]/g, '');
    const prevLen = messageCache.length;
    messageCache = messageCache.filter((m) => m.contact_phone !== cleanPhone);
    const deleted = prevLen - messageCache.length;
    this.persist();
    return deleted;
  }

  private static persist(): void {
    saveLocalMessages(messageCache);
    const redis = getRedisClient();
    if (redis) {
      redis.set(formatRedisKey('wa_chat_history_list'), JSON.stringify(messageCache.slice(-2000))).catch((err) => {
        console.error('[MessageStore] Redis save error:', err);
      });
    }
  }
}
