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
  name?: string;
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
  getApiUrl(): string {
    const isProd = process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';
    if (isProd) {
      return (process.env.PROD_DOCUSEAL_URL || process.env.MOBIGO_API_URL || process.env.DOCUSEAL_API_URL || 'https://mobigo.io7.my').replace(/\/+$/, '');
    }
    return (process.env.DOCUSEAL_API_URL || process.env.DEV_DOCUSEAL_URL || 'http://localhost:3000').replace(/\/+$/, '');
  }

  getApiKey(): string {
    const isProd = process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';
    if (isProd) {
      return process.env.PROD_DOCUSEAL_API_KEY || process.env.MOBIGO_IO7_MY_API_KEY || process.env.DOCUSEAL_API_KEY || 'dwvP7HPoWiJsvcETWeLfR8K6NVf4a9vefLhiTydH5xk';
    }
    return process.env.DEV_DOCUSEAL_API_KEY || process.env.DOCUSEAL_API_KEY || '9ewYoE91wx1p8hASHVMaoJBuvA4uP2vyU14WaPMGAe6';
  }

  getPublicUrl(): string {
    const isProd = process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';
    if (isProd) {
      return (process.env.PROD_DOCUSEAL_URL || process.env.MOBIGO_API_URL || process.env.DOCUSEAL_PUBLIC_URL || 'https://mobigo.io7.my').replace(/\/+$/, '');
    }
    const local = process.env.DEV_DOCUSEAL_URL || process.env.DOCUSEAL_PUBLIC_URL || 'http://localhost:3000';
    return local.replace('http://app:3000', 'http://localhost:3000').replace(/\/+$/, '');
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
        try {
          const altRes = await axios.post(altUrl, params, {
            headers: this.getHeaders(),
            timeout: 30000,
          });
          return altRes.data;
        } catch (altErr: any) {
          console.error(`[DocuSeal] Create Submission Error at ${altUrl}:`, altErr.response?.data || altErr.message);
          throw new Error(`DocuSeal submission failed at ${altUrl} (${altErr.response?.status || 500}): ${altErr.response?.data?.error || altErr.response?.data?.message || altErr.message}`);
        }
      }
      console.error(`[DocuSeal] Create Submission Error at ${url}:`, err.response?.data || err.message);
      throw new Error(`DocuSeal submission failed at ${url} (${err.response?.status || 500}): ${err.response?.data?.error || err.response?.data?.message || err.message}`);
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
    const yearYY = String(now.getFullYear()).slice(-2);
    const fullDate = `${day}/${month}/${now.getFullYear()}`;

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
      'Year of Date': yearYY,
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
