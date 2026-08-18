import { BufferJSON } from 'baileys';
import { getRedisClient, formatRedisKey } from './redisAuthState.js';
import { MobigoAiService, ExtractedDocumentData, BufferedFile } from './mobigoAiService.js';
import { docusealService } from './docusealService.js';
import { sendTextMessage } from './baileysManager.js';

export enum AgentChatState {
  IDLE = 'IDLE',
  COLLECTING = 'COLLECTING',
  REVIEWING = 'REVIEWING',
  AWAITING_MISSING_FIELD = 'AWAITING_MISSING_FIELD',
  AWAITING_TEMPLATE_SELECTION = 'AWAITING_TEMPLATE_SELECTION',
}

export interface ChatSessionWorkflow {
  chatJid: string;
  senderPhone: string;
  pushName?: string;
  state: AgentChatState;
  textNotes: string[];
  bufferedFiles: BufferedFile[];
  selectedTemplateId: number;
  extractedData?: ExtractedDocumentData;
  missingFieldPrompt?: string;
  updatedAt: string;
}

export interface TemplateOption {
  id: number;
  name: string;
  shortName: string;
  description: string;
  keywords?: string[];
}

export const TEMPLATE_OPTIONS: TemplateOption[] = [
  {
    id: 3,
    name: 'Phone Rental Service Template',
    shortName: 'Phone Rental',
    description: 'Phone Rental Agreement, Device Details & Fees',
    keywords: ['phone', 'rental', 'agreement', 'device'],
  },
  {
    id: 5,
    name: 'CTOS CBM - Consent Form',
    shortName: 'CTOS Consent Form',
    description: 'Credit Check Consent Form',
    keywords: ['ctos', 'cbm', 'consent'],
  },
];

export function getTemplateOption(id: number): TemplateOption | undefined {
  return TEMPLATE_OPTIONS.find((t) => t.id === id);
}

// In-Memory map for lightning fast access + Redis persistent backup
const workflowSessions = new Map<string, ChatSessionWorkflow>();

export class AgentWorkflowService {
  /**
   * Initialize and hydrate from Redis on startup
   */
  static async init(): Promise<void> {
    const redis = getRedisClient();
    if (redis) {
      try {
        const keys = await redis.keys(formatRedisKey('wa_agent_wf:*'));
        for (const key of keys) {
          const raw = await redis.get(key);
          if (raw) {
            const parsed = JSON.parse(raw, BufferJSON.reviver);
            workflowSessions.set(parsed.chatJid, parsed);
          }
        }
        console.log(`[AgentWorkflowService] Hydrated ${workflowSessions.size} active agent session(s) from Redis.`);
      } catch (err) {
        console.warn('[AgentWorkflowService] Redis init warning:', err);
      }
    }
  }

  static getSession(chatJid: string, senderPhone?: string): ChatSessionWorkflow | undefined {
    let s = workflowSessions.get(chatJid);
    if (!s && senderPhone) {
      const cleanPhone = senderPhone.replace(/[^0-9]/g, '');
      if (cleanPhone.length >= 8) {
        for (const sess of workflowSessions.values()) {
          const sessPhone = (sess.senderPhone || '').replace(/[^0-9]/g, '');
          if (sessPhone === cleanPhone && sess.state !== AgentChatState.IDLE) {
            return sess;
          }
        }
      }
    }
    return s;
  }

  static isAgentChat(chatJid: string, senderPhone?: string): boolean {
    const s = this.getSession(chatJid, senderPhone);
    return !!s && s.state !== AgentChatState.IDLE;
  }

  static async saveSession(session: ChatSessionWorkflow): Promise<void> {
    session.updatedAt = new Date().toISOString();
    workflowSessions.set(session.chatJid, session);
    if (session.senderPhone) {
      const cleanPhone = session.senderPhone.replace(/[^0-9]/g, '');
      if (cleanPhone) {
        workflowSessions.set(`${cleanPhone}@s.whatsapp.net`, session);
      }
    }

    const redis = getRedisClient();
    if (redis) {
      try {
        await redis.set(formatRedisKey(`wa_agent_wf:${session.chatJid}`), JSON.stringify(session, BufferJSON.replacer), 'EX', 86400 * 7); // 7 days TTL
      } catch (_) {}
    }
  }

