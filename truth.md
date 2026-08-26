# truth.md — owainlewis/awesome-artificial-intelligence, Python to TypeScript (golden trajectory)

The ordered moves a competent run makes, from opening the task to handing over
the migrated repository. Each step says **what to do and why**; **no step states
what it evaluates to**. Derived from a completed migration with every produced
value stripped out: no captured semantic, no error message, no validation
message, no folded string, no parsed URL, no exception text, no coverage figure,
no divergence list and no case or test count appears anywhere in this file.

**Method is kept; the goldens are stripped.** What is below is complete as
method — the inventory to take before touching anything, the standard-library
semantics that have to be captured by execution before the first line of
TypeScript exists, the boundary decision that determines whether the port
preserves behaviour or merely resembles it, the order the layers are ported in,
the full set of cases both repositories must satisfy, and the check that catches
the errors a passing suite cannot see. What is deliberately **not** printed is
any observed value: what a case-folding operation does to a given character,
what a URL decomposes into, what an exception's string form is, what a decoder
does with a leading marker, which characters a class contains, what a parser
prints on a bad argument, or how many places the two implementations were found
to disagree. Those are the answer key. A run that has this file still has to
execute the Python to learn them, which is the point — the capture is Steps 3
and 4, the comparison is Step 11, and the comparison is the crux.

**No worked port of any function appears here either**, for the same reason. One
correct rendering of the URL normaliser shows a reader the whole pattern for the
rest.

---

## What is being asked

Migrate the Python in a repository to TypeScript so that the migrated repository
behaves exactly as the original does, and so that both repositories build, test
and can be shown to agree.

The source is `scraped_repos/Python/owainlewis_awesome-artificial-intelligence`
at base commit `ab1c3cceef8ab906586505a7a7a293f434280862` — **MIT licensed**,
declared in a root `LICENSE`. It is a curated list. Most of it is not program.

The tree divides sharply, and the division is the first thing to get right:

- `scripts/` and `tests/` — the whole of the Python. Two files. One
  command-line program built from a frozen dataclass and eight module-level
  functions, and one test file holding a single `unittest.TestCase`.
- `README.md`, `archive/`, `docs/`, `AUTOMATION.md`, `CONTRIBUTING.md`,
  `CURATION.md`, `LICENSE`, `.github/` — everything else. None of it is Python.

That second list is **not** inert, and treating it as inert is the first way to
get the boundary wrong. `README.md` is not documentation: it is the program's
input, the thing the program exists to police, and the fixture every end-to-end
run reads. It is carried across byte-for-byte, because a single changed
character in it changes what both implementations report. Two other files in
that list give instructions for running this repository's own checks; those
instructions name a toolchain that the migration replaces, and leaving them
pointing at the old one ships a repository whose documentation does not work.
Distinguish *content to preserve* from *instructions to retarget* before
touching either.

The Python declares **no third-party dependencies at all** — the program and its
tests are standard library only. That fact is the delta-lever, not a
simplification.

The output is `migrated_repo_TypeScript/owainlewis_awesome-artificial-intelligence`,
laid out the way the sibling migrations in the workspace are laid out,
containing the ported program in the same directory under the same name, its
tests, a Dockerfile, a Makefile, a migration record, the differential probe in
both languages, and the patch set described in Step 14.

## Delta-lever

**A zero-dependency Python program is the hardest kind to port, not the
easiest.**

Where a program leans on third-party libraries, the port's risky surface is
visible in the manifest: a reader can enumerate what must be reproduced. Here
the manifest is empty, so every behaviour worth preserving is produced by the
standard library — and the standard library is exactly where a target-language
counterpart exists under the same name, looks obviously equivalent, and is not.

This program is a thin arrangement over that standard library. Read it and count
what its own statements actually decide: very little. Nearly every value a
caller observes is decided inside a module that is not in this repository.
There are five such areas and they are not equally obvious:

