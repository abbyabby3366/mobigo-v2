import path from 'path';
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
   * Process all collected files and text notes to extract structured document fields.
   */
  static async extractContractData(
    textNotes: string[],
    files: BufferedFile[]
  ): Promise<ExtractedDocumentData> {
    // 1. Try Mobigo API endpoint first
    try {
      const mobigoResult = await this.callMobigoApi(textNotes, files);
      if (mobigoResult && Object.keys(mobigoResult).length > 0) {
        return mobigoResult;
      }
    } catch (err) {
      console.warn('[MobigoAiService] Mobigo API call failed, falling back to AI Vision Router:', (err as any).message);
    }

    // 2. Fallback to AI Vision Router
    return await this.callAiRouterVision(textNotes, files);
  }

  /**
   * Call external Mobigo API (https://mobigo.io7.my) with multipart form data
   */
  private static async callMobigoApi(
    textNotes: string[],
    files: BufferedFile[]
  ): Promise<ExtractedDocumentData | null> {
    const mobigoUrl = process.env.MOBIGO_API_URL || 'https://mobigo.io7.my';
    const apiKey = process.env.MOBIGO_IO7_MY_API_KEY;

    if (!apiKey) return null;

    const formData = new FormData();
    formData.append('text_notes', textNotes.join('\n\n'));

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      let buf = f.fileBuffer;
      if (!buf && f.filePath && fs.existsSync(f.filePath)) {
        buf = fs.readFileSync(f.filePath);
      }
      if (buf) {
        const blob = new Blob([buf], { type: f.mimetype || 'application/octet-stream' });
        formData.append('files', blob, f.fileName || `file_${i}`);
      }
    }

    const res = await fetch(`${mobigoUrl}/api/documents/extract`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
      signal: AbortSignal.timeout(15000),
    });

    if (res.ok) {
      const data = (await res.json()) as any;
      return (data?.extracted || data?.data || data) as ExtractedDocumentData;
    }

    return null;
  }

  /**
   * Call OpenAI-compatible AI Router with multimodal Vision model
   */
  private static async callAiRouterVision(
    textNotes: string[],
    files: BufferedFile[]
  ): Promise<ExtractedDocumentData> {
    const aiUrl = process.env.AI_ROUTER_URL || 'https://router.oino.dev/v1/chat/completions';
    const aiKey = process.env.AI_ROUTER_KEY || 'sk-e5b95619ac694e0a-a72568-c2160a10';
    const aiModel = process.env.AI_ROUTER_MODEL || 'antigravity/gemini-3.6-flash-medium';

    const promptText = `
You are an expert Malaysian contract and document parser for Mobigo Phone Rental Services.
Analyze all provided images, IC identity cards, payslips, invoices, order details, and text notes.
Extract all relevant fields and return ONLY a valid JSON object matching the Mobigo Phone Rental Service Agreement schema:

{
  "name": "Full Name of Customer as per IC/MyKad",
  "ic_number": "Malaysian IC/MyKad Number (e.g. 890425-02-5957 or 010188888)",
  "phone_number": "Mobile Phone Number (e.g. 01153565717 or 60123456789)",
  "email": "Customer Email Address",
  "address": "Full Delivery / Residential Address including Postcode and State",
  "product_name": "Full Phone Model, Color & Storage (e.g. iPhone 17 Pro Max, Deep Blue, 512GB)",
  "imei": "15-digit Device IMEI Number",
  "monthly_rent": "Monthly Rental Price in RM (e.g. RM 150)",
  "total_rent": "Total Rental Amount in RM (e.g. RM 1800)",
  "deposit": "Product Deposit Amount in RM (e.g. RM 300)",
  "product_price": "Total Product / Device Retail Price in RM (e.g. RM 5999)",
  "order_number": "Order / Booking Number (e.g. ORD-123456)"
}

Parsing Rules:
1. Extract customer name accurately (e.g. from MyKad or text).
2. Extract IC number accurately.
3. Extract mobile phone number (supporting formats like 011..., 012..., 017..., +601...).
4. Extract delivery address with street, postcode, and state.
5. Capture device details including brand, model, color, and storage capacity.
6. Extract IMEI number (15 digits).
7. If monthly rental is specified, calculate total rental (e.g. 12 months x monthly rent).
8. If currency values are numeric, prefix with 'RM '.
9. Return empty string "" only when no information is found in any files or text.

Text Notes received from agent:
${textNotes.join('\n---\n')}
`;

    const contentArray: any[] = [{ type: 'text', text: promptText }];

    // Attach images as base64
    for (const f of files) {
      let buf = f.fileBuffer;
      if (!buf && f.filePath && fs.existsSync(f.filePath)) {
        buf = fs.readFileSync(f.filePath);
      }

      if (buf && f.mimetype.startsWith('image/')) {
        const base64Data = buf.toString('base64');
        contentArray.push({
          type: 'image_url',
          image_url: {
            url: `data:${f.mimetype};base64,${base64Data}`,
          },
        });
      }
    }

    const payload = {
      model: aiModel,
      messages: [
        {
          role: 'user',
          content: contentArray,
        },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    };

    const response = await fetch(aiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`AI Router returned error ${response.status}: ${errText}`);
    }

    const json = (await response.json()) as any;
    const rawContent = json.choices?.[0]?.message?.content || '{}';

    try {
      const cleaned = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleaned) as ExtractedDocumentData;
    } catch (parseErr) {
      console.error('[MobigoAiService] Failed to parse AI response:', rawContent);
      return {};
    }
  }
}
