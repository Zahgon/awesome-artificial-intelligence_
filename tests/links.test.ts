/**
 * The link-checking path, driven against a loopback HTTP server.
 *
 * `check_link` / `check_links` were untested upstream and stayed untested in
 * the port, which left `urlopen.ts` -- the largest single piece of ported
 * standard library -- at 6% coverage. No network is used: the server below
 * binds 127.0.0.1 on an ephemeral port, so this runs in the offline container
 * the Dockerfile builds.
 *
 * The behaviour asserted is CPython's, as `check_link` depends on it: HEAD
 * first, GET only when HEAD is answered 405 or 501, non-2xx raised rather than
 * returned, and socket failures surfaced as the exception type
 * `classify_exception` branches on.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { checkLink, checkLinks, type Resource } from '../scripts/validate_readme.js';
import { HTTPError, PyOSError, URLError } from '../scripts/internal/errors.js';
import { urlopen } from '../scripts/internal/urlopen.js';

/** Every request the server saw, so HEAD-then-GET can be asserted. */
let seen: { method: string; url: string; agent: string }[] = [];
let base = '';
let server: http.Server;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({
      method: req.method ?? '',
      url: req.url ?? '',
      agent: String(req.headers['user-agent'] ?? ''),
    });
    const path = (req.url ?? '/').split('?')[0] as string;

    if (path === '/ok') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('ok');
      return;
    }
    if (path === '/head-not-allowed') {
      // HEAD is refused; CPython retries the same URL with GET.
      if (req.method === 'HEAD') {
        res.writeHead(405);
        res.end();
        return;
      }
      res.writeHead(200);
      res.end('via get');
      return;
    }
    if (path === '/head-not-implemented') {
      if (req.method === 'HEAD') {
        res.writeHead(501);
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
      return;
    }
    if (path === '/redirect') {
      res.writeHead(302, { location: '/ok' });
      res.end();
      return;
    }
    if (path === '/gone') {
      res.writeHead(410);
      res.end();
      return;
    }
    if (path === '/blocked') {
      res.writeHead(403);
      res.end();
      return;
    }
    if (path === '/boom') {
      res.writeHead(503);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + String((server.address() as AddressInfo).port);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const resource = (url: string): Resource => ({
  line: 1,
  section: 'Learn',
  category: 'Books',
  title: 'T',
  url,
  description: 'D.',
});

describe('urlopen', () => {
  it('returns the status and the final URL for a 200', async () => {
    const response = await urlopen({ url: base + '/ok', method: 'HEAD', headers: {} }, 15);
    expect(response.status).toBe(200);
    expect(response.url).toBe(base + '/ok');
  });

  it('exposes response headers as a lower-cased record', async () => {
    const response = await urlopen({ url: base + '/ok', method: 'GET', headers: {} }, 15);
    expect(response.headers['content-type']).toContain('text/html');
  });

  it('raises HTTPError rather than returning a non-2xx response', async () => {
    await expect(
      urlopen({ url: base + '/gone', method: 'HEAD', headers: {} }, 15),
    ).rejects.toBeInstanceOf(HTTPError);
  });

  it('carries the status code on the HTTPError', async () => {
    await urlopen({ url: base + '/gone', method: 'HEAD', headers: {} }, 15).catch((error) => {
      expect((error as HTTPError).code).toBe(410);
    });
  });

  it('follows a redirect and reports the destination', async () => {
    const response = await urlopen({ url: base + '/redirect', method: 'GET', headers: {} }, 15);
    expect(response.status).toBe(200);
    expect(response.url).toBe(base + '/ok');
  });

  it('surfaces an unresolvable host as a URLError, not a bare TypeError', async () => {
    const error = await urlopen(
      { url: 'http://qc.invalid.invalid/x', method: 'HEAD', headers: {} },
      15,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(URLError);
    expect(error).toBeInstanceOf(PyOSError);
  });

  // MIGRATION.md asserts this as a deliberate CPython fidelity point:
  // HTTPRedirectHandler.redirect_request builds a Request with no method, and
  // get_method() defaults to GET -- so a redirected HEAD continues as a GET.
  // Hosts that 301 a HEAD and answer the GET differently are graded on the
  // second answer. Nothing tested it until now.
  it('continues a redirected HEAD as a GET', async () => {
    seen = [];
    const response = await urlopen({ url: base + '/redirect', method: 'HEAD', headers: {} }, 15);
    expect(response.status).toBe(200);
    expect(seen).toHaveLength(2);
    expect(seen[0]?.method).toBe('HEAD');
    expect(seen[0]?.url).toBe('/redirect');
    expect(seen[1]?.method).toBe('GET');
    expect(seen[1]?.url).toBe('/ok');
  });

  it('carries the validator User-Agent on the redirected request too', async () => {
    seen = [];
    await checkLink(resource(base + '/redirect'));
    expect(seen).toHaveLength(2);
    expect(seen[0]?.agent).toBe('awesome-ai-resource-validator/1.0');
    expect(seen[1]?.agent).toBe('awesome-ai-resource-validator/1.0');
  });
});

describe('checkLink', () => {
  it('returns null for a reachable link', async () => {
    expect(await checkLink(resource(base + '/ok'))).toBeNull();
  });

  it('classifies 410 as an error', async () => {
    expect(await checkLink(resource(base + '/gone'))).toEqual([
      'error',
      'broken link (410): ' + base + '/gone',
    ]);
  });

  it('classifies 403 as a warning', async () => {
    expect(await checkLink(resource(base + '/blocked'))).toEqual([
      'warning',
      'link check blocked (403): ' + base + '/blocked',
    ]);
  });

  it('classifies a 5xx as a warning', async () => {
    expect(await checkLink(resource(base + '/boom'))).toEqual([
      'warning',
      'remote server error (503): ' + base + '/boom',
    ]);
  });

  it('sends the CPython User-Agent on the HEAD it issues', async () => {
    seen = [];
    await checkLink(resource(base + '/ok'));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.method).toBe('HEAD');
    expect(seen[0]?.url).toBe('/ok');
    expect(seen[0]?.agent).toBe('awesome-ai-resource-validator/1.0');
  });

  it('retries with GET when HEAD is answered 405', async () => {
    seen = [];
    expect(await checkLink(resource(base + '/head-not-allowed'))).toBeNull();
    expect(seen.map((r) => r.method)).toEqual(['HEAD', 'GET']);
    expect(seen.map((r) => r.url)).toEqual(['/head-not-allowed', '/head-not-allowed']);
    expect(seen[1]?.agent).toBe('awesome-ai-resource-validator/1.0');
  });

  it('retries with GET when HEAD is answered 501, and reports the GET status', async () => {
    seen = [];
    expect(await checkLink(resource(base + '/head-not-implemented'))).toEqual([
      'error',
      'broken link (404): ' + base + '/head-not-implemented',
    ]);
    expect(seen.map((r) => r.method)).toEqual(['HEAD', 'GET']);
  });

  it('does not retry a status that is not 405 or 501', async () => {
    seen = [];
    await checkLink(resource(base + '/gone'));
    expect(seen.map((r) => r.method)).toEqual(['HEAD']);
  });

  it('reports an unreachable host as an error', async () => {
    const result = await checkLink(resource('http://qc.invalid.invalid/x'));
    expect(result?.[0]).toBe('error');
    expect(result?.[1]).toContain('unreachable link');
  });
});

describe('checkLinks', () => {
  it('returns errors and warnings sorted, in separate buckets', async () => {
    const [errors, warnings] = await checkLinks([
      resource(base + '/gone'),
      resource(base + '/blocked'),
      resource(base + '/ok'),
      resource(base + '/boom'),
    ]);
    expect(errors).toEqual(['broken link (410): ' + base + '/gone']);
    expect(warnings).toEqual([
      'link check blocked (403): ' + base + '/blocked',
      'remote server error (503): ' + base + '/boom',
    ]);
  });

  it('sorts rather than preserving input order', async () => {
    const [, warnings] = await checkLinks([
      resource(base + '/boom'),
      resource(base + '/blocked'),
    ]);
    expect(warnings).toEqual([...warnings].sort());
  });

  it('returns two empty buckets for an empty list', async () => {
    expect(await checkLinks([])).toEqual([[], []]);
  });

  it('drops reachable links from both buckets', async () => {
    expect(await checkLinks([resource(base + '/ok'), resource(base + '/ok')])).toEqual([[], []]);
  });

  it('handles more resources than the worker bound', async () => {
    // The pool is 8 wide; 20 resources exercises the queueing path.
    const many = Array.from({ length: 20 }, () => resource(base + '/gone'));
    const [errors] = await checkLinks(many);
    expect(errors).toHaveLength(20);
  });
});
