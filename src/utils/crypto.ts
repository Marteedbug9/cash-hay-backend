// src/utils/crypto.ts
import { randomBytes, createCipheriv, createDecipheriv, createHmac } from 'crypto';

const DATA_KEY_B64 = process.env.DATA_KEY_BASE64 || '';
const BIDX_KEY_B64 = process.env.BLIND_INDEX_KEY_BASE64 || '';

if (!DATA_KEY_B64) throw new Error('DATA_KEY_BASE64 manquant');
if (!BIDX_KEY_B64) throw new Error('BLIND_INDEX_KEY_BASE64 manquant');

const DATA_KEY = Buffer.from(DATA_KEY_B64, 'base64'); // 32 bytes
const BIDX_KEY = Buffer.from(BIDX_KEY_B64, 'base64'); // 32 bytes

if (DATA_KEY.length !== 32) throw new Error('DATA_KEY_BASE64 doit décoder 32 octets');
if (BIDX_KEY.length !== 32) throw new Error('BLIND_INDEX_KEY_BASE64 doit décoder 32 octets');

export const ENCRYPTION_VERSION = 1;
const IV_LEN = 12;   // GCM nonce
const TAG_LEN = 16;  // GCM auth tag

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', DATA_KEY, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  // format: version(1) | iv(12) | tag(16) | ciphertext
  return Buffer.concat([Buffer.from([ENCRYPTION_VERSION]), iv, tag, ct]).toString('base64');
}

export function decrypt(payloadB64: string): string {
  const buf = Buffer.from(payloadB64, 'base64');
  if (buf.length < 1 + IV_LEN + TAG_LEN) throw new Error('Ciphertext trop court');
  const ver = buf[0];
  if (ver !== ENCRYPTION_VERSION) throw new Error(`Version de chiffrement non supportée: ${ver}`);
  const iv  = buf.subarray(1, 1 + IV_LEN);
  const tag = buf.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const ct  = buf.subarray(1 + IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', DATA_KEY, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

// Normalisation pour blind index
export const norm = (s: string) => s.normalize('NFKC').trim().toLowerCase();

// Blind index générique (recherche exacte)
export function blindIndex(value: string): string {
  return createHmac('sha256', BIDX_KEY).update(norm(value)).digest('hex');
}

// Variantes pratiques
export const blindIndexEmail = (email: string) => blindIndex(email.replace(/\s+/g, ''));
export const blindIndexPhone = (phone: string) => blindIndex(phone.replace(/[^\d+]/g, ''));

// Helpers nullables & JSON
export const encryptNullable = (v?: string | null) => (v == null ? null : encrypt(v));
export const decryptNullable = (v?: string | null) => (v == null ? null : decrypt(v));

export const encryptJSON = (obj: unknown) => encrypt(JSON.stringify(obj));
export const decryptJSON = <T = unknown>(b64: string): T => JSON.parse(decrypt(b64)) as T;