1. **Text operations that appear to be one-to-one.** Splitting a document into
   lines, trimming, folding for comparison, ordering a list of strings, and the
   character class a regular expression means by its whitespace shorthand. Each
   has a target-language counterpart with the same name or an obvious shape, and
   **each of those counterparts differs** — in which characters it acts on, or
   in what it produces, or both. One of the source's operations has no
   target-language counterpart at all, and the two idioms a reader reaches for
   instead are each wrong on a different input. These differences are invisible
   in the source text and absent from the source's own fixtures.

2. **Line numbering is derived, and it is user-facing.** Every message the
   program emits is prefixed with a position computed from the split in (1). Get
   the split wrong and every message is still well-formed, still plausible, and
   points somewhere else.

3. **The URL parser is not the target's URL parser.** A key is derived from
   parsing and reassembling a URL, and that key decides whether two entries
   collide. The target language ships a parser under an obvious name which
   normalises more aggressively, on more axes, than the source's — and, more
   importantly, **does not fail where the source's fails**. One of the program's
   error paths exists only because the source's parser raises; adopting the
   target's parser deletes that path while leaving the code that handles it
   looking correct.

4. **The network client's failure taxonomy is the behaviour.** One function
   grades a link check, and it grades it by asking which *class* of failure
   occurred. The target's obvious client reports every class alike, follows
   redirects on its own terms, and retries. A substitution keeps the shape of
   the grading function and collapses the distinctions it exists to make. The
   text interpolated into those messages comes from the string form of the
   failure object, and at least one of those string forms is not what a reader
   would predict from how the object was constructed.

5. **The argument parser's output is program output.** Usage, help layout,
   abbreviation, the wording on a bad argument, and the exit status of each are
   all observable, and none of them are in the source text.

Compounding all five: the source's suite exercises five of the eight functions
and **not one of its fixtures leaves the ASCII range**. As Step 2 will show,
that is the property that matters. A port that substitutes the obvious
counterpart for every item above passes the entire migrated suite, because the
suite's inputs are precisely the inputs on which the counterparts agree.

So the lever is in **reproducing semantics determined by execution rather than
by recollection**, and in **grading the port against the running original across
a matrix broader than either suite**. Everything else here — writing TypeScript,
laying out modules, building a container — is work a competent run does
correctly without help.

## The crux

**The crux is Step 11: the port is compared against the running Python across a
shared case matrix, and the matrix is itself under test.**

A differential probe is the right instrument, and building one is not the hard
part. The hard part is that **a probe is only as good as its matrix, and a
matrix assembled from the source's own test inputs inherits every blind spot the
source's suite has**. Both implementations then agree, byte for byte, over a set
of cases that share a property neither author thought about — and the agreement
is real, and it proves nothing about inputs that lack that property.

On this migration the source's fixtures share a character-range property and a
structural one. A matrix lifted from those fixtures agrees perfectly over a port
that is wrong in every area named in the delta-lever. Cases without those
properties separate them immediately.

The step has four failure surfaces, and all four are separately fatal:

1. **Substituting the counterparts rather than reproducing them.** The target's
   URL parser, its HTTP client, its lowercasing, its trim, its line split, its
   sort, its text decoder: each is the obvious counterpart and each has
   different behaviour. This route produces a port that passes a mirrored suite,
   because the mirrored suite tests the inputs the original authors chose.
2. **Building the matrix out of the suite.** The probe is assembled by lifting
   the source tests' fixtures. It then exercises exactly what the suite already
   exercises, at greater cost and with no additional reach, and it reports
   equivalence over the region where equivalence was never in doubt.
3. **Probing the library and not the command.** The API surface is the easy
   half. Exit status per outcome class, which stream each line goes to, the
   order lines appear in, and what the parser prints when it refuses are all
   part of the behaviour, and none of them are visible from a library-level
   probe.
4. **Masking or normalising a difference instead of explaining it.** Some values
   legitimately differ between two runs of the *same* implementation. Every
   normalisation is a value not compared, so each has to be justified by
   demonstrated non-determinism and written down. Normalising a field because it
   differed is how a real divergence is retired as noise.

