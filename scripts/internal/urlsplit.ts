/**
 * Port of `urllib.parse.urlsplit` / `urlunsplit` and the `SplitResult`
 * accessors, transcribed from CPython 3.13.
 *
 * Not `new URL()`. The WHATWG parser percent-encodes, resolves dot segments,
 * drops default ports, appends a "/" to an empty path and rejects inputs
 * urlsplit happily returns -- so a WHATWG-based `normalize_url` would produce
 * different dedupe keys and would never raise the ValueError that becomes the
 * validator's "invalid URL" error.
 */

import { ipAddressKind } from './ipaddress.js';
import { PyValueError } from './errors.js';
import { pyIsAscii, pyLower, pyLstrip, pyPartition, pyRepr, pyRpartition } from './pystr.js';

const SCHEME_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-.';

const WHATWG_C0_CONTROL_OR_SPACE = Array.from({ length: 0x21 }, (_, i) => String.fromCharCode(i)).join('');

const UNSAFE_URL_BYTES_TO_REMOVE = ['\t', '\r', '\n'];

const USES_NETLOC = new Set([
  '', 'ftp', 'http', 'gopher', 'nntp', 'telnet', 'imap', 'wais', 'file', 'mms', 'https', 'shttp',
  'snews', 'prospero', 'rtsp', 'rtsps', 'rtspu', 'rsync', 'svn', 'svn+ssh', 'sftp', 'nfs', 'git',
  'git+ssh', 'ws', 'wss', 'itms-services',
]);

export interface SplitResult {
  readonly scheme: string;
  readonly netloc: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;
  /** `.hostname` -- lowercased, userinfo and brackets removed, or null. */
  readonly hostname: string | null;
  /** `.port` -- raises PyValueError exactly where CPython's property does. */
  port(): number | null;
}

function splitnetloc(url: string, start: number): [string, string] {
  let delim = url.length;
  for (const c of '/?#') {
    const at = url.indexOf(c, start);
    if (at >= 0) delim = Math.min(delim, at);
  }
  return [url.slice(start, delim), url.slice(delim)];
}

function checkBracketedHost(hostname: string): void {
  if (hostname.startsWith('v') || hostname.startsWith('V')) {
    if (!/^[vV][a-fA-F0-9]+\..+$/s.test(hostname)) throw new PyValueError('IPvFuture address is invalid');
    return;
  }
  const kind = ipAddressKind(hostname);
  if (kind === null) {
    throw new PyValueError(`${pyRepr(hostname)} does not appear to be an IPv4 or IPv6 address`);
  }
  if (kind === 'ipv4') throw new PyValueError('An IPv4 address cannot be in brackets');
}

function checkBracketedNetloc(netloc: string): void {
  const hostnameAndPort = pyRpartition(netloc, '@')[2];
  const [beforeBracket, haveOpenBr, bracketed] = pyPartition(hostnameAndPort, '[');
  let hostname: string;
  if (haveOpenBr) {
    if (beforeBracket) throw new PyValueError('Invalid IPv6 URL');
    const [host, , rest] = pyPartition(bracketed, ']');
    hostname = host;
    if (rest && !rest.startsWith(':')) throw new PyValueError('Invalid IPv6 URL');
  } else {
    hostname = pyPartition(hostnameAndPort, ':')[0];
  }
  checkBracketedHost(hostname);
}

function checknetloc(netloc: string): void {
  if (!netloc || pyIsAscii(netloc)) return;
  // Catch characters like U+2100 that NFKC-expand into a delimiter.
  let n = netloc.replaceAll('@', '').replaceAll(':', '').replaceAll('#', '').replaceAll('?', '');
  const netloc2 = n.normalize('NFKC');
  if (n === netloc2) return;
  for (const c of '/?#@:') {
    if (netloc2.includes(c)) {
      throw new PyValueError(`netloc '${netloc}' contains invalid characters under NFKC normalization`);
    }
  }
}

