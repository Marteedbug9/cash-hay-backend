// src/utils/pii.ts
import { encrypt, decrypt, blindIndex } from './crypto';

export const normEmail = (s: string) =>
  s.normalize('NFKC').trim().toLowerCase();

export const normPhone = (s: string) =>
  s.normalize('NFKC').replace(/[^\d+]/g, ''); // idéal: normaliser en E.164

export const blindIndexEmail = (email: string) => blindIndex(normEmail(email));
export const blindIndexPhone = (phone: string) => blindIndex(normPhone(phone));

export const toEmailEncBidx = (email?: string | null) =>
  email ? { enc: encrypt(normEmail(email)), bidx: blindIndexEmail(email) } : { enc: null, bidx: null };

export const toPhoneEncBidx = (phone?: string | null) =>
  phone ? { enc: encrypt(normPhone(phone)), bidx: blindIndexPhone(phone) } : { enc: null, bidx: null };

export const fromEnc = (b64?: string | null) => (b64 ? decrypt(b64) : null);