The first is the default route and the nearest real competitor. It is fast,
idiomatic, produces clean-looking TypeScript, and it fails on inputs no reviewer
will think to try without a captured reference to diff against.

---

## Step 0 — Take the base commit, the licence, and the boundary

Record the base commit, the licence, and the declared interpreter floor before
anything else. The floor matters: the behaviour being preserved is that of the
release this project pins, not of the language in general, and more than one of
the semantics in the delta-lever is release-specific.

Establish the boundary in writing before porting anything. Enumerate every path
in the tree and mark each one: *is the program*, *is the program's input*, *is
instructions for running the program*, or *is neither*. The second and fourth
categories are carried across byte-for-byte. The third is retargeted. Confusing
the second with the fourth is harmless; confusing it with the third is not,
because it means editing the fixture both implementations are graded on.

Read both Python files end to end. The program is small enough that this is
cheap, and everything that follows depends on knowing which standard-library
APIs are reachable and — more importantly — which of them the source reaches
*into* rather than merely calls.

Record the line counts, split into program and test. They are the honest
denominator for "did I port all of it".

## Step 1 — Establish the source's build and test baseline in a container

Use the container definition supplied outside the source tree so the specimen
stays pristine. Choose the base image from the declared interpreter floor, not
from habit.

Run the suite with per-test reporting and record the results verbatim. Then run
the program itself, in each of its argument shapes, and record what it writes,
to which stream, and what it exits with. The suite and the command are different
surfaces; the suite does not reach the command at all.

Note what the suite did **not** need in order to pass. One of the program's
modes requires the network and another requires a version-control history;
neither is exercised. That absence is a fact about the suite, and it is the
reason Steps 3, 4 and 11 exist.

## Step 2 — Measure what the source suite reaches

Instrument the source suite and record coverage per file, keeping the uncovered
ranges rather than the summary figure. Then go further than the tool does and
characterise the *inputs*, not just the lines: for every fixture the suite
supplies, note the character range it occupies and the structural forms it
contains.

Name explicitly: which functions are never called, which branches are never
entered, which argument shapes are never parsed, and which classes of input are
never supplied. The last of those is the finding that matters here and no
coverage tool will report it — a suite can reach every line of a function and
never once hand it an input on which the target language's counterpart would
disagree.

This measurement is what makes Steps 12 and 13 necessary rather than optional.
Write it down before writing any TypeScript, because after the port exists it is
tempting to read the suite as adequate.

## Step 3 — Capture the text and comparison semantics by execution

The first of two captures, and the cheaper one.

For every standard-library text operation the program uses, write a probe that
runs it inside the reference image over an input set chosen to *find*
disagreement rather than to confirm agreement: characters outside ASCII, at
category boundaries, in the control ranges, and at the edges of whichever
classes the operation is documented to act on. Enumerate the operation's domain
by exhaustion where the domain is enumerable — the answer is a table, and a
table derived by running the interpreter is evidence in a way that a table
recalled from documentation is not.

Do the same for the comparison and ordering operations, and for whatever the
regular-expression engine means by each shorthand class it is given. A
shorthand's membership is a property of the engine, not of the pattern, and it
is exactly the kind of thing both languages document loosely and implement
differently.

Two conditions decide whether this step is worth anything:

- **Capture from the interpreter the image resolves, not from documentation.**
  Documentation describes a language; the port has to match a release. Where the
  two disagree, the release governs.
- **Keep the report as a checked-in fixture** so a later regression fails a
  suite rather than waiting to be noticed by a human running a script.

Where a captured table is large, generate the ported form from the capture
rather than transcribing it, and keep the generator. A hand-copied table is a
defect waiting for a reviewer who will not check it.

## Step 4 — Capture the parsing, network and argument semantics by execution

The second capture, over the three subsystems whose behaviour is not text.

For the URL parser: capture, for each input class the program can receive, both
what it decomposes to and *whether it raises* — the raising cases are the ones
the target's parser will silently not reproduce. Include inputs whose validity
differs between the two languages' validators, inputs with authority components
the program does not obviously use, and inputs that are rejected for reasons
that have nothing to do with their syntax.

