import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import sessionRoutes from './routes/sessionRoutes.js';
import messageRoutes from './routes/messageRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js';
import { restoreAllSessions } from './services/baileysManager.js';
import { SessionStore } from './services/sessionStore.js';
import { MessageStore } from './services/messageStore.js';
import { AgentWorkflowService } from './services/agentWorkflowService.js';
import { renderDashboardHtml } from './views/dashboardHtml.js';

// Load root directory .env first (mobigo-v2/.env)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static uploads folder for images and documents
const uploadsDir = path.join(process.cwd(), 'uploads');
app.use('/uploads', express.static(uploadsDir));

// 1. Dashboard Web UI (WhatsApp Web & Sessions Management)
app.get(['/', '/sessions', '/chats', '/messages', '/dashboard'], (req, res) => {
  res.send(renderDashboardHtml());
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'Mobigo WhatsApp Server' });
});

// 2. API Routes
app.use('/api/whatsapp-sessions', sessionRoutes);
app.use('/whatsapp-sessions', sessionRoutes);
app.use('/api/agent-phone-numbers', sessionRoutes);
app.use('/agent-phone-numbers', sessionRoutes);
app.use('/api/session', sessionRoutes);

// Chat Web Routes
app.use('/api/chats', chatRoutes);
app.use('/chats', chatRoutes);

// Messages routes
app.use('/api/messages', messageRoutes);
app.use('/messages', messageRoutes);

// Webhook routes
app.use('/api/webhooks', webhookRoutes);
app.use('/webhooks', webhookRoutes);

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Server Error]:', err);
  res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
});

// Start Server
app.listen(PORT, async () => {
  console.log(`=========================================`);
  console.log(`🚀 Mobigo WhatsApp Server is running on port ${PORT}`);
  console.log(`💻 Web Dashboard & Chat: http://localhost:${PORT}`);
  console.log(`=========================================`);

  try {
    await SessionStore.init();
    await MessageStore.init();
    await AgentWorkflowService.init();
    await restoreAllSessions();
  } catch (err: any) {
    console.warn(`[Startup] WhatsApp session bootstrap deferred:`, err.message);
  }
});
