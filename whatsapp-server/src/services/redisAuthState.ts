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
export function getEnvPrefix(): string {
  const env = (process.env.NODE_ENV || 'development').toLowerCase();
  return env === 'production' ? 'prod' : 'dev';
}

export function getSessionsDir(): string {
  const baseDir = process.env.SESSIONS_DIR || './sessions';
  return path.join(baseDir, getEnvPrefix());
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

// In-memory L1 cache for instant cryptographic key lookups (0ms latency)
const memoryKeyCache = new Map<string, any>();

export async function useRedisAuthState(sessionId: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  clearCreds: () => Promise<void>;
}> {
  const sessionLocalDir = path.join(getSessionsDir(), sessionId);
  if (!fs.existsSync(sessionLocalDir)) {
    fs.mkdirSync(sessionLocalDir, { recursive: true });
  }

  const credsFile = path.join(sessionLocalDir, 'creds.json');
  const redis = getRedisClient();

  const credsKey = formatRedisKey(`wa_session:${sessionId}:creds`);
  const keysPrefix = formatRedisKey(`wa_session:${sessionId}:keys:`);

  const readData = async (key: string, localFileName?: string) => {
    // 1. Check in-memory L1 cache (0ms)
    if (memoryKeyCache.has(key)) {
      return memoryKeyCache.get(key);
    }

    // 2. Check local disk L2 cache (<1ms)
    if (localFileName) {
      const filePath = path.join(sessionLocalDir, localFileName);
      if (fs.existsSync(filePath)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'), BufferJSON.reviver);
          if (parsed) {
            memoryKeyCache.set(key, parsed);
            return parsed;
          }
        } catch (_) {}
      }
    }

    // 3. Fallback to remote Redis Cloud L3
    if (redis) {
      try {
        const data = await redis.get(key);
        if (data) {
          const parsed = JSON.parse(data, BufferJSON.reviver);
          memoryKeyCache.set(key, parsed);
          // Persist to local disk cache
          if (localFileName) {
            const filePath = path.join(sessionLocalDir, localFileName);
            try {
              fs.writeFileSync(filePath, JSON.stringify(parsed, BufferJSON.replacer));
            } catch (_) {}
          }
          return parsed;
        }
      } catch (_) {}
    }

    return null;
  };

  const writeData = async (key: string, value: any, localFileName?: string) => {
    // 1. Immediately update in-memory cache (0ms)
    if (value === null || value === undefined) {
      memoryKeyCache.delete(key);
    } else {
      memoryKeyCache.set(key, value);
    }

    // 2. Write to local disk cache (<1ms)
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

    // 3. Sync to Redis Cloud in background (non-blocking)
    if (redis) {
      if (value === null || value === undefined) {
        redis.del(key).catch(() => {});
      } else {
        redis.set(key, JSON.stringify(value, BufferJSON.replacer)).catch(() => {});
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
          const missingIds: string[] = [];

          // Fast path: resolve from memory or local disk first
          for (const id of ids) {
            const key = `${keysPrefix}${type}:${id}`;
            const localName = `${type}_${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;

            if (memoryKeyCache.has(key)) {
              const val = memoryKeyCache.get(key);
              if (val) {
                data[id] = type === 'app-state-sync-key' ? proto.Message.AppStateSyncKeyData.fromObject(val) : val;
              }
            } else if (fs.existsSync(path.join(sessionLocalDir, localName))) {
              try {
                const parsed = JSON.parse(fs.readFileSync(path.join(sessionLocalDir, localName), 'utf-8'), BufferJSON.reviver);
                if (parsed) {
                  memoryKeyCache.set(key, parsed);
                  data[id] = type === 'app-state-sync-key' ? proto.Message.AppStateSyncKeyData.fromObject(parsed) : parsed;
                }
              } catch (_) {
                missingIds.push(id);
              }
            } else {
              missingIds.push(id);
            }
          }

          // If any keys were missing, batch-fetch them from Redis via MGET (single network round-trip)
          if (missingIds.length > 0 && redis) {
            try {
              const redisKeys = missingIds.map((id) => `${keysPrefix}${type}:${id}`);
              const results = await redis.mget(...redisKeys);
              for (let i = 0; i < missingIds.length; i++) {
                const id = missingIds[i];
                const raw = results[i];
                if (raw) {
                  const parsed = JSON.parse(raw, BufferJSON.reviver);
                  const key = redisKeys[i];
                  memoryKeyCache.set(key, parsed);
                  const localName = `${type}_${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
                  try {
                    fs.writeFileSync(path.join(sessionLocalDir, localName), JSON.stringify(parsed, BufferJSON.replacer));
                  } catch (_) {}

                  data[id] = type === 'app-state-sync-key' ? proto.Message.AppStateSyncKeyData.fromObject(parsed) : parsed;
                }
              }
            } catch (_) {}
          }

          return data;
        },
        set: async (data) => {
          const pipeline = redis ? redis.pipeline() : null;

          for (const category in data) {
            for (const id in data[category as keyof SignalDataTypeMap]) {
              const value = data[category as keyof SignalDataTypeMap]![id];
              const key = `${keysPrefix}${category}:${id}`;
              const localName = `${category}_${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;

              // 1. Update memory
              if (value === null || value === undefined) {
                memoryKeyCache.delete(key);
              } else {
                memoryKeyCache.set(key, value);
              }

              // 2. Update local disk
              const filePath = path.join(sessionLocalDir, localName);
              try {
                if (value === null || value === undefined) {
                  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                } else {
                  fs.writeFileSync(filePath, JSON.stringify(value, BufferJSON.replacer));
                }
              } catch (_) {}

              // 3. Queue in Redis pipeline
              if (pipeline) {
                if (value === null || value === undefined) {
                  pipeline.del(key);
                } else {
                  pipeline.set(key, JSON.stringify(value, BufferJSON.replacer));
                }
              }
            }
          }

          // Execute Redis pipeline asynchronously in the background (non-blocking)
          if (pipeline) {
            pipeline.exec().catch(() => {});
          }
        },
      },
    },
    saveCreds: async () => {
      await writeData(credsKey, creds, 'creds.json');
    },
    clearCreds: async () => {
      memoryKeyCache.clear();
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
