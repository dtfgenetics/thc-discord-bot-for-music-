import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  '0.0.0.0'
]);

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

export function isPrivateAddress(address) {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family !== 6) return true;

  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(normalized)) return true;

  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);

  return false;
}

export async function assertPublicHttpUrl(rawUrl, lookupFn = dnsLookup) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    throw new Error('Track URL must be a valid absolute URL.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only public HTTP or HTTPS audio URLs are supported.');
  }

  if (url.username || url.password) {
    throw new Error('Credentials in track URLs are not allowed.');
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname || BLOCKED_HOSTS.has(hostname) || hostname.endsWith('.localhost')) {
    throw new Error('Local/private track URLs are not allowed.');
  }

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error('Local/private track URLs are not allowed.');
    return url;
  }

  const records = await lookupFn(hostname, { all: true, verbatim: true });
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('Track host could not be resolved.');
  }
  if (records.some((record) => isPrivateAddress(record.address))) {
    throw new Error('Track host resolves to a local/private network.');
  }

  return url;
}
