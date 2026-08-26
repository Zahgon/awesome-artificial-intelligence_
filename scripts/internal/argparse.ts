/**
 * The corner of `argparse` this script uses: one optional positional, one
 * store_true flag, one valued option, and `-h`.
 *
 * Written out rather than pulled from a package so the usage line, the help
 * layout, the "unrecognized arguments" wording, option abbreviation and the
 * exit-2-on-error behaviour all match what the Python entry point printed.
 */

import process from 'node:process';

export interface ParsedArgs {
  readme: string;
  checkLinks: boolean;
  base: string | null;
}

/**
 * argparse defaults `prog` to `os.path.basename(sys.argv[0])`. Porting the rule
 * rather than its output means this reads "validate_readme.ts" here and read
 * "validate_readme.py" in the original -- each naming its own entry point.
 */
function defaultProg(): string {
  const entry = process.argv[1];
  if (entry === undefined) return 'validate_readme.ts';
  const normalized = entry.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

const PROG = defaultProg();
const USAGE = `usage: ${PROG} [-h] [--check-links] [--base BASE] [readme]`;

const HELP = `${USAGE}

positional arguments:
  readme

options:
  -h, --help     show this help message and exit
  --check-links
  --base BASE    Git revision used to enforce weekly churn limits
`;

/** Raised instead of calling process.exit, so the parser stays testable. */
export class ArgumentExit extends Error {
  constructor(
    readonly code: number,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    super(`argparse exit ${code}`);
    this.name = 'ArgumentExit';
  }
}

const OPTIONS = ['--help', '--check-links', '--base'];

/** argparse allows any unambiguous prefix of a long option. */
function resolveOption(token: string): string | null {
  if (OPTIONS.includes(token)) return token;
  const matches = OPTIONS.filter((name) => name.startsWith(token));
  if (matches.length === 1) return matches[0] as string;
  return null;
}

/** `argparse._negative_number_matcher`. */
const NEGATIVE_NUMBER = /^-\d+$|^-\d*\.\d+$/;

/**
 * `argparse._parse_optional`'s question: does this token read as an option?
 *
 * A leading `-` is not enough. CPython hands three kinds of dash-led token
 * straight to the positionals instead: a lone `-`, anything matching the
 * negative-number pattern (because this parser declares no negative-number-like
 * options), and anything containing a space.
 */
function isOptionToken(token: string): boolean {
  if (!token.startsWith('-')) return false;
  if (token === '-') return false;
  if (NEGATIVE_NUMBER.test(token)) return false;
  if (token.includes(' ')) return false;
  return true;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  let readme: string | null = null;
  let checkLinks = false;
  let base: string | null = null;
  const unrecognized: string[] = [];
  // argparse consumes the first bare `--` and reads everything after it as a
  // positional; the separator itself is stripped rather than reported.
  let separatorSeen = false;

  const takePositional = (token: string): void => {
    if (readme === null) readme = token;
    else unrecognized.push(token);
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] as string;

    if (!separatorSeen && token === '--') {
      separatorSeen = true;
      continue;
    }
    if (separatorSeen || !isOptionToken(token)) {
      takePositional(token);
      continue;
    }

    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      const name = eq >= 0 ? token.slice(0, eq) : token;
      const inlineValue = eq >= 0 ? token.slice(eq + 1) : null;
      const resolved = resolveOption(name);

      if (resolved === '--help') {
        // `-h` and `--help` are one action, and argparse names both in the error.
        if (inlineValue !== null) {
          throw new ArgumentExit(2, '', `${USAGE}\n${PROG}: error: argument -h/--help: ignored explicit argument '${inlineValue}'\n`);
        }
        throw new ArgumentExit(0, HELP, '');
      }
      if (resolved === '--check-links') {
        if (inlineValue !== null) {
          throw new ArgumentExit(2, '', `${USAGE}\n${PROG}: error: argument --check-links: ignored explicit argument '${inlineValue}'\n`);
        }
        checkLinks = true;
        continue;
      }
      if (resolved === '--base') {
        if (inlineValue !== null) {
          base = inlineValue;
        } else {
          const next = argv[i + 1];
          if (next === undefined || next.startsWith('-')) {
            throw new ArgumentExit(2, '', `${USAGE}\n${PROG}: error: argument --base: expected one argument\n`);
          }
          base = next;
          i += 1;
        }
        continue;
      }
      unrecognized.push(token);
      continue;
    }

    // Single-dash tokens. `-h` is the only one this parser defines.
    //
    // CPython 3.13 records whether the value arrived via `=` or was simply
    // concatenated, and treats the two differently for a nargs=0 action:
    // `-h=x` is an error, while `-hx` and `-hhh` fire help and exit 0 -- the
    // leftover is only rejected after the help action has already run.
    const shortEq = token.indexOf('=');
    if (shortEq >= 0 && token.slice(0, shortEq) === '-h') {
      throw new ArgumentExit(2, '', `${USAGE}\n${PROG}: error: argument -h/--help: ignored explicit argument '${token.slice(shortEq + 1)}'\n`);
    }
    if (token[1] === 'h') throw new ArgumentExit(0, HELP, '');
    unrecognized.push(token);
  }

  if (unrecognized.length > 0) {
    throw new ArgumentExit(2, '', `${USAGE}\n${PROG}: error: unrecognized arguments: ${unrecognized.join(' ')}\n`);
  }

  return { readme: readme ?? 'README.md', checkLinks, base };
}
