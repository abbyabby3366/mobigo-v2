import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
  AuthenticationState,
  downloadMediaMessage,
} from 'baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';
import { SessionStatus, InboundMessageEvent } from '../types/index.js';
import { useRedisAuthState } from './redisAuthState.js';
import { handleInboundEvent } from './inboundActionHandler.js';
import { SessionStore } from './sessionStore.js';
import { MessageStore, MessageDirection, MessageStatus } from './messageStore.js';

const SESSIONS_DIR = process.env.SESSIONS_DIR || './sessions';

if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

export interface ActiveSession {
  socket: ReturnType<typeof makeWASocket>;
  sessionId: string;
  status: SessionStatus;
  phoneNumber?: string;
  pushName?: string;
  qrCode?: string;
  lastActiveAt?: Date;
  clearCreds?: () => Promise<void>;
}

const activeSessions = new Map<string, ActiveSession>();
const systemSentMessageIds = new Set<string>();

export function markSystemSentMessageId(msgId?: string) {
  if (!msgId) return;
  systemSentMessageIds.add(msgId);
  if (systemSentMessageIds.size > 10000) {
    const first = systemSentMessageIds.values().next().value;
    if (first) systemSentMessageIds.delete(first);
  }
}

export function isSystemSentMessageId(msgId?: string): boolean {
  if (!msgId) return false;
  return systemSentMessageIds.has(msgId);
}

export function getActiveSession(sessionId: string): ActiveSession | undefined {
  return activeSessions.get(sessionId);
}

export function removeActiveSession(sessionId: string): void {
  const active = activeSessions.get(sessionId);
  if (active) {
    try {
      active.socket.end(undefined);
    } catch (_) {}
    activeSessions.delete(sessionId);
  }
}

export function normalizePhone(raw: string): string {
  let clean = String(raw || '').replace(/[^0-9]/g, '');
  if (clean.startsWith('0')) {
    clean = '60' + clean.slice(1);
  }
  return clean;
}

export async function verifyAndFormatJid(
  sock: any,
  phone: string
): Promise<{ jid: string; exists: boolean; cleanPhone: string }> {
  const clean = normalizePhone(phone);
  if (!clean) {
    return { jid: '', exists: false, cleanPhone: '' };
  }

  const defaultJid = `${clean}@s.whatsapp.net`;

  try {
    if (sock && typeof sock.onWhatsApp === 'function') {
      const results = await sock.onWhatsApp(clean);
      if (Array.isArray(results) && results.length > 0) {
        const match = results.find((r: any) => r.exists) || results[0];
        if (match && match.exists && match.jid) {
          const verifiedPhone = match.jid.split('@')[0];
          return { jid: match.jid, exists: true, cleanPhone: verifiedPhone };
        }
      }
    }
  } catch (err) {
    console.warn(`[Baileys] Warning checking onWhatsApp for ${clean}:`, err);
  }

  return { jid: defaultJid, exists: true, cleanPhone: clean };
}

