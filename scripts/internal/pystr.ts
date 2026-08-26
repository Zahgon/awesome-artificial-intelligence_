/**
 * CPython `str` semantics that JavaScript does not share.
 *
 * Every function here exists because the obvious JavaScript equivalent gives a
 * different answer on inputs `validate_readme` can actually receive. They are
 * kept in one place so the port of the script itself reads like the Python.
 */

import {
  CASEFOLD_EXTRA,
  CASEFOLD_RUNS,
  LOWER_EXTRA,
  LOWER_RUNS,
  NONPRINTABLE_RANGES,
} from './casedata.js';

/**
 * Codepoints `str.splitlines()` treats as line boundaries.
 *
 * `text.split('\n')` sees one of these. CPython sees ten, so a README with a
 * form feed or a NEL in it is numbered differently by the two implementations.
 */
const LINE_BOUNDARIES = new Set([
  0x0a, // \n  LINE FEED
  0x0b, // \v  LINE TABULATION
  0x0c, // \f  FORM FEED
  0x0d, // \r  CARRIAGE RETURN
  0x1c, //     FILE SEPARATOR
  0x1d, //     GROUP SEPARATOR
  0x1e, //     RECORD SEPARATOR
  0x85, //     NEXT LINE
  0x2028, //   LINE SEPARATOR
  0x2029, //   PARAGRAPH SEPARATOR
]);

/**
 * Codepoints `str.strip()` removes, i.e. those where `str.isspace()` is true.
 *
 * Differs from `String.prototype.trim()` at both ends: CPython strips
 * U+001C..U+001F and U+0085 and does not strip U+FEFF.
 */
const PY_SPACE = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001,
  0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f,
  0x205f, 0x3000,
]);

/** The character class CPython's `re` module means by `\s` in a str pattern. */
export const RE_SPACE_CLASS =
  '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';

/** `str.splitlines()`. */
export function pySplitlines(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (LINE_BOUNDARIES.has(code)) {
      lines.push(text.slice(start, i));
      // \r\n is a single boundary, not two.
      i += code === 0x0d && text.charCodeAt(i + 1) === 0x0a ? 2 : 1;
      start = i;
    } else {
      i += 1;
    }
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

/** `str.strip()` with no argument. */
export function pyStrip(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && PY_SPACE.has(text.charCodeAt(start))) start += 1;
  while (end > start && PY_SPACE.has(text.charCodeAt(end - 1))) end -= 1;
  return text.slice(start, end);
}

/** `str.lstrip(chars)`. */
export function pyLstrip(text: string, chars: string): string {
  const set = new Set([...chars]);
  let start = 0;
  while (start < text.length && set.has(text[start] as string)) start += 1;
  return text.slice(start);
}

/** `str.rstrip(chars)`. */
export function pyRstrip(text: string, chars: string): string {
  const set = new Set([...chars]);
  let end = text.length;
  while (end > 0 && set.has(text[end - 1] as string)) end -= 1;
  return text.slice(0, end);
}

/** Look a codepoint up in a generated run table; return null when unmapped. */
function mapCodepoint(cp: number, runs: readonly number[], extra: Readonly<Record<number, string>>): string | null {
  const direct = extra[cp];
  if (direct !== undefined) return direct;
  let lo = 0;
  let hi = runs.length / 3 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const start = runs[mid * 3] as number;
    const end = runs[mid * 3 + 1] as number;
    if (cp < start) hi = mid - 1;
    else if (cp > end) lo = mid + 1;
    else return String.fromCodePoint(cp + (runs[mid * 3 + 2] as number));
  }
  return null;
}

function translate(text: string, runs: readonly number[], extra: Readonly<Record<number, string>>): string {
  let out = '';
  for (const ch of text) {
    const mapped = mapCodepoint(ch.codePointAt(0) as number, runs, extra);
    out += mapped ?? ch;
  }
  return out;
}

/**
 * `str.casefold()`.
 *
 * There is no JavaScript equivalent. `toLowerCase()` leaves U+00DF and the
 * Greek final sigma alone where casefold rewrites them, so using it would let
 * "Straße" and "STRASSE" occupy two entries in the duplicate-title map.
 */
export function pyCasefold(text: string): string {
  return translate(text, CASEFOLD_RUNS, CASEFOLD_EXTRA);
}

/** `str.lower()`, pinned to the interpreter's Unicode version rather than Node's ICU. */
export function pyLower(text: string): string {
  return translate(text, LOWER_RUNS, LOWER_EXTRA);
}

/** `str.isprintable()` for a single codepoint. */
function isPrintable(cp: number): boolean {
  let lo = 0;
  let hi = NONPRINTABLE_RANGES.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const start = NONPRINTABLE_RANGES[mid * 2] as number;
    const end = NONPRINTABLE_RANGES[mid * 2 + 1] as number;
    if (cp < start) hi = mid - 1;
    else if (cp > end) lo = mid + 1;
    else return false;
  }
  return true;
}

const HEX = (cp: number, width: number): string => cp.toString(16).padStart(width, '0');

/**
 * `repr()` of a str.
 *
 * Reachable from user-facing output: the port-parsing failure formats the
 * offending port with `{port!r}`, and that message is embedded verbatim in the
 * "invalid URL" error the validator prints.
 */
export function pyRepr(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (ch === quote || ch === '\\') out += '\\' + ch;
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (cp < 0x20 || cp === 0x7f) out += '\\x' + HEX(cp, 2);
    else if (cp < 0x7f) out += ch;
    else if (isPrintable(cp)) out += ch;
    else if (cp < 0x100) out += '\\x' + HEX(cp, 2);
    else if (cp < 0x10000) out += '\\u' + HEX(cp, 4);
    else out += '\\U' + HEX(cp, 8);
  }
  return out + quote;
}

/**
 * Compare two strings the way Python's `<` does: by codepoint.
 *
 * JavaScript's default sort compares UTF-16 code units, which orders U+FFFF
 * after any astral character. Python orders it before.
 */
export function pyCompare(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i += 1) {
    const x = (left[i] as string).codePointAt(0) as number;
    const y = (right[i] as string).codePointAt(0) as number;
    if (x !== y) return x < y ? -1 : 1;
  }
  return left.length - right.length;
}

/** `sorted()` over a list of strings. */
export function pySorted(items: readonly string[]): string[] {
  return [...items].sort(pyCompare);
}

/** `str.isascii()`. */
export function pyIsAscii(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) > 0x7f) return false;
  return true;
}

/** `left, sep, right = text.partition(sep)`. */
export function pyPartition(text: string, sep: string): [string, string, string] {
  const at = text.indexOf(sep);
  if (at < 0) return [text, '', ''];
  return [text.slice(0, at), sep, text.slice(at + sep.length)];
}

/** `left, sep, right = text.rpartition(sep)`. */
export function pyRpartition(text: string, sep: string): [string, string, string] {
  const at = text.lastIndexOf(sep);
  if (at < 0) return ['', '', text];
  return [text.slice(0, at), sep, text.slice(at + sep.length)];
}