For the network client: capture the failure taxonomy rather than a transcript.
For each class of failure the grading function distinguishes, determine what
object the client raises, where in the class hierarchy it sits, and what its
string form is — that string is interpolated into user-facing output and is not
always the value it was constructed from. Capture the client's redirect policy
too, including what it does to the request method, since the grading function
sees only the final response.

For the argument parser: capture every invocation class — no arguments, each
flag, each flag with a missing or malformed value, an unknown argument, and the
help request — recording both streams and the exit status for each.

Read the source's own error paths against these captures. Where the program
dereferences without a check, or catches one class and not its sibling, that is
behaviour to reproduce, not to correct.

## Step 5 — Decide the dependency boundary, and decide it explicitly

This is the decision the whole migration turns on.

For each standard-library module the source uses, decide: reproduce its
behaviour in-tree, or map it to a target-language counterpart. Write the
decision and its reason down in the migration record before writing code.

The test to apply is not "is there a counterpart" — there always is. It is
**"is any of this module's behaviour observable to a caller?"** Where the answer
is yes, an off-the-shelf substitute changes the contract while leaving the
program's shape intact, which is the failure mode that survives review.

Where a module's behaviour is reproduced, port **the part the source reaches**,
not the module. Scope creep here is unbounded, and the captures from Steps 3 and
4 are what bound it: reproduce what was captured, and cut any probe line that
turns out to exercise a path the program never takes.

Keep the reproduced material in its own directory, separate from the ported
program, so that a reader can see at a glance which code is a translation of
this repository and which is a translation of a language runtime. The two are
audited differently and measured differently.

## Step 6 — Lay out the target tree

Mirror the source's directory structure and file names. The program keeps its
name and its position; the test file keeps its position and takes the target
ecosystem's naming convention for tests.

Add only what the port needs: a manifest, a compiler configuration, a test-runner
configuration, a container definition, a task runner, and the probe directory.
Carry the source's ignore rules forward and extend them for the new toolchain's
build output.

The manifest is upstream packaging as well as toolchain declaration — carry over
the identifying fields rather than writing a fresh one.

## Step 7 — Port bottom-up, reproduced runtime first

Text and comparison primitives first, then the parser, then the failure
hierarchy, then the network client, then the argument parser, then the
program's own functions last. Each layer compiles and is exercised against its
Step 3 or Step 4 capture before the layer above it is written.

Where the source's behaviour depends on a table, generate the table from the
capture and check the generator in. Where it depends on an algorithm, reproduce
the algorithm rather than a recorded output of it — a recorded output is a
fixture that fails silently the first time an input changes.

## Step 8 — Port the program function for function

Same names, same order, same signatures, same members. Where the source uses a
composite value as a mapping key, choose a target encoding that is provably
injective and say why; a delimiter-joined key that can collide is a defect that
appears only on inputs no test contains.

Where the source's iteration order over a mapping is observable in output, use a
target structure with the same ordering guarantee.

Reproduce every failure path, including the ones unreachable in practice. An
unreachable raise is still part of the function's contract, and removing it
makes the port fail differently from the original the day the path becomes
reachable.

## Step 9 — Port the command-line interface

Argument parsing, both output streams, the order lines are written in, which
stream each goes to, and the exit status for each outcome class, against the
Step 4 capture.

Where the parser derives a value from the program's own invocation, port **the
rule** rather than the value the rule produced in the source. Hard-coding the
source language's own file extension into the target's output is a trap that
looks like fidelity and is a bug; record the choice either way, because it is a
deliberate difference and a reader will otherwise take it for an oversight.

## Step 10 — Migrate the test suite one for one, then add to it

Port every test with its name, its fixtures and its assertions intact, in the
same order, in the file that mirrors its source file. Map each assertion helper
to the target's nearest equivalent rather than to a looser one — an
identity-comparison helper does not become a truthiness check.

