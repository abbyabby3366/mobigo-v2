import fs from 'fs';

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
   * Process all collected files and text notes by sending directly to Mobigo / DocuSeal endpoint.
   */
  static async extractContractData(
    textNotes: string[],
    files: BufferedFile[],
    templateId: number = 3
  ): Promise<ExtractedDocumentData> {
    // Determine base URL (inside Docker network: http://app:3000, or external: MOBIGO_API_URL)
    const baseUrl = (process.env.DOCUSEAL_API_URL || process.env.MOBIGO_API_URL || 'http://app:3000').replace(/\/+$/, '');
    const apiKey = process.env.DOCUSEAL_API_KEY || process.env.MOBIGO_IO7_MY_API_KEY || '9ewYoE91wx1p8hASHVMaoJBuvA4uP2vyU14WaPMGAe6';

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
    console.log(`[MobigoAiService] Sending document extraction request to Mobigo endpoint: ${endpoint} (template_id: ${templateId})`);

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'X-Auth-Token': apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Mobigo API error (${res.status}): ${errText || res.statusText}`);
    }

    const data = (await res.json()) as any;
    const firstSub = data.submitters?.[0] || {};
    const values = firstSub.values || data.fields || data.extracted || data || {};

    // Format and normalize extracted fields
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

    const extracted: ExtractedDocumentData = {
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
      ...values,
    };

    return extracted;
  }
}
