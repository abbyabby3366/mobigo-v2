import {
  AuthenticationCreds,
  AuthenticationState,
  SignalDataTypeMap,
  initAuthCreds,
  proto,
  BufferJSON,
} from 'baileys';
import { Redis } from 'ioredis';
import fs from 'fs';
import path from 'path';

let redisClient: Redis | null = null;
const SESSIONS_DIR = process.env.SESSIONS_DIR || './sessions';

export function getEnvPrefix(): string {
  const env = (process.env.NODE_ENV || 'development').toLowerCase();
  return env === 'production' ? 'prod' : 'dev';
}

export function getAuthVersion(): string {
  return process.env.REDIS_AUTH_VERSION || 'v1';
}

export function formatRedisKey(key: string): string {
  const prefix = getEnvPrefix();
  const authVer = getAuthVersion();
  return `${prefix}:${authVer}:${key}`;
}

export function getRedisClient(): Redis | null {
  if (redisClient) return redisClient;

  const host = process.env.REDIS_HOST;
  const port = parseInt(process.env.REDIS_PORT || '6379', 10);
  const password = process.env.REDIS_PASSWORD || undefined;

  if (!host) {
    return null;
  }

  try {
    redisClient = new Redis({
      host,
      port,
      password,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });

    redisClient.on('error', (err) => console.error('[Redis] Client Error:', err.message));
    redisClient.on('connect', () => console.log(`[Redis] Connected successfully (Env: ${getEnvPrefix()}).`));

    return redisClient;
  } catch (err) {
    console.error('[Redis] Failed to initialize client:', err);
    return null;
  }
}

export async function useRedisAuthState(sessionId: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  clearCreds: () => Promise<void>;
}> {
  const sessionLocalDir = path.join(SESSIONS_DIR, sessionId);
  if (!fs.existsSync(sessionLocalDir)) {
    fs.mkdirSync(sessionLocalDir, { recursive: true });
  }

  const credsFile = path.join(sessionLocalDir, 'creds.json');
  const redis = getRedisClient();

  const credsKey = formatRedisKey(`wa_session:${sessionId}:creds`);
  const keysPrefix = formatRedisKey(`wa_session:${sessionId}:keys:`);

  const readData = async (key: string, localFileName?: string) => {
    if (redis) {
      try {
        const data = await redis.get(key);
        if (data) return JSON.parse(data, BufferJSON.reviver);
      } catch (_) {}
    }

    if (localFileName) {
      const filePath = path.join(sessionLocalDir, localFileName);
      if (fs.existsSync(filePath)) {
        try {
          return JSON.parse(fs.readFileSync(filePath, 'utf-8'), BufferJSON.reviver);
        } catch (_) {}
      }
    }
    return null;
  };

  const writeData = async (key: string, value: any, localFileName?: string) => {
    // Write local backup first
    if (localFileName) {
      const filePath = path.join(sessionLocalDir, localFileName);
      try {
        if (value === null || value === undefined) {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } else {
          fs.writeFileSync(filePath, JSON.stringify(value, BufferJSON.replacer));
        }
      } catch (_) {}
    }

    // Write to Redis
    if (redis) {
      try {
        if (value === null || value === undefined) {
          await redis.del(key);
        } else {
          await redis.set(key, JSON.stringify(value, BufferJSON.replacer));
        }
      } catch (_) {
        // Silently caught so Redis OOM doesn't crash the server
      }
    }
  };

  const rawCreds = await readData(credsKey, 'creds.json');
  const creds: AuthenticationCreds = rawCreds || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: { [id: string]: any } = {};
          for (const id of ids) {
            const localName = `${type}_${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
            const value = await readData(`${keysPrefix}${type}:${id}`, localName);
            if (value) {
              if (type === 'app-state-sync-key' && value) {
                data[id] = proto.Message.AppStateSyncKeyData.fromObject(value);
              } else {
                data[id] = value;
              }
            }
          }
          return data;
        },
        set: async (data) => {
          const tasks: Promise<void>[] = [];
          for (const category in data) {
            for (const id in data[category as keyof SignalDataTypeMap]) {
              const value = data[category as keyof SignalDataTypeMap]![id];
              const key = `${keysPrefix}${category}:${id}`;
              const localName = `${category}_${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
              tasks.push(writeData(key, value, localName));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => {
      await writeData(credsKey, creds, 'creds.json');
    },
    clearCreds: async () => {
      try {
        if (fs.existsSync(sessionLocalDir)) {
          fs.rmSync(sessionLocalDir, { recursive: true, force: true });
        }
      } catch (_) {}

      if (redis) {
        try {
          const keys = await redis.keys(formatRedisKey(`wa_session:${sessionId}:*`));
          if (keys.length > 0) {
            await redis.del(...keys);
          }
        } catch (_) {}
      }
    },
  };
}