  static async deleteSession(chatJid: string, senderPhone?: string): Promise<void> {
    workflowSessions.delete(chatJid);
    if (senderPhone) {
      const cleanPhone = senderPhone.replace(/[^0-9]/g, '');
      if (cleanPhone) {
        workflowSessions.delete(`${cleanPhone}@s.whatsapp.net`);
      }
    }
    const redis = getRedisClient();
    if (redis) {
      try {
        await redis.del(formatRedisKey(`wa_agent_wf:${chatJid}`));
      } catch (_) {}
    }
  }

  /**
   * Main entry point for inbound messages in WhatsApp
   */
  static async handleInboundMessage(
    sessionId: string,
    chatJid: string,
    senderPhone: string,
    pushName: string | undefined,
    textContent: string,
    hasMedia: boolean,
    mediaType?: 'document' | 'image' | 'video' | 'audio',
    fileName?: string,
    fileBuffer?: Buffer,
    mimetype?: string,
    filePath?: string
  ): Promise<boolean> {
    const trimmed = (textContent || '').trim();
    const lower = trimmed.toLowerCase();

    // 1. /start command
    if (lower === '/start' || lower === 'start agent' || lower === '/agent') {
      await this.handleStartCommand(sessionId, chatJid, senderPhone, pushName);
      return true;
    }

    // Check if this chat is in active agent mode (lookup by chatJid OR senderPhone)
    let session = this.getSession(chatJid, senderPhone);

    // Auto-recover session if user sends /ai or /reset even if server restarted
    if (!session || session.state === AgentChatState.IDLE) {
      if (lower === '/ai' || lower === 'ai' || lower.startsWith('/ai ') || lower.startsWith('/extract')) {
        await this.handleStartCommand(sessionId, chatJid, senderPhone, pushName);
        session = this.getSession(chatJid, senderPhone);
      } else {
        return false; // Let standard handling proceed
      }
    }

    if (!session) return false;

    // Keep session destination chatJid fresh
    session.chatJid = chatJid;
    if (senderPhone) session.senderPhone = senderPhone;

    // 2. /stop command
    if (lower === '/stop' || lower === 'stop agent') {
      await this.handleStopCommand(sessionId, chatJid);
      return true;
    }

    // 3. /reset command
    if (lower === '/reset' || lower === '/clear' || lower === 'reset') {
      session.textNotes = [];
      session.bufferedFiles = [];
      session.extractedData = {};
      session.state = AgentChatState.COLLECTING;
      await this.saveSession(session);

      await sendTextMessage(
        sessionId,
        chatJid,
        `🧹 *Draft reset.* All buffered files and details have been cleared.\n\nSend customer documents/photos or text notes, and send */ai* when ready.`
      );
      return true;
    }

    // 4. /help command
    if (lower === '/help' || lower === 'help' || lower === 'menu') {
      await this.sendHelpMessage(sessionId, chatJid);
      return true;
    }

    // 5. /ai command -> Trigger Template Selection first
    if (lower.startsWith('/ai') || lower === 'ai' || lower.startsWith('/extract') || lower === 'process') {
      await this.handleAiCommand(sessionId, session, trimmed);
      return true;
    }

    // 6. Template selection (if awaiting template selection)
    if (session.state === AgentChatState.AWAITING_TEMPLATE_SELECTION) {
      const choiceIndex = parseInt(trimmed, 10);
      if (!isNaN(choiceIndex) && choiceIndex >= 1 && choiceIndex <= TEMPLATE_OPTIONS.length) {
        session.selectedTemplateId = TEMPLATE_OPTIONS[choiceIndex - 1].id;
        await this.executeAiExtraction(sessionId, session);
        return true;
      }

      // Keyword fallback (e.g. user typed "ctos" or "phone rental")
      const matched = TEMPLATE_OPTIONS.find(
        (t) => t.keywords?.some((k) => lower.includes(k)) || lower.includes(t.name.toLowerCase())
      );
      if (matched) {
        session.selectedTemplateId = matched.id;
        await this.executeAiExtraction(sessionId, session);
        return true;
      }

      const validOptions = TEMPLATE_OPTIONS.map((t, i) => `*${i + 1}* for *${t.name}*`).join(' or ');
      await sendTextMessage(
        sessionId,
        chatJid,
        `⚠️ *Invalid Selection*\n\nPlease reply with ${validOptions}.`
      );
      return true;
    }

    // 7. Proceed / Submit command
    if (
      lower === '/proceed' ||
      lower === 'proceed' ||
      lower === '/submit' ||
      lower === 'submit' ||
      lower === 'confirm' ||
      lower === 'yes'
    ) {
      await this.handleProceedCommand(sessionId, session);
      return true;
    }

    // 8. Handle Field Edit (e.g. "1 Mohammad Ali" or "2 email@gmail.com") in REVIEWING or AWAITING_MISSING_FIELD state
    if (session.state === AgentChatState.REVIEWING || session.state === AgentChatState.AWAITING_MISSING_FIELD) {
      const handled = await this.tryHandleFieldEdit(sessionId, session, trimmed);
      if (handled) return true;

      // If user typed an unknown command starting with '/' in review mode
      if (trimmed.startsWith('/')) {
        await sendTextMessage(
          sessionId,
          chatJid,
          `⚠️ *Command not detected: ${trimmed}*\n\n` +
          `• To generate DocuSeal signing link: send */proceed*\n` +
          `• To re-extract details: send */ai*\n` +
          `• To reset draft: send */reset*\n` +
          `• For assistance: send */help*`
        );
        return true;
      }

      // If user typed normal text in review mode that didn't match a field edit
      if (!hasMedia && trimmed) {
        await sendTextMessage(
          sessionId,
          chatJid,
          `⚠️ *Didn't quite get what you said, please repeat.*\n\n` +
          `• To edit a field: reply with the number and value (e.g. *2 customer@gmail.com*)\n` +
          `• To confirm and generate contract: send */proceed*\n` +
          `• To reset draft: send */reset*`
        );
        return true;
      }
    }

    // 9. Ingest media / text notes into the current buffer
    if (hasMedia && (fileBuffer || filePath)) {
      session.bufferedFiles.push({
        fileName: fileName || `file_${Date.now()}`,
        mediaType: mediaType || 'document',
        mimetype: mimetype || 'application/octet-stream',
        fileBuffer,
        filePath,
      });
      session.state = AgentChatState.COLLECTING;
      await this.saveSession(session);

      const count = session.bufferedFiles.length;
      await sendTextMessage(
        sessionId,
        chatJid,
        `📎 *${mediaType === 'image' ? '🖼️ Image' : '📄 Document'} added:* ${fileName || 'File'} *(Total: ${count} file${count > 1 ? 's' : ''})*\n\nSend more files/notes or type */ai* when ready to process.`
      );
      return true;
    }

    // 10. Unknown command starting with '/' in COLLECTING mode
    if (trimmed.startsWith('/')) {
      await sendTextMessage(
        sessionId,
        chatJid,
        `⚠️ *Command not detected: ${trimmed}*\n\n` +
        `• Send customer photos (IC, payslips) or text notes\n` +
        `• Send */ai* to extract contract details\n` +
        `• Send */help* for available commands`
      );
      return true;
    }

    // 11. Ingest plain text note in COLLECTING mode
    if (trimmed) {
      session.textNotes.push(trimmed);
      session.state = AgentChatState.COLLECTING;
      await this.saveSession(session);

      const totalItems = session.bufferedFiles.length + session.textNotes.length;
      await sendTextMessage(
        sessionId,
        chatJid,
        `📝 *Note added* *(Total items: ${totalItems})*.\n\nSend more files or type */ai* to extract details.`
      );
      return true;
    }

    return true;
  }

