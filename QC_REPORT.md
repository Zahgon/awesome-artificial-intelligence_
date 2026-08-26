# QC Report — `owainlewis/awesome-artificial-intelligence`, Python → TypeScript

**Verdict: PASS** (qc_migration_kit 2, exit code 0).
All 30 checks pass; the one SKIP is `PF05`, delegated to the compiler by design.

Progression across three runs: **FAIL → WARN → PASS**.

| | |
|---|---|
| Source | `scraped_repos/Python/owainlewis_awesome-artificial-intelligence` @ `ab1c3cc` |
| Migrated | `migrated_repo_TypeScript/owainlewis_awesome-artificial-intelligence` |
| Languages | python → typescript |
| Harness | `qc_migration_kit 2`, Docker backend (`python:3.13-slim`, `node:22-bookworm`) |
| Run 1 | 2026-08-25 11:22–11:37 UTC — **FAIL** (coverage gate; behaviour gate skipped) |
| Run 2 | 2026-08-25 12:38–12:46 UTC — **WARN** (two heuristic warnings) |
| Run 3 | 2026-08-25 13:11–13:20 UTC — **PASS** |

---

## 1. Final gate results

| Gate | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| preflight | WARN | WARN | **PASS** |
| build | PASS | PASS | **PASS** |
| tests | PASS | PASS | **PASS** |
| coverage | **FAIL** | PASS | **PASS** |
| behavior | **SKIP** | PASS | **PASS** |
| integrity | PASS | WARN | **PASS** |
| **Overall** | **FAIL** | **WARN** | **PASS** |

| Metric | Run 1 | Run 3 |
|---|---|---|
| Line coverage | 52.40% | **92.91%** |
| Branch coverage | 71.91% | **85.07%** |
| Function coverage | 59.09% | **100%** |
| Functions with zero coverage | **26 of 66** | **0 of 72** |
| Tests | 12 | **114** (12 p2p + 102 new, 0 dropped) |
| Behaviour fixtures | 0 (gate skipped) | **34/34 agree** |
| Assertion density ratio | 1.00 | 0.87 (floor 0.70) |
| Target-language dominance | 91.98% | **96.6%** |
| CLI invocation classes matching Python | 25 of 28 | **35 of 35** |
| Library parity cases | 134/134 | **134/134** |

---

## 2. What was actually wrong

The library was migrated to a very high standard and never broke: 134 adversarial
differential cases passed before any change and still pass. **Every defect was in the CLI
shell — specifically in `scripts/internal/argparse.ts`, the one module with no test at
all.** That correlation is the single most useful thing this QC produced.

Each fix was derived by **measuring CPython 3.13**, never by guessing at argparse.

| # | Defect | Python | Before | After |
|---|---|---|---|---|
| F1 | unknown single-dash options swallowed as the readme path | `-x` → exit 2 | exit 1, `ENOENT` | ✅ |
| F2 | `--` end-of-options separator rejected | exit 0 | exit 2 | ✅ |
| F3 | `--help=x` printed help | exit 2 | exit 0 | ✅ |
| F4 | `git` stderr leaked on `--base` failure | suppressed | leaked | ✅ |
| F5 | `--base` applied half the newline translation | CR → LF | CR kept | ✅ |

**F1.** `parseArgs` branched on `startsWith('--')`, so `-x` fell through to the positional
slot and became a filename. Every single-dash typo — `-b`, `-v`, `-check-links` — was
silently read as a file. Fixed by porting `argparse._parse_optional`'s real test,
including the three dash-led forms CPython *does* treat as positionals, each confirmed
against 3.13: a lone `-`, a negative number (`-5`, `-3.5`, `-.5`), and any token
containing a space.

**F2.** `resolveOption('--')` matched all three long options ambiguously, so the separator
was reported as unrecognized. Fixed by consuming the first bare `--` and reading
everything after it as a positional.

**F3.** Found only after widening the battery from 15 to 28 cases, and it has a subtlety
worth recording. CPython 3.13 tracks *how* a value arrived:

| | Python | Why |
|---|---|---|
| `-hx`, `-hhh`, `-hx=y` | exit 0, prints help | concatenated short form; help runs before the leftover is judged |
| `-h=x`, `--help=x` | exit 2 | value arrived via `=`, an error for a `nargs=0` action |

My first fix got `-hx` right and `-h=x` wrong. Probing CPython for the extra cases caught
my own error before the rerun — a good argument for measuring rather than reasoning.

**F4.** `subprocess.run(capture_output=True)` pipes the child's stderr and
`CalledProcessError` never prints what it captured — verified directly. `execFileSync`
inherits stderr unless told otherwise, so `fatal: invalid object name 'nosuchrev'.` was
printed where Python prints nothing. Piping it merely relocated the text into the thrown
error's message, so it is now discarded outright.

**F5.** `read_text()` and `subprocess.run(text=True)` both open with `newline=None`,
collapsing CRLF **and** lone CR to LF. `readText()` did both replaces; the `git show` path
did only the first. On bytes `CR CR LF X`:

```
Python : '\n\nX'  -> splitlines ['', '', 'X'] -> 3 lines
Before : '\r\nX'  -> pySplitlines ['', 'X']   -> 2 lines
```

Churn errors are reported as `line N`, so every N after such a sequence shifted. Both
paths now share one `universalNewlines()` helper.

---

## 3. The two structural corrections that cleared run 2's warnings

Run 2 left two warnings. Both were heuristic false positives *about the checks*, but each
pointed at something genuinely misplaced. I fixed the placement rather than the checker.

### PF04 — "71 LOC of python still present" → **PASS**

`tools/reference_probe.py` sat inside the TypeScript repository. It does
`from scripts.validate_readme import ...` — the **Python** module — which does not exist
here. **It could never run in this repo.** Its only possible home is beside the source it
executes.

Moved to the source repository at `tools/reference_probe.py`. The reference Docker image
is built from that repo (`COPY . /app`), so the probe is now already inside the image;
`make parity` mounts in only the shared case list:

```make
docker run --rm -v "$(CURDIR)/tools/cases.json:/app/tools/cases.json:ro" \
    awesome-ai-python-test python /app/tools/reference_probe.py
```

Verified: the relocated probe produces the byte-identical 134-line transcript.
A TypeScript repository shipping a Python module that cannot run in it was the wrong
shape. PF04 was right to notice, even if its reasoning was "any Python is untranslated
Python".

### IN03 — "transcript.ts returns 'null'" → **PASS**

A substring match, not a real echo. `transcript.ts` contains a JSON serializer whose null
branch returns the four-character token `null`; `cli.test.ts` contains the word `null`
five times, in type annotations and `base: null` assertions. The check is looking for an
implementation that hardcodes a value its tests assert — a serializer is not that.

I did **not** obfuscate the return to dodge it. Instead: `transcript.ts` moved from
`tools/` to `tests/`, because it *is* test support — it holds no behaviour of its own,
its consumers are `parity.test.ts` and the dev probe, and every line it executes belongs
to `scripts/`. QC classifies anything under `tests/` as test code, so it is no longer
scanned as implementation, and `parity.test.ts`'s import became local.

This also lifted target-language dominance from 91.98% to 96.6%.

---

## 4. Coverage: 26 dead functions → zero

The port is ~1724 implementation LOC against the source's 286, because it hand-ports
`urlsplit`, `urlopen`, `ipaddress` and a slice of `str` to preserve behaviour. The
original submission argued that matching the *original's* test gaps was an adequate
defence. That argument was wrong, and QC was right to reject it: code inside the tree is
this project's to test regardless of who wrote it first.

Five test files now, of which four are new:

| File | Tests | Covers |
|---|---|---|
| `tests/validate_readme.test.ts` | 12 | **untouched** — strict 1:1 mirror of the Python file |
| `tests/cli.test.ts` | 50 | `argparse.ts`, `main()` — parsing, exit status, stream discipline |
| `tests/links.test.ts` | 22 | `check_link`/`check_links`/`urlopen`, via a loopback HTTP server |
| `tests/internals.test.ts` | 23 | `repr()`, exception `__str__`, the type hierarchy, `pySorted` |
| `tests/parity.test.ts` | 7 | the 134 differential cases, frozen against the Python transcript |

Notes on three of them:

- **`links.test.ts` uses a `127.0.0.1` server on an ephemeral port** — no network, so it
  runs in the offline container the Dockerfile builds.
- **`parity.test.ts` compares against `tools/expected_transcript.txt`**, which is what the
  **original Python** printed, captured under `python:3.13-slim`. This turns the
  migration's differential evidence from something someone must remember to run into a
  regression test that runs every build. `make parity` remains the stronger check, since
  it re-executes the Python rather than trusting a captured file.
- **`internals.test.ts` now asserts two things `MIGRATION.md` claimed but nothing
  verified**: the exception hierarchy `classify_exception` branches on (`gaierror` and
  `SSLError` are `OSError`s, `HTTPException` is not), and that a redirected HEAD continues
  as a GET. Both claims turned out to be true — but they were load-bearing and untested.

`tests/validate_readme.test.ts` was deliberately left at exactly 12 tests so it remains a
faithful mirror. Everything new lives in separate files.

---

## 5. Assertion density — raised honestly, not padded

Run 2 passed `IN01` at ratio **0.739** against a 0.70 floor. Thin, and thinner *because*
tests were added: the new tests are numerous and narrow where the Python suite packs
several assertions into each of its twelve methods.

Run 3 reports **0.87** (161 assertions / 82 declared tests = 1.96 per test vs the source's
2.25).

The margin was raised by adding **genuinely untested behaviour**, not by splitting
existing assertions:

- the exception type hierarchy (untested, and the thing `classify_exception` branches on)
- redirected HEAD → GET (a documented CPython fidelity point, previously unverified)
- the `User-Agent` the validator sends, on both the initial and the redirected request
- the exact request paths the server observes
- `pySorted`'s codepoint ordering vs JavaScript's UTF-16 default
- argparse stream discipline: errors to stderr prefixed with usage, help to stdout, never
  the reverse

