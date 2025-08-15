import axios from 'axios';

export type IPLocation = {
  city?: string | null;
  region?: string | null;     // regionName chez ip-api
  country?: string | null;
  countryCode?: string | null;
  lat?: number | null;
  lon?: number | null;
};

export function normalizeIP(ipRaw: string): string {
  if (!ipRaw) return '';
  // ::ffff:1.2.3.4  ->  1.2.3.4
  if (ipRaw.startsWith('::ffff:')) return ipRaw.slice(7);
  // "1.2.3.4:12345" -> "1.2.3.4"
  const lastColon = ipRaw.lastIndexOf(':');
  if (ipRaw.includes('.') && lastColon !== -1) {
    return ipRaw.slice(0, lastColon);
  }
  return ipRaw;
}

export function isPrivateIP(ip: string): boolean {
  return /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|::1|fc00:|fe80:)/.test(ip);
}

export async function fetchIPLocation(ipRaw: string): Promise<IPLocation | null> {
  const ip = normalizeIP(ipRaw);
  if (!ip || isPrivateIP(ip)) return null; // évite lookup sur IP privées/localhost

  try {
    const { data } = await axios.get(`http://ip-api.com/json/${ip}`, { timeout: 3000 });
    if (data?.status === 'success') {
      return {
        city: data.city ?? null,
        region: data.regionName ?? data.region ?? null,
        country: data.country ?? null,
        countryCode: data.countryCode ?? null,
        lat: data.lat ?? null,
        lon: data.lon ?? null,
      };
    }
  } catch {
    // silencieux, on fallback plus bas
  }
  return null;
}

export function formatLocationLabel(loc: IPLocation | null): string {
  if (!loc) return 'localisation inconnue';
  const parts = [loc.city, loc.region, loc.country].filter(Boolean);
  return parts.length ? parts.join(', ') : 'localisation inconnue';
}
