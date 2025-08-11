import crypto from 'crypto';

export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function makeCode(len = 6): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // évite 0/O/1/I
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
