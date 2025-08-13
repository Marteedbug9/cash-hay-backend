// src/utils/security.ts
import crypto from 'crypto';


export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}
/** SHA-256 hex de la chaîne normalisée UTF-8 */
export function sha256Hex(input: string): string {
  // NFKC pour éviter les variantes Unicode (espaces insécables, etc.)
  const normalized = String(input).normalize('NFKC');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/** Compare deux hex en constant-time (retourne true si égaux) */
export function timingSafeEqualHex(aHex: string, bHex: string): boolean {
  // aligne la longueur en prévenant l’early return
  if (aHex.length !== bHex.length) {
    // compare à un buffer de même taille pour garder le timing constant
    const dummy = Buffer.alloc(aHex.length / 2);
    try { crypto.timingSafeEqual(Buffer.from(aHex, 'hex'), dummy); } catch {}
    return false;
  }
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  return crypto.timingSafeEqual(a, b);
}

/** Génère un code OTP alphanum (sans 0/O/1/I) en uppercase */
export function makeCode(len = 6): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    const idx = crypto.randomInt(0, alphabet.length);
    out += alphabet[idx];
  }
  return out;
}

/** (optionnel) OTP purement numérique, ex. 6 chiffres */
export function makeNumericCode(len = 6): string {
  let out = '';
  for (let i = 0; i < len; i++) out += String(crypto.randomInt(0, 10));
  return out;
}

/** Normalise un code saisi par l’utilisateur avant vérif */
export function normalizeOtp(input: string): string {
  return String(input).normalize('NFKC').trim().toUpperCase();
}
