import fs from 'fs';
import { docusealService } from './docusealService.js';

export interface ExtractedDocumentData {
  name?: string;
  ic_number?: string;
  phone_number?: string;
  email?: string;
  address?: string;
  product_name?: string;
  imei?: string;
  monthly_rent?: string;
  total_rent?: string;
  deposit?: string;
  product_price?: string;
  order_number?: string;
  branch_name?: string;
  [key: string]: any;
}

export interface BufferedFile {
  fileName: string;
  mediaType: 'image' | 'document' | 'video' | 'audio';
  mimetype: string;
  filePath?: string;
  fileBuffer?: Buffer;
  caption?: string;
}

export class MobigoAiService {
  /**
   * Process all collected files and text notes by sending directly to
   * Mobigo / DocuSeal endpoint as multipart/form-data.
   */
  static async extractContractData(
    textNotes: string[],
    files: BufferedFile[],
    templateId: number
  ): Promise<ExtractedDocumentData> {
    const baseUrl = docusealService.getApiUrl();
    const apiKey = docusealService.getApiKey();

    const formData = new FormData();
    formData.append('template_id', String(templateId));
    formData.append('text', textNotes.join('\n\n'));

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      let buf = f.fileBuffer;
      if (!buf && f.filePath && fs.existsSync(f.filePath)) {
        buf = fs.readFileSync(f.filePath);
      }
      if (buf) {
        const blob = new Blob([buf], { type: f.mimetype || 'application/octet-stream' });
        formData.append('files[]', blob, f.fileName || `file_${i}`);
      }
    }

    const endpoint = `${baseUrl}/api/ai_submissions/extract`;
    console.log(`[MobigoAiService] Sending extraction request -> POST ${endpoint} (template_id: ${templateId}, files: ${files.length}, notes: ${textNotes.length})`);

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          // Do not set Content-Type header manually; fetch automatically sets multipart/form-data boundary
          'X-Auth-Token': apiKey,
        },
        body: formData,
        signal: AbortSignal.timeout(45000), // 45s timeout for AI extraction
      });
    } catch (networkErr: any) {
      console.error(`[MobigoAiService] Network error reaching POST ${endpoint}:`, networkErr);
      throw new Error(`Failed to reach Mobigo/DocuSeal server at [${endpoint}]: ${networkErr.message}`);
    }

    if (!res.ok) {
      let errDetail = '';
      try {
        const errJson: any = await res.json();
        errDetail = errJson.error || errJson.message || JSON.stringify(errJson);
      } catch (_) {
        errDetail = await res.text().catch(() => '');
      }
      console.error(`[MobigoAiService] ❌ Mobigo API Error: Status ${res.status} (${res.statusText}) | URL: ${endpoint} | Template ID: ${templateId} | Response: ${errDetail}`);
      throw new Error(`Mobigo API error (${res.status}) at ${endpoint} [Template: ${templateId}]: ${errDetail || res.statusText}`);
    }

    const data = (await res.json()) as any;
    const firstSub = data.submitters?.[0] || {};
    const values = firstSub.values || data.fields || data.extracted || data || {};

    // Map DocuSeal field names to our internal names
    const nameVal = firstSub.name || values['Name'] || values['Nama'] || values['name'] || '';
    const emailVal = firstSub.email || values['Email'] || values['email'] || '';
    const phoneVal = firstSub.phone || values['Nombor Telefon'] || values['phone_number'] || '';
    const icVal = values['No Kad Pengenalan'] || values['No. Kad Pengenalan'] || values['ic_number'] || '';
    const addressVal = values['Alamat Penghantaran'] || values['Alamat'] || values['address'] || '';
    const productVal = values['Nama Produk'] || values['product_name'] || '';

    let imeiVal = values['Nombor IMEI'] || values['Nombor IMEI / Siri'] || values['imei'] || '';
    if (!imeiVal && (values['IMEI 1'] || values['imei1'] || values['IMEI1'])) {
      const im1 = values['IMEI 1'] || values['imei1'] || values['IMEI1'];
      const im2 = values['IMEI 2'] || values['imei2'] || values['IMEI2'];
      imeiVal = im2 ? `IMEI1: ${im1} / IMEI2: ${im2}` : im1;
    }

    const monthlyRent = values['Harga Sewa Sebulan'] || values['monthly_rent'] || '';
    const totalRent = values['Jumlah Sewa'] || values['total_rent'] || '';
    const deposit = values['Deposit Produk'] || values['deposit'] || '';
    const productPrice = values['Harga Produk'] || values['product_price'] || '';
    const orderNum = values['Nombor Pesanan'] || values['order_number'] || '';

    // Extract branch name (raw field) - check AI fields and text notes fallback
    let branchName =
      values['branch_name'] ||
      values['Branch Name'] ||
      values['Branch'] ||
      values['branch'] ||
      values['Cawangan'] ||
      values['cawangan'] ||
      values['Nama Cawangan'] ||
      values['nama_cawangan'] ||
      '';

    if (!branchName && textNotes.length > 0) {
      const fullText = textNotes.join('\n');
      const branchRegex = /(?:branch(?:\s*name)?|cawangan(?:\s*name)?|nama\s*cawangan)\s*[:=\-]\s*([^\r\n,]+)/i;
      const match = fullText.match(branchRegex);
      if (match && match[1]) {
        branchName = match[1].trim();
      }
    }

    return {
      name: nameVal,
      email: emailVal,
      phone_number: phoneVal,
      ic_number: icVal,
      address: addressVal,
      product_name: productVal,
      imei: imeiVal,
      monthly_rent: monthlyRent,
      total_rent: totalRent,
      deposit: deposit,
      product_price: productPrice,
      order_number: orderNum,
      branch_name: branchName,
      ...values,
    };
  }
}