Where the source uses a language feature the target lacks, reimplement it in the
test file rather than approximating it. A test that quietly does more than its
source did is no longer a mirror of it.

Then add coverage the source lacks, guided by Step 2's finding about input
classes rather than by line coverage.

## Step 11 — Differential probe against the running original  *(crux)*

Build one case matrix, held in one file, read by both probes. Two probes with
their own copies of the cases drift, and the drift hides behind a clean diff.

Populate the matrix from Steps 3 and 4 — the inputs chosen to find
disagreement — not from the suite's fixtures. Then apply the adequacy test: for
each property the initial cases share, add at least one case that lacks it, and
list the properties examined. This is the step the whole migration turns on and
it is the one easiest to skip while believing it was done.

Write the reference probe in the source language, run it inside the reference
image, and write the migrated probe to emit the same transcript format. Diff the
two whole.

For each divergence, find the cause before changing code. A divergence has a
reason that generalises; adjusting the port until the diff passes converges on
agreement inside the matrix and divergence just outside it. Expect at least one
divergence whose cause is in a layer already decided to be correct, and at least
one that no amount of reading either language's documentation would have
produced.

Re-run after the last edit, from both sides, and report the diff with its case
count so that "equivalent" is a number rather than an adjective.

## Step 12 — Compare the commands, not only the library

Run both implementations as commands over the same inputs: every argument shape
from Step 4, the real curated file, and a file crafted to produce each outcome
class. Compare exit status, both streams and the order of lines within each.

Include the modes the suite never reaches. One of them needs the network and one
needs a version-control history; construct the history rather than skipping the
mode, because it is a whole function of the program and the source's suite never
looked at it.

## Step 13 — Turn each divergence into a test

Every cause found in Steps 11 and 12 becomes a case in the migrated suite, named
for the behaviour rather than for the symptom, and documented at the site in the
port where a future reader would otherwise "fix" it. A divergence that is
understood but not pinned will return.

Add the Step 2 gaps as cases too: the functions the source never called and the
input classes it never supplied.

## Step 14 — Write the migration record, then produce the patch set

The record states how the source maps onto the port, what accounts for each
standard-library module with its reason, how the port was verified — naming each
layer of verification and what it does and does not establish — every preserved
flaw with a pointer to its site, and every place the two implementations
necessarily differ with the argument for why the difference is not observable.

Report coverage honestly. The reproduced-runtime directory is not the program
and did not exist on the source side; report it as its own group rather than
folding it into one figure, and state which side of the comparison each number
belongs to. Where the two ecosystems' tools count differently, say so instead of
presenting the numbers as directly comparable.

Recount every figure from the final tree rather than carrying forward an earlier
estimate; formatting and edits move them.

Then produce the patch set: one diff from a pristine checkout at the base commit
to the migrated tree, excluding build output, dependency directories and the
meta-files that describe the task rather than form part of the migrated
repository. Include the lockfile — the container installs from it, and a patch
that omits it does not produce a buildable tree.

Split the diff: every change to a test file in one patch, everything else in the
other. A deletion of a source-language test file is a change to a test file and
belongs with its replacement.

Verify by applying to a **fresh** pristine checkout in a scratch directory and
comparing against the working tree — never in the tree that produced it. Verify
the split by applying both patches, in either order, and comparing the result
with what the whole produces.

## Step 15 — Final gate

From a clean state, with no network beyond the lockfile install: install,
typecheck, build, test. Then run the built artefact, not merely build it. Then
the container, cold. Then the differential probe once more, both sides. Then
remove build output and dependency directories from the deliverable.

---

## The test cases

Both repositories must be brought to a state where their tests run and pass, and
the two must be shown to agree. The cases below are the required set. Each says
what it covers and where its expected value comes from — **not what that value
is**; every golden is obtained by executing the source per Steps 3, 4, 11 and 12.

### Source-side cases (the Python repository)

