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

  // 2. Action: If a file / document is received outside workflow, remind user to run /start
  if (hasMedia && (mediaType === 'document' || mediaType === 'image')) {
    const defaultTplId = process.env.DOCUSEAL_DEFAULT_TEMPLATE_ID;
    // Only attempt direct DocuSeal submission if an explicit default template is configured and it's a PDF document
    if (defaultTplId && mediaType === 'document' && fileBuffer) {
      try {
        const fileBase64 = `data:${mimetype || 'application/pdf'};base64,${fileBuffer.toString('base64')}`;
        const docName = fileName || `WhatsApp_Doc_${Date.now()}.pdf`;

        const submission = await docusealService.createSubmission({
          template_id: defaultTplId,
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

        console.log(`[Inbound Action] Created DocuSeal submission ${submission?.id || 'OK'} for ${senderPhone}`);

        const submitter = submission?.submitters?.[0] || submission?.[0]?.submitters?.[0];
        const slug = submitter?.slug;
        const host = docusealService.getPublicUrl();
        const signingUrl = slug ? `${host}/s/${slug}` : undefined;

        const replyText = signingUrl
          ? `✅ *Document Received!*\n\nHello ${pushName || 'there'}, we have prepared your submission.\n\nPlease review and complete the signing process here:\n👉 ${signingUrl}\n\nThank you!`
          : `✅ *Document Received!*\n\nHello ${pushName || 'there'}, your document *"${docName}"* has been received.`;

        await sendReply(senderPhone, replyText);
        return;
      } catch (err: any) {
        console.error('[Inbound Action] Error in direct submission:', err?.message || err);
      }
    }

    // Default friendly reminder for AI workflow
    const fileLabel = mediaType === 'image' ? 'photo' : 'document';
    const reminderMsg =
      `📎 *We received your ${fileLabel}!* (${fileName || 'Attachment'})\n\n` +
      `To process customer documents, verify details, or generate contracts with our *AI Document Assistant*:\n\n` +
      `👉 Please send */start* first to begin a new session.\n\n` +
      `Once started, you can send all customer photos/documents (IC, payslip, phone IMEI) and reply */ai* when ready!\n\n` +
      `💡 _Send */start* or */help* anytime._`;

    await sendReply(senderPhone, reminderMsg);
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
