Task:
Migrate the Python in the repository `owainlewis_awesome-artificial-intelligence`
to TypeScript. The migrated program must behave exactly as the original does.

Input:

1. `scraped_repos/Python/owainlewis_awesome-artificial-intelligence/` — the
   repository to migrate, at base commit `ab1c3cc`. The repository is a curated
   list of AI resources; most of it is the list itself, the policy documents
   that govern what may go on it, GitHub workflow and issue-template YAML, and
   one JSON schema. The Python is 2 files, 396 lines, in two directories:

   - `scripts/` — one command-line program, built from a frozen dataclass and
     eight module-level functions. It parses the curated list and reports
     structural faults in it, can be asked to check every listed link over the
     network, and can be asked to enforce change-rate limits against an earlier
     revision fetched with `git`. It takes arguments, reads a file, writes
     messages, and exits with a status.
   - `tests/` — one test file holding a single `unittest.TestCase`, covering
     part of that program.

   `pyproject.toml` requires Python 3.13 and declares no third-party
   dependencies; `.python-version` pins the interpreter.

   Everything else in the tree — `README.md`, `archive/`, `docs/`,
   `AUTOMATION.md`, `CONTRIBUTING.md`, `CURATION.md`, `LICENSE` and `.github/`
   — is not Python and is not migrated. Some of it is read by the program and
   by the tests and must keep working. Some of it gives instructions for
   running this repository's own checks.

2. `docker/awesome-ai-python-test.Dockerfile` — a container definition that runs
   the original test suite. It is kept outside the repository so the source
   stays pristine.

Output:

`migrated_repo_TypeScript/owainlewis_awesome-artificial-intelligence/` — the
migrated repository, laid out the way the sibling migrations under
`migrated_repo_go/` and `migrated_repo_rust/` are laid out, containing:

- the ported source, one module per Python module, in the same directory and
  under the same structure;
- the ported tests;
- a `Dockerfile` that builds the port and runs its tests;
- a `Makefile` exposing install, build, test and typecheck;
- a migration record in Markdown recording how the source maps onto the port,
  how each thing the Python relied on is accounted for, how the port was
  verified, and every place the two implementations necessarily differ, with
  the reason for each;
- `golden.patch` — a single Git diff that turns a pristine checkout of the
  source at the base commit into the migrated tree;
- `test.patch` — the part of `golden.patch` that touches test files;
- `fix.patch` — the rest of `golden.patch`. Applying `fix.patch` and
  `test.patch` to a pristine checkout must produce exactly what `golden.patch`
  produces.

Requirements:

- Every module, class, function, constant and public API in the source has an
  equivalent in the port.
- Observable behaviour is preserved: the values each function returns, the
  types of the exceptions raised and the text of their messages, the order in
  which results are produced, the exact text written to standard output and
  standard error, which stream each line goes to, and the exit status of each
  command-line invocation.
- Behaviour the source obtains from its language's standard library rather than
  from its own statements is part of observable behaviour and is preserved.
- Behaviour that follows from the source language's runtime, or from the
  version this project pins, rather than from the statements in the repository,
  is part of observable behaviour and is preserved.
- Error and failure behaviour is part of observable behaviour and is preserved
  as found, not corrected.
- Every test in the source is migrated, keeping its name, its inputs, its
  assertions and its position relative to the code it covers. Tests may be
  added; none may be dropped, merged or weakened.
- Both repositories build, and their tests run and pass.
- The migration is confined to the Python, to the build, CI and test files the
  port needs, and to files that give instructions for running this repository's
  own checks. Nothing else in the tree may appear in the diff, and the curated
  list itself must be carried over byte-for-byte.

Scoring:

The two implementations are executed against the same inputs and their results
compared. There is one case per test in the source suite, one case per public
function covering its return value across its input classes, one case per input
class that raises, one case per command-line invocation class covering its
standard output, its standard error and its exit status, one case per
standard-library behaviour the port takes over, and one case each for the source
build, the migrated build, the migrated typecheck, the migrated test suite, and
the patch and its split. Score = cases passed / total.

Docker is available. The migrated package must build and test with no network
access beyond its own lockfile install.