| # | Case | How it is satisfied |
|---|---|---|
| S0 | The source image builds cold on an interpreter satisfying the declared floor, from a base image pinned to a release rather than a floating tag | Step 1 |
| S1 | The suite runs with per-test reporting and the per-file and total results are recorded verbatim | Step 1 |
| S2 | The program is run in every argument shape and both streams and the exit status are recorded for each | Step 1, Step 4 |
| S3 | Coverage of the source's own module is measured with real instrumentation and recorded with its uncovered ranges kept | Step 2 |
| S4 | The functions the suite never calls, the branches never entered, the argument shapes never parsed and the **input classes never supplied** are each identified | Step 2 |
| S5 | Each text and comparison semantic is captured by execution over an input set chosen to find disagreement, enumerated by exhaustion where the domain is enumerable | Step 3 |
| S6 | The regular-expression engine's membership for each shorthand class the program uses is captured from the engine | Step 3 |
| S7 | The URL parser is captured per input class, recording both the decomposition **and whether it raises** | Step 4 |
| S8 | The network client's failure taxonomy is captured: the object per failure class, its position in the hierarchy, and its string form | Step 4 |
| S9 | The client's redirect policy, including its effect on the request method, is captured | Step 4 |
| S10 | The argument parser is captured for every invocation class, both streams and exit status | Step 4 |
| S11 | The file decoder's treatment of a leading marker and of malformed input is captured | Step 3 |
| S12 | The boundary is established: every path marked as program, program input, instructions, or neither | Step 0 |
| S13 | The declared interpreter floor is read from the project, and the resolved interpreter from the image | Step 0, Step 1 |

S1 is the acceptance target for M1. S4 is what makes M3–M5 necessary rather than
optional, and it is the finding no coverage tool produces.

### Migrated-side cases (the TypeScript repository)

| # | Case | Relationship to the source |
|---|---|---|
| M0 | The package installs from its lockfile, typechecks, builds, and its image builds cold with no network | mirrors S0 |
| M1 | One test per source test function: same name, same fixtures, same assertions, in the mirroring file, in the same order — and the count equals S1's | one-for-one mirror |
| M2 | Every assertion helper maps to the target's nearest equivalent, not a looser one, and any source language feature the target lacks is reimplemented rather than approximated | matches what the source's assertions check |
| M3… | One test per function the source suite never called | no source counterpart; Step 13 |
| M4… | One test per input class S4 identified as never supplied | no source counterpart; Step 13 |
| M5… | One test per divergence found in Steps 11 and 12, named for its cause | no source counterpart; Step 13 |
| M6 | Typecheck clean under the strictest available settings, with any exclusion stated explicitly and its reason recorded in the configuration | no source counterpart |
| M7 | The built artefact is executed, not merely built, and its output compared with the source's | no source counterpart; Step 15 |
| M8 | Coverage is reported with the reproduced-runtime directory as its own group, and the comparison with S3 states which figures are and are not commensurable | relates to S3 |

The migrated suite must have **at least** as many cases as the source's and must
not drop, merge, split or weaken any of M1. Additional cases are reported as
additional, never folded into a single total in a way that obscures whether the
mirror is complete.

### Equivalence cases (cross-repository)

| # | Case | Passing condition |
|---|---|---|
| E1 | Library probe | Both implementations, reading the **same** matrix file, produce identical transcripts across every public function; the diff is empty and its case count is reported |
| E2 | Matrix adequacy | For each property shared by the matrix's initial cases, at least one case lacks it — and the properties examined are listed |
| E3 | Command probe | For every argument shape: exit status identical, both streams identical, and the order of lines within each identical |
| E4 | Raising parity | For every input class on which the source raises, the port raises, with the same message text — and for every class on which it does not, the port does not |
| E5 | Mode coverage | The modes the source suite never reaches are exercised on both sides, with the prerequisites constructed rather than the modes skipped |
| E6 | Normalisation justification | Every normalised value is demonstrably non-deterministic between two runs of the *same* implementation, and the justification is written in the harness |
| E7 | Predicted-then-checked divergences | For each divergence, the cause was identified and confirmed against the original *before* code changed |
| E8 | Boundary | Nothing outside the Step 0 boundary appears in `golden.patch`, and every file marked *program input* is byte-identical on both sides |
| E9 | Patch round trip | `golden.patch` applies to a pristine checkout at the base commit, and that tree installs, builds and passes the migrated suite |
| E10 | Patch split | `fix.patch` + `test.patch` applied to a pristine checkout produce a tree identical to the one `golden.patch` produces, in either order, and every test-file change — including deletions — is in `test.patch` |

