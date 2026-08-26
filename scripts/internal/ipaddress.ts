/**
 * Just enough of `ipaddress` for `urllib.parse._check_bracketed_host`, which
 * needs to tell "valid IPv6", "valid IPv4" and "neither" apart.
 *
 * This is deliberately not `net.isIP()`: Node accepts leading zeros in IPv4
 * octets ("0177.1.1.1"), which CPython has rejected since 3.9.5, and the two
 * disagree about scoped IPv6 too.
 */

import { pyIsAscii, pyPartition } from './pystr.js';

/** `IPv4Address(text)` succeeds. */
export function isIPv4(text: string): boolean {
  if (text.includes('/')) return false;
  const octets = text.split('.');
  if (octets.length !== 4) return false;
  return octets.every(parseOctet);
}

function parseOctet(octet: string): boolean {
  if (octet.length === 0 || octet.length > 3) return false;
  if (!/^[0-9]+$/.test(octet)) return false; // isdigit() and isascii()
  if (octet !== '0' && octet.startsWith('0')) return false; // ambiguous leading zero
  return Number(octet) <= 255;
}

/** `IPv6Address(text)` succeeds. */
export function isIPv6(text: string): boolean {
  if (text.includes('/')) return false;

  // _split_scope_id: exactly one '%', with a non-empty zone after it.
  const [beforeScope, sep, scopeId] = pyPartition(text, '%');
  let addr = text;
  if (sep) {
    if (!scopeId || scopeId.includes('%')) return false;
    addr = beforeScope;
  }
  return parseIPv6Int(addr);
}

function parseIPv6Int(ipStr: string): boolean {
  if (!ipStr) return false;

  let parts = ipStr.split(':');
  if (parts.length < 3) return false; // "At least 3 parts expected"

  // A trailing dotted quad stands in for the last two hextets.
  if ((parts[parts.length - 1] as string).includes('.')) {
    if (!isIPv4(parts.pop() as string)) return false;
    parts.push('0', '0'); // placeholder hextets, only the count matters here
  }

  const maxParts = 8;
  let skipIndex: number | null = null;
  for (let i = 1; i < parts.length - 1; i += 1) {
    if (!parts[i]) {
      if (skipIndex !== null) return false; // more than one '::'
      skipIndex = i;
    }
  }

  let partsHi: number;
  let partsLo: number;
  let partsSkipped: number;

  if (skipIndex !== null) {
    partsHi = skipIndex;
    partsLo = parts.length - skipIndex - 1;
    if (!parts[0]) {
      partsHi -= 1;
      if (partsHi) return false; // ":::" or leading ":x"
    }
    if (!parts[parts.length - 1]) {
      partsLo -= 1;
      if (partsLo) return false;
    }
    partsSkipped = maxParts - (partsHi + partsLo);
    if (partsSkipped < 1) return false;
  } else {
    if (parts.length !== maxParts) return false;
    if (!parts[0]) return false; // leading ':' without '::'
    if (!parts[parts.length - 1]) return false;
    partsHi = parts.length;
    partsLo = 0;
    partsSkipped = 0;
  }

  for (let i = 0; i < partsHi; i += 1) if (!parseHextet(parts[i] as string)) return false;
  for (let i = 1; i <= partsLo; i += 1) if (!parseHextet(parts[parts.length - i] as string)) return false;
  return true;
}

function parseHextet(hextet: string): boolean {
  if (!pyIsAscii(hextet)) return false;
  if (!/^[0-9A-Fa-f]+$/.test(hextet)) return false;
  return hextet.length <= 4;
}

/** Mirrors `ip_address()`: IPv4 is tried first, then IPv6. */
export function ipAddressKind(text: string): 'ipv4' | 'ipv6' | null {
  if (isIPv4(text)) return 'ipv4';
  if (isIPv6(text)) return 'ipv6';
  return null;
}
