/**
 * Port of tests/test_validate_readme.py.
 *
 * One `it` per Python `test_*` method, in source order, with the same fixture
 * strings and the same assertions. `assertIn` becomes `toContain`,
 * `assertTrue(any(...))` becomes `toBe(true)` over the same comprehension, so a
 * failure here fails for the same reason it would have failed in Python.
 */

import { describe, expect, it } from 'vitest';

import {
  classifyException,
  classifyStatus,
  normalizeUrl,
  validateChurn,
  validateText,
} from '../scripts/validate_readme.js';
import { GaiError, PyTimeoutError, SSLError, URLError } from '../scripts/internal/errors.js';

const VALID = `# List

### Books

- [A Book](https://example.com/book): A useful book.
`;

describe('ValidateReadmeTests', () => {
  it('test_valid_resource', () => {
    const { resources, errors, warnings } = validateText(VALID);
    expect(resources.length).toBe(1);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('test_malformed_resource', () => {
    const { errors } = validateText('### Books\n\n- [A Book](http://example.com): No TLS.\n');
    expect(errors[0]).toContain('malformed resource entry');
  });

  it('test_duplicate_title_and_normalized_url', () => {
    const text = `### Books

- [A Book](https://EXAMPLE.com/book/): First entry.
- [a book](https://example.com/book#section): Second entry.
`;
    const { errors } = validateText(text);
    expect(errors.some((error) => error.includes('duplicate title'))).toBe(true);
    expect(errors.some((error) => error.includes('duplicate URL'))).toBe(true);
  });

  it('test_empty_category', () => {
    const { errors } = validateText('### Books\n\nSome prose.\n');
    expect(errors[0]).toContain("category 'Books' has no resources");
  });

  it('test_level_two_heading_resets_category', () => {
    const text = VALID + '\n## Contributing\n\n- [A Tool](https://example.com/tool): A tool.\n';
    const { errors } = validateText(text);
    expect(errors.some((error) => error.includes('outside a level-three category'))).toBe(true);
  });

  it('test_same_category_name_in_different_sections', () => {
    const text = `## First

### Tools

## Second

### Tools

- [A Tool](https://example.com/tool): A tool.
`;
    const { errors } = validateText(text);
    expect(errors.some((error) => error.includes("section 'First'"))).toBe(true);
  });

  it('test_description_needs_period', () => {
    const { errors } = validateText(
      '### Books\n\n- [A Book](https://example.com/book): Missing punctuation\n',
    );
    expect(errors[0]).toContain('description must end with a period');
  });

  it('test_normalize_url', () => {
    expect(normalizeUrl('HTTPS://EXAMPLE.COM:443/path/?q=1#fragment')).toBe('https://example.com/path?q=1');
  });

  it('test_invalid_url_is_an_error', () => {
    const { errors } = validateText(
      '### Books\n\n- [A Book](https://example.com:bad/book): Invalid port.\n',
    );
    expect(errors[0]).toContain('invalid URL');
  });

  it('test_link_status_classification', () => {
    expect(classifyStatus(404, 'https://example.com')?.[0]).toBe('error');
    expect(classifyStatus(400, 'https://example.com')?.[0]).toBe('error');
    expect(classifyStatus(451, 'https://example.com')?.[0]).toBe('error');
    expect(classifyStatus(403, 'https://example.com')?.[0]).toBe('warning');
    expect(classifyStatus(408, 'https://example.com')?.[0]).toBe('warning');
    expect(classifyStatus(503, 'https://example.com')?.[0]).toBe('warning');
    expect(classifyStatus(200, 'https://example.com')).toBeNull();
  });

  it('test_link_exception_classification', () => {
    const url = 'https://example.invalid';
    const dnsError = new URLError(new GaiError('not found'));
    const tlsError = new URLError(new SSLError('bad certificate'));
    const timeout = new URLError(new PyTimeoutError('timed out'));
    expect(classifyException(dnsError, url)[0]).toBe('error');
    expect(classifyException(tlsError, url)[0]).toBe('error');
    expect(classifyException(timeout, url)[0]).toBe('warning');
  });

  it('test_churn_limits', () => {
    let base = '## Learn\n\n### Books\n\n- [Book](https://example.com/book): A book.\n\n';
    base += '## Build\n\n### Tools\n\n';
    base += Array.from(
      { length: 6 },
      (_, index) => '- [Tool ' + index + '](https://example.com/' + index + '): A tool.',
    ).join('\n');

    // str.replace(old, new, 6) -- bounded to six replacements, like the Python.
    const acceptable = replaceCount(base, 'A tool.', 'A better tool.', 6);
    expect(validateChurn(base, acceptable)).toEqual([]);

    const tooMany = acceptable + '\n- [Tool 7](https://example.com/7): A tool.\n';
    expect(validateChurn(base, tooMany).some((error) => error.includes('resource entries'))).toBe(true);

    const fourAdditions =
      base +
      '\n' +
      Array.from(
        { length: 4 },
        (_, index) => '- [New ' + index + '](https://example.com/new-' + index + '): A tool.',
      ).join('\n');
    expect(validateChurn(base, fourAdditions).some((error) => error.includes('net entries'))).toBe(true);

    let twoFoundations = base.replaceAll('A book.', 'A revised book.');
    twoFoundations = twoFoundations.replaceAll(
      '\n## Build',
      '\n- [Second Book](https://example.com/book-2): A book.\n\n## Build',
    );
    expect(
      validateChurn(base, twoFoundations).some((error) => error.includes('foundational entries')),
    ).toBe(true);

    let movedToFoundations = base.replaceAll('A book.', 'A revised book.');
    movedToFoundations = movedToFoundations.replaceAll(
      '\n## Build\n\n### Tools\n\n- [Tool 0](https://example.com/0): A tool.',
      '\n- [Tool 0](https://example.com/0): A tool.\n\n## Build\n\n### Tools',
    );
    expect(
      validateChurn(base, movedToFoundations).some((error) => error.includes('foundational entries')),
    ).toBe(true);
  });
});

/** `str.replace(old, new, count)` -- JavaScript has no count argument. */
function replaceCount(text: string, from: string, to: string, count: number): string {
  let out = '';
  let rest = text;
  for (let done = 0; done < count; done += 1) {
    const at = rest.indexOf(from);
    if (at < 0) break;
    out += rest.slice(0, at) + to;
    rest = rest.slice(at + from.length);
  }
  return out + rest;
}