  /**
   * /start Command Handler
   */
  private static async handleStartCommand(
    sessionId: string,
    chatJid: string,
    senderPhone: string,
    pushName?: string
  ): Promise<void> {
    const newSession: ChatSessionWorkflow = {
      chatJid,
      senderPhone,
      pushName,
      state: AgentChatState.COLLECTING,
      textNotes: [],
      bufferedFiles: [],
      selectedTemplateId: 3, // Default Phone Rental Service Template
      extractedData: {},
      updatedAt: new Date().toISOString(),
    };

    await this.saveSession(newSession);

    const welcomeMsg =
      `👋 *Thanks for using Mobigo AI Document Processing Agent.*\n\n` +
      `To start creating your first document, just send all your files here (IC photos, payslips, bank statements, order details), and send */ai* to create your submission based on the details you sent.\n\n` +
      `💡 *Commands:*\n` +
      `• Send photos/PDFs/text notes to add to buffer\n` +
      `• */ai* - Process documents & extract contract details\n` +
      `• *1 <value>* - Quick edit field #1 (or any field number)\n` +
      `• */proceed* - Create DocuSeal submission & get signing link\n` +
      `• */reset* - Clear current document draft\n` +
      `• */stop* - Exit agent mode`;

    await sendTextMessage(sessionId, chatJid, welcomeMsg);
  }