export async function initWhatsAppSession(sessionId: string): Promise<ActiveSession> {
  const existing = activeSessions.get(sessionId);
  if (existing && existing.status === SessionStatus.CONNECTED) {
    return existing;
  }

  await SessionStore.createSession({ session_id: sessionId });

  let state: AuthenticationState;
  let saveCreds: () => Promise<void>;
  let clearCreds: (() => Promise<void>) | undefined;

  const hasRedis = Boolean(process.env.REDIS_HOST);

  if (hasRedis) {
    try {
      const redisAuth = await useRedisAuthState(sessionId);
      state = redisAuth.state;
      saveCreds = redisAuth.saveCreds;
      clearCreds = redisAuth.clearCreds;
      console.log(`[Baileys] Using Redis Auth State for session "${sessionId}"`);
    } catch (err) {
      console.warn(`[Baileys] Failed to use Redis auth for "${sessionId}", falling back to disk:`, err);
      const sessionFolder = path.join(SESSIONS_DIR, sessionId);
      const fileAuth = await useMultiFileAuthState(sessionFolder);
      state = fileAuth.state;
      saveCreds = fileAuth.saveCreds;
    }
  } else {
    const sessionFolder = path.join(SESSIONS_DIR, sessionId);
    if (!fs.existsSync(sessionFolder)) {
      fs.mkdirSync(sessionFolder, { recursive: true });
    }
    const fileAuth = await useMultiFileAuthState(sessionFolder);
    state = fileAuth.state;
    saveCreds = fileAuth.saveCreds;
  }

  const logger = pino({ level: 'silent' });
  let version = [2, 3000, 1043857760] as any;
  try {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000));
    const fetched = await Promise.race([fetchLatestBaileysVersion(), timeout]);
    if (fetched && (fetched as any).version) {
      version = (fetched as any).version;
    }
  } catch (verErr) {
    console.warn('[Baileys] Using fallback version due to fetch error:', verErr);
  }

  console.log(`[Baileys] Initializing WASocket for "${sessionId}" with version:`, version);

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    browser: Browsers.macOS('Chrome'),
    printQRInTerminal: true,
    logger,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    defaultQueryTimeoutMs: 60_000,
  });

  const sessionObj: ActiveSession = {
    socket: sock,
    sessionId,
    status: SessionStatus.STARTING,
    clearCreds,
    lastActiveAt: new Date(),
  };
  activeSessions.set(sessionId, sessionObj);

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        const qrBase64 = await QRCode.toDataURL(qr);
        sessionObj.status = SessionStatus.QR_READY;
        sessionObj.qrCode = qrBase64;
        await SessionStore.updateSession(sessionId, {
          status: SessionStatus.QR_READY,
          qr_code: qrBase64,
        });
        console.log(`[Baileys] QR code ready for session "${sessionId}". Scan with WhatsApp!`);
      } catch (err) {
        console.error(`[Baileys] Failed to generate QR data URL:`, err);
      }
    }

    if (connection === 'open') {
      const rawUserJid = sock.user?.id || '';
      const phoneNumber = rawUserJid.split(':')[0].replace(/[^0-9]/g, '');
      const pushName = sock.user?.name || '';

      sessionObj.status = SessionStatus.CONNECTED;
      sessionObj.qrCode = undefined;
      sessionObj.phoneNumber = phoneNumber;
      sessionObj.pushName = pushName;
      sessionObj.lastActiveAt = new Date();

      await SessionStore.updateSession(sessionId, {
        status: SessionStatus.CONNECTED,
        qr_code: '',
        phone_number: phoneNumber,
        push_name: pushName,
        last_phone_activity_at: new Date().toISOString(),
      });

      console.log(`✅ [Baileys] WhatsApp Connected: session="${sessionId}", phone=+${phoneNumber}, name="${pushName}"`);
    }

    if (connection === 'close') {
      sessionObj.status = SessionStatus.DISCONNECTED;
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;

      if (isLoggedOut) {
        console.log(`❌ [Baileys] WhatsApp Session logged out (401): ${sessionId}`);
        await SessionStore.updateSession(sessionId, {
          status: SessionStatus.DISCONNECTED,
          qr_code: '',
        });
        if (clearCreds) {
          await clearCreds().catch(console.error);
        } else {
          const sessionFolder = path.join(SESSIONS_DIR, sessionId);
          try {
            fs.rmSync(sessionFolder, { recursive: true, force: true });
          } catch (_) {}
        }
        activeSessions.delete(sessionId);
      } else {
        const sessionMeta = await SessionStore.getSession(sessionId);
        if (sessionMeta?.status !== SessionStatus.DISCONNECTED) {
          console.log(`🔄 [Baileys] Reconnecting session "${sessionId}" (reason: ${statusCode || 'unknown'})...`);
          setTimeout(() => {
            initWhatsAppSession(sessionId).catch(console.error);
          }, 4000);
        }
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) {
        markSystemSentMessageId(msg.key.id || '');
        await SessionStore.updateSession(sessionId, {
          last_physical_phone_sent_message_at: new Date().toISOString(),
          last_phone_activity_at: new Date().toISOString(),
        });
        continue;
      }

      if (isSystemSentMessageId(msg.key.id || '')) continue;
      if (!msg.message) continue;

      const fromJid = msg.key.remoteJid || '';
      const pushName = msg.pushName || '';
      const msgTime = msg.messageTimestamp ? new Date(Number(msg.messageTimestamp) * 1000) : new Date();

      let senderPhone = '';
      if (fromJid.endsWith('@s.whatsapp.net') || fromJid.endsWith('@c.us')) {
        senderPhone = fromJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
      } else {
        senderPhone = normalizePhone(fromJid.split('@')[0]);
      }

      await SessionStore.updateSession(sessionId, {
        last_phone_activity_at: msgTime.toISOString(),
      });

      // Extract text content
      const textContent =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.documentMessage?.caption ||
        msg.message.videoMessage?.caption ||
        '';

      // Check media
      let hasMedia = false;
      let mediaType: 'document' | 'image' | 'video' | 'audio' | undefined;
      let fileName: string | undefined;
      let mimetype: string | undefined;
      let fileBuffer: Buffer | undefined;

      const docMsg = msg.message.documentMessage;
      const imgMsg = msg.message.imageMessage;
      const vidMsg = msg.message.videoMessage;
      const audMsg = msg.message.audioMessage;

      let fileUrl: string | undefined;
      if (docMsg || imgMsg || vidMsg || audMsg) {
        hasMedia = true;
        if (docMsg) {
          mediaType = 'document';
          fileName = docMsg.fileName || `document_${Date.now()}.pdf`;
          mimetype = docMsg.mimetype || 'application/pdf';
        } else if (imgMsg) {
          mediaType = 'image';
          fileName = `image_${Date.now()}.jpg`;
          mimetype = imgMsg.mimetype || 'image/jpeg';
        } else if (vidMsg) {
          mediaType = 'video';
          fileName = `video_${Date.now()}.mp4`;
          mimetype = vidMsg.mimetype || 'video/mp4';
        } else if (audMsg) {
          mediaType = 'audio';
          fileName = `audio_${Date.now()}.mp3`;
          mimetype = audMsg.mimetype || 'audio/mp4';
        }

        try {
          fileBuffer = await downloadMediaMessage(
            msg,
            'buffer',
            {},
            { logger, reuploadRequest: sock.updateMediaMessage }
          );
          if (fileBuffer) {
            const uploadsDir = path.join(process.cwd(), 'uploads');
            if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
            const safeName = `${Date.now()}_${(fileName || 'file').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
            fs.writeFileSync(path.join(uploadsDir, safeName), fileBuffer);
            fileUrl = `/uploads/${safeName}`;
          }
        } catch (downloadErr) {
          console.error('[Baileys] Error downloading media:', downloadErr);
        }
      }

      // Log Inbound Message to MessageStore
      MessageStore.logMessage({
        id: msg.key.id || undefined,
        session_id: sessionId,
        direction: MessageDirection.INBOUND,
        from_phone: senderPhone,
        to_phone: sessionObj.phoneNumber || '',
        contact_phone: senderPhone,
        contact_name: pushName,
        text: textContent,
        has_media: hasMedia,
        media_type: mediaType,
        file_name: fileName,
        file_url: fileUrl,
        status: MessageStatus.RECEIVED,
        timestamp: msgTime.toISOString(),
      }).catch(console.error);

      // Forward to session agent phone numbers (Forwarding tab feature matching WhatsBlast)
      const sessionDoc = await SessionStore.getSession(sessionId);
      if (sessionDoc && Array.isArray(sessionDoc.agent_phone_numbers) && sessionDoc.agent_phone_numbers.length > 0) {
        for (const agent of sessionDoc.agent_phone_numbers) {
          if (agent.is_active && agent.phone_number) {
            const agentJid = `${agent.phone_number.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
            const alertText = hasMedia
              ? `📩 *Inbound ${mediaType?.toUpperCase()}* from ${pushName || senderPhone} (+${senderPhone}):\n📄 File: ${fileName || 'Attachment'}\n"${textContent}"`
              : `📩 *Inbound Reply* from ${pushName || senderPhone} (+${senderPhone}):\n\n"${textContent}"`;

            sock.sendMessage(agentJid, { text: alertText }).then((sentMsg) => {
              if (sentMsg?.key?.id) markSystemSentMessageId(sentMsg.key.id);
            }).catch(console.error);
          }
        }
      }

      const eventPayload: InboundMessageEvent = {
        sessionId,
        messageId: msg.key.id || '',
        fromJid,
        senderPhone,
        pushName,
        text: textContent,
        hasMedia,
        mediaType,
        fileName,
        mimetype,
        fileBuffer,
        timestamp: msgTime,
      };

      handleInboundEvent(eventPayload).catch((err) => {
        console.error('[Baileys] Error handling inbound event:', err);
      });
    }
  });

  return sessionObj;
}

