// Generates scripts/internal/casedata.ts from tables dumped out of the *same*
// CPython build the original repository targets.
//
// Why this exists: JavaScript's String.prototype.toLowerCase() is not
// str.lower(), and nothing in JavaScript is str.casefold(). Both differ from
// CPython in real, reachable ways (JS toLowerCase maps U+0131 DOTLESS I to
// itself where casefold leaves it alone but folds U+00DF to "ss"; and Node's
// ICU tracks a different Unicode version than the interpreter). Pinning the
// tables to the interpreter makes the port's answers independent of whichever
// ICU the host Node happens to ship.
//
// Regenerate with `make gen-tables` after dumping py_case.json / nonprintable.json:
//
//   python - <<'EOF'
//   import json
//   cf = {cp: chr(cp).casefold() for cp in range(0x110000) if chr(cp).casefold() != chr(cp)}
//   lo = {cp: chr(cp).lower()    for cp in range(0x110000) if chr(cp).lower()    != chr(cp)}
//   json.dump({"casefold": cf, "lower": lo}, open("py_case.json", "w"))
//   EOF
import fs from 'node:fs';

const [, , caseJson, nonPrintJson, outFile] = process.argv;
const py = JSON.parse(fs.readFileSync(caseJson, 'utf8'));
const nonPrintable = JSON.parse(fs.readFileSync(nonPrintJson, 'utf8'));

/** Compress a {codepoint: replacement} map into constant-delta runs + leftovers. */
function encode(map) {
  const entries = Object.entries(map)
    .map(([cp, to]) => [Number(cp), to])
    .sort((a, b) => a[0] - b[0]);

  const runs = [];   // [start, end, delta, ...]
  const extra = {};  // multi-codepoint results, kept verbatim
  let run = null;

  const flush = () => {
    if (run) runs.push(run[0], run[1], run[2]);
    run = null;
  };

  for (const [cp, to] of entries) {
    const pts = [...to];
    if (pts.length !== 1) {
      flush();
      extra[cp] = to;
      continue;
    }
    const delta = pts[0].codePointAt(0) - cp;
    if (run && run[1] + 1 === cp && run[2] === delta) run[1] = cp;
    else {
      flush();
      run = [cp, cp, delta];
    }
  }
  flush();
  return { runs, extra };
}

const cf = encode(py.casefold);
const lo = encode(py.lower);
const flatNonPrintable = nonPrintable.flat();

const banner = `// GENERATED FILE -- do not edit by hand. See tools/gen_case_tables.mjs.
//
// Case-mapping and printability tables lifted from CPython 3.13 (the version
// pinned by the original repository's .python-version). Node's own
// toLowerCase() is not substituted for these: it disagrees with str.lower()
// on codepoints added between the two Unicode versions, and it is not
// str.casefold() at all.
`;

const fmt = (nums) => {
  const out = [];
  for (let i = 0; i < nums.length; i += 12) out.push('  ' + nums.slice(i, i + 12).join(', ') + ',');
  return out.join('\n');
};

fs.writeFileSync(
  outFile,
  `${banner}
/** Constant-delta runs, flattened as [start, end, delta, ...]. */
export const CASEFOLD_RUNS: readonly number[] = [
${fmt(cf.runs)}
];

/** Codepoints whose fold expands to more than one codepoint (e.g. U+00DF -> "ss"). */
export const CASEFOLD_EXTRA: Readonly<Record<number, string>> = ${JSON.stringify(cf.extra)};

export const LOWER_RUNS: readonly number[] = [
${fmt(lo.runs)}
];

export const LOWER_EXTRA: Readonly<Record<number, string>> = ${JSON.stringify(lo.extra)};

/** Inclusive ranges where str.isprintable() is False, flattened as [start, end, ...]. */
export const NONPRINTABLE_RANGES: readonly number[] = [
${fmt(flatNonPrintable)}
];
`,
  'utf8',
);

console.log(
  `casefold: ${cf.runs.length / 3} runs + ${Object.keys(cf.extra).length} extra; ` +
    `lower: ${lo.runs.length / 3} runs + ${Object.keys(lo.extra).length} extra; ` +
    `nonprintable: ${nonPrintable.length} ranges`,
);