/** `netloc` -> `[hostname, port]`, both possibly empty/null. */
function hostinfo(netloc: string): [string, string | null] {
  const hostinfoPart = pyRpartition(netloc, '@')[2];
  const [, haveOpenBr, bracketed] = pyPartition(hostinfoPart, '[');
  let hostname: string;
  let port: string;
  if (haveOpenBr) {
    const [host, , afterBracket] = pyPartition(bracketed, ']');
    hostname = host;
    port = pyPartition(afterBracket, ':')[2];
  } else {
    const [host, , rest] = pyPartition(hostinfoPart, ':');
    hostname = host;
    port = rest;
  }
  return [hostname, port ? port : null];
}

export function urlsplit(url: string, allowFragments = true): SplitResult {
  // Only lstrip: some applications rely on preserving trailing space.
  let rest = pyLstrip(url, WHATWG_C0_CONTROL_OR_SPACE);
  for (const b of UNSAFE_URL_BYTES_TO_REMOVE) rest = rest.replaceAll(b, '');

  let scheme = '';
  let netloc = '';
  let query = '';
  let fragment = '';

  const colon = rest.indexOf(':');
  if (colon > 0 && /^[A-Za-z]$/.test(rest[0] as string)) {
    let ok = true;
    for (const c of rest.slice(0, colon)) {
      if (!SCHEME_CHARS.includes(c)) {
        ok = false;
        break;
      }
    }
    if (ok) {
      scheme = rest.slice(0, colon).toLowerCase();
      rest = rest.slice(colon + 1);
    }
  }

  if (rest.slice(0, 2) === '//') {
    [netloc, rest] = splitnetloc(rest, 2);
    const hasOpen = netloc.includes('[');
    const hasClose = netloc.includes(']');
    if ((hasOpen && !hasClose) || (hasClose && !hasOpen)) throw new PyValueError('Invalid IPv6 URL');
    if (hasOpen && hasClose) checkBracketedNetloc(netloc);
  }

  if (allowFragments && rest.includes('#')) {
    const at = rest.indexOf('#');
    fragment = rest.slice(at + 1);
    rest = rest.slice(0, at);
  }
  if (rest.includes('?')) {
    const at = rest.indexOf('?');
    query = rest.slice(at + 1);
    rest = rest.slice(0, at);
  }
  checknetloc(netloc);

  const [rawHost, rawPort] = hostinfo(netloc);

  return {
    scheme,
    netloc,
    path: rest,
    query,
    fragment,
    get hostname(): string | null {
      if (!rawHost) return null;
      // A scoped IPv6 zone must not be lowercased with the address.
      const [host, percent, zone] = pyPartition(rawHost, '%');
      return pyLower(host) + percent + zone;
    },
    port(): number | null {
      if (rawPort === null) return null;
      // `port.isdigit() and port.isascii()` -- Unicode digits are rejected.
      if (!/^[0-9]+$/.test(rawPort)) {
        throw new PyValueError(`Port could not be cast to integer value as ${pyRepr(rawPort)}`);
      }
      const value = Number(rawPort);
      if (!(value >= 0 && value <= 65535)) throw new PyValueError('Port out of range 0-65535');
      return value;
    },
  };
}

export function urlunsplit(components: [string, string, string, string, string]): string {
  const [scheme, netloc, path, query, fragment] = components;
  let url = path;
  if (netloc) {
    if (url && url.slice(0, 1) !== '/') url = '/' + url;
    url = '//' + netloc + url;
  } else if (url.slice(0, 2) === '//') {
    url = '//' + url;
  } else if (scheme && USES_NETLOC.has(scheme) && (!url || url.slice(0, 1) === '/')) {
    url = '//' + url;
  }
  if (scheme) url = scheme + ':' + url;
  if (query) url = url + '?' + query;
  if (fragment) url = url + '#' + fragment;
  return url;
}
