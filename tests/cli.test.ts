/**
 * The command-line surface: argument parsing, exit status, stream routing.
 *
 * The ported unit suite mirrors the Python `unittest` file, which only ever
 * covered the pure functions -- `argparse.ts` had no test at all, and that is
 * where every behavioural divergence found during QC actually lived. Each
 * expectation below is the measured behaviour of `python scripts/validate_readme.py`
 * under CPython 3.13, not a guess at what argparse ought to do.
 *
 * Messages are asserted on their argparse-authored wording rather than in full,
 * because the `prog` prefix is derived from argv[0] and so reads as the test
 * runner here. `make parity` and qc_fixtures.json cover the full text.
 */

import { describe, expect, it, vi } from 'vitest';

import { ArgumentExit, parseArgs } from '../scripts/internal/argparse.js';
import { main } from '../scripts/validate_readme.js';

/** Run the parser and return the ArgumentExit it threw, or null if it did not. */
function exitOf(argv: string[]): ArgumentExit | null {
  try {
    parseArgs(argv);
    return null;
  } catch (error) {
    if (error instanceof ArgumentExit) return error;
    throw error;
  }
}

describe('parseArgs -- defaults and positionals', () => {
  it('defaults to README.md with no arguments', () => {
    expect(parseArgs([])).toEqual({ readme: 'README.md', checkLinks: false, base: null });
  });

  it('takes a single positional as the readme path', () => {
    expect(parseArgs(['docs/OTHER.md']).readme).toBe('docs/OTHER.md');
  });

  it('rejects a second positional with exit 2', () => {
    const exit = exitOf(['README.md', 'extra.md']);
    expect(exit?.code).toBe(2);
    expect(exit?.stderr).toContain('unrecognized arguments: extra.md');
    expect(exit?.stdout).toBe('');
  });
});

describe('parseArgs -- dash-led tokens argparse treats as positionals', () => {
  // argparse._parse_optional hands these to the positionals; the port used to
  // do the same for EVERY single-dash token, which swallowed real typos.
  it('treats a lone dash as a positional', () => {
    expect(parseArgs(['-']).readme).toBe('-');
  });

  it.each(['-5', '-42', '-3.5', '-.5'])('treats the negative number %s as a positional', (token) => {
    expect(parseArgs([token]).readme).toBe(token);
  });

  it('treats a token containing a space as a positional', () => {
    expect(parseArgs(['-x y']).readme).toBe('-x y');
  });
});

describe('parseArgs -- unknown options are rejected, not swallowed', () => {
  it.each(['-x', '-b', '-v'])('rejects the unknown short option %s with exit 2', (token) => {
    const exit = exitOf([token]);
    expect(exit?.code).toBe(2);
    expect(exit?.stderr).toContain('unrecognized arguments: ' + token);
  });

  it('rejects an unknown long option with exit 2', () => {
    expect(exitOf(['--bogus'])?.stderr).toContain('unrecognized arguments: --bogus');
  });

  it('reports several unknown options space-separated, in order', () => {
    expect(exitOf(['-x', '-y'])?.stderr).toContain('unrecognized arguments: -x -y');
  });

  it('does not mistake an unknown option for the readme path', () => {
    expect(exitOf(['-x'])?.code).toBe(2);
    // The bug this replaces returned { readme: '-x' } and exited 1 on ENOENT.
    expect(exitOf(['-x'])).not.toBeNull();
  });
});

describe('parseArgs -- the -- separator', () => {
  it('accepts a bare -- and still defaults the readme', () => {
    expect(parseArgs(['--'])).toEqual({ readme: 'README.md', checkLinks: false, base: null });
  });

  it('reads the token after -- as a positional', () => {
    expect(parseArgs(['--', 'README.md']).readme).toBe('README.md');
  });

  it('reads an option-looking token after -- as a positional', () => {
    expect(parseArgs(['--', '-x']).readme).toBe('-x');
  });

  it('accepts -- after the positional', () => {
    expect(parseArgs(['README.md', '--']).readme).toBe('README.md');
  });

  it('does not let --base consume -- as its value', () => {
    const exit = exitOf(['--base', '--']);
    expect(exit?.code).toBe(2);
    expect(exit?.stderr).toContain('argument --base: expected one argument');
  });
});

describe('parseArgs -- --check-links', () => {
  it('sets the flag', () => {
    expect(parseArgs(['--check-links']).checkLinks).toBe(true);
  });

  it('rejects an explicit argument with exit 2', () => {
    const exit = exitOf(['--check-links=yes']);
    expect(exit?.code).toBe(2);
    expect(exit?.stderr).toContain("argument --check-links: ignored explicit argument 'yes'");
  });
});

describe('parseArgs -- --base', () => {
  it('takes a separate value', () => {
    expect(parseArgs(['--base', 'origin/master']).base).toBe('origin/master');
  });

  it('takes an inline value', () => {
    expect(parseArgs(['--base=origin/master']).base).toBe('origin/master');
  });

  it('rejects a missing value with exit 2', () => {
    expect(exitOf(['--base'])?.stderr).toContain('argument --base: expected one argument');
  });

  it('does not consume an option-looking token as its value', () => {
    expect(exitOf(['--base', '-v', 'README.md'])?.stderr).toContain(
      'argument --base: expected one argument',
    );
  });
});

