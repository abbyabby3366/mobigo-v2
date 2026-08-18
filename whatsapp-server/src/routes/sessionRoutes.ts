import { Router, Request, Response } from 'express';
import {
  initWhatsAppSession,
  getActiveSession,
  removeActiveSession,
} from '../services/baileysManager.js';
import { SessionStore } from '../services/sessionStore.js';
import { SessionStatus } from '../types/index.js';
import { useRedisAuthState, getSessionsDir } from '../services/redisAuthState.js';
import path from 'path';
import fs from 'fs';

const router = Router();

function formatSession(s: any) {
  const isConnected = s.status === SessionStatus.CONNECTED;
  return {
    id: s.id || s.session_id,
    session_id: s.session_id,
    status: s.status,
    phone_number: s.phone_number || '',
    push_name: s.push_name || '',
    alias: s.alias || '',
    labels: s.labels || [],
    qr_code: s.qr_code || '',
    min_interval_seconds: s.min_interval_seconds ?? 10,
    max_interval_seconds: s.max_interval_seconds ?? 15,
    active_start_time: s.active_start_time || '00:00',
    active_end_time: s.active_end_time || '23:59',
    warmup_schedule: s.warmup_schedule || [],
    agent_phone_numbers: s.agent_phone_numbers || [],
    max_message_count_per_day: s.max_message_count_per_day ?? 50,
    current_message_count: s.current_message_count ?? 0,
    last_phone_activity_at: s.last_phone_activity_at || null,
    last_physical_phone_sent_message_at: s.last_physical_phone_sent_message_at || null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

// 1. GET /whatsapp-sessions - List all sessions
router.get(['/', '/whatsapp-sessions'], async (req: Request, res: Response) => {
  const { search, status } = req.query;
  let sessions = await SessionStore.getAllSessions();

  if (search) {
    const q = String(search).toLowerCase();
    sessions = sessions.filter(
      (s) =>
        s.session_id.toLowerCase().includes(q) ||
        (s.alias && s.alias.toLowerCase().includes(q)) ||
        (s.phone_number && s.phone_number.includes(q))
    );
  }

  if (status && status !== 'all') {
    sessions = sessions.filter((s) => s.status === status);
  }

  return res.json(sessions.map(formatSession));
});

// 2. POST /whatsapp-sessions - Create a new session
router.post(['/', '/whatsapp-sessions'], async (req: Request, res: Response) => {
  const sessionId = req.body.session_id || `session_${Date.now()}`;
  const alias = req.body.alias ? String(req.body.alias).trim() : undefined;
  const labels = req.body.labels ? (Array.isArray(req.body.labels) ? req.body.labels : String(req.body.labels).split(',')) : [];

  let session = await SessionStore.getSession(sessionId);
  if (!session) {
    session = await SessionStore.createSession({
      session_id: sessionId,
      alias: alias || '',
      labels,
      min_interval_seconds: req.body.min_interval_seconds ? Number(req.body.min_interval_seconds) : 10,
      max_interval_seconds: req.body.max_interval_seconds ? Number(req.body.max_interval_seconds) : 15,
      active_start_time: req.body.active_start_time || '00:00',
      active_end_time: req.body.active_end_time || '23:59',
      warmup_schedule: req.body.warmup_schedule || [],
    });
  }

  initWhatsAppSession(sessionId).catch(console.error);
  return res.status(201).json(formatSession(session));
});

// 3. GET /qr - Get QR code for default or query session (HTML or JSON)
router.get(['/qr', '/whatsapp-sessions/qr'], async (req: Request, res: Response) => {
  const sessionId =
    (req.query.session_id as string) ||
    (req.query.session as string) ||
    process.env.DEFAULT_SESSION_ID ||
    'mobigo_main';

  const session = await SessionStore.getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // If accessed directly from browser as text/html
  if (req.headers.accept?.includes('text/html')) {
    if (session.status === SessionStatus.CONNECTED) {
      return res.send(`
        <html>
          <body style="font-family:sans-serif; text-align:center; padding:50px; background:#f9fafb;">
            <div style="background:#fff; border-radius:16px; padding:40px; display:inline-block; box-shadow:0 4px 6px -1px rgba(0,0,0,0.1); max-width:400px; width:100%;">
              <h2 style="color:#10b981; margin-top:0;">✅ WhatsApp Connected</h2>
              <p style="color:#4b5563;">Session: <b>${session.session_id}</b></p>
              <p style="color:#4b5563;">Phone: <b>+${session.phone_number || 'Unknown'}</b> (${session.push_name || ''})</p>
              <a href="/" style="display:inline-block; margin-top:20px; padding:10px 24px; background:#10b981; color:#fff; font-weight:600; text-decoration:none; border-radius:8px;">Open Management Dashboard</a>
            </div>
          </body>
        </html>
      `);
    }

    if (!session.qr_code) {
      return res.send(`
        <html>
          <body style="font-family:sans-serif; text-align:center; padding:50px; background:#f9fafb;">
            <div style="background:#fff; border-radius:16px; padding:40px; display:inline-block; box-shadow:0 4px 6px -1px rgba(0,0,0,0.1); max-width:400px; width:100%;">
              <h2 style="color:#374151; margin-top:0;">⏳ Initializing WhatsApp QR...</h2>
              <p style="color:#6b7280; font-size:14px;">Connecting to WhatsApp network, please wait...</p>
              <div style="margin:20px auto; width:30px; height:30px; border:3px solid #10b981; border-top-color:transparent; border-radius:50%; animation:spin 1s linear infinite;"></div>
              <style>@keyframes spin { 100% { transform:rotate(360deg); } }</style>
              <script>setTimeout(() => location.reload(), 2500);</script>
            </div>
          </body>
        </html>
      `);
    }

    return res.send(`
      <html>
        <head>
          <title>Mobigo WhatsApp QR Pairing</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family:sans-serif; text-align:center; padding:40px; background:#f9fafb;">
          <div style="background:#fff; border-radius:16px; padding:35px; display:inline-block; box-shadow:0 4px 6px -1px rgba(0,0,0,0.1); max-width:380px; width:100%;">
            <h2 style="margin-top:0; color:#111827; font-size:20px;">📱 Pair WhatsApp</h2>
            <p style="color:#6b7280; font-size:13px; margin-bottom:20px;">Open WhatsApp > Linked Devices > Link a Device</p>
            <div style="padding:10px; background:#f3f4f6; border-radius:12px; display:inline-block; border:1px solid #e5e7eb;">
              <img src="${session.qr_code}" alt="WhatsApp QR Code" style="width:250px; height:250px; border-radius:8px; display:block;"/>
            </div>
            <p style="color:#9ca3af; font-size:12px; margin-top:15px; margin-bottom:15px;">Session ID: <code>${session.session_id}</code></p>
            <a href="/" style="display:inline-block; font-size:13px; font-weight:600; color:#10b981; text-decoration:none;">Go to Sessions Dashboard &rarr;</a>
          </div>
          <script>
            // Poll session status every 3s and reload automatically when connected
            setInterval(async () => {
              try {
                const r = await fetch('/api/whatsapp-sessions/${session.session_id}/qr');
                const d = await r.json();
                if (d.status === 'CONNECTED' || (d.qr_code && d.qr_code !== "${session.qr_code}")) {
                  location.reload();
                }
              } catch (_) {}
            }, 3000);
          </script>
        </body>
      </html>
    `);
  }

  return res.json({
    status: session.status,
    qr_code: session.qr_code || null,
    qrBase64: session.qr_code || null,
  });
});

// 4. GET /whatsapp-sessions/:id/qr - Get QR code for specific ID
router.get(['/:id/qr', '/whatsapp-sessions/:id/qr'], async (req: Request, res: Response) => {
  const paramId = String(req.params.id);
  const session = await SessionStore.getSession(paramId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (session.status === SessionStatus.CONNECTED) {
    return res.json({ status: 'CONNECTED', message: 'WhatsApp is already connected' });
  }

  return res.json({
    status: session.status,
    qr_code: session.qr_code || null,
    qrBase64: session.qr_code || null,
  });
});

// 4. PATCH /whatsapp-sessions/:id - Update session settings
router.patch(['/:id', '/whatsapp-sessions/:id'], async (req: Request, res: Response) => {
  const paramId = String(req.params.id);
  const session = await SessionStore.getSession(paramId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const updates: any = {};
  const {
    status,
    alias,
    labels,
    max_message_count_per_day,
    warmup_schedule,
    min_interval_seconds,
    max_interval_seconds,
    active_start_time,
    active_end_time,
  } = req.body;

  if (status) {
    updates.status = status;
    if (status === SessionStatus.DISCONNECTED || status === 'disconnecting') {
      updates.status = SessionStatus.DISCONNECTED;
      updates.qr_code = '';
      const active = getActiveSession(session.session_id);
      if (active) {
        try {
          await active.socket.logout();
        } catch (_) {}
        removeActiveSession(session.session_id);
      }
    }
  }

  if (alias !== undefined) updates.alias = String(alias).trim();
  if (labels !== undefined) {
    updates.labels = Array.isArray(labels)
      ? labels.map((l: any) => String(l).trim()).filter(Boolean)
      : String(labels).split(',').map((s: string) => s.trim()).filter(Boolean);
  }
  if (max_message_count_per_day !== undefined) updates.max_message_count_per_day = Number(max_message_count_per_day);
  if (warmup_schedule !== undefined) {
    updates.warmup_schedule = Array.isArray(warmup_schedule)
      ? warmup_schedule
      : String(warmup_schedule).split(',').map((n) => parseInt(n.trim(), 10)).filter((n) => !isNaN(n));
  }
  if (min_interval_seconds !== undefined) updates.min_interval_seconds = Number(min_interval_seconds);
  if (max_interval_seconds !== undefined) updates.max_interval_seconds = Number(max_interval_seconds);
  if (active_start_time !== undefined) updates.active_start_time = String(active_start_time);
  if (active_end_time !== undefined) updates.active_end_time = String(active_end_time);

  const updated = await SessionStore.updateSession(session.session_id, updates);
  return res.json(formatSession(updated || session));
});

// 5. POST /whatsapp-sessions/:id/reconnect - Reconnect
router.post(['/:id/reconnect', '/whatsapp-sessions/:id/reconnect'], async (req: Request, res: Response) => {
  const paramId = String(req.params.id);
  const session = await SessionStore.getSession(paramId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  removeActiveSession(session.session_id);
  await SessionStore.updateSession(session.session_id, { status: SessionStatus.STARTING });
  initWhatsAppSession(session.session_id).catch(console.error);

  return res.json({ success: true, message: 'Reconnecting session...' });
});

// 6. POST /whatsapp-sessions/:id/logout - Logout
router.post(['/:id/logout', '/whatsapp-sessions/:id/logout'], async (req: Request, res: Response) => {
  const paramId = String(req.params.id);
  const session = await SessionStore.getSession(paramId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  await SessionStore.updateSession(session.session_id, {
    status: SessionStatus.DISCONNECTED,
    qr_code: '',
  });

  const active = getActiveSession(session.session_id);
  if (active) {
    try {
      await active.clearCreds?.();
      await active.socket.logout();
    } catch (_) {}
    removeActiveSession(session.session_id);
  } else {
    try {
      const redisAuth = await useRedisAuthState(session.session_id);
      await redisAuth.clearCreds();
    } catch (_) {}
  }

  const folder = path.join(getSessionsDir(), session.session_id);
  if (fs.existsSync(folder)) {
    try {
      fs.rmSync(folder, { recursive: true, force: true });
    } catch (_) {}
  }

  return res.json({ success: true, message: 'Logged out successfully' });
});

// 7. DELETE /whatsapp-sessions/:id - Delete
router.delete(['/:id', '/whatsapp-sessions/:id'], async (req: Request, res: Response) => {
  const paramId = String(req.params.id);
  const session = await SessionStore.getSession(paramId);

  if (session) {
    const targetSessionId = session.session_id;
    await SessionStore.deleteSession(targetSessionId);

    try {
      const redisAuth = await useRedisAuthState(targetSessionId);
      await redisAuth.clearCreds();
    } catch (_) {}

    const folder = path.join(getSessionsDir(), targetSessionId);
    if (fs.existsSync(folder)) {
      try {
        fs.rmSync(folder, { recursive: true, force: true });
      } catch (_) {}
    }

    removeActiveSession(targetSessionId);
  }

  return res.json({ success: true });
});

// 8. Agent Phone Numbers CRUD (Matching WhatsBlast Forwarding Tab)
router.get('/agent-phone-numbers', async (req: Request, res: Response) => {
  const sessionId = (req.query.session as string) || (req.query.session_id as string);
  if (!sessionId) {
    const all = await SessionStore.getAllSessions();
    const agents = all.flatMap((s) => (s.agent_phone_numbers || []).map((a) => ({ ...a, session: s.session_id })));
    return res.json(agents);
  }

  const session = await SessionStore.getSession(sessionId);
  if (!session) {
    return res.json([]);
  }

  const agents = (session.agent_phone_numbers || []).map((a) => ({
    ...a,
    session: session.session_id,
  }));
  return res.json(agents);
});

router.post('/agent-phone-numbers', async (req: Request, res: Response) => {
  const { session, session_id, phone_number } = req.body;
  const targetSessionId = session || session_id;

  if (!targetSessionId || !phone_number) {
    return res.status(400).json({ error: 'Session ID and phone_number are required' });
  }

  const agent = await SessionStore.addAgentPhone(targetSessionId, phone_number);
  if (!agent) {
    return res.status(404).json({ error: 'Session not found' });
  }

  return res.status(201).json({ ...agent, session: targetSessionId });
});

router.delete('/agent-phone-numbers/:id', async (req: Request, res: Response) => {
  const agentId = String(req.params.id);
  const all = await SessionStore.getAllSessions();

  for (const s of all) {
    const hasAgent = (s.agent_phone_numbers || []).some((a) => a.id === agentId);
    if (hasAgent) {
      await SessionStore.deleteAgentPhone(s.session_id, agentId);
      return res.json({ success: true });
    }
  }

  return res.json({ success: true });
});

export default router;
