// Verify an output directory against every rule the sealed scorer checks, independently of the
// entry's own boardIssue. This is the operator's check, not the grader's:
//
//   node tools/verify.mjs out
//
// It reads <out>/board.json, <out>/dashboard/, <out>/screenshots/ and <out>/dossier.json, and prints
// one line per rule with PASS or FAIL. Exit code 1 when any rule fails.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'out');
const snapshotPath = process.argv[3] ?? '/tmp/tr-kit/token-radar-01-kit/input/snapshot.json';

const results = [];
function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail: detail ?? '' });
  } catch (err) {
    results.push({ name, ok: false, detail: err.message });
  }
}
function must(cond, message) {
  if (!cond) throw new Error(message);
}

const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const knownSlugs = new Set(snapshot.protocols.map((p) => p.slug));
const watchlist = new Set(snapshot.watchlist);

// ---------------------------------------------------------------- board_file

let board = null;
check('board_file', () => {
  const path = join(out, 'board.json');
  must(existsSync(path), 'board.json is missing');
  const bytes = statSync(path).size;
  must(bytes <= 8 * 1024 * 1024, `board.json is ${bytes} bytes, over 8 MiB`);
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const rows = Array.isArray(raw) ? raw : raw.rows;
  must(Array.isArray(rows), 'board.json has no rows array');
  must(rows.length >= 100 && rows.length <= 4000, `rows is ${rows.length}, outside 100..4000`);
  const seen = new Set();
  for (const r of rows) {
    must(typeof r.slug === 'string' && r.slug.length >= 1 && r.slug.length <= 128, `bad slug ${JSON.stringify(r.slug)}`);
    must(!/\s/.test(r.slug), `slug ${r.slug} carries whitespace`);
    must(knownSlugs.has(r.slug), `slug ${r.slug} is not in the snapshot`);
    must(!seen.has(r.slug), `slug ${r.slug} appears twice`);
    seen.add(r.slug);
    must(typeof r.name === 'string' && r.name.trim() !== '', `${r.slug} has no name`);
    must(Number.isSafeInteger(r.rank) && r.rank > 0, `${r.slug} has rank ${r.rank}`);
    must(Number.isSafeInteger(r.implied_value_usd) && r.implied_value_usd > 0, `${r.slug} has implied ${r.implied_value_usd}`);
    must(r.implied_value_usd <= 100_000_000_000_000, `${r.slug} implied over the cap`);
    must(Array.isArray(r.farm_steps), `${r.slug} has no farm_steps array`);
    must(r.farm_steps.length >= 3 && r.farm_steps.length <= 12, `${r.slug} has ${r.farm_steps.length} steps`);
    for (const s of r.farm_steps) {
      must(typeof s === 'string', `${r.slug} has a non-string step`);
      const t = s.trim();
      must(t.length >= 20 && t.length <= 600, `${r.slug} has a step of ${t.length} chars`);
    }
  }
  board = rows;
  return `${rows.length} rows, ${bytes} bytes`;
});

// ---------------------------------------------------------------- sorted_by_value

check('sorted_by_value', () => {
  must(board !== null, 'no board to check');
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) must(ranks[i] === i + 1, `rank ${i + 1} is ${ranks[i]}`);
  for (let i = 1; i < board.length; i++) {
    must(board[i].implied_value_usd <= board[i - 1].implied_value_usd, `row ${i + 1} outranks row ${i}`);
  }
  const distinct = new Set(board.map((r) => r.implied_value_usd));
  must(distinct.size > 1, 'every implied value is the same');
  return `ranks 1..${board.length}, ${distinct.size} distinct values`;
});

// ---------------------------------------------------------------- coverage

check('coverage', () => {
  must(board !== null, 'no board to check');
  const have = new Set(board.map((r) => r.slug));
  const missing = [...watchlist].filter((s) => !have.has(s));
  must(missing.length === 0, `missing ${missing.length}: ${missing.slice(0, 5).join(', ')}`);
  return `all ${watchlist.size} watchlist slugs present`;
});

// ---------------------------------------------------------------- farm_steps

check('farm_steps', () => {
  must(board !== null, 'no board to check');
  const counts = new Set(board.map((r) => r.farm_steps.length));
  const lens = board.flatMap((r) => r.farm_steps.map((s) => s.trim().length));
  const plans = new Set(board.map((r) => r.farm_steps.join('|')));
  must(plans.size === board.length, `${board.length - plans.size} protocols share a byte-identical plan`);
  return `step counts ${[...counts].join('/')}, lengths ${Math.min(...lens)}..${Math.max(...lens)}, all ${board.length} plans distinct`;
});

// ---------------------------------------------------------------- dashboard_files

const PLAIN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const NET = /https?:\/\//i;

function walk(root, rel = '') {
  const files = [];
  for (const e of readdirSync(rel === '' ? root : join(root, rel), { withFileTypes: true })) {
    const p = rel === '' ? e.name : `${rel}/${e.name}`;
    if (e.isDirectory()) {
      must(!e.name.startsWith('.'), `dot-directory ${p}`);
      files.push(...walk(root, p));
    } else {
      must(e.isFile(), `${p} is not a regular file`);
      must(PLAIN.test(e.name), `${p}: name is not plain`);
      files.push(p);
    }
  }
  return files;
}

