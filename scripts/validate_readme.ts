#!/usr/bin/env node
/** Validate the structure and links in the curated README. */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { ArgumentExit, parseArgs } from './internal/argparse.js';
import {
  GaiError,
  HTTPError,
  HTTPException,
  PyOSError,
  PyTimeoutError,
  PyValueError,
  SSLError,
  URLError,
  pyStrOf,
} from './internal/errors.js';
import {
  RE_SPACE_CLASS,
  pyCasefold,
  pyLower,
  pyRstrip,
  pySorted,
  pySplitlines,
  pyStrip,
} from './internal/pystr.js';
import { urlopen } from './internal/urlopen.js';
import { urlsplit, urlunsplit } from './internal/urlsplit.js';

// `[^)\s]` and `.` use CPython's classes, not JavaScript's: Python's \s covers
// U+001C..U+001F and U+0085 but not U+FEFF, and Python's `.` excludes only \n.
const RESOURCE_RE = new RegExp('^- \\[([^\\]]+)]\\((https://[^)' + RE_SPACE_CLASS + ']+)\\): ([^\\n]+)$');
const LINK_RE = /^- \[/;
const USER_AGENT = 'awesome-ai-resource-validator/1.0';

/** `@dataclass(frozen=True) class Resource`. */
export interface Resource {
  readonly line: number;
  readonly section: string;
  readonly category: string;
  readonly title: string;
  readonly url: string;
  readonly description: string;
}

export type Severity = 'error' | 'warning';
export type Classification = readonly [Severity, string] | null;

export function normalizeUrl(url: string): string {
  const parts = urlsplit(url);
  let hostname = pyLower(parts.hostname ?? '');
  const port = parts.port();
  if (port && !(parts.scheme.toLowerCase() === 'https' && port === 443)) {
    hostname = hostname + ':' + port;
  }
  const urlPath = pyRstrip(parts.path, '/') || '/';
  return urlunsplit([parts.scheme.toLowerCase(), hostname, urlPath, parts.query, '']);
}

export interface ValidationResult {
  resources: Resource[];
  errors: string[];
  warnings: string[];
}

/** Composite dict key for `(section, category)`; JSON keeps it injective. */
const categoryKey = (section: string, category: string): string => JSON.stringify([section, category]);

export function validateText(text: string): ValidationResult {
  const resources: Resource[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  let section = '';
  let category = '';
  const categoryLines = new Map<string, number>();
  const categoryCounts = new Map<string, number>();

  const lines = pySplitlines(text);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    const lineNumber = index + 1;

    if (line.startsWith('## ')) {
      section = pyStrip(line.slice(3));
      category = '';
      continue;
    }
    if (line.startsWith('### ')) {
      category = pyStrip(line.slice(4));
      const key = categoryKey(section, category);
      categoryLines.set(key, lineNumber);
      categoryCounts.set(key, 0);
      continue;
    }
    if (!LINK_RE.test(line)) continue;

    const match = RESOURCE_RE.exec(line);
    if (!match) {
      errors.push('line ' + lineNumber + ': malformed resource entry');
      continue;
    }
    if (!category) {
      errors.push('line ' + lineNumber + ': resource is outside a level-three category');
      continue;
    }
    const title = match[1] as string;
    const url = match[2] as string;
    const description = match[3] as string;
    if (!description.endsWith('.')) {
      errors.push('line ' + lineNumber + ': description must end with a period');
    }
    resources.push({
      line: lineNumber,
      section,
      category,
      title: pyStrip(title),
      url,
      description: pyStrip(description),
    });
    const key = categoryKey(section, category);
    categoryCounts.set(key, (categoryCounts.get(key) as number) + 1);
  }

  for (const [key, count] of categoryCounts) {
    if (count === 0) {
      const parsed = JSON.parse(key) as [string, string];
      const sectionName = parsed[0];
      const categoryName = parsed[1];
      const location = sectionName ? " in section '" + sectionName + "'" : '';
      errors.push(
        'line ' + categoryLines.get(key) + ": category '" + categoryName + "'" + location + ' ' +
          'has no resources',
      );
    }
  }

  const seenTitles = new Map<string, Resource>();
  const seenUrls = new Map<string, Resource>();
  for (const resource of resources) {
    const titleKey = pyCasefold(resource.title);
    const priorTitle = seenTitles.get(titleKey);
    if (priorTitle !== undefined) {
      errors.push(
        'line ' + resource.line + ": duplicate title '" + resource.title + "' " +
          '(first used on line ' + priorTitle.line + ')',
      );
    } else {
      seenTitles.set(titleKey, resource);
    }

    let urlKey: string;
    try {
      urlKey = normalizeUrl(resource.url);
    } catch (error) {
      if (!(error instanceof PyValueError)) throw error;
      errors.push(
        'line ' + resource.line + ": invalid URL '" + resource.url + "' (" + error.pyStr() + ')',
      );
      continue;
    }
    const priorUrl = seenUrls.get(urlKey);
    if (priorUrl !== undefined) {
      errors.push(
        'line ' + resource.line + ": duplicate URL '" + resource.url + "' " +
          '(first used on line ' + priorUrl.line + ')',
      );
    } else {
      seenUrls.set(urlKey, resource);
    }
  }

  return { resources, errors, warnings };
}

export function classifyStatus(status: number, url: string): Classification {
  if (status === 404 || status === 410) return ['error', 'broken link (' + status + '): ' + url];
  if (status === 401 || status === 403 || status === 429) {
    return ['warning', 'link check blocked (' + status + '): ' + url];
  }
  if (status === 408) return ['warning', 'link check timed out (' + status + '): ' + url];
  if (status >= 500) return ['warning', 'remote server error (' + status + '): ' + url];
  if (status >= 400) return ['error', 'broken link (' + status + '): ' + url];
  return null;
}

export function classifyException(error: unknown, url: string): readonly [Severity, string] {
  const reason = error instanceof URLError ? error.reason : error;
  const shown = pyStrOf(reason);
  if (reason instanceof PyTimeoutError) return ['warning', 'link check timed out: ' + url + ' (' + shown + ')'];
  if (reason instanceof SSLError || reason instanceof GaiError) {
    return ['error', 'unreachable link: ' + url + ' (' + shown + ')'];
  }
  if (reason instanceof HTTPException) return ['warning', 'link check interrupted: ' + url + ' (' + shown + ')'];
  return ['error', 'unreachable link: ' + url + ' (' + shown + ')'];
}

export async function checkLink(resource: Resource): Promise<Classification> {
  const headers = { 'User-Agent': USER_AGENT };

  try {
    const response = await urlopen({ url: resource.url, method: 'HEAD', headers }, 15);
    return classifyStatus(response.status, resource.url);
  } catch (error) {
    if (error instanceof HTTPError) {
      // 405/501 mean "HEAD unsupported here"; fall through and retry with GET.
      if (error.code !== 405 && error.code !== 501) {
        return classifyStatus(error.code, resource.url);
      }
    } else if (error instanceof PyOSError || error instanceof HTTPException) {
      return classifyException(error, resource.url);
    } else {
      throw error;
    }
  }

  try {
    const response = await urlopen({ url: resource.url, method: 'GET', headers }, 15);
    return classifyStatus(response.status, resource.url);
  } catch (error) {
    if (error instanceof HTTPError) return classifyStatus(error.code, resource.url);
    if (error instanceof PyOSError || error instanceof HTTPException) {
      return classifyException(error, resource.url);
    }
    throw error;
  }
}

/** `ThreadPoolExecutor(max_workers=n).map(fn, items)` -- bounded, order-preserving. */
async function mapWithWorkers<T, R>(
  items: readonly T[],
  workers: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const run = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, run));
  return results;
}