**E1–E5 are the migration's actual acceptance criteria**, and E2 is what makes
them mean anything. M1 passing is necessary and not remotely sufficient: the
source's suite reaches a minority of the program and none of its fixtures leave
the range where the obvious substitutions agree.

### Meta cases

| # | Case | Passing condition |
|---|---|---|
| X1 | Every divergence found is present in the migrated suite as a named regression case | A divergence fixed but not pinned will return |
| X2 | Preserved flaws are stated | Every behaviour the port reproduces *because* the original has it, rather than because it is correct, is named with a pointer to its site |
| X3 | Necessary differences are stated | Every behaviour the port cannot reproduce identically is named with its cause and the argument for why it is not observable |
| X4 | Generated material is generated | Any large captured table is produced by a checked-in generator from a capture, not transcribed by hand |
| X5 | Figures are recounted, not carried forward | Every count quoted in the migration record is re-derived from the final tree |
| X6 | Retargeted instructions are retargeted | Every file that tells a reader how to run this repository's checks names the migrated toolchain, and no file that is program input has been edited |

### Running the cases

Every case above is executed by one of the commands the Makefile exposes plus
the container invocations in Steps 1, 11 and 12. They are referred to so the
workflow is reproducible without guessing at invocations; **none of them states
what its output should be.** The expected values are the Steps 3, 4, 11 and 12
captures, and a run that has not performed those has nothing to compare against.

---

## Where runs break

- **The target's URL parser is adopted.** The default route, and the one that
  looks most reasonable. It normalises on axes the source's does not and it
  does not raise where the source's raises, which silently deletes one of the
  program's error paths while leaving the handler for it in place.
- **The target's HTTP client is adopted.** It reports every failure class alike,
  follows redirects on its own terms, and retries. The grading function keeps
  its shape and loses every distinction it exists to make.
- **The obvious text counterparts are used.** Line splitting, trimming, folding
  for comparison, sorting, and the regular-expression whitespace class each have
  a same-named or same-shaped counterpart that differs. None of the differences
  are visible in the source text, and none of them appear on the suite's
  fixtures.
- **The folding operation is approximated.** It has no target-language
  counterpart. The two idioms a reader reaches for instead are each wrong, on
  different inputs, and one of them is wrong in a way that looks like a fix.
- **A table is transcribed instead of generated.** Large captured tables copied
  by hand are wrong in one entry that nobody checks, and the error surfaces
  years later on one input.
- **The matrix is built from the suite's fixtures.** The probe then agrees over
  exactly the region where agreement was never in question, and reports
  equivalence with a number attached, which is worse than reporting nothing.
- **A shared property of the matrix is never questioned.** Every fixture stays
  inside one character range, or every malformed input fails the same way. The
  diff is clean and the defect is underneath it.
- **A decoder default is inherited.** The target's decoder and the source's
  disagree about a leading marker, and the option that controls it is named for
  the opposite of what it does. The disagreement changes what the first line of
  the program's input is taken to be.
- **An exception's string form is assumed to be its argument.** At least one
  class in the failure taxonomy overrides it, and that string is interpolated
  directly into user-facing output.
- **Only the library is probed.** Exit status, stream selection, line order and
  the parser's refusals are not visible from a library-level probe, and the
  suite does not reach the command at all.
- **The modes the suite never reaches are skipped on both sides.** One needs the
  network and one needs a version-control history. Skipping them leaves a whole
  function of the program ungraded by anything.
- **The program's input file is edited.** It is the fixture both implementations
  are graded on; a single changed character changes what both report, and the
  comparison then measures the edit.
