/**
 * The differential evidence, frozen as a regression test.
 *
 * `tools/expected_transcript.txt` is what the ORIGINAL Python printed for
 * `tools/cases.json`, captured under `python:3.13-slim` (the interpreter
 * `.python-version` pins). This asserts the port still reproduces it line for
 * line -- so the 134-case parity result survives future edits instead of
 * depending on someone remembering to run `make parity`.
 *
 * `make parity` remains the stronger check: it re-executes the Python rather
 * than trusting a captured file. This is the cheap guard that runs every time.
 */

import { describe, expect, it } from 'vitest';

import { buildTranscript, loadCases, loadExpected } from './transcript.js';

describe('differential parity against the original Python', () => {
  const expected = loadExpected();
  const actual = buildTranscript(loadCases());

  it('reproduces the reference transcript line for line', () => {
    expect(actual).toEqual(expected);
  });

  it('covers every case in cases.json', () => {
    const cases = loadCases();
    const total =
      cases.normalize_url.length +
      cases.classify_status.length +
      cases.validate_text.length +
      cases.validate_churn.length +
      cases.classify_exception.length;
    expect(actual).toHaveLength(total);
    expect(expected).toHaveLength(total);
  });

  // Named separately so a regression names the section it broke rather than
  // dumping a 134-line array diff.
  for (const section of [
    'normalize_url',
    'classify_status',
    'validate_text',
    'validate_churn',
    'classify_exception',
  ]) {
    it('matches the reference for ' + section, () => {
      const mine = actual.filter((line) => line.startsWith(section + '\t'));
      const theirs = expected.filter((line) => line.startsWith(section + '\t'));
      expect(mine.length).toBeGreaterThan(0);
      expect(mine).toEqual(theirs);
    });
  }
});
