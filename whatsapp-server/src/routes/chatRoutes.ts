import { Router, Request, Response } from 'express';
import multer from 'multer';
import { MessageStore } from '../services/messageStore.js';
import { sendTextMessage, sendDocumentMessage, sendImageMessage } from '../services/baileysManager.js';
import { SessionStore } from '../services/sessionStore.js';

const router = Router();
const upload = multer({ limits: { fileSize: 50 * 1024 * 1024 } });
const DEFAULT_SESSION_ID = process.env.DEFAULT_SESSION_ID || 'mobigo_main';

// 1. GET /api/chats - Get conversation list
router.get('/', async (req: Request, res: Response) => {
  const sessionId = (req.query.session_id as string) || (req.query.session as string) || undefined;
  const conversations = await MessageStore.getConversations(sessionId);
  res.json({ success: true, conversations });
});

// 2. GET /api/chats/:phone/messages - Get message history with a contact
router.get('/:phone/messages', async (req: Request, res: Response) => {
  const phone = String(req.params.phone);
  const sessionId = (req.query.session_id as string) || (req.query.session as string) || undefined;
  const messages = await MessageStore.getMessagesForContact(phone, sessionId);
  res.json({ success: true, messages });
});

// 3. POST /api/chats/:phone/send - Send text message from Chat UI
router.post('/:phone/send', async (req: Request, res: Response) => {
  const phone = String(req.params.phone);
  const sessionId = req.body.session_id || req.body.session || DEFAULT_SESSION_ID;
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ success: false, error: 'Message text is required' });
  }

  try {
    const result = await sendTextMessage(sessionId, phone, text);
    res.json({ success: true, messageId: result?.key?.id, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. POST /api/chats/:phone/send-media - Send document / image from Chat UI
router.post('/:phone/send-media', upload.single('file'), async (req: Request, res: Response) => {
  const phone = String(req.params.phone);
  const sessionId = req.body.session_id || req.body.session || DEFAULT_SESSION_ID;
  const { caption, mediaType } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ success: false, error: 'File upload is required' });
  }

  try {
    let result: any;
    if (mediaType === 'image' || file.mimetype.startsWith('image/')) {
      result = await sendImageMessage(sessionId, phone, file.buffer, caption);
    } else {
      result = await sendDocumentMessage(
        sessionId,
        phone,
        file.buffer,
        file.originalname || 'Document.pdf',
        caption,
        file.mimetype
      );
    }

    res.json({ success: true, messageId: result?.key?.id, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. DELETE /api/chats/:phone - Clear conversation
router.delete('/:phone', async (req: Request, res: Response) => {
  const phone = String(req.params.phone);
  const deleted = await MessageStore.clearConversation(phone);
  res.json({ success: true, deletedCount: deleted });
});

export default router;
