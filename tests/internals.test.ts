/**
 * The CPython string forms the validator's own output is built from.
 *
 * `pyRepr` reaches the user through the "invalid URL" message, which embeds a
 * bad port with `{port!r}`; the exception `__str__` forms reach it through
 * `classify_exception`. Each expectation is the value CPython 3.13 printed --
 * captured with `repr()` / `str()` under `python:3.13-slim`, not inferred.
 */

import { describe, expect, it } from 'vitest';

import {
  GaiError,
  HTTPError,
  HTTPException,
  PyOSError,
  PyTimeoutError,
  SSLError,
  URLError,
  pyStrOf,
} from '../scripts/internal/errors.js';
import { pyRepr, pySorted } from '../scripts/internal/pystr.js';

describe('pyRepr -- repr() of a str', () => {
  it.each([
    ['\x01', "'\\x01'"],
    ['\x7f', "'\\x7f'"],
    ['', "'\\x85'"],
    [' ', "'\\u2028'"],
    ['\u{e0001}', "'\\U000e0001'"],
    ['\t\n\r', "'\\t\\n\\r'"],
  ])('escapes %j the way CPython does', (input, expected) => {
    expect(pyRepr(input)).toBe(expected);
  });

  it('leaves a printable non-ASCII character alone', () => {
    expect(pyRepr('ÿ')).toBe("'ÿ'");
  });

  it('switches to double quotes when the text contains a single quote', () => {
    expect(pyRepr("a'b")).toBe('"a\'b"');
  });

  it('keeps single quotes when the text contains a double quote', () => {
    expect(pyRepr('a"b')).toBe('\'a"b\'');
  });

  it('escapes a backslash', () => {
    expect(pyRepr('a\\b')).toBe("'a\\\\b'");
  });
});

describe('URLError.__str__', () => {
  it('wraps the reason in <urlopen error ...>', () => {
    expect(pyStrOf(new URLError(new GaiError('not found')))).toBe('<urlopen error not found>');
  });

  it('renders an SSLError reason as its args tuple', () => {
    expect(pyStrOf(new URLError(new SSLError('bad certificate')))).toBe(
      "<urlopen error ('bad certificate',)>",
    );
  });

  it('renders a plain string reason directly', () => {
    expect(pyStrOf(new URLError('plain'))).toBe('<urlopen error plain>');
  });
});

describe('HTTPError.__str__', () => {
  it.each([
    [410, 'Gone', 'HTTP Error 410: Gone'],
    [404, 'Not Found', 'HTTP Error 404: Not Found'],
  ])('renders %i as the CPython form', (code, msg, expected) => {
    expect(pyStrOf(new HTTPError('http://u/x', code as number, msg as string))).toBe(expected);
  });

  it('is a URLError, so classify_exception still sees an OSError', () => {
    expect(new HTTPError('http://u/x', 500, 'Boom')).toBeInstanceOf(URLError);
  });

  it('carries the status code', () => {
    expect(new HTTPError('http://u/x', 503, 'Busy').code).toBe(503);
  });
});

/**
 * `classify_exception` branches on `isinstance`, so the hierarchy IS the
 * behaviour: a class landing on the wrong side silently regrades a link from
 * error to warning. MIGRATION.md claims these relationships; nothing asserted
 * them until now.
 */
describe('exception hierarchy classify_exception branches on', () => {
  it('keeps the socket and TLS failures as OSErrors', () => {
    expect(new GaiError('x')).toBeInstanceOf(PyOSError);
    expect(new SSLError('x')).toBeInstanceOf(PyOSError);
    expect(new PyTimeoutError('x')).toBeInstanceOf(PyOSError);
    expect(new URLError('x')).toBeInstanceOf(PyOSError);
    expect(new HTTPError('http://u/x', 404, 'm')).toBeInstanceOf(PyOSError);
  });

  it('keeps HTTPException off the OSError branch', () => {
    expect(new HTTPException('x')).not.toBeInstanceOf(PyOSError);
    expect(new HTTPException('x')).not.toBeInstanceOf(URLError);
    expect(new HTTPException('x')).toBeInstanceOf(Error);
  });

  it('makes HTTPError both a URLError and a response', () => {
    const error = new HTTPError('http://u/x', 410, 'Gone', { server: 'test' });
    expect(error).toBeInstanceOf(URLError);
    expect(error.url).toBe('http://u/x');
    expect(error.msg).toBe('Gone');
    expect(error.hdrs).toEqual({ server: 'test' });
  });

  it('preserves the wrapped reason on URLError', () => {
    const reason = new GaiError('not found');
    const error = new URLError(reason);
    expect(error.reason).toBe(reason);
    expect(error.reason).toBeInstanceOf(GaiError);
    expect(pyStrOf(error.reason)).toBe('not found');
  });
});

/**
 * `check_links` returns `sorted(errors), sorted(warnings)`. Python orders by
 * codepoint; JavaScript's default sort orders by UTF-16 code unit, which puts
 * an astral character before U+FFFF instead of after.
 */
describe('pySorted -- codepoint order, not UTF-16 order', () => {
  it('orders an astral character after U+FFFF, unlike the default sort', () => {
    const items = ['\u{1f600}', '￿', 'a'];
    expect(pySorted(items)).toEqual(['a', '￿', '\u{1f600}']);
    expect([...items].sort()).not.toEqual(pySorted(items));
  });

  it('leaves an already-ordered ASCII list alone and does not mutate its input', () => {
    const items = ['a', 'b', 'c'];
    expect(pySorted(items)).toEqual(['a', 'b', 'c']);
    expect(pySorted(['c', 'a', 'b'])).toEqual(['a', 'b', 'c']);
    expect(items).toEqual(['a', 'b', 'c']);
  });
});
