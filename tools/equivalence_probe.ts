/**
 * Run tools/cases.json through the TypeScript port.
 *
 * Emits the same tab-separated transcript as tools/reference_probe.py, so
 * `make parity` can diff the two. See that file for the rationale.
 *
 * The transcript itself is built by tests/transcript.ts, which
 * tests/parity.test.ts also uses -- so the live probe and the committed
 * regression test can never cover different ground.
 */

import process from 'node:process';

import { buildTranscript, loadCases } from '../tests/transcript.js';

process.stdout.write(buildTranscript(loadCases()).join('\n') + '\n');
