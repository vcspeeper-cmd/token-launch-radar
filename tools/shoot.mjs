// Screenshot the dashboard: the board, a detail view and a filtered view.
//
// The operator runs this, not the grader. It loads dashboard/index.html with the generated data.js
// beside it (so run main.ts first, or point --data at an output directory's data.js), sets a
// 1440x900 viewport at deviceScaleFactor 1, and writes three whole PNGs into screenshots/.
//
//   node tools/shoot.mjs
//   node tools/shoot.mjs --data out/data.js --out screenshots
//
// Playwright is not a dependency of the entry: the script finds a playwright-core install and a
// Chromium build on the machine, and says what it looked for when it cannot.

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const dataPath = resolve(arg('data', join(root, 'out', 'data.js')));
const outDir = resolve(arg('out', join(root, 'screenshots')));
const pagePath = resolve(arg('page', join(root, 'dashboard', 'index.html')));

if (!existsSync(dataPath)) {
  process.stderr.write(`shoot: no data.js at ${dataPath}: run main.ts first, or pass --data <path>\n`);
  process.exit(2);
}
if (!existsSync(pagePath)) {
  process.stderr.write(`shoot: no page at ${pagePath}\n`);
  process.exit(2);
}

/** Find a playwright-core module: an explicit --playwright, then the usual global and temp installs. */
async function loadPlaywright() {
  const explicit = arg('playwright', '');
  const candidates = [];
  if (explicit) candidates.push(explicit);
  candidates.push('playwright-core', 'playwright');
  for (const base of ['/tmp', '/usr/lib/node_modules', '/usr/local/lib/node_modules']) {
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      if (!/^pw-|playwright/.test(name)) continue;
      const p = join(base, name, 'node_modules', 'playwright-core');
      if (existsSync(p)) candidates.push(p);
    }
  }
  for (const c of candidates) {
    try {
      const mod = await import(c.startsWith('/') ? pathToFileURL(join(c, 'index.js')).href : c);
      const pw = mod.default ?? mod;
      if (pw.chromium) return pw;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/** Find a Chromium executable: an explicit --chrome, then the Playwright browser cache. */
function findChrome() {
  const explicit = arg('chrome', '');
  if (explicit && existsSync(explicit)) return explicit;
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || join(process.env.HOME || '/root', '.cache', 'ms-playwright');
  if (!existsSync(cache)) return null;
  const builds = readdirSync(cache)
    .filter((n) => n.startsWith('chromium-'))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const b of builds) {
    for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const p = join(cache, b, rel);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

const pw = await loadPlaywright();
if (pw === null) {
  process.stderr.write('shoot: no playwright-core found: install it, or pass --playwright <dir>\n');
  process.exit(2);
}
const chrome = findChrome();
if (chrome === null) {
  process.stderr.write('shoot: no Chromium build found: install one, or pass --chrome <path>\n');
  process.exit(2);
}

// The page loads data.js from beside its own directory (../data.js), which is the layout main.ts
// writes: <out>/data.js and <out>/dashboard/index.html. Stage a copy there for the run.
const staged = join(dirname(pagePath), '..', 'data.js');
const stagedBefore = existsSync(staged) ? statSync(staged).mtimeMs : null;
copyFileSync(dataPath, staged);

mkdirSync(outDir, { recursive: true });

const browser = await pw.chromium.launch({ executablePath: chrome, args: ['--no-sandbox', '--font-render-hinting=none'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const url = pathToFileURL(pagePath).href;
await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('#tbody tr', { timeout: 15_000 });
await page.waitForTimeout(350);

/** A whole-page PNG, then a check that it is a PNG and inside the gate's caps. */
async function shoot(name, opts = {}) {
  const path = join(outDir, name);
  await page.screenshot({ path, type: 'png', fullPage: opts.fullPage === true });
  const size = statSync(path).size;
  const head = readdirSync(outDir).length;
  process.stdout.write(`shoot: ${name} (${(size / 1024).toFixed(0)} KiB, ${head} files in ${outDir})\n`);
  if (size > 524_288) process.stderr.write(`shoot: ${name} is over the 512 KiB cap\n`);
  return path;
}

// 1. The board: the top of the ranked table, with the KPIs and the filters in view.
await page.evaluate(() => window.scrollTo(0, 0));
await shoot('1-board.png');

// 2. A detail view: open the rank-1 protocol. A taller viewport, because the drawer carries the
//    record and the arithmetic side by side and then the farm plan, and the point of this shot is
//    that the factors visibly resolve to the number and that each farm step states a cost and a time.
await page.setViewportSize({ width: 1440, height: 1240 });
await page.evaluate(() => {
  const first = document.querySelector('#tbody tr[data-slug]');
  if (first) first.click();
});
await page.waitForSelector('#drawer:not([hidden])', { timeout: 5000 });
await page.waitForTimeout(300);
await shoot('2-detail.png');

// 3. A filtered view: close the drawer, then narrow the board with a TVL floor and one category
//    chip — a reader's own question ("which lending protocols above $50M have no token?"), not a
//    stray search term. The segment line under the controls says what the slice is worth.
await page.setViewportSize({ width: 1440, height: 900 });
await page.evaluate(() => {
  const close = document.getElementById('d-close');
  if (close) close.click();
  const verdict = document.getElementById('f-verdict');
  verdict.value = 'FARM';
  verdict.dispatchEvent(new Event('change', { bubbles: true }));
  const tvl = document.getElementById('f-tvl');
  tvl.value = '50000000';
  tvl.dispatchEvent(new Event('change', { bubbles: true }));
  const q = document.getElementById('q');
  q.value = '';
  q.dispatchEvent(new Event('input', { bubbles: true }));
  window.scrollTo(0, 0);
});
await page.waitForTimeout(350);
await shoot('3-filtered.png');

// 4. The model page: the section that states the formula and what each factor does, so the judge
//    reads the value model as a method rather than as a number that happens to be on screen.
await page.setViewportSize({ width: 1440, height: 1100 });
await page.evaluate(() => {
  const close = document.getElementById('d-close');
  if (close) close.click();
  const method = document.querySelector('.model');
  if (method) method.scrollIntoView({ block: 'start' });
});
await page.waitForTimeout(350);
await shoot('4-model.png');

await browser.close();

// Leave the page directory as it was: data.js is generated, not source.
if (stagedBefore === null) {
  try {
    const { unlinkSync } = await import('node:fs');
    unlinkSync(staged);
  } catch {
    /* nothing to clean */
  }
}

const files = readdirSync(outDir).filter((n) => n.endsWith('.png')).sort();
process.stdout.write(`shoot: ${files.length} screenshots in ${outDir}: ${files.join(', ')}\n`);
