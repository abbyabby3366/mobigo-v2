import { Router, Request, Response } from 'express';
import { sendTextMessage, sendDocumentMessage } from '../services/baileysManager.js';

const router = Router();
const DEFAULT_SESSION_ID = process.env.DEFAULT_SESSION_ID || 'mobigo_main';

/**
 * Handle DocuSeal webhooks (e.g., form.completed, submission.completed)
 */
router.post('/docuseal', async (req: Request, res: Response) => {
  const payload = req.body;
  const eventType = payload.event_type || payload.event;

  console.log(`[DocuSeal Webhook] Received event: ${eventType}`);

  if (eventType === 'form.completed' || eventType === 'submission.completed') {
    const data = payload.data || payload;
    const submitter = data.submitters?.[0] || data.submitter;
    const phone = submitter?.phone || data.phone;
    const documentUrl = data.documents?.[0]?.url || data.document_url || data.pdf_url;
    let documentName = data.name ? `${data.name}.pdf` : (data.documents?.[0]?.name || 'Completed_Document.pdf');
    if (!documentName.endsWith('.pdf')) documentName += '.pdf';
    documentName = documentName.replace(/\s*27062026/g, '');

    if (phone) {
      const sessionId = DEFAULT_SESSION_ID;
      try {
        if (documentUrl) {
          await sendDocumentMessage(
            sessionId,
            phone,
            documentUrl,
            documentName,
            `🎉 *Document Completed!*\n\nHello ${submitter?.name || 'there'}, your signed document is attached above for your records.\n\nThank you for choosing Mobigo!`
          );
        } else {
          await sendTextMessage(
            sessionId,
            phone,
            `🎉 *Document Completed!*\n\nHello ${submitter?.name || 'there'}, your document has been successfully signed and processed.\n\nThank you for choosing Mobigo!`
          );
        }
        console.log(`[DocuSeal Webhook] Successfully sent completion WhatsApp to ${phone}`);
      } catch (err: any) {
        console.error(`[DocuSeal Webhook] Failed to send completion WhatsApp to ${phone}:`, err.message);
      }
    }
  }

  res.json({ received: true });
});

export default router;