export async function checkLinks(resources: readonly Resource[]): Promise<[string[], string[]]> {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const result of await mapWithWorkers(resources, 8, checkLink)) {
    if (result === null) continue;
    const severity = result[0];
    const message = result[1];
    (severity === 'error' ? errors : warnings).push(message);
  }
  return [pySorted(errors), pySorted(warnings)];
}

export function validateChurn(baseText: string, currentText: string): string[] {
  const baseResult = validateText(baseText);
  const currentResult = validateText(currentText);
  if (baseResult.errors.length > 0 || currentResult.errors.length > 0) {
    return ['cannot calculate churn until both README versions are structurally valid'];
  }

  const resourceMap = (resources: readonly Resource[]): Map<string, Resource> => {
    const out = new Map<string, Resource>();
    // Later entries win, exactly as the Python dict comprehension does.
    for (const resource of resources) out.set(pyCasefold(resource.title), resource);
    return out;
  };

  const base = resourceMap(baseResult.resources);
  const current = resourceMap(currentResult.resources);

  const signature = (resource: Resource | undefined): string | null =>
    resource === undefined
      ? null
      : JSON.stringify([resource.section, resource.category, resource.url, resource.description]);

  const changedTitles = new Set<string>();
  for (const title of new Set([...base.keys(), ...current.keys()])) {
    if (signature(base.get(title)) !== signature(current.get(title))) changedTitles.add(title);
  }

  let foundationalChanges = 0;
  for (const title of changedTitles) {
    const candidates = [base.get(title), current.get(title)];
    const touchesLearn = candidates.some(
      (resource) => resource !== undefined && pyCasefold(resource.section) === 'learn',
    );
    if (touchesLearn) foundationalChanges += 1;
  }

  const netAdditions = currentResult.resources.length - baseResult.resources.length;
  const errors: string[] = [];
  if (changedTitles.size > 6) {
    errors.push('churn limit exceeded: ' + changedTitles.size + ' resource entries changed (maximum 6)');
  }
  if (netAdditions > 3) {
    errors.push('churn limit exceeded: ' + netAdditions + ' net entries added (maximum 3)');
  }
  if (foundationalChanges > 1) {
    errors.push(
      'churn limit exceeded: ' + foundationalChanges + ' foundational entries changed (maximum 1)',
    );
  }
  return errors;
}

