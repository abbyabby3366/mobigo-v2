import axios from 'axios';
import { ExtractedDocumentData } from './mobigoAiService.js';

export interface DocuSealSubmitter {
  email?: string;
  phone?: string;
  name?: string;
  role?: string;
  values?: Record<string, any>;
  fields?: Array<{ name: string; default_value?: any; value?: any }>;
}

export interface CreateSubmissionParams {
  template_id?: number | string;
  send_email?: boolean;
  send_sms?: boolean;
  submitters: DocuSealSubmitter[];
  message?: {
    subject?: string;
    body?: string;
  };
  documents?: Array<{
    name: string;
    file: string; // base64 or URL
    fields?: any[];
  }>;
}

export class DocuSealService {
  private getApiUrl(): string {
    const defaultUrl = process.env.DOCUSEAL_API_URL || (process.env.NODE_ENV === 'production' ? 'http://app:3000' : 'http://localhost:3000');
    return defaultUrl.replace(/\/$/, '');
  }

  private getApiKey(): string {
    return process.env.DOCUSEAL_API_KEY || '9ewYoE91wx1p8hASHVMaoJBuvA4uP2vyU14WaPMGAe6';
  }

  private getHeaders() {
    return {
      'X-Auth-Token': this.getApiKey(),
      'Content-Type': 'application/json',
    };
  }

  /**
   * Create a new submission from template or with documents
   */
  async createSubmission(params: CreateSubmissionParams): Promise<any> {
    const url = `${this.getApiUrl()}/api/submissions`;
    try {
      const response = await axios.post(url, params, {
        headers: this.getHeaders(),
        timeout: 30000,
      });
      return response.data;
    } catch (err: any) {
      // Fallback without /api if DocuSeal root routing differs
      if (err.response?.status === 404) {
        const altUrl = `${this.getApiUrl()}/submissions`;
        const altRes = await axios.post(altUrl, params, {
          headers: this.getHeaders(),
          timeout: 30000,
        });
        return altRes.data;
      }
      console.error('[DocuSeal] Create Submission Error:', err.response?.data || err.message);
      throw new Error(err.response?.data?.error || err.response?.data?.message || err.message || 'Failed to create DocuSeal submission');
    }
  }

  /**
   * Retrieve a specific submission by ID
   */
  async getSubmission(id: number | string): Promise<any> {
    const url = `${this.getApiUrl()}/api/submissions/${id}`;
    try {
      const response = await axios.get(url, {
        headers: this.getHeaders(),
      });
      return response.data;
    } catch (err: any) {
      console.error(`[DocuSeal] Get Submission ${id} Error:`, err.response?.data || err.message);
      throw err;
    }
  }

  /**
   * List existing templates
   */
  async listTemplates(): Promise<any[]> {
    const url = `${this.getApiUrl()}/api/templates`;
    try {
      const response = await axios.get(url, {
        headers: this.getHeaders(),
      });
      return response.data?.data || response.data || [];
    } catch (err: any) {
      console.error('[DocuSeal] List Templates Error:', err.response?.data || err.message);
      return [];
    }
  }

  /**
   * Get template by ID
   */
  async getTemplate(id: number | string): Promise<any> {
    const url = `${this.getApiUrl()}/api/templates/${id}`;
    try {
      const response = await axios.get(url, {
        headers: this.getHeaders(),
      });
      return response.data;
    } catch (err: any) {
      console.error(`[DocuSeal] Get Template ${id} Error:`, err.response?.data || err.message);
      return null;
    }
  }

  /**
   * Helper to build submitters object with pre-filled fields for DocuSeal
   */
  buildSubmittersPayload(data: ExtractedDocumentData): DocuSealSubmitter[] {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear());
    const fullDate = `${day}/${month}/${year}`;

    const fieldsMap: Record<string, any> = {
      'Name': data.name || '',
      'No Kad Pengenalan': data.ic_number || '',
      'Nombor Telefon': data.phone_number || '',
      'Email': data.email || '',
      'Alamat Penghantaran': data.address || '',
      'Nama Produk': data.product_name || '',
      'Nombor IMEI': data.imei || '',
      'Harga Sewa Sebulan': data.monthly_rent ? String(data.monthly_rent) : '',
      'Jumlah Sewa': data.total_rent ? String(data.total_rent) : '',
      'Deposit Produk': data.deposit ? String(data.deposit) : '',
      'Harga Produk': data.product_price ? String(data.product_price) : '',
      'Nombor Pesanan': data.order_number || '',
      'Day Of Date': day,
      'Month Of Date': month,
      'Year of Date': year,
      'Date': fullDate,
    };

    const submitter: DocuSealSubmitter = {
      name: data.name || 'Customer',
      email: data.email || 'customer@mobigo.com',
      phone: data.phone_number || undefined,
      role: 'First Party',
      values: fieldsMap,
    };

    return [submitter];
  }
}

export const docusealService = new DocuSealService();
