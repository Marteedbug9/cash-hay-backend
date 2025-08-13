// utils/address.ts
import { sha256Hex } from './security';

export function addressFingerprint({
  address_line1, address_line2, city, postal_code, country,
}: {
  address_line1: string; address_line2?: string; city: string; postal_code?: string; country: string;
}) {
  const norm = (s?: string) => (s ?? '').normalize('NFKC').trim().toUpperCase().replace(/\s+/g, ' ');
  const key = [norm(address_line1), norm(address_line2), norm(city), norm(postal_code), norm(country)].join('|');
  return sha256Hex(key);
}
