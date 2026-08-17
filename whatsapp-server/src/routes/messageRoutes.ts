import { Router, Request, Response } from 'express';
import multer from 'multer';
import {
  sendTextMessage,
  sendDocumentMessage,
  sendImageMessage,
} from '../services/baileysManager.js';
import { docusealService } from '../services/docusealService.js';
import { SessionStore } from '../services/sessionStore.js';

const router = Router();
const upload = multer({ limits: { fileSize: 50 * 1024 * 1024 } });
const DEFAULT_SESSION_ID = process.env.DEFAULT_SESSION_ID || 'mobigo_main';

async function resolveSessionId(req: Request): Promise<string> {
  const sId = req.params.session_id || req.body.session_id || req.body.session || DEFAULT_SESSION_ID;
  const found = await SessionStore.getSession(sId);
  return found?.session_id || sId;
}

// 1. Send Text Message (Supports /send-text and /:session_id/send-text)
router.post(['/send-text', '/:session_id/send-text'], async (req: Request, res: Response) => {
  const sessionId = await resolveSessionId(req);
  const { to, text } = req.body;

  if (!to || !text) {
    return res.status(400).json({ success: false, error: 'Parameters "to" and "text" are required.' });
  }

  try {
    const result = await sendTextMessage(sessionId, to, text);
    res.json({ success: true, messageId: result?.key?.id, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Send Document / PDF
router.post(['/send-document', '/:session_id/send-document'], upload.single('file'), async (req: Request, res: Response) => {
  const sessionId = await resolveSessionId(req);
  const { to, url, caption, fileName, mimetype } = req.body;
  const uploadedFile = req.file;

  if (!to) {
    return res.status(400).json({ success: false, error: 'Parameter "to" is required.' });
  }

  if (!uploadedFile && !url) {
    return res.status(400).json({
      success: false,
      error: 'Either "url" or a multipart file upload ("file") is required.',
    });
  }

  try {
    const docPayload = uploadedFile ? uploadedFile.buffer : url;
    const finalFileName = fileName || uploadedFile?.originalname || 'Document.pdf';
    const finalMime = mimetype || uploadedFile?.mimetype || 'application/pdf';

    const result = await sendDocumentMessage(
      sessionId,
      to,
      docPayload,
      finalFileName,
      caption,
      finalMime
    );

    res.json({ success: true, messageId: result?.key?.id, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Send Image
router.post(['/send-image', '/:session_id/send-image'], upload.single('file'), async (req: Request, res: Response) => {
  const sessionId = await resolveSessionId(req);
  const { to, url, caption } = req.body;
  const uploadedFile = req.file;

  if (!to) {
    return res.status(400).json({ success: false, error: 'Parameter "to" is required.' });
  }

  if (!uploadedFile && !url) {
    return res.status(400).json({
      success: false,
      error: 'Either "url" or a multipart file upload ("file") is required.',
    });
  }

  try {
    const imgPayload = uploadedFile ? uploadedFile.buffer : url;
    const result = await sendImageMessage(sessionId, to, imgPayload, caption);

    res.json({ success: true, messageId: result?.key?.id, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Create DocuSeal Submission & Send Signing Link via WhatsApp
router.post(['/send-submission', '/:session_id/send-submission'], async (req: Request, res: Response) => {
  const sessionId = await resolveSessionId(req);
  const { to, template_id, name, custom_message, fields } = req.body;

  if (!to) {
    return res.status(400).json({ success: false, error: 'Parameter "to" (recipient phone) is required.' });
  }

  try {
    const templateId = template_id || process.env.DOCUSEAL_DEFAULT_TEMPLATE_ID;
    if (!templateId) {
      return res.status(400).json({
        success: false,
        error: 'template_id is required or DOCUSEAL_DEFAULT_TEMPLATE_ID must be set in .env',
      });
    }

    const submission = await docusealService.createSubmission({
      template_id: templateId,
      submitters: [
        {
          phone: to,
          name: name || 'Valued Customer',
          fields: fields || {},
        },
      ],
    });

    const submitter = submission?.submitters?.[0] || submission?.[0]?.submitters?.[0];
    const slug = submitter?.slug;
    const host = process.env.DOCUSEAL_API_URL || 'http://localhost:3000';
    const signingUrl = slug ? `${host}/s/${slug}` : undefined;

    const messageText = custom_message
      ? `${custom_message}\n\n👉 ${signingUrl}`
      : `📄 *Mobigo Document Signing Request*\n\nHello ${name || 'there'},\n\nPlease review and sign your document using the link below:\n👉 ${signingUrl}\n\nThank you!`;

    const waResult = await sendTextMessage(sessionId, to, messageText);

    res.json({
      success: true,
      submission,
      signingUrl,
      whatsappMessageId: waResult?.key?.id,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
