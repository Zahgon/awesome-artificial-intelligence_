/**
 * Build the differential transcript for `tools/cases.json`.
 *
 * Shared by `tests/parity.test.ts`, which compares it to
 * `tools/expected_transcript.txt` -- the transcript the original Python
 * produced, captured once under `python:3.13-slim` -- and by
 * `tools/equivalence_probe.ts`, which prints it for `make parity` to diff
 * against the live Python.
 *
 * Keeping one builder means the regression test and the live probe cannot
 * drift apart and silently stop covering the same ground.
 *
 * It lives under `tests/` rather than `tools/` because it is test support:
 * it holds no behaviour of its own, and every line it runs belongs to
 * `scripts/`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyException,
  classifyStatus,
  normalizeUrl,
  validateChurn,
  validateText,
} from '../scripts/validate_readme.js';
import {
  GaiError,
  HTTPException,
  PyOSError,
  PyTimeoutError,
  PyValueError,
  SSLError,
  URLError,
} from '../scripts/internal/errors.js';

export interface Cases {
  normalize_url: string[];
  classify_status: number[];
  validate_text: string[];
  validate_churn: [string, string][];
  classify_exception: [string, string, string][];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const toolsDir = path.join(here, '..', 'tools');

export function loadCases(): Cases {
  return JSON.parse(fs.readFileSync(path.join(toolsDir, 'cases.json'), 'utf8')) as Cases;
}

export function loadExpected(): string[] {
  const raw = fs.readFileSync(path.join(toolsDir, 'expected_transcript.txt'), 'utf8');
  return raw.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
}

const REASONS: Record<string, new (message: string) => unknown> = {
  gaierror: GaiError,
  SSLError,
  TimeoutError: PyTimeoutError,
  HTTPException,
  OSError: PyOSError,
};

/** `json.dumps(value, ensure_ascii=False, sort_keys=True)` for these shapes. */
function dumps(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return '[' + value.map(dumps).join(', ') + ']';
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const body = keys
      .map((key) => dumps(key) + ': ' + dumps((value as Record<string, unknown>)[key]))
      .join(', ');
    return '{' + body + '}';
  }
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

export function buildTranscript(cases: Cases): string[] {
  const out: string[] = [];
  const emit = (section: string, key: unknown, value: unknown): void => {
    out.push(section + '\t' + dumps(key) + '\t' + dumps(value));
  };

  for (const url of cases.normalize_url) {
    let result: [string, string];
    try {
      result = ['ok', normalizeUrl(url)];
    } catch (error) {
      if (!(error instanceof PyValueError)) throw error;
      result = ['ValueError', error.pyStr()];
    }
    emit('normalize_url', url, result);
  }

  for (const status of cases.classify_status) {
    const classified = classifyStatus(status, 'https://example.com');
    emit('classify_status', status, classified === null ? null : [classified[0], classified[1]]);
  }

  for (const text of cases.validate_text) {
    const { resources, errors, warnings } = validateText(text);
    emit('validate_text', text, {
      resources: resources.map((r) => [
        r.line,
        r.section,
        r.category,
        r.title,
        r.url,
        r.description,
      ]),
      errors,
      warnings,
    });
  }

  for (const [base, current] of cases.validate_churn) {
    emit('validate_churn', [base, current], validateChurn(base, current));
  }

  for (const [wrapper, reasonName, message] of cases.classify_exception) {
    const Reason = REASONS[reasonName] as new (message: string) => unknown;
    const reason = new Reason(message);
    const error = wrapper === 'URLError' ? new URLError(reason) : reason;
    const classified = classifyException(error, 'https://example.invalid');
    emit('classify_exception', [wrapper, reasonName, message], [classified[0], classified[1]]);
  }

  return out;
}
