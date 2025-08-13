// utils/address.ts 
import { sha256Hex } from './security';

export function addressFingerprint({
  address_line1,
  address_line2,
  city,
  department,
  postal_code,
  country,
}: {
  address_line1: string;
  address_line2?: string | null;
  city: string;
  department?: string | null;
  postal_code?: string | null;
  country: string;
}) {
  const norm = (s?: string | null) =>
    String(s ?? '')
      .normalize('NFKD')                 // décompose accents
      .replace(/[\u0300-\u036f]/g, '')   // enlève diacritiques
      .replace(/[^\w\s]/g, ' ')          // ponctuation -> espace
      .replace(/\s+/g, ' ')              // compacter espaces
      .trim()
      .toUpperCase();

  const key = [
    norm(address_line1),
    norm(address_line2),
    norm(city),
    norm(department),
    norm(postal_code),
    norm(country),
  ].join('|');

  return sha256Hex(key);
}