  /**
   * /stop Command Handler
   */
  private static async handleStopCommand(sessionId: string, chatJid: string): Promise<void> {
    await this.deleteSession(chatJid);
    await sendTextMessage(
      sessionId,
      chatJid,
      `🛑 *Agent mode deactivated.*\n\nThis chat has been removed from active agent sessions. Send */start* anytime to activate again.`
    );
  }

  /**
   * /ai Command Handler -> Prompts User to Choose Template
   */
  private static async handleAiCommand(
    sessionId: string,
    session: ChatSessionWorkflow,
    rawText: string
  ): Promise<void> {
    const totalCount = session.bufferedFiles.length + session.textNotes.length;
    if (totalCount === 0) {
      await sendTextMessage(
        sessionId,
        session.chatJid,
        `⚠️ *No data received yet.*\n\nPlease send customer photos (e.g. IC, payslips), documents, or text details first, then send */ai*.`
      );
      return;
    }

    // If agent directly passed template option (e.g. "/ai 1" or "/ai 2") or keyword
    const parts = rawText.split(/\s+/);
    if (parts.length > 1) {
      const opt = parts[1].trim().toLowerCase();
      const choiceIndex = parseInt(opt, 10);
      if (!isNaN(choiceIndex) && choiceIndex >= 1 && choiceIndex <= TEMPLATE_OPTIONS.length) {
        session.selectedTemplateId = TEMPLATE_OPTIONS[choiceIndex - 1].id;
        await this.executeAiExtraction(sessionId, session);
        return;
      }
      const matched = TEMPLATE_OPTIONS.find(
        (t) => t.keywords?.some((k) => opt.includes(k)) || opt.includes(t.name.toLowerCase())
      );
      if (matched) {
        session.selectedTemplateId = matched.id;
        await this.executeAiExtraction(sessionId, session);
        return;
      }
    }

    // Set state to await template selection
    session.state = AgentChatState.AWAITING_TEMPLATE_SELECTION;
    await this.saveSession(session);

    const templateOptionsText = TEMPLATE_OPTIONS.map(
      (t, idx) => `${idx + 1}️⃣ *${t.name}* _(ID: ${t.id})_`
    ).join('\n');

    const templatePrompt =
      `📑 *Which template should I use?*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${templateOptionsText}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `👉 *Reply ${TEMPLATE_OPTIONS.map((_, i) => i + 1).join(' or ')} to select the template.*`;

    await sendTextMessage(sessionId, session.chatJid, templatePrompt);
  }

  /**
   * Execute AI Extraction for the Selected Template
   */
  private static async executeAiExtraction(sessionId: string, session: ChatSessionWorkflow): Promise<void> {
    const tpl = getTemplateOption(session.selectedTemplateId) || TEMPLATE_OPTIONS[0];
    const templateName = tpl.name;

    await sendTextMessage(
      sessionId,
      session.chatJid,
      `⏳ *Processing ${session.bufferedFiles.length} file(s) and ${session.textNotes.length} note(s) for ${templateName} with Mobigo AI...*\n\nPlease wait a moment.`
    );

    try {
      const templateId = session.selectedTemplateId || 3;
      const extracted = await MobigoAiService.extractContractData(session.textNotes, session.bufferedFiles, templateId);

      // Smart Defaults for missing contract values
      if (!extracted.order_number || extracted.order_number.trim() === '') {
        extracted.order_number = `ORD-${Math.floor(100000 + Math.random() * 900000)}`;
      }

      // Auto-format currency
      if (extracted.monthly_rent && !extracted.monthly_rent.toUpperCase().includes('RM')) {
        extracted.monthly_rent = `RM ${extracted.monthly_rent.trim()}`;
      }
      if (extracted.total_rent && !extracted.total_rent.toUpperCase().includes('RM')) {
        extracted.total_rent = `RM ${extracted.total_rent.trim()}`;
      }
      if (extracted.deposit && !extracted.deposit.toUpperCase().includes('RM')) {
        extracted.deposit = `RM ${extracted.deposit.trim()}`;
      }
      if (extracted.product_price && !extracted.product_price.toUpperCase().includes('RM')) {
        extracted.product_price = `RM ${extracted.product_price.trim()}`;
      }

      session.extractedData = extracted;
      session.state = AgentChatState.REVIEWING;
      await this.saveSession(session);

      await this.presentExtractedReview(sessionId, session);
    } catch (err: any) {
      console.error('[AgentWorkflowService] AI Extraction Error:', err);
      await sendTextMessage(
        sessionId,
        session.chatJid,
        `❌ *AI Extraction Error:* ${err.message}\n\nPlease verify your files and try sending */ai* again.`
      );
    }
  }

  /**
   * Present Extracted Data as a Clean Numbered List matching DocuSeal Template Agreement
   */
  private static async presentExtractedReview(sessionId: string, session: ChatSessionWorkflow): Promise<void> {
    const d = session.extractedData || {};

    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear());
    const currentDate = `${day}/${month}/${year}`;

    if (session.selectedTemplateId === 5) {
      // Template 5: CTOS CBM Consent Form
      const reviewMsg =
        `📋 *Mobigo Contract Draft Details*\n` +
        `📑 *Template:* CTOS CBM - Consent Form (ID: 5)\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 *1. RECIPIENT & DELIVERY INFO*\n` +
        `1. *Recipient Name:* ${d.name || '_(Missing)_'}\n` +
        `2. *Recipient Email:* ${d.email || '_(Missing)_'} 📬 _(Destination)_\n` +
        `3. *Recipient Phone:* ${d.phone_number || '_(Missing)_'}\n\n` +
        `📄 *2. CONSENT & IC DETAILS*\n` +
        `4. *No. Kad Pengenalan:* ${d.ic_number || '_(Missing)_'}\n` +
        `5. *Tarikh Borang:* ${currentDate}\n` +
        `6. *Cawangan / Branch:* ${d.branch_name || '_(None / Optional)_'}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `✍️ *To edit any field:* Reply with number and value:\n` +
        `_Example:_ *2 customer@email.com*\n` +
        `_Example:_ *4 890425-02-5957*\n` +
        `_Example:_ *6 Sunway Pyramid*\n\n` +
        `👉 Send */proceed* to create DocuSeal signing link!`;

      await sendTextMessage(sessionId, session.chatJid, reviewMsg);
      return;
    }