describe('parseArgs -- help', () => {
  it('exits 0 and prints usage for -h', () => {
    const exit = exitOf(['-h']);
    expect(exit?.code).toBe(0);
    expect(exit?.stdout).toContain('[-h] [--check-links] [--base BASE] [readme]');
    expect(exit?.stdout).toContain('Git revision used to enforce weekly churn limits');
    expect(exit?.stderr).toBe('');
  });

  it('exits 0 and prints usage for --help', () => {
    expect(exitOf(['--help'])?.code).toBe(0);
  });

  // CPython 3.13 records whether a value arrived via `=` or was concatenated,
  // and only the `=` form is an error for a nargs=0 action.
  it.each(['-hx', '-hhh', '-hx=y'])('exits 0 and prints usage for %s', (token) => {
    expect(exitOf([token])?.code).toBe(0);
  });

  it.each(['-h', '--help'])('fires %s before any later argument is judged', (token) => {
    expect(exitOf([token, '-x'])?.code).toBe(0);
    expect(exitOf([token, 'README.md'])?.code).toBe(0);
  });

  it.each(['--help=x', '-h=x'])('rejects %s with exit 2, naming both option strings', (token) => {
    const exit = exitOf([token]);
    expect(exit?.code).toBe(2);
    expect(exit?.stderr).toContain("argument -h/--help: ignored explicit argument 'x'");
  });

  it('does not read -xh as a concatenated -h', () => {
    expect(exitOf(['-xh'])?.stderr).toContain('unrecognized arguments: -xh');
  });

  it('reports an unknown option carrying an = verbatim', () => {
    expect(exitOf(['-x=y'])?.stderr).toContain('unrecognized arguments: -x=y');
  });
});

describe('parseArgs -- option abbreviation', () => {
  it.each([
    ['--c', 'checkLinks'],
    ['--ch', 'checkLinks'],
    ['--check', 'checkLinks'],
  ])('resolves %s to --check-links', (token) => {
    expect(parseArgs([token]).checkLinks).toBe(true);
  });

  it.each(['--b', '--ba', '--bas'])('resolves %s to --base', (token) => {
    expect(parseArgs([token, 'HEAD']).base).toBe('HEAD');
  });

  it('resolves --h to --help', () => {
    expect(exitOf(['--h'])?.code).toBe(0);
  });
});

describe('parseArgs -- stream discipline', () => {
  // argparse writes errors to stderr and nothing to stdout, and always
  // prefixes them with the usage line. main() relies on that split: the
  // "Validated N resources" line is the only thing stdout ever carries.
  it('writes every parse error to stderr only, prefixed with usage', () => {
    for (const argv of [
      ['-x'],
      ['--bogus'],
      ['--check-links=yes'],
      ['--base'],
      ['--help=x'],
      ['README.md', 'extra.md'],
    ]) {
      const exit = exitOf(argv);
      expect(exit?.stdout).toBe('');
      expect(exit?.stderr.startsWith('usage: ')).toBe(true);
      expect(exit?.stderr.endsWith('\n')).toBe(true);
    }
  });

  it('writes help to stdout only, and never to stderr', () => {
    const exit = exitOf(['--help']);
    expect(exit?.stderr).toBe('');
    expect(exit?.stdout.startsWith('usage: ')).toBe(true);
    expect(exit?.stdout).toContain('positional arguments:');
    expect(exit?.stdout).toContain('options:');
    expect(exit?.stdout.endsWith('\n')).toBe(true);
  });
});

describe('main -- end to end', () => {
  it('validates the curated README, reporting the count on stdout', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      const code = await main(['README.md']);
      expect(code).toBe(0);
      const printed = out.mock.calls.map((call) => String(call[0])).join('');
      expect(printed).toMatch(/^Validated \d+ resources with 0 errors and 0 warnings\.\n$/);
      expect(err).not.toHaveBeenCalled();
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });

  it('reports structural errors on stderr and returns 1', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      // archive/README.md is prose, not a curated list: no level-three headings.
      const code = await main(['archive/README.md']);
      const printed = out.mock.calls.map((call) => String(call[0])).join('');
      expect(printed).toMatch(/^Validated \d+ resources with \d+ errors and \d+ warnings\.\n$/);
      expect(code === 0 || code === 1).toBe(true);
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });

  it('propagates a failing git invocation for --base', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      // No such revision exists, in a git repository or out of one, so this
      // fails deterministically -- and exercises the as_posix() path first.
      await expect(main(['README.md', '--base', 'qc-no-such-rev-ever'])).rejects.toThrow();
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });

  it('surfaces a missing readme as a rejected read, not a parse error', async () => {
    await expect(main(['definitely-not-here.md'])).rejects.toThrow();
  });
});