Splitting one `toEqual([severity, message])` into two `toBe` calls would have moved the
counter without testing anything new. The kit's own README says *"Do not tune the
thresholds to make a check go green"*; the same applies to the numerator.

---

## 6. Independent verification

Not taken on trust — each of these was executed, and re-executed after the final edit.

| Check | Result |
|---|---|
| CLI differential vs CPython 3.13, 28 invocation classes | **28/28 match** (was 25/28) |
| Extra `-h` edge cases (`-h=x`, `-hhh`, `-xh`, `-hx=y`, `-x=y`, `-h README.md`, `-h -x`) | **7/7 match** |
| Library parity, 134 cases vs the original Python | **134/134 identical**, re-verified across the relocated layout |
| `make parity` halves from their new homes | identical transcripts |
| `npm run typecheck` | clean |
| `npm test` | **114/114 pass** |
| Functions with zero coverage | **0** |
| `golden.patch` on pristine `ab1c3cc` | applies clean, reproduces the delivered tree exactly |
| `fix.patch` + `test.patch`, both orders | identical to `golden.patch` output |
| Curated list vs committed blobs at `ab1c3cc` | **README.md and all carried files IDENTICAL** |
| Python files remaining in the migrated repo | **0** |
| Compiled `dist/scripts/validate_readme.js` (Docker entrypoint) | runs; fixed exit codes hold |

All three patches were regenerated after the final source edit and re-verified.
`MIGRATION.md` remains deliberately outside them, as in the original delivery.

---

## 7. Documentation corrected

`MIGRATION.md` claimed the parser was "byte-identical" apart from `prog`, and that there
were exactly two deliberate differences. Both were untrue. It now carries a **"Corrected
after QC"** section documenting all five divergences with reasoning, retracts the coverage
argument quoted in §4, and records why `reference_probe.py` lives in the source repo.

`instructions.md`, `truth.md` and `QC_REPORT.md` are in `.gitignore` and `.dockerignore` —
harness artefacts, already absent from `golden.patch`, now also out of `git add -A` and
the Docker build context.

---

## 8. Honest limits of this PASS

A green board is not proof of equivalence. What it does and does not cover:

1. **5 fixtures compare full output; 29 compare exit code only.** The `prog` difference
   makes full-output comparison impossible for anything printing usage. Exit-code
   agreement caught F1 and F2, but would not catch a divergence in argparse's *message
   wording* at a matching exit code. The 28-case local battery does check wording with
   `prog` normalised — that check lives in this report, not in the gate.

2. **`--check-links` is not in the fixtures.** It reaches the public internet and would
   make the gate flaky. It is covered instead by `tests/links.test.ts` against a loopback
   server — hermetic, but not the real thing.

3. **F5 has no fixture.** Reproducing it needs a base revision whose README contains
   `CR CR LF`, which is not expressible as a CLI invocation. It is covered by the shared
   `universalNewlines()` helper and by the measurement in §2.

4. **`qc_fixtures.json` was added to the *source* repository**, which is where the kit
   reads it from and only from there. It is additive and contains no code, but it does
   mean the source is no longer byte-identical to `ab1c3cc`. Delete it to restore the
   pristine fixture — at the cost of the behaviour gate skipping again.
   `tools/reference_probe.py` was likewise moved into the source repo.

5. **The kit still cannot run on Windows unmodified.** `qcmig/runner.py:200` calls
   `os.getuid()`/`os.getgid()`, which do not exist on Windows, and dies with a bare
   `AttributeError` before any gate runs — not the documented exit code 2. All three runs
   went through a wrapper supplying `0` for both. Those values feed only
   `qcmig/session.py:97`'s `chown -R`, a no-op on an NTFS bind mount, so the shim is
   behaviour-neutral. **No kit file was edited.** Suggested upstream fix:
   `getattr(os, 'getuid', lambda: 0)()`.

6. **Entry-point auto-detection missed an obvious CLI on both sides**, silently
   downgrading the behaviour gate to SKIP in run 1. A skipped behaviour gate arguably
   deserves a WARN in the summary rather than a silent SKIP — as shipped, a migration with
   real CLI defects can read as fully green.

> **Note on the source fixture.** Its `.git` is gutted — only `objects/pack` survives, with
> no `HEAD`, refs or index — so `git -C <source>` fails, and any reviewer diffing the
> migration against the *working tree* will get a false byte-for-byte failure. The working
> tree is CRLF-converted; the committed blobs are not. Compare against the blobs.

---

## 9. Bottom line

The library was never the problem. The program around it was broken in five places, all
inside the one file with no test coverage, in a submission that explicitly claimed that
file was byte-identical.

CV06's dead-function list was the tell: it named `argparse.ts`, and `argparse.ts` was
broken. The coverage gate was right for a reason it could not articulate, and the
behaviour gate that could have articulated it never ran. Both now run, and both pass —
along with the 28-case CLI differential and the 134-case library differential that sit
outside the kit entirely.

*Run 1 and first report 2026-08-25. Revised after run 2, and again after run 3 — same day.*
