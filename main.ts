// Token Radar: a ranked board of the protocols whose token does not exist yet.
//
// Node 22, the standard library only. The program reads the sealed snapshot, scores every pre-token
// protocol with the model in lib/value.ts, writes the ranked board to <out>/board.json, writes the
// dashboard's data to <out>/data.js, copies dashboard/ and screenshots/ into <out>, and writes
// <out>/dossier.json with the vendored make.fun library.
//
//   node main.ts --input /input/snapshot.json --output /output
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// The board is the model's claim, never make.fun's: it says what a token would be worth if the
// protocol's record stayed as it is, and it says so with the arithmetic on the page.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildBoard, dataScript, parseSnapshot, SnapshotError, verifyBoard } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's caps: the text cap shapes the bytes, the rest only refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** `--name <value>` or `--name=<value>` out of the arguments, else the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/** A bare `--name` switch out of the arguments. */
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const inputArg = arg('input', '/input/snapshot.json');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const hashOnly = flag('hash-only');

// The output directory is made before anything is scored: a run that cannot write must say so at
// once, not after the whole board has been built and thrown away on a raw fs error.
try {
  mkdirSync(out, { recursive: true });
} catch (err) {
  const reason = err instanceof Error ? err.message : String(err);
  process.stderr.write(`token radar: cannot write the output directory ${out}: ${reason}\n`);
  process.exit(2);
}

let snapshot;
try {
  snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
} catch (err) {
  if (err instanceof SnapshotError) {
    process.stderr.write(`token radar: ${err.message}\n`);
    process.exit(2);
  }
  throw err;
}

// `--verify-only` checks the board a previous run left behind instead of building a new one: it
// scores nothing and writes nothing, so a reader can re-run the check on a handed-in board.
if (flag('verify-only')) {
  const boardFile = join(out, 'board.json');
  if (!existsSync(boardFile)) {
    process.stderr.write(`token radar: no board to verify at ${boardFile}: run without --verify-only first\n`);
    process.exit(2);
  }
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(boardFile, 'utf8'));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    process.stderr.write(`token radar: cannot read the board at ${boardFile}: ${reason}\n`);
    process.exit(2);
  }
  const rows = (document as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) {
    process.stderr.write(`token radar: the board at ${boardFile} has no rows array\n`);
    process.exit(2);
  }
  const problems = verifyBoard(rows, snapshot);
  for (const problem of problems) process.stderr.write(`token radar: board check: ${problem}\n`);
  process.stdout.write(
    `token radar: board check: ${rows.length} rows, ${problems.length === 0 ? 'no problems' : `${problems.length} problem${problems.length === 1 ? '' : 's'}`}\n`,
  );
  process.exit(problems.length === 0 ? 0 : 1);
}

const { rows, radar } = buildBoard(snapshot);
const issue = boardIssue(rows, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

// The board is written; now read it back as data and check it before claiming success. A board the
// program cannot stand behind is a failure, not a warning: every problem goes to stderr and the run
// exits 1, so a broken board is never handed in.
const problems = verifyBoard(rows, snapshot);
if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`token radar: board check: ${problem}\n`);
  process.exit(1);
}
if (!hashOnly) {
  process.stdout.write(
    `token radar: board check: ${rows.length} rows, ranks 1..${rows.length}, watchlist covered, farm steps in range\n`,
  );
}

/**
 * Copy one directory's regular files into `to`, skipping names that start with a dot.
 *
 * The destination is emptied first: a stale file from an earlier run must never end up in the
 * dossier, where it would be shown as source the page does not have.
 */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  if (existsSync(to)) rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dash = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this <out> and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }),
);

// The content hash: sha256 over the exact bytes of board.json then data.js, in that order. Two runs
// that write the same board print the same line, so a reader can compare them byte for byte.
const contentHash = createHash('sha256');
contentHash.update(readFileSync(join(out, 'board.json')));
contentHash.update(readFileSync(join(out, 'data.js')));
process.stdout.write(`token radar: content sha256 ${contentHash.digest('hex')}\n`);

// `--hash-only` stops here: the hash line is the whole output, so a script can compare two runs
// without parsing the prose that follows.
if (hashOnly) process.exit(0);

const top = rows[0]!;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols scanned, ${snapshot.watchlist.length} on the watchlist, ` +
    `${radar.totals.preToken} record no token, ${radar.totals.liveToken} already trade\n` +
    `token radar: ${rows.length} rows ranked; rank 1 is ${top.name} at $${top.implied_value_usd.toLocaleString('en-US')} implied\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dash.length} files), ` +
    `${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