export async function restoreAllSessions(): Promise<void> {
  const sessions = await SessionStore.getAllSessions();
  for (const s of sessions) {
    if (s.status === SessionStatus.CONNECTED || s.status === SessionStatus.STARTING || s.status === SessionStatus.QR_READY) {
      try {
        await initWhatsAppSession(s.session_id);
        await new Promise((r) => setTimeout(r, 1000));
      } catch (err) {
        console.error(`[Baileys] Error restoring session ${s.session_id}:`, err);
      }
    }
  }
}

export async function sendTextMessage(sessionId: string, toPhone: string, text: string): Promise<any> {
  const active = activeSessions.get(sessionId) || (await initWhatsAppSession(sessionId));
  const { jid: targetJid, exists, cleanPhone } = await verifyAndFormatJid(active.socket, toPhone);

  if (!exists) {
    throw new Error(`Phone number ${toPhone} is not registered on WhatsApp`);
  }

  const result = await active.socket.sendMessage(targetJid, { text });
  if (result?.key?.id) markSystemSentMessageId(result.key.id);

  // Log Outbound Message
  MessageStore.logMessage({
    id: result?.key?.id || undefined,
    session_id: sessionId,
    direction: MessageDirection.OUTBOUND,
    from_phone: active.phoneNumber || '',
    to_phone: cleanPhone,
    contact_phone: cleanPhone,
    text,
    status: MessageStatus.SENT,
  }).catch(console.error);

  return result;
}