    // Default: Template 3 (Phone Rental Service Template)
    const reviewMsg =
      `📋 *Mobigo Contract Draft Details*\n` +
      `📑 *Template:* Phone Rental Service Template (ID: 3)\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 *1. RECIPIENT & DELIVERY INFO (First Party)*\n` +
      `1. *Recipient Name:* ${d.name || '_(Missing)_'}\n` +
      `2. *Recipient Email:* ${d.email || '_(Missing)_'} 📬 _(Destination)_\n` +
      `3. *Recipient Phone:* ${d.phone_number || '_(Missing)_'}\n\n` +
      `📄 *2. AGREEMENT & DEVICE DETAILS*\n` +
      `4. *No. Kad Pengenalan:* ${d.ic_number || '_(Missing)_'}\n` +
      `5. *Alamat Penghantaran:* ${d.address || '_(Missing)_'}\n` +
      `6. *Nama Produk:* ${d.product_name || '_(Missing)_'}\n` +
      `7. *Nombor IMEI:* ${d.imei || '-'}\n` +
      `8. *Harga Sewa Sebulan:* ${d.monthly_rent || '-'}\n` +
      `9. *Jumlah Sewa:* ${d.total_rent || '-'}\n` +
      `10. *Deposit Produk:* ${d.deposit || '-'}\n` +
      `11. *Harga Produk:* ${d.product_price || '-'}\n` +
      `12. *Nombor Pesanan:* ${d.order_number || '-'}\n` +
      `13. *Tarikh Perjanjian:* ${currentDate}\n` +
      `14. *Cawangan / Branch:* ${d.branch_name || '_(None / Optional)_'}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `✍️ *To edit any field:* Reply with number and value:\n` +
      `_Example:_ *2 customer@email.com*\n` +
      `_Example:_ *3 01153565717*\n` +
      `_Example:_ *5 No 12 Jalan Merdeka, KL*\n` +
      `_Example:_ *7 IMEI1: 354704736663104 / IMEI2: 354704736663112*\n` +
      `_Example:_ *8 RM 150*\n` +
      `_Example:_ *14 Sunway Pyramid*\n\n` +
      `👉 Send */proceed* to create DocuSeal signing link!`;

    await sendTextMessage(sessionId, session.chatJid, reviewMsg);
  }

  /**
   * Handle Edit of Extracted Field
   */
  private static async tryHandleFieldEdit(
    sessionId: string,
    session: ChatSessionWorkflow,
    text: string
  ): Promise<boolean> {
    const d = session.extractedData || {};

    // Pattern 1: Starts with a number e.g. "1 Ahmad Albab" or "2 ahmad@gmail.com"
    const match = text.match(/^(\d{1,2})[\s.:=\-]+(.+)$/);
    if (match) {
      const fieldIdx = parseInt(match[1], 10);
      let val = match[2].trim();

      // Format currency for money fields
      if ([8, 9, 10, 11].includes(fieldIdx) && !val.toUpperCase().includes('RM') && /^\d+/.test(val)) {
        val = `RM ${val}`;
      }

      if (session.selectedTemplateId === 5) {
        switch (fieldIdx) {
          case 1: d.name = val; break;
          case 2: d.email = val; break;
          case 3: d.phone_number = val; break;
          case 4: d.ic_number = val; break;
          case 6: d.branch_name = val; break;
          default: return false;
        }
      } else {
        switch (fieldIdx) {
          case 1: d.name = val; break;
          case 2: d.email = val; break;
          case 3: d.phone_number = val; break;
          case 4: d.ic_number = val; break;
          case 5: d.address = val; break;
          case 6: d.product_name = val; break;
          case 7: d.imei = val; break;
          case 8:
            d.monthly_rent = val;
            // Auto calculate total rent (12 months) if missing
            const rentNum = parseFloat(val.replace(/[^0-9.]/g, ''));
            if (!isNaN(rentNum) && (!d.total_rent || d.total_rent === '-')) {
              d.total_rent = `RM ${rentNum * 12}`;
            }
            break;
          case 9: d.total_rent = val; break;
          case 10: d.deposit = val; break;
          case 11: d.product_price = val; break;
          case 12: d.order_number = val; break;
          case 14: d.branch_name = val; break;
          default: return false;
        }
      }

      session.extractedData = d;
      session.state = AgentChatState.REVIEWING;
      await this.saveSession(session);

      await sendTextMessage(sessionId, session.chatJid, `✅ *Updated Field #${fieldIdx}:* ${val}`);
      await this.presentExtractedReview(sessionId, session);
      return true;
    }

    // Pattern 2: Key-value e.g. "name: Ahmad", "email: test@gmail.com", "branch: ABC Holdings"
    const kvMatch = text.match(/^(name|nama|email|emel|phone|telefon|hp|ic|kad|alamat|address|product|produk|imei|deposit|sewa|rent|order|pesanan|branch|cawangan)[\s:=]+(.+)$/i);
    if (kvMatch) {
      const key = kvMatch[1].toLowerCase();
      let val = kvMatch[2].trim();

      if (key.includes('name') || key.includes('nama')) d.name = val;
      else if (key.includes('email') || key.includes('emel')) d.email = val;
      else if (key.includes('phone') || key.includes('tele') || key.includes('hp')) d.phone_number = val;
      else if (key.includes('ic') || key.includes('kad')) d.ic_number = val;
      else if (key.includes('address') || key.includes('alamat')) d.address = val;
      else if (key.includes('product') || key.includes('produk')) d.product_name = val;
      else if (key.includes('imei')) d.imei = val;
      else if (key.includes('deposit')) d.deposit = val.toUpperCase().includes('RM') ? val : `RM ${val}`;
      else if (key.includes('sewa') || key.includes('rent')) {
        d.monthly_rent = val.toUpperCase().includes('RM') ? val : `RM ${val}`;
      }
      else if (key.includes('order') || key.includes('pesanan')) d.order_number = val;
      else if (key.includes('branch') || key.includes('cawangan')) d.branch_name = val;

      session.extractedData = d;
      session.state = AgentChatState.REVIEWING;
      await this.saveSession(session);

      await sendTextMessage(sessionId, session.chatJid, `✅ *Updated ${key}:* ${val}`);
      await this.presentExtractedReview(sessionId, session);
      return true;
    }

    return false;
  }

  /**
   * Helper to check missing required fields
   */
  private static getMissingRequiredFields(d: ExtractedDocumentData): string[] {
    const missing: string[] = [];
    if (!d.name || d.name.trim() === '') missing.push('1. Recipient Name');
    if (!d.email || d.email.trim() === '' || !d.email.includes('@')) {
      missing.push('2. Recipient Email (Destination)');
    }
    if (!d.phone_number || d.phone_number.trim() === '') missing.push('3. Recipient Phone');
    if (!d.ic_number || d.ic_number.trim() === '') missing.push('4. No. Kad Pengenalan');
    if (!d.product_name || d.product_name.trim() === '') missing.push('6. Nama Produk');
    return missing;
  }

  /**
   * Handle Proceed & Submit to DocuSeal
   */
  private static async handleProceedCommand(sessionId: string, session: ChatSessionWorkflow): Promise<void> {
    const d = session.extractedData || {};

    // Validate Required Fields
    const missing = this.getMissingRequiredFields(d);

    if (missing.length > 0) {
      session.state = AgentChatState.AWAITING_MISSING_FIELD;
      await this.saveSession(session);

      const promptMsg =
        `⛔ *Cannot Proceed: Required Fields Missing*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `DocuSeal submission requires the following fields before generating a contract:\n\n` +
        missing.map(m => `❌ *${m}*`).join('\n') +
        `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👉 *How to fill:* Reply with the field number and value:\n` +
        `_Example:_ *2 customer@gmail.com*\n` +
        `_Example:_ *3 01153565717*\n\n` +
        `💡 _You will not be allowed to /proceed until all required fields are filled._`;

      await sendTextMessage(sessionId, session.chatJid, promptMsg);
      return; // STRICTLY BLOCKED
    }

    // Submit to DocuSeal
    await sendTextMessage(
      sessionId,
      session.chatJid,
      `⏳ *Creating DocuSeal submission for ${d.name}...*\nGenerating signing link.`
    );

    try {
      const templateId = session.selectedTemplateId || 3;
      const submitters = docusealService.buildSubmittersPayload(d);

      const branchName = d.branch_name ? d.branch_name.trim() : '';
      const orderNum = d.order_number ? d.order_number.trim() : '';
      const tpl = getTemplateOption(session.selectedTemplateId) || TEMPLATE_OPTIONS[0];
      const baseDocName = tpl.shortName;
      let submissionName = orderNum ? `${baseDocName} ${orderNum}` : baseDocName;
      if (branchName) submissionName += ` (${branchName})`;

      const submissionRes = await docusealService.createSubmission({
        template_id: templateId,
        name: submissionName,
        send_email: false,
        send_sms: false,
        submitters,
      });

      const firstSubmitter = Array.isArray(submissionRes)
        ? submissionRes[0]
        : (submissionRes.submitters?.[0] || submissionRes);

      const slug = firstSubmitter?.slug;
      const subId = firstSubmitter?.submission_id || firstSubmitter?.id || 'OK';

      // Determine public base URL for browser-accessible signing link
      const publicBase = (process.env.DOCUSEAL_PUBLIC_URL || process.env.MOBIGO_API_URL || 'http://localhost:3000')
        .replace(/\/+$/, '')
        .replace('http://app:3000', 'http://localhost:3000');

      let signingUrl = '';
      if (slug) {
        signingUrl = `${publicBase}/s/${slug}`;
      } else if (firstSubmitter?.embed_src) {
        signingUrl = firstSubmitter.embed_src;
      } else {
        signingUrl = `${publicBase}/submissions/${subId}`;
      }

      const templateName = tpl.name;

      const successMsg =
        `🎉 *DocuSeal Submission Created!* 🎉\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📄 *Template:* ${templateName}\n` +
        `👤 *Customer:* ${d.name}\n` +
        `📬 *Email:* ${d.email}\n` +
        `📱 *Phone:* ${d.phone_number}\n` +
        `🆔 *Submission ID:* #${subId}\n\n` +
        `✍️ *Customer Signing Link:*\n` +
        `👉 ${signingUrl}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `_You can forward this signing link to the customer._\n\n` +
        `⚠️ _Note: Submission has been created and cannot be edited. If any info is wrong, please redo a new submission._\n\n` +
        `Send */start* to create another document.`;

      await sendTextMessage(sessionId, session.chatJid, successMsg);

      // Reset buffer for next document
      session.textNotes = [];
      session.bufferedFiles = [];
      session.extractedData = {};
      session.state = AgentChatState.IDLE;
      await this.saveSession(session);
    } catch (err: any) {
      console.error('[AgentWorkflowService] DocuSeal Submission Error:', err);
      await sendTextMessage(
        sessionId,
        session.chatJid,
        `❌ *DocuSeal Submission Error:* ${err.message || err}\n\nPlease check your details and send */proceed* again.`
      );
    }
  }

  private static async sendHelpMessage(sessionId: string, chatJid: string): Promise<void> {
    const helpMsg =
      `🤖 *Mobigo AI Agent Commands:*\n\n` +
      `• Send photos/PDFs/text notes to add to buffer\n` +
      `• */ai* - Process and extract document details\n` +
      `• *<number> <value>* - Edit field by number (e.g. *2 customer@gmail.com*)\n` +
      `• */proceed* - Submit and generate DocuSeal signing link\n` +
      `• */reset* - Clear current document draft\n` +
      `• */stop* - Exit agent mode`;

    await sendTextMessage(sessionId, chatJid, helpMsg);
  }
}