/**
 * CPython's universal-newline translation.
 *
 * Applied by `Path.read_text()` and, just as much, by `subprocess.run(text=True)`
 * -- both open their stream with `newline=None`. All three of CRLF, lone CR and
 * LF collapse to LF; stripping only CRLF leaves a lone CR behind and shifts
 * every line number after it.
 */
function universalNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * `Path.read_text(encoding="utf-8")`: strict UTF-8, universal newlines, and --
 * unlike TextDecoder's default -- a byte-order mark that stays in the string.
 */
function readText(file: string): string {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  return universalNewlines(decoder.decode(fs.readFileSync(file)));
}

/** `Path(...).as_posix()`. */
function asPosix(file: string): string {
  return path.sep === '\\' ? file.replaceAll('\\', '/') : file;
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);

  const validated = validateText(readText(args.readme));
  const resources = validated.resources;
  const errors = validated.errors;
  const warnings = validated.warnings;

  if (args.checkLinks) {
    const [linkErrors, linkWarnings] = await checkLinks(resources);
    errors.push(...linkErrors);
    warnings.push(...linkWarnings);
  }
  if (args.base) {
    // `capture_output=True` pipes the child's stderr, and `CalledProcessError`
    // never prints what it captured -- so git's own "fatal: ..." reaches the
    // user nowhere upstream. execFileSync would inherit stderr by default, and
    // piping it merely relocates the text into the thrown error's message, so
    // it is discarded outright: that is what the original is observably doing.
    const baseText = universalNewlines(
      execFileSync('git', ['show', args.base + ':' + asPosix(args.readme)], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    );
    errors.push(...validateChurn(baseText, readText(args.readme)));
  }

  for (const warning of warnings) process.stderr.write('WARNING: ' + warning + '\n');
  for (const error of errors) process.stderr.write('ERROR: ' + error + '\n');
  process.stdout.write(
    'Validated ' + resources.length + ' resources with ' + errors.length + ' errors and ' +
      warnings.length + ' warnings.\n',
  );
  return errors.length > 0 ? 1 : 0;
}

const entry = process.argv[1];
const invokedDirectly = entry !== undefined && /validate_readme\.(ts|js)$/.test(entry.replaceAll('\\', '/'));

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      if (error instanceof ArgumentExit) {
        if (error.stdout) process.stdout.write(error.stdout);
        if (error.stderr) process.stderr.write(error.stderr);
        process.exitCode = error.code;
        return;
      }
      throw error;
    });
}
