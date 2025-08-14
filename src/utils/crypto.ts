// src/utils/crypto.ts
import { randomBytes, createCipheriv, createDecipheriv, createHmac } from 'crypto';

function materializeKey(envName: 'DATA_KEY_BASE64' | 'BLIND_INDEX_KEY_BASE64'): Buffer {
  const raw = (process.env[envName] || '').trim();
  if (!raw) throw new Error(`${envName} manquant`);

  // 1) Essai base64 standard
  let buf = Buffer.from(raw, 'base64');
  if (buf.length === 32) return buf;

  // 2) Essai base64 URL-safe (+ padding)
  const urlSafe = raw.replace(/-/g, '+').replace(/_/g, '/');
  const pad = urlSafe.length % 4 ? urlSafe + '='.repeat(4 - (urlSafe.length % 4)) : urlSafe;
  buf = Buffer.from(pad, 'base64');
  if (buf.length === 32) return buf;

  // 3) Essai HEX (64 chars)
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    buf = Buffer.from(raw, 'hex');
    if (buf.length === 32) return buf;
  }

  throw new Error(`${envName} doit décoder 32 octets (base64 standard/URL-safe ou hex 64 chars).`);
}

const DATA_KEY = materializeKey('DATA_KEY_BASE64');
const BIDX_KEY = materializeKey('BLIND_INDEX_KEY_BASE64');

export const ENCRYPTION_VERSION = 1;
const IV_LEN = 12;   // GCM nonce
const TAG_LEN = 16;  // GCM auth tag

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', DATA_KEY, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
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

export const norm = (s: string) => s.normalize('NFKC').trim().toLowerCase();

export function blindIndex(value: string): string {
  return createHmac('sha256', BIDX_KEY).update(norm(value)).digest('hex');
}

export const blindIndexEmail = (email: string) => blindIndex(email.replace(/\s+/g, ''));
export const blindIndexPhone = (phone: string) => blindIndex(phone.replace(/[^\d+]/g, ''));

export const encryptNullable = (v?: string | null) => (v == null ? null : encrypt(v));
export const decryptNullable = (v?: string | null) => (v == null ? null : decrypt(v));
export const encryptJSON = (obj: unknown) => encrypt(JSON.stringify(obj));
export const decryptJSON = <T = unknown>(b64: string): T => JSON.parse(decrypt(b64)) as T;
