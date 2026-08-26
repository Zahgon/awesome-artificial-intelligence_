# Python to TypeScript migration notes

Source: [`owainlewis/awesome-artificial-intelligence`](https://github.com/owainlewis/awesome-artificial-intelligence)
@ `ab1c3cceef8ab906586505a7a7a293f434280862` (MIT).

Everything written in Python in that repository has an equivalent here, and
every Python test has a TypeScript twin asserting the same things on the same
inputs. This file records the decisions a reader would otherwise have to
reverse-engineer.

---

## What moved

| Python | TypeScript | Notes |
|---|---|---|
| `scripts/validate_readme.py` (251 lines) | `scripts/validate_readme.ts` | Full port, function for function |
| `tests/test_validate_readme.py` (12 tests) | `tests/validate_readme.test.ts` | 12 tests, same fixtures and assertions |
| `pyproject.toml`, `.python-version` | `package.json`, `tsconfig.json` | Toolchain declaration |
| `.github/workflows/quality.yml` | same path | `setup-python` → `setup-node`; same two checks |

Carried over **verbatim**, because they were never Python: `README.md`,
`archive/README.md`, `AUTOMATION.md`, `CURATION.md`, `LICENSE`, `docs/`,
`.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md`,
`.github/codex/schemas/`. `README.md` in particular is the data under test —
it is byte-identical to the source, so both implementations validate exactly
the same 77 resources.

Command invocations inside `CONTRIBUTING.md` and `.github/codex/prompts/` were
retargeted (`python -m unittest …` → `npm test`), since those strings are
instructions to run this repository's checks.

`scripts/internal/` is new. It holds the CPython standard-library semantics the
port depends on and is not a translation of anything in the source repo.

---

## The decision that matters

`validate_readme.py` is 251 lines of straightforward logic sitting on top of
five standard-library modules — `re`, `urllib.parse`, `urllib.request`,
`argparse` and `str` itself — and **every one of them disagrees with its
obvious JavaScript counterpart** on inputs this validator can actually receive.
Porting the 251 lines and reaching for `URL`, `fetch`, `split('\n')`,
`toLowerCase()` and `trim()` would have produced code that resembles the
original and gives different answers. Each of the following is reproduced
deliberately in `scripts/internal/`.

### `str.splitlines()` is not `split('\n')` (`pystr.ts`)

CPython splits on ten codepoints: `\n \v \f \r \x1c \x1d \x1e \x85 U+2028
U+2029`, with `\r\n` counted once. Every error this script emits is prefixed
with a line number derived from that split, so a README containing a form feed
is numbered differently by the two implementations — and the line number is the
only thing telling a contributor where the problem is.

### `str.casefold()` does not exist in JavaScript (`pystr.ts`, `casedata.ts`)

Duplicate detection keys on `resource.title.casefold()` and the "foundational
entry" rule tests `section.casefold() == "learn"`. `toLowerCase()` is not
casefold: it leaves `ß` and the Greek final sigma alone where casefold rewrites
them, so "Straße" and "STRASSE" would occupy two entries in the dedupe map
instead of colliding. The popular `toUpperCase().toLowerCase()` trick is also
wrong — it folds `ı` (U+0131) to `i`, which casefold does not.

`casedata.ts` is therefore **generated from the interpreter itself**
(`tools/gen_case_tables.mjs`), holding CPython 3.13's full `casefold` and
`lower` maps as constant-delta runs. Pinning to the interpreter rather than to
`String.prototype` also removes a second failure mode: Node 24's ICU tracks a
newer Unicode than CPython 3.13, and the two disagree on 55 codepoints in
`lower()` alone.

### `str.strip()` and `re`'s `\s` are not `trim()` and JavaScript's `\s`

Python's whitespace class covers U+001C–U+001F and U+0085 and excludes U+FEFF;
JavaScript's does the opposite on both counts. `RESOURCE_RE` uses `[^)\s]` to
find the end of a URL, so the difference decides whether a zero-width no-break
space terminates the match. `RE_SPACE_CLASS` spells CPython's class out.

### `urlsplit` is not `new URL()` (`urlsplit.ts`, `ipaddress.ts`)

`normalize_url` is the dedupe key and the source of the "invalid URL" error.
The WHATWG parser percent-encodes, resolves dot segments, drops default ports,
appends `/` to an empty path, and — decisively — *does not raise* on the inputs
whose `ValueError` becomes that error message. `urlsplit` is transcribed from
CPython 3.13 instead, including:

- `.port` raising `Port could not be cast to integer value as '…'` (with
  Python's `repr()`, hence `pyRepr`) and `Port out of range 0-65535`
- `.hostname` splitting on `@` and `[…]`, and preserving an IPv6 zone's case
- the NFKC netloc check that rejects `https://℀.com` because it expands to
  `a/c`
- `_check_bracketed_host`, which needs enough of `ipaddress` to tell IPv6 from
  IPv4 from neither. `net.isIP()` is not a substitute: it accepts the leading
  zeros in `0177.1.1.1` that CPython has rejected since 3.9.5.

`urlunsplit` is the 3.13 version, which emits `https:///path` for an empty
netloc — earlier releases did not.

### `urlopen` is not `fetch()` (`urlopen.ts`)

`check_link` distinguishes four failure modes and grades them differently.
`fetch` reports all of them as one opaque `TypeError`, and follows redirects,
retries and decompresses on its own terms. Built on `node:http` instead, with:

- non-2xx surfacing as `HTTPError` rather than a returned response
- CPython's redirect rules (301/302/303/307/308, `max_repeats=4`,
  `max_redirections=10`)
- **a redirected HEAD continuing as a GET**, because
  `HTTPRedirectHandler.redirect_request` builds a `Request` with no method and
  `get_method()` defaults to GET. Hosts that 301 a HEAD and then answer the GET
  differently are graded on the second answer, in both implementations.

### `ssl.SSLError.__str__` is not `args[0]` (`errors.ts`)

`str(ssl.SSLError("bad certificate"))` is `"('bad certificate',)"`, not
`"bad certificate"` — the C-level `__str__` falls back to `str(self.args)` when
no `strerror` was set. That string is interpolated into the "unreachable link"
message, so the naive reading would have changed user-visible output. The
exception classes also preserve the inheritance `classify_exception` branches
on: `gaierror` and `SSLError` are `OSError`s, `HTTPException` is not, and
`socket.timeout` *is* `TimeoutError`.

### `sorted()` is not `Array.prototype.sort()` (`pystr.ts`)

`check_links` returns `sorted(errors), sorted(warnings)`. Python orders by
codepoint; JavaScript's default orders by UTF-16 code unit, which puts an
astral character *before* U+FFFF instead of after.

### `read_text(encoding="utf-8")` keeps the BOM

`new TextDecoder('utf-8')` strips it by default — the option to keep it is
confusingly named `ignoreBOM: true`. It matters: with the BOM retained, a
leading `### Books` no longer starts with `###␠`, so the category is never
opened and the first resource is reported as "outside a level-three category".
Both implementations now agree on that.

---

## Verification

### The migrated unit suite

`tests/validate_readme.test.ts` is the port of the Python file: 12 tests, one
per `test_*` method, in source order, with the same fixture strings. `assertIn`
→ `toContain`, `assertTrue(any(...))` → `toBe(true)` over the same
comprehension, so a failure fails for the same reason it would have in Python.
`str.replace(old, new, count)` has no JavaScript equivalent and is
reimplemented locally in the test file. That file is kept a strict 1:1 mirror —
nothing is added to it.

Four further files cover ground the Python suite never did. They exist because
QC found real divergences in exactly the code the mirrored suite does not
reach:

| File | Covers |
|---|---|
| `tests/cli.test.ts` | `argparse.ts` and `main()` — argument parsing, exit status, stream routing |
| `tests/links.test.ts` | `check_link` / `check_links` / `urlopen`, against a loopback HTTP server |
| `tests/parity.test.ts` | the 134 differential cases, frozen against the Python transcript |
| `tests/internals.test.ts` | `repr()`, exception `__str__`, and the type hierarchy `classify_exception` branches on |

Every expectation in them is a *measured* CPython 3.13 value, not an assumption
about what argparse or `repr()` ought to do.

```
npm test          # 114 passed
make docker-test  # the same 114, inside the image
```

### Differential equivalence probe

Unit tests prove the port satisfies the same assertions; they do not prove it
*behaves* the same. `tools/cases.json` holds 134 cases across all five pure
functions — including the ones the unit suite never reaches: `ß`/`ΣΤΙξ`/dotless
`ı` titles, a BOM'd README, `\v`/`\f`/`\x1c` as line boundaries, bracketed and
IPv6-zoned hosts, Arabic-Indic digits as a port, NFKC-collapsing netlocs, and
every `classify_status` boundary.

`tools/reference_probe.py` runs them through the original Python;
`tools/equivalence_probe.ts` runs them through this port; `make parity` diffs
the transcripts.

```
134/134 cases byte-identical
```

That, rather than the unit suite, is the evidence for the "no behavioural
difference" claim.

### Coverage

| | Python | TypeScript |
|---|---|---|
| Entry-point module | 72% statements (`validate_readme.py`) | 61% statements, 89% branches (`validate_readme.ts`) |

An earlier revision of this file argued that the gap between those two figures
was not a coverage regression, because "the same functions are exercised and
the same functions are not". That argument was wrong, and QC was right to
reject it. Matching the *original's* test gaps is not a defence when the port
is eight times the size: this repository ports `urlsplit`, `urlopen`,
`ipaddress` and a slice of `str` into its own tree, and code inside the tree is
this project's to test regardless of who wrote it first. Twenty-six functions
sat at zero coverage, `argparse.ts` among them — and `argparse.ts` turned out
to contain four behavioural divergences. The untested module was the broken
module.

Current figures, over `scripts/**` with the generated table excluded:

| | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| `validate_readme.ts` | 91.63% | 92.56% | 100% | 91.63% |
| `scripts/internal/` | 93.12% | 81.76% | 100% | 93.12% |
| **All files** | **92.66%** | **84.73%** | **100%** | **92.66%** |

**No function is left at zero coverage.**

What remains uncovered is deliberate: redirect-limit and TLS-error branches in
`urlopen.ts` that need a hostile server to reach, and the IPv6 compression
edge cases in `ipaddress.ts` that the parity cases do not construct.

`casedata.ts` is excluded from the denominator. It is 480 lines of generated
`const` tables with no functions, and it is 100% "covered" the moment it is
imported — including it would raise the reported figure by roughly sixteen
points while saying nothing about whether anything is tested. The exclusion
costs this repository those points on purpose.

---

## Deliberate differences

Two, both documented rather than hidden:

1. **`argparse` `prog`.** The usage line reads `validate_readme.ts` here and
   read `validate_readme.py` upstream. argparse derives `prog` from
   `basename(sys.argv[0])`; the *rule* was ported rather than its output,
   because hard-coding `.py` into a TypeScript repository is a trap.

   Apart from that substitution, the parser is byte-identical across the 34
   invocation classes in `qc_fixtures.json` — help layout, option
   abbreviation, the "unrecognized arguments" wording, and exit status.
   An earlier revision of this file made that claim without having tested it,
   and it was false: see "Corrected after QC" below.

2. **Decode and I/O failure messages.** A README that is not valid UTF-8, or is
   missing, aborts with a non-zero exit in both implementations, but the
   traceback text differs (`UnicodeDecodeError` / `FileNotFoundError` versus
   Node's `TypeError` / `ENOENT`). Reproducing CPython traceback formatting was
   judged out of proportion to the benefit; the exit status, which is what CI
   reads, matches.

---

## Corrected after QC

Migration QC drove both programs through the same command-line invocations —
ground the 134-case probe never touched, because every case in it calls a
function directly. Five divergences surfaced. All are fixed; each has a test.

1. **Unknown single-dash options were swallowed as the readme path.**
   `parseArgs` branched on `startsWith('--')`, so `-x` fell through to the
   positional slot and became a filename: exit 1 with `ENOENT` where argparse
   exits 2 with `unrecognized arguments: -x`. Every single-dash typo — `-b`,
   `-v`, `-check-links` — was silently read as a file. Fixed by porting
   `argparse._parse_optional`'s actual test, including the three dash-led forms
   CPython *does* hand to the positionals: a lone `-`, a negative number, and
   anything containing a space.

2. **The `--` end-of-options separator was rejected.** `resolveOption('--')`
   matched all three long options ambiguously and the token was reported as
   unrecognized — exit 2, where argparse consumes the separator, strips it, and
   exits 0. Fixed by consuming the first bare `--` and reading everything after
   it as a positional.

3. **`--help=x` printed help and exited 0.** argparse rejects an explicit
   argument to a `nargs=0` action: exit 2, `argument -h/--help: ignored
   explicit argument 'x'` — naming both option strings, because `-h` and
   `--help` are one action. `-hx`, by contrast, *does* print help and exit 0.
   Both now match.

4. **`git`'s stderr leaked to the terminal on a `--base` failure.**
   `subprocess.run(capture_output=True)` pipes the child's stderr and
   `CalledProcessError` never prints what it captured, so `fatal: invalid
   object name ...` reaches the user nowhere upstream. `execFileSync` inherits
   stderr unless told otherwise; piping it merely relocated the text into the
   thrown error's message, so it is now discarded outright.

5. **`--base` applied only half of the universal-newline translation.**
   `read_text()` and `subprocess.run(text=True)` both open with `newline=None`,
   collapsing CRLF *and* lone CR to LF. `readText()` did both replaces; the
   `git show` path did only the first. On a base revision containing `CR CR LF`
   the two implementations then disagreed on the line count — 3 against 2 —
   shifting every `line N` in the churn errors after it. Both paths now share
   one `universalNewlines()` helper.

`qc_fixtures.json` in the source repository pins all 34 invocation classes so
the behaviour gate re-checks them on every QC run.

---

## Layout

```
scripts/
  validate_readme.ts          the port, function for function
  internal/
    pystr.ts                  splitlines, strip, casefold, lower, repr, sorted
    casedata.ts               GENERATED -- CPython 3.13 case + printability tables
    urlsplit.ts               urllib.parse.urlsplit / urlunsplit / SplitResult
    ipaddress.ts              enough of ipaddress for _check_bracketed_host
    errors.ts                 the exception hierarchy classify_exception branches on
    urlopen.ts                urllib.request.urlopen over node:http
    argparse.ts               the corner of argparse main() uses
tests/
  validate_readme.test.ts     12 tests, one per Python test_* method
  cli.test.ts                 argparse + main: parsing, exit status, streams
  links.test.ts               check_link / urlopen, against a loopback server
  parity.test.ts              the 134 cases, frozen against the Python transcript
  internals.test.ts           repr(), exception __str__ and the type hierarchy
  transcript.ts               builds the transcript; shared by test and probe
tools/
  cases.json                  134 differential cases
  expected_transcript.txt     what the ORIGINAL Python printed for them
  equivalence_probe.ts        runs the cases through this port
  gen_case_tables.mjs         regenerates casedata.ts from a CPython dump
```

`tools/reference_probe.py` is **not** here. It imports `scripts/validate_readme.py`
and can only run against the original, so it lives in the source repository —
which is also where the reference Docker image is built from, so `make parity`
finds it already inside the image and mounts in only the shared case list. A
TypeScript repository shipping a Python module that cannot run in it was the
wrong shape; QC's PF04 was right to notice.
