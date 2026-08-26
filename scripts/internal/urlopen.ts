/**
 * A `urllib.request.urlopen` work-alike over node:http / node:https.
 *
 * `fetch()` is not used. It follows redirects on its own terms, retries, keeps
 * connections alive, decompresses, and reports every failure as one opaque
 * TypeError -- which would collapse the four branches `classify_exception`
 * distinguishes into a single "unreachable link". This reproduces the pieces
 * `check_link` actually depends on:
 *
 *   - non-2xx becomes an HTTPError rather than a returned response
 *   - redirects are followed for 301/302/303/307/308, with CPython's limits
 *   - a redirected HEAD continues as a GET, because CPython's
 *     HTTPRedirectHandler.redirect_request builds a Request with no method
 *   - socket errors surface as URLError wrapping gaierror / SSLError /
 *     TimeoutError, which is what the classifier branches on
 */

import http from 'node:http';
import https from 'node:https';
import { URL as NodeURL } from 'node:url';

import {
  GaiError,
  HTTPError,
  PyTimeoutError,
  SSLError,
  URLError,
} from './errors.js';

const MAX_REPEATS = 4;
const MAX_REDIRECTIONS = 10;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_REDIRECT_SCHEMES = new Set(['http:', 'https:', 'ftp:', '']);

/** Content headers CPython drops when rebuilding a redirected request. */
const CONTENT_HEADERS = new Set(['content-length', 'content-type']);

export interface Response {
  readonly status: number;
  readonly url: string;
  readonly headers: Record<string, string>;
}

export interface RequestSpec {
  url: string;
  method: 'HEAD' | 'GET';
  headers: Record<string, string>;
}

/** Map a Node socket/TLS error onto the CPython exception `check_link` expects. */
function toPythonError(err: NodeJS.ErrnoException): URLError | PyTimeoutError {
  const code = err.code ?? '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_NODATA') {
    return new URLError(new GaiError(err.message));
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return new URLError(new PyTimeoutError('timed out'));
  }
  if (code.startsWith('ERR_TLS') || code.startsWith('CERT_') || code === 'EPROTO' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'SELF_SIGNED_CERT_IN_CHAIN') {
    return new URLError(new SSLError(err.message));
  }
  return new URLError(err.message);
}

function performOnce(spec: RequestSpec, timeoutMs: number): Promise<{ res: http.IncomingMessage; url: string }> {
  return new Promise((resolve, reject) => {
    let parsed: NodeURL;
    try {
      parsed = new NodeURL(spec.url);
    } catch {
      reject(new URLError(`unknown url type: ${spec.url}`));
      return;
    }
    const transport = parsed.protocol === 'https:' ? https : http;
    const request = transport.request(
      parsed,
      {
        method: spec.method,
        headers: spec.headers,
        // urllib opens a fresh connection per request and closes it.
        agent: new transport.Agent({ keepAlive: false }),
      },
      (res) => {
        resolve({ res, url: spec.url });
      },
    );

    // urlopen(timeout=...) is a per-socket-operation timeout, not a deadline.
    request.setTimeout(timeoutMs, () => {
      request.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }));
    });
    request.on('error', (err: NodeJS.ErrnoException) => reject(toPythonError(err)));
    request.end();
  });
}

function headerRecord(res: http.IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(res.headers)) {
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

/**
 * `urllib.request.urlopen(request, timeout=...)`.
 *
 * Resolves with a 2xx response, or rejects with HTTPError / URLError.
 */
export async function urlopen(spec: RequestSpec, timeoutSeconds: number): Promise<Response> {
  const timeoutMs = timeoutSeconds * 1000;
  let current: RequestSpec = { ...spec, headers: { ...spec.headers } };
  const visited = new Map<string, number>();

  for (;;) {
    const { res, url } = await performOnce(current, timeoutMs);
    const status = res.statusCode ?? 0;
    const reason = res.statusMessage ?? '';
    const headers = headerRecord(res);
    // Nothing here reads a body; drain so the socket can close.
    res.resume();

    if (status >= 200 && status < 300) return { status, url, headers };

    if (REDIRECT_CODES.has(status)) {
      const location = headers['location'] ?? headers['uri'];
      if (location === undefined) throw new HTTPError(url, status, reason, headers);

      let target: NodeURL;
      try {
        target = new NodeURL(location, url);
      } catch {
        throw new HTTPError(url, status, reason, headers);
      }
      if (!ALLOWED_REDIRECT_SCHEMES.has(target.protocol)) {
        throw new HTTPError(url, status, `Redirection to url '${target.href}' is not allowed`, headers);
      }

      const newUrl = target.href;
      const seen = visited.get(newUrl) ?? 0;
      if (seen >= MAX_REPEATS || visited.size >= MAX_REDIRECTIONS) {
        throw new HTTPError(
          url,
          status,
          'The HTTP server returned a redirect error that would lead to an infinite loop.\n' +
            `The last 30x error message was:\n${reason}`,
          headers,
        );
      }
      visited.set(newUrl, seen + 1);

      const nextHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(current.headers)) {
        if (!CONTENT_HEADERS.has(key.toLowerCase())) nextHeaders[key] = value;
      }
      // redirect_request() constructs a Request without a method, and
      // Request.get_method() defaults to GET when there is no body -- so a
      // redirected HEAD continues as a GET. This is load-bearing: some hosts
      // 301 a HEAD and then answer the GET with a different status.
      current = { url: newUrl, method: 'GET', headers: nextHeaders };
      continue;
    }

    throw new HTTPError(url, status, reason, headers);
  }
}