check('dashboard_files', () => {
  const root = join(out, 'dashboard');
  must(existsSync(root), 'no dashboard/ directory');
  const files = walk(root);
  must(files.length <= 400, `${files.length} files, over 400`);
  const bytes = files.reduce((n, f) => n + statSync(join(root, f)).size, 0);
  must(bytes <= 4 * 1024 * 1024, `${bytes} bytes, over 4 MiB`);
  must(files.some((f) => f.endsWith('.html')), 'no .html file');
  must(files.some((f) => f.endsWith('.css')), 'no .css file');
  must(files.some((f) => f.endsWith('.js')), 'no .js file');
  must(files.includes('index.html'), 'no index.html at the root');

  // No network address in an HTML attribute, a <style> body, a CSS file, or a JS import specifier.
  for (const f of files) {
    const text = readFileSync(join(root, f), 'utf8');
    if (f.endsWith('.html')) {
      for (const m of text.matchAll(/<[^>]*>/g)) {
        const tag = m[0];
        for (const a of tag.matchAll(/\s([a-zA-Z-:]+)\s*=\s*"([^"]*)"/g)) {
          must(!NET.test(a[2]), `${f}: attribute ${a[1]} names a network address`);
        }
        for (const a of tag.matchAll(/\s([a-zA-Z-:]+)\s*=\s*'([^']*)'/g)) {
          must(!NET.test(a[2]), `${f}: attribute ${a[1]} names a network address`);
        }
      }
      for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
        must(!NET.test(m[1]), `${f}: a <style> body names a network address`);
      }
      for (const m of text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
        must(!NET.test(m[1]), `${f}: an inline script names a network address`);
      }
    }
    if (f.endsWith('.css')) must(!NET.test(text), `${f}: a CSS file names a network address`);
    if (f.endsWith('.js') || f.endsWith('.mjs')) {
      for (const m of text.matchAll(/(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/g)) {
        must(!NET.test(m[1]), `${f}: an import specifier names a network address`);
      }
      for (const m of text.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        must(!NET.test(m[1]), `${f}: a dynamic import names a network address`);
      }
      for (const m of text.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        must(!NET.test(m[1]), `${f}: a require names a network address`);
      }
    }
  }
  const sourceBytes = files.filter((f) => /\.(html|css|js|mjs)$/.test(f)).reduce((n, f) => n + statSync(join(root, f)).size, 0);
  return `${files.length} files, ${bytes} bytes (${sourceBytes} of source)`;
});

// ---------------------------------------------------------------- screenshots

function pngSize(path) {
  const b = readFileSync(path);
  must(b.length >= 24, 'too short to be a PNG');
  must(b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47, 'not a PNG');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length };
}

check('screenshots', () => {
  const root = join(out, 'screenshots');
  must(existsSync(root), 'no screenshots/ directory');
  const names = readdirSync(root, { withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name);
  must(names.length >= 3 && names.length <= 4, `${names.length} images, need 3 or 4`);
  const details = [];
  for (const n of names) {
    must(PLAIN.test(n), `${n}: name is not plain`);
    const { w, h, bytes } = pngSize(join(root, n));
    must(bytes <= 512 * 1024, `${n} is ${bytes} bytes, over 512 KiB`);
    const long = Math.max(w, h);
    const short = Math.min(w, h);
    must(long <= 1440, `${n} long side ${long} > 1440`);
    must(short >= 800, `${n} short side ${short} < 800`);
    details.push(`${n} ${w}x${h} ${(bytes / 1024).toFixed(0)}K`);
  }
  return details.join(', ');
});

// ---------------------------------------------------------------- dossier_matches

check('dossier_matches', async () => {
  const path = join(out, 'dossier.json');
  must(existsSync(path), 'dossier.json is missing');
  const bytes = statSync(path).size;
  must(bytes <= 1.5 * 1024 * 1024, `dossier is ${bytes} bytes, over 1.5 MiB`);
  const d = JSON.parse(readFileSync(path, 'utf8'));
  must(d.schema === 'makefun/dossier/v1', `schema is ${d.schema}`);
  must(Array.isArray(d.images) && d.images.length >= 3, 'fewer than 3 images');
  for (const img of d.images) {
    const raw = readFileSync(join(out, 'screenshots', img.name));
    const sha = createHash('sha256').update(raw).digest('hex');
    must(sha === img.sha256, `${img.name}: sha256 does not match the file`);
  }
  const textBytes = Buffer.byteLength(d.text, 'utf8');
  must(textBytes <= 65536, `text is ${textBytes} bytes, over 65536`);
  const cut = /\[Cut at \d+ bytes/.test(d.text);
  return `${bytes} bytes, ${d.images.length} images, text ${textBytes}/65536${cut ? ' (CUT)' : ', every source file whole'}`;
});

// ---------------------------------------------------------------- report

const pending = results.filter((r) => r.detail instanceof Promise);
for (const r of pending) r.detail = await r.detail;

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  process.stdout.write(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(18)} ${r.detail}\n`);
}
process.stdout.write(`\n${results.length - failed}/${results.length} rules pass\n`);
process.exit(failed === 0 ? 0 : 1);
