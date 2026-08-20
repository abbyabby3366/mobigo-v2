import axios from 'axios';
import { ExtractedDocumentData } from './mobigoAiService.js';

export interface CreateMobigoApplicationResponse {
  success: boolean;
  message?: string;
  data?: {
    id: number;
    applicationNumber: string;
    status: string;
    apiKeyLabel: string;
    creationSource: string;
    createdAt: string;
  };
  error?: string;
}

export class MobigoManagementService {
  private static getApiUrl(): string {
    const raw = process.env.MOBIGO_MANAGEMENT_API_URL || 'https://mobigomanagement.onrender.com';
    return raw.replace(/\/+$/, '');
  }

  private static getApiKey(): string {
    return (
      process.env.MOBIGO_MANAGEMENT_API_KEY ||
      'mbg_live_19e8ff22ff54e4a7996b5f87c0b7e2e3e07c8a2285cea05d'
    );
  }

  /**
   * Submit an application directly to the Mobigo Management system
   */
  static async createApplication(
    data: ExtractedDocumentData,
    meta?: {
      submissionId?: string | number;
      templateName?: string;
      agentPhone?: string;
      dealerName?: string;
    }
  ): Promise<CreateMobigoApplicationResponse> {
    const baseUrl = this.getApiUrl();
    const apiKey = this.getApiKey();
    const endpoint = `${baseUrl}/api/v1/applications`;

    // Parse numeric price
    const rawPrice = String(data.product_price || data.total_rent || data.monthly_rent || '0')
      .replace(/[^0-9.]/g, '');
    const unitPrice = parseFloat(rawPrice) > 0 ? parseFloat(rawPrice) : 1.0;

    // Detect IC vs Passport
    const rawIdentifier = (data.ic_number || data.passport_number || '').trim();
    const isPassport = Boolean(
      data.passport_number ||
      (rawIdentifier && /^[A-Za-z]/.test(rawIdentifier) && rawIdentifier.length < 12)
    );

    // Detect Brand
    const prodNameLower = (data.product_name || '').toLowerCase();
    let detectedBrand = 'Mobile';
    if (prodNameLower.includes('iphone') || prodNameLower.includes('apple') || prodNameLower.includes('ipad')) {
      detectedBrand = 'Apple';
    } else if (prodNameLower.includes('samsung') || prodNameLower.includes('galaxy')) {
      detectedBrand = 'Samsung';
    } else if (prodNameLower.includes('xiaomi') || prodNameLower.includes('redmi')) {
      detectedBrand = 'Xiaomi';
    } else if (prodNameLower.includes('vivo')) {
      detectedBrand = 'Vivo';
    } else if (prodNameLower.includes('oppo')) {
      detectedBrand = 'Oppo';
    } else if (prodNameLower.includes('honor')) {
      detectedBrand = 'Honor';
    } else if (prodNameLower.includes('huawei')) {
      detectedBrand = 'Huawei';
    }

    const payload: any = {
      ...data,
      meta,
      customer: {
        fullName: (data.name || 'Customer').trim(),
        icNumber: !isPassport && rawIdentifier ? rawIdentifier : null,
        passportNumber: isPassport && rawIdentifier ? rawIdentifier : null,
        nationality: (data.nationality || (isPassport ? 'International' : 'Malaysian')).trim(),
        phoneNumber: (data.phone_number || meta?.agentPhone || '+60123456789').trim(),
        email: data.email ? data.email.trim() : null,
        homeAddress: data.address ? data.address.trim() : null,
        state: data.state ? String(data.state).trim() : null,
        city: data.city ? String(data.city).trim() : null,
        postcode: data.postcode ? String(data.postcode).trim() : null,
      },
      product: {
        category: (data.category || 'Smartphone').trim(),
        brand: data.brand || detectedBrand,
        name: (data.product_name || 'Smartphone Device').trim(),
        model: data.model || data.product_name ? String(data.model || data.product_name).trim() : null,
        serialNumber: data.imei || data.imei1 || data.serial_number ? String(data.imei || data.imei1 || data.serial_number).trim() : null,
        unitPrice: unitPrice,
        quantity: 1,
      },
      financing: {
        dealerName: (meta?.dealerName || data.branch_name || data.cawangan || 'DocuSeal System').trim(),
        remarks: [
          meta?.submissionId ? `DocuSeal Submission #${meta.submissionId}` : '',
          data.order_number ? `Order #${data.order_number}` : '',
          meta?.templateName ? `Template: ${meta.templateName}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      },
    };

    // Optional Emergency Contact if present
    if (data.emergency_name && data.emergency_phone) {
      payload.emergencyContact = {
        fullName: String(data.emergency_name).trim(),
        relationship: String(data.emergency_relationship || 'Guarantor').trim(),
        phoneNumber: String(data.emergency_phone).trim(),
      };
    }

    // Optional Employment if present
    if (data.employer_name || data.occupation || data.monthly_salary) {
      const salaryNum = parseFloat(String(data.monthly_salary || '').replace(/[^0-9.]/g, ''));
      payload.employment = {
        employerName: data.employer_name ? String(data.employer_name).trim() : null,
        occupation: data.occupation ? String(data.occupation).trim() : null,
        employmentStatus: data.employment_status ? String(data.employment_status).trim() : 'Employed',
        monthlySalary: !isNaN(salaryNum) && salaryNum > 0 ? salaryNum : null,
      };
    }

    console.log(`[MobigoManagementService] Sending application to -> POST ${endpoint}`);

    try {
      const response = await axios.post<CreateMobigoApplicationResponse>(endpoint, payload, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 15000,
      });

      console.log(
        `[MobigoManagementService] Application created successfully:`,
        response.data?.data?.applicationNumber
      );
      return response.data;
    } catch (err: any) {
      const errMsg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        'Failed to connect to Mobigo Management API';
      console.error(`[MobigoManagementService] Error creating application:`, errMsg);
      return {
        success: false,
        error: errMsg,
      };
    }
  }

  /**
   * Check if a completed webhook payload belongs to a Phone Rental document
   */
  static isPhoneRentalPayload(rawPayload: any): boolean {
    const envelope = rawPayload?.data || rawPayload || {};
    const docName = String(
      envelope.template?.name || envelope.template_name || envelope.name || envelope.title || ''
    ).toLowerCase();

    return docName.includes('phone rental') || docName.includes('phone-rental');
  }

  /**
   * Forward a completed DocuSeal webhook payload directly to Mobigo Management
   */
  static async sendCompletedWebhook(rawWebhookPayload: any): Promise<CreateMobigoApplicationResponse> {
    if (!this.isPhoneRentalPayload(rawWebhookPayload)) {
      console.log('[MobigoManagementService] Skipping non-phone-rental / CTOS document signing event.');
      return {
        success: false,
        error: 'Skipped non-phone-rental template',
      };
    }

    const baseUrl = this.getApiUrl();
    const apiKey = this.getApiKey();
    const endpoint = `${baseUrl}/api/v1/applications`;

    console.log(`[MobigoManagementService] Forwarding completed signing webhook to -> POST ${endpoint}`);

    try {
      const response = await axios.post<CreateMobigoApplicationResponse>(endpoint, rawWebhookPayload, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 15000,
      });

      console.log(
        `[MobigoManagementService] Signed application recorded in Mobigo:`,
        response.data?.data?.applicationNumber
      );

      const appNum = response.data?.data?.applicationNumber;
      const statusText = `✅ *MobiGo Management:* Recorded as *${appNum}* (${baseUrl})`;
      await this.notifyWhatsAppCompleted(rawWebhookPayload, statusText);

      return response.data;
    } catch (err: any) {
      const errMsg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        'Failed to forward completed webhook to Mobigo Management API';
      console.error(`[MobigoManagementService] Error recording signed application:`, errMsg);

      const statusText = `⚠️ *MobiGo Management Status:* Error - ${errMsg}`;
      await this.notifyWhatsAppCompleted(rawWebhookPayload, statusText);

      return {
        success: false,
        error: errMsg,
      };
    }
  }

  /**
   * Helper to format and send WhatsApp notification via https://deswa.io7.my/api/external/send-message
   */
  private static async notifyWhatsAppCompleted(rawPayload: any, mobigoStatusText: string): Promise<void> {
    const envelope = rawPayload?.data || rawPayload || {};
    const submitter = envelope.submitters?.[0] || envelope.submitter || {};
    const phone = submitter.phone || envelope.phone;
    const custName = submitter.name || envelope.name || 'Customer';
    const docName = envelope.name || 'Document Agreement';
    const subId = envelope.id || submitter.submission_id || 'OK';

    const message = [
      '🎉 *Document Signed & Completed!*',
      '━━━━━━━━━━━━━━━━━━━━━━━',
      `📄 *Document:* ${docName}`,
      `👤 *Customer:* ${custName}`,
      `🆔 *Submission ID:* #${subId}`,
      '',
      mobigoStatusText,
      '━━━━━━━━━━━━━━━━━━━━━━━',
      '_Thank you for choosing Mobigo!_'
    ].join('\n');

    // Send to configured notification phone only if set in .env
    const notifyPhone = process.env.WHATSAPP_NOTIFY_PHONE;
    if (notifyPhone) {
      await this.sendExternalWhatsApp(notifyPhone, message);
    } else {
      console.log('[MobigoManagementService] WHATSAPP_NOTIFY_PHONE is blank. Skipping WhatsApp notification.');
    }
  }

  /**
   * Send WhatsApp message via https://deswa.io7.my/api/external/send-message
   */
  static async sendExternalWhatsApp(rawNumber: string, message: string): Promise<boolean> {
    if (!rawNumber || !message) return false;

    let cleanNumber = String(rawNumber).replace(/[^0-9+]/g, '');
    if (cleanNumber.startsWith('0')) {
      cleanNumber = `60${cleanNumber.slice(1)}`;
    } else if (cleanNumber.startsWith('+')) {
      cleanNumber = cleanNumber.slice(1);
    } else if (!cleanNumber.startsWith('60')) {
      cleanNumber = `60${cleanNumber}`;
    }

    try {
      const resp = await axios.post(
        'https://deswa.io7.my/api/external/send-message',
        {
          number: cleanNumber,
          message: message,
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000,
        }
      );
      console.log(`[External WhatsApp API] Sent message to ${cleanNumber}:`, resp.data);
      return true;
    } catch (err: any) {
      console.warn(`[External WhatsApp API] Failed sending to ${cleanNumber}:`, err?.response?.data || err?.message || err);
      return false;
    }
  }
}

