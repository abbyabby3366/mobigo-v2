import { getRedisClient, formatRedisKey, getSessionsDir } from './redisAuthState.js';
import { LidPhoneMapper } from './lidPhoneMapper.js';
import fs from 'fs';
import path from 'path';

function getMessagesFile(): string {
  return path.join(getSessionsDir(), 'messages_history.json');
}

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
    const file = getMessagesFile();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (Array.isArray(data)) return data;
    }
  } catch (_) {}
  return [];
}

function saveLocalMessages(msgs: IChatMessage[]): void {
  try {
    const dir = getSessionsDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(getMessagesFile(), JSON.stringify(msgs.slice(-5000), null, 2), 'utf-8');
  } catch (_) {}
}

export class MessageStore {
  private static isInitialized = false;

  static async init(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;

    await LidPhoneMapper.init();

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

    // Auto-discover any matching contacts in history to unify existing cache
    this.reconcileCache();
  }

  private static reconcileCache(): void {
    // 1. Gather all known contact names and cross-references
    for (const m of messageCache) {
      const phone = m.contact_phone || m.to_phone || m.from_phone;
      if (phone && m.contact_name && !m.contact_name.startsWith('+')) {
        LidPhoneMapper.registerContactName(phone, m.contact_name);
      }
    }

    // 2. Canonicalize all contact_phone fields
    let modified = false;
    for (const m of messageCache) {
      const rawPhone = m.contact_phone || m.to_phone || m.from_phone || '';
      const canonical = LidPhoneMapper.canonicalize(rawPhone);
      if (canonical && m.contact_phone !== canonical) {
        m.contact_phone = canonical;
        modified = true;
      }
      if (!m.contact_name || m.contact_name.startsWith('+')) {
        const name = LidPhoneMapper.getContactName(m.contact_phone);
        if (name) {
          m.contact_name = name;
          modified = true;
        }
      }
    }

    if (modified) {
      this.persist();
    }
  }

  static getContactName(phoneOrLid: string): string | undefined {
    return LidPhoneMapper.getContactName(phoneOrLid);
  }

  static async logMessage(msg: Partial<IChatMessage>): Promise<IChatMessage> {
    await this.init();

    const rawContactPhone = msg.contact_phone || msg.to_phone || msg.from_phone || '';
    const canonicalContactPhone = LidPhoneMapper.canonicalize(rawContactPhone) || rawContactPhone.replace(/[^0-9]/g, '');

    let contactName = msg.contact_name || '';
    if (contactName && !contactName.startsWith('+')) {
      LidPhoneMapper.registerContactName(canonicalContactPhone, contactName);
      if (rawContactPhone) LidPhoneMapper.registerContactName(rawContactPhone, contactName);
    } else {
      contactName = LidPhoneMapper.getContactName(canonicalContactPhone) || LidPhoneMapper.getContactName(rawContactPhone) || '';
    }

    const newMsg: IChatMessage = {
      id: msg.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      session_id: msg.session_id || 'mobigo_main',
      direction: msg.direction || MessageDirection.OUTBOUND,
      from_phone: msg.from_phone || '',
      to_phone: msg.to_phone || '',
      contact_phone: canonicalContactPhone,
      contact_name: contactName,
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
      const rawPhone = m.contact_phone || m.to_phone || m.from_phone;
      if (!rawPhone) continue;
      const phone = LidPhoneMapper.canonicalize(rawPhone) || rawPhone.replace(/[^0-9]/g, '');
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

      const contactName =
        (m.contact_name && !m.contact_name.startsWith('+') ? m.contact_name : undefined) ||
        LidPhoneMapper.getContactName(phone) ||
        (phone.length <= 13 ? `+${phone}` : 'WhatsApp Contact');

      const existing = map.get(phone);

      if (!existing) {
        map.set(phone, {
          contact_phone: phone,
          contact_name: contactName,
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
        if (contactName && !contactName.startsWith('+') && (!existing.contact_name || existing.contact_name.startsWith('+'))) {
          existing.contact_name = contactName;
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
    const matchKeys = new Set(LidPhoneMapper.getAllMatches(cleanPhone));
    const canonical = LidPhoneMapper.canonicalize(cleanPhone);

    let msgs = messageCache.filter((m) => {
      if (m.contact_phone && matchKeys.has(m.contact_phone)) return true;
      if (m.to_phone && matchKeys.has(m.to_phone.replace(/[^0-9]/g, ''))) return true;
      if (m.from_phone && matchKeys.has(m.from_phone.replace(/[^0-9]/g, ''))) return true;
      if (canonical && m.contact_phone && LidPhoneMapper.canonicalize(m.contact_phone) === canonical) return true;
      return false;
    });

    if (sessionId && sessionId !== 'all') {
      msgs = msgs.filter((m) => m.session_id === sessionId);
    }

    return msgs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  static async clearConversation(contactPhone: string): Promise<number> {
    await this.init();
    const cleanPhone = contactPhone.replace(/[^0-9]/g, '');
    const matchKeys = new Set(LidPhoneMapper.getAllMatches(cleanPhone));
    const canonical = LidPhoneMapper.canonicalize(cleanPhone);

    const prevLen = messageCache.length;
    messageCache = messageCache.filter((m) => {
      if (m.contact_phone && matchKeys.has(m.contact_phone)) return false;
      if (m.to_phone && matchKeys.has(m.to_phone.replace(/[^0-9]/g, ''))) return false;
      if (m.from_phone && matchKeys.has(m.from_phone.replace(/[^0-9]/g, ''))) return false;
      if (canonical && m.contact_phone && LidPhoneMapper.canonicalize(m.contact_phone) === canonical) return false;
      return true;
    });

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