export async function sendDocumentMessage(
  sessionId: string,
  toPhone: string,
  document: Buffer | string,
  fileName: string,
  caption?: string,
  mimetype?: string
): Promise<any> {
  const active = activeSessions.get(sessionId) || (await initWhatsAppSession(sessionId));
  const { jid: targetJid, exists, cleanPhone } = await verifyAndFormatJid(active.socket, toPhone);

  if (!exists) {
    throw new Error(`Phone number ${toPhone} is not registered on WhatsApp`);
  }

  const docPayload = typeof document === 'string' ? { url: document } : document;

  let fileUrl: string | undefined = typeof document === 'string' ? document : undefined;
  if (Buffer.isBuffer(document)) {
    try {
      const uploadsDir = path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      const safeName = `${Date.now()}_${(fileName || 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      fs.writeFileSync(path.join(uploadsDir, safeName), document);
      fileUrl = `/uploads/${safeName}`;
    } catch (_) {}
  }

  const result = await active.socket.sendMessage(targetJid, {
    document: docPayload,
    fileName: fileName || 'Document.pdf',
    mimetype: mimetype || 'application/pdf',
    caption: caption || undefined,
  });

  if (result?.key?.id) markSystemSentMessageId(result.key.id);

  // Log Outbound Document Message
  MessageStore.logMessage({
    id: result?.key?.id || undefined,
    session_id: sessionId,
    direction: MessageDirection.OUTBOUND,
    from_phone: active.phoneNumber || '',
    to_phone: cleanPhone,
    contact_phone: cleanPhone,
    text: caption || '',
    has_media: true,
    media_type: 'document',
    file_name: fileName,
    file_url: fileUrl,
    status: MessageStatus.SENT,
  }).catch(console.error);

  return result;
}

export async function sendImageMessage(
  sessionId: string,
  toPhone: string,
  image: Buffer | string,
  caption?: string
): Promise<any> {
  const active = activeSessions.get(sessionId) || (await initWhatsAppSession(sessionId));
  const { jid: targetJid, exists, cleanPhone } = await verifyAndFormatJid(active.socket, toPhone);

  if (!exists) {
    throw new Error(`Phone number ${toPhone} is not registered on WhatsApp`);
  }

  const imgPayload = typeof image === 'string' ? { url: image } : image;

  let fileUrl: string | undefined = typeof image === 'string' ? image : undefined;
  if (Buffer.isBuffer(image)) {
    try {
      const uploadsDir = path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      const safeName = `${Date.now()}_image.jpg`;
      fs.writeFileSync(path.join(uploadsDir, safeName), image);
      fileUrl = `/uploads/${safeName}`;
    } catch (_) {}
  }

  const result = await active.socket.sendMessage(targetJid, {
    image: imgPayload,
    caption: caption || undefined,
  });

  if (result?.key?.id) markSystemSentMessageId(result.key.id);

  // Log Outbound Image Message
  MessageStore.logMessage({
    id: result?.key?.id || undefined,
    session_id: sessionId,
    direction: MessageDirection.OUTBOUND,
    from_phone: active.phoneNumber || '',
    to_phone: cleanPhone,
    contact_phone: cleanPhone,
    text: caption || '',
    has_media: true,
    media_type: 'image',
    file_url: fileUrl,
    status: MessageStatus.SENT,
  }).catch(console.error);

  return result;
}
