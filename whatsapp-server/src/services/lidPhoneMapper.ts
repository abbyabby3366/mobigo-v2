import { getRedisClient, formatRedisKey } from './redisAuthState.js';

class LidPhoneMapperService {
  private lidToPhone = new Map<string, string>();
  private phoneToLid = new Map<string, string>();
  private contactNames = new Map<string, string>();
  private isInitialized = false;

  async init(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;

    const redis = getRedisClient();
    if (redis) {
      try {
        const rawLid = await redis.get(formatRedisKey('wa_lid_to_phone_map'));
        if (rawLid) {
          const obj = JSON.parse(rawLid);
          for (const [k, v] of Object.entries(obj)) {
            if (typeof v === 'string') {
              this.lidToPhone.set(k, v);
              this.phoneToLid.set(v, k);
            }
          }
        }

        const rawNames = await redis.get(formatRedisKey('wa_contact_names_map'));
        if (rawNames) {
          const obj = JSON.parse(rawNames);
          for (const [k, v] of Object.entries(obj)) {
            if (typeof v === 'string') {
              this.contactNames.set(k, v);
            }
          }
        }
      } catch (err) {
        console.warn('[LidPhoneMapper] Redis load error:', err);
      }
    }
  }

  registerMapping(lidOrJid: string, phoneOrJid: string, name?: string): void {
    if (!lidOrJid || !phoneOrJid) return;

    const clean1 = lidOrJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    const clean2 = phoneOrJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');

    if (!clean1 || !clean2 || clean1 === clean2) return;

    let lid = clean1;
    let phone = clean2;

    // Detect which is LID (often 15 digits or starts with 107/112/202, or ends with @lid)
    // and which is phone number (often 9-13 digits or ends with @s.whatsapp.net)
    if (lidOrJid.includes('@s.whatsapp.net') || (clean1.length <= 13 && clean2.length > 13)) {
      phone = clean1;
      lid = clean2;
    } else if (phoneOrJid.includes('@lid')) {
      lid = clean2;
      phone = clean1;
    }

    if (lid && phone && lid !== phone) {
      this.lidToPhone.set(lid, phone);
      this.phoneToLid.set(phone, lid);
      if (name) {
        this.contactNames.set(phone, name);
        this.contactNames.set(lid, name);
      }
      this.persist();
    }
  }

  registerContactName(phoneOrLid: string, name: string): void {
    if (!phoneOrLid || !name) return;
    const clean = phoneOrLid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    if (!clean) return;

    this.contactNames.set(clean, name);
    const canonical = this.canonicalize(clean);
    if (canonical) this.contactNames.set(canonical, name);
    const lid = this.getLidForPhone(canonical || clean);
    if (lid) this.contactNames.set(lid, name);
    this.persist();
  }

  getContactName(phoneOrLid: string): string | undefined {
    const clean = phoneOrLid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    if (!clean) return undefined;
    return this.contactNames.get(clean) || this.contactNames.get(this.canonicalize(clean));
  }

  getPhoneForLid(lid: string): string | undefined {
    const clean = lid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    return this.lidToPhone.get(clean);
  }

  getLidForPhone(phone: string): string | undefined {
    const clean = phone.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    return this.phoneToLid.get(clean);
  }

  canonicalize(phoneOrLid: string): string {
    if (!phoneOrLid) return '';
    const clean = phoneOrLid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    if (!clean) return '';
    const mappedPhone = this.lidToPhone.get(clean);
    if (mappedPhone) return mappedPhone;
    return clean;
  }

  getAllMatches(phoneOrLid: string): string[] {
    const clean = phoneOrLid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    const res = new Set<string>();
    if (clean) res.add(clean);
    const canonical = this.canonicalize(clean);
    if (canonical) res.add(canonical);
    const lid = this.getLidForPhone(canonical || clean);
    if (lid) res.add(lid);
    const phone = this.getPhoneForLid(clean);
    if (phone) res.add(phone);
    return Array.from(res);
  }

  private persist(): void {
    const redis = getRedisClient();
    if (redis) {
      const obj: Record<string, string> = {};
      for (const [k, v] of this.lidToPhone.entries()) {
        obj[k] = v;
      }
      redis.set(formatRedisKey('wa_lid_to_phone_map'), JSON.stringify(obj)).catch(() => {});

      const nameObj: Record<string, string> = {};
      for (const [k, v] of this.contactNames.entries()) {
        nameObj[k] = v;
      }
      redis.set(formatRedisKey('wa_contact_names_map'), JSON.stringify(nameObj)).catch(() => {});
    }
  }
}

export const LidPhoneMapper = new LidPhoneMapperService();
