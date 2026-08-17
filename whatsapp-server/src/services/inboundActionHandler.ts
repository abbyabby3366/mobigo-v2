import { InboundMessageEvent } from '../types/index.js';
import { docusealService } from './docusealService.js';

export async function handleInboundEvent(event: InboundMessageEvent): Promise<void> {
  const { sessionId, senderPhone, pushName, text, hasMedia, mediaType, fileName, fileBuffer, mimetype, replySender } = event;

  const sendReply = async (toPhone: string, replyText: string): Promise<any> => {
    if (replySender) {
      return replySender(toPhone, replyText);
    }
  };

  console.log(`[Inbound Action] Message from ${pushName || senderPhone} (${senderPhone}) | Media: ${hasMedia ? mediaType : 'None'}`);

  // 1. If an admin notification phone number is configured, send alert
  const adminPhone = process.env.ADMIN_NOTIFY_PHONE;
  if (adminPhone && adminPhone !== senderPhone) {
    const adminText = hasMedia
      ? `🔔 *Mobigo Alert:* New ${mediaType} received from *${pushName || senderPhone}* (+${senderPhone})\n📄 File: ${fileName || 'Document'}\n💬 Caption: ${text || 'None'}`
      : `🔔 *Mobigo Alert:* Message from *${pushName || senderPhone}* (+${senderPhone}):\n"${text}"`;

    sendReply(adminPhone, adminText).catch((err: any) => {
      console.warn('[Inbound Action] Failed to notify admin phone:', err?.message || err);
    });
  }

  // 2. Action: If a file / document is received, process DocuSeal submission
  if (hasMedia && fileBuffer && (mediaType === 'document' || mediaType === 'image')) {
    try {
      const defaultTemplateId = process.env.DOCUSEAL_DEFAULT_TEMPLATE_ID;
      const fileBase64 = `data:${mimetype || 'application/pdf'};base64,${fileBuffer.toString('base64')}`;
      const docName = fileName || `WhatsApp_Doc_${Date.now()}.${mediaType === 'image' ? 'jpg' : 'pdf'}`;

      let submission: any;

      if (defaultTemplateId) {
        // Create submission using existing template
        submission = await docusealService.createSubmission({
          template_id: defaultTemplateId,
          submitters: [
            {
              phone: senderPhone,
              name: pushName || `WhatsApp User ${senderPhone}`,
            },
          ],
        });
      } else {
        // Create direct document submission
        submission = await docusealService.createSubmission({
          submitters: [
            {
              phone: senderPhone,
              name: pushName || `WhatsApp User ${senderPhone}`,
            },
          ],
          documents: [
            {
              name: docName,
              file: fileBase64,
            },
          ],
        });
      }

      console.log(`[Inbound Action] Created DocuSeal submission ${submission?.id || 'OK'} for ${senderPhone}`);

      // Reply back to customer on WhatsApp with signing URL
      const submitter = submission?.submitters?.[0] || submission?.[0]?.submitters?.[0];
      const slug = submitter?.slug;
      const host = process.env.DOCUSEAL_API_URL || 'http://localhost:3000';
      const signingUrl = slug ? `${host}/s/${slug}` : undefined;

      const replyText = signingUrl
        ? `✅ *Document Received!*\n\nHello ${pushName || 'there'}, we have prepared your submission.\n\nPlease review and complete the signing process here:\n👉 ${signingUrl}\n\nThank you!`
        : `✅ *Document Received!*\n\nHello ${pushName || 'there'}, your document *"${docName}"* has been received and processed successfully.`;

      await sendReply(senderPhone, replyText);
    } catch (err: any) {
      console.error('[Inbound Action] Error processing received document for submission:', err?.message || err);
      await sendReply(
        senderPhone,
        `⚠️ We received your file, but encountered an issue processing the submission: ${err?.message || err}`
      ).catch(() => {});
    }
    return;
  }

  // 3. Action: Handle text commands or general inquiry
  const normalizedText = (text || '').trim().toLowerCase();

  if (normalizedText === 'hi' || normalizedText === 'hello' || normalizedText === 'help' || normalizedText === 'menu') {
    const welcomeMsg =
      `👋 *Hello ${pushName || ''}!*\n\n` +
      `Welcome to *Mobigo WhatsApp Services*.\n\n` +
      `📌 *Available Options:*\n` +
      `• *For Customers:* Send your document (PDF or image) to receive a direct signing link.\n` +
      `• *For Sales Agents:* Send */start* to launch the *AI Document Processing Agent* (collect ICs, payslips, extract with */ai*, and generate DocuSeal contracts).\n\n` +
      `💡 _Send */start* or */help* anytime for assistance._`;

    await sendReply(senderPhone, welcomeMsg);
  }
}