- **Instructions for running the repository's checks are left pointing at the
  old toolchain** — or, worse, the file that is program input is retargeted
  along with them.
- **A divergent value is normalised instead of explained.** Retires a real
  divergence as noise, permanently.
- **A divergence is fixed by adjusting code until the diff passes.** Converges
  on agreement inside the matrix and divergence just outside it.
- **A rule is ported as the value it produced.** Where the parser derives
  something from the program's own invocation, carrying the source's answer
  across hard-codes the source language into the target's output.
- **Coverage figures from the two ecosystems are presented as comparable.** The
  tools count different things, and the reproduced-runtime directory has no
  counterpart on the source side at all.
- **The lockfile is left out of the patch.** The container installs from it; the
  patch then produces a tree that does not build.
- **The patch is generated and verified against the same tree.** It applies on
  the machine that produced it and nowhere else.
- **The patch split is asserted rather than verified.** A test-file change lands
  in the wrong patch, or a deletion is filed opposite its replacement, and
  nothing catches it because the two are never applied together and compared.
- **Meta-files are swept into the patch** because they sit in the same directory
  as the migrated repository.

## What cannot be done

The behaviour is not recoverable from the source text. The program declares no
third-party dependencies, which removes the manifest that would otherwise list
what has to be reproduced, and leaves every behaviour resting on standard-library
operations whose target-language counterparts share their names and not their
semantics. Their rules are specific to the interpreter release the project pins,
and at least one of them is specific to a table that ships with the interpreter
and drifts between releases of *both* languages independently. No amount of
reading the sources, and no amount of consulting either language's
documentation, substitutes for executing this project.

Neither is a passing suite evidence. The source's suite reaches a minority of the
program's functions, never parses an argument, never opens a socket, never
constructs a history, and never supplies an input outside the range where the
obvious substitutions agree. A migrated suite built only to mirror it inherits
every one of those properties. Judge the port on the Step 11 and Step 12 diffs,
not on a green result.

And a clean diff is not evidence either, which is this task's particular trap. A
probe over a matrix that shares an unexamined property produces a clean diff over
a port that is wrong in every area the delta-lever names. The diff is only as
strong as the matrix, and strengthening the matrix is the step that is easiest to
skip and hardest to notice having skipped.

## Sources

- **The program being migrated** —
  `scraped_repos/Python/owainlewis_awesome-artificial-intelligence` at base
  commit `ab1c3cceef8ab906586505a7a7a293f434280862`, upstream
  `https://github.com/owainlewis/awesome-artificial-intelligence`. **MIT
  licensed**, declared in the root `LICENSE`; the licence file is carried across
  unchanged and the position is recorded in the migration record. Only
  `scripts/` and `tests/` are Python; the rest of the repository is the curated
  list itself, its policy documents, and CI configuration — untouched except
  where a file gives instructions for running this repository's own checks.
- **The build and test baseline** —
  `docker/awesome-ai-python-test.Dockerfile`, kept outside the source tree so the
  specimen stays pristine, pinned to a release rather than a floating tag, and
  carrying the version-control client the program shells out to.
- **The behaviour of the standard library** — read from the interpreter inside
  that image, at the release the image resolves, by the probes of Steps 3 and 4;
  then confirmed against the Step 11 and Step 12 comparisons. Where a reading and
  a capture disagree, the capture governs.
- **The curated list** — `README.md` in the source module, carried across
  byte-for-byte because it is the fixture both implementations are graded on.
- **The layout, naming and top-level file set the migrated repository follows** —
  the sibling migrations in this workspace, in particular their separation of the
  ported program from the reproduced runtime, their probe directory, and their
  `golden.patch` / `fix.patch` / `test.patch` convention.
- **Every golden value referenced but not printed here** — obtained by executing
  the source per Steps 3, 4, 11 and 12, and preserved in the migrated repository
  as the checked-in matrix and the generated tables, so that each one is
  re-derivable rather than asserted.
