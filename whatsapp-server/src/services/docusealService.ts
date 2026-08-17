import axios from 'axios';

export interface DocuSealSubmitter {
  email?: string;
  phone?: string;
  name?: string;
  role?: string;
  fields?: Record<string, any>;
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
    return (process.env.DOCUSEAL_API_URL || 'http://app:3000').replace(/\/$/, '');
  }

  private getApiKey(): string {
    return process.env.DOCUSEAL_API_KEY || '';
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
    const url = `${this.getApiUrl()}/submissions`;
    try {
      const response = await axios.post(url, params, {
        headers: this.getHeaders(),
        timeout: 30000,
      });
      return response.data;
    } catch (err: any) {
      console.error('[DocuSeal] Create Submission Error:', err.response?.data || err.message);
      throw new Error(err.response?.data?.error || err.message || 'Failed to create DocuSeal submission');
    }
  }

  /**
   * Retrieve a specific submission by ID
   */
  async getSubmission(id: number | string): Promise<any> {
    const url = `${this.getApiUrl()}/submissions/${id}`;
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
    const url = `${this.getApiUrl()}/templates`;
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
}

export const docusealService = new DocuSealService();
