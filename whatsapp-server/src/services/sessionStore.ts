import { getRedisClient } from './redisAuthState.js';
import { IWhatsAppSessionData, IAgentPhoneNumber, SessionStatus } from '../types/index.js';
import fs from 'fs';
import path from 'path';

const SESSIONS_DIR = process.env.SESSIONS_DIR || './sessions';
const STORE_FILE = path.join(SESSIONS_DIR, 'sessions_meta.json');

// In-memory cache synced with Redis & local store
const sessionCache = new Map<string, IWhatsAppSessionData>();

function loadLocalFallback(): Map<string, IWhatsAppSessionData> {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'));
      const map = new Map<string, IWhatsAppSessionData>();
      if (Array.isArray(data)) {
        data.forEach((s) => map.set(s.session_id, s));
      }
      return map;
    }
  } catch (_) {}
  return new Map();
}

function saveLocalFallback(map: Map<string, IWhatsAppSessionData>): void {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
    const arr = Array.from(map.values());
    fs.writeFileSync(STORE_FILE, JSON.stringify(arr, null, 2), 'utf-8');
  } catch (_) {}
}

export class SessionStore {
  private static isInitialized = false;

  static async init(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // 1. Load local fallback
    const local = loadLocalFallback();
    local.forEach((v, k) => sessionCache.set(k, v));

    // 2. Load from Redis if available
    const redis = getRedisClient();
    if (redis) {
      try {
        const keys = await redis.keys('wa_session_meta:*');
        for (const key of keys) {
          const raw = await redis.get(key);
          if (raw) {
            const data: IWhatsAppSessionData = JSON.parse(raw);
            sessionCache.set(data.session_id, data);
          }
        }
      } catch (err) {
        console.error('[SessionStore] Redis load error:', err);
      }
    }

    // Ensure default session exists if empty
    const defaultSessionId = process.env.DEFAULT_SESSION_ID || 'mobigo_main';
    if (sessionCache.size === 0) {
      await this.createSession({
        session_id: defaultSessionId,
        alias: 'Main Store WhatsApp',
        labels: ['sales', 'mobigo'],
      });
    }
  }

  static async getAllSessions(): Promise<IWhatsAppSessionData[]> {
    await this.init();
    return Array.from(sessionCache.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  static async getSession(idOrSessionId: string): Promise<IWhatsAppSessionData | null> {
    await this.init();
    if (sessionCache.has(idOrSessionId)) {
      return sessionCache.get(idOrSessionId)!;
    }
    for (const s of sessionCache.values()) {
      if (s.id === idOrSessionId || s.session_id === idOrSessionId) {
        return s;
      }
    }
    return null;
  }

  static async createSession(data: Partial<IWhatsAppSessionData>): Promise<IWhatsAppSessionData> {
    await this.init();
    const sessionId = data.session_id || `session_${Date.now()}`;
    const existing = await this.getSession(sessionId);
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const newSession: IWhatsAppSessionData = {
      id: sessionId,
      session_id: sessionId,
      status: SessionStatus.STARTING,
      alias: data.alias || '',
      labels: data.labels || [],
      max_message_count_per_day: data.max_message_count_per_day ?? 50,
      current_message_count: 0,
      min_interval_seconds: data.min_interval_seconds ?? 10,
      max_interval_seconds: data.max_interval_seconds ?? 15,
      active_start_time: data.active_start_time || '00:00',
      active_end_time: data.active_end_time || '23:59',
      warmup_schedule: data.warmup_schedule || [],
      agent_phone_numbers: data.agent_phone_numbers || [],
      createdAt: now,
      updatedAt: now,
    };

    sessionCache.set(sessionId, newSession);
    await this.persist(newSession);
    return newSession;
  }

  static async updateSession(
    idOrSessionId: string,
    updates: Partial<IWhatsAppSessionData>
  ): Promise<IWhatsAppSessionData | null> {
    await this.init();
    const session = await this.getSession(idOrSessionId);
    if (!session) return null;

    const updated: IWhatsAppSessionData = {
      ...session,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    sessionCache.set(session.session_id, updated);
    await this.persist(updated);
    return updated;
  }

  static async deleteSession(idOrSessionId: string): Promise<boolean> {
    await this.init();
    const session = await this.getSession(idOrSessionId);
    if (!session) return false;

    sessionCache.delete(session.session_id);
    saveLocalFallback(sessionCache);

    const redis = getRedisClient();
    if (redis) {
      try {
        await redis.del(`wa_session_meta:${session.session_id}`);
      } catch (_) {}
    }
    return true;
  }

  static async addAgentPhone(idOrSessionId: string, phone: string): Promise<IAgentPhoneNumber | null> {
    const session = await this.getSession(idOrSessionId);
    if (!session) return null;

    const newAgent: IAgentPhoneNumber = {
      id: `agent_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      phone_number: phone.replace(/[^0-9]/g, ''),
      is_active: true,
      createdAt: new Date().toISOString(),
    };

    const agents = session.agent_phone_numbers || [];
    agents.push(newAgent);
    await this.updateSession(session.session_id, { agent_phone_numbers: agents });
    return newAgent;
  }

  static async deleteAgentPhone(idOrSessionId: string, agentId: string): Promise<boolean> {
    const session = await this.getSession(idOrSessionId);
    if (!session) return false;

    const agents = (session.agent_phone_numbers || []).filter((a) => a.id !== agentId);
    await this.updateSession(session.session_id, { agent_phone_numbers: agents });
    return true;
  }

  private static async persist(session: IWhatsAppSessionData): Promise<void> {
    saveLocalFallback(sessionCache);
    const redis = getRedisClient();
    if (redis) {
      try {
        await redis.set(`wa_session_meta:${session.session_id}`, JSON.stringify(session));
      } catch (err) {
        console.error(`[SessionStore] Redis persist error for ${session.session_id}:`, err);
      }
    }
  }
}
