# Task: build a winning entry for make.fun bounty `token-radar-01`

You are building a competition entry. The repository root is your current working directory.
Everything must be written by you with `write_file` / `edit_file`. Do not `cp` the starter.

Reference material you may READ (never copy verbatim):
- `/tmp/tr-kit/token-radar-01-kit/starter/main.ts` — a working but ordinary entry. Read it to learn the exact I/O contract.
- `/tmp/tr-kit/token-radar-01-kit/starter/lib/model.ts` — the starter's (weak) value model.
- `/tmp/tr-kit/token-radar-01-kit/starter/dashboard/` — the starter's plain page.
- `/tmp/tr-kit/token-radar-01-kit/input/snapshot.json` — the sealed data (758 protocols, 40 on the watchlist).
- `vendor/makefun-board.ts` — ALREADY PRESENT, byte-for-byte required, DO NOT MODIFY.

## What the program must do

`main.ts` at the repository root, Node 22, **standard library only**. It must:

1. Read the snapshot from `--input <file|dir>` defaulting to `/input/snapshot.json`.
2. Build a ranked board and write `<out>/board.json` as `{"rows":[...]}`.
3. Write `<out>/data.js` — the dashboard's data, as a JS file that assigns a global, e.g. `window.RADAR = {...};`
4. Copy `dashboard/` and `screenshots/` into `<out>/`.
5. Write `<out>/dossier.json` with `buildDossier(out, { text_max_bytes: 65536, screenshots: {max:4,max_bytes:524288}, dashboard: {max_files:400,max_bytes:4194304} })` from `./vendor/makefun-board.ts`.
6. `<out>` is `--output <dir>` defaulting to `process.env.MAKEFUN_OUTPUT_DIR ?? '/output'`.

Node 22 runs `.ts` directly but only strips types: **no enums, no namespaces, no decorators, no parameter properties**. Use `import ... from './lib/x.ts'` with the explicit `.ts` extension.

## Hard gate rules (an entry failing any of these scores 0)

**board.json**
- `rows` is an array of 100 to 4000 rows, at most 8 MiB.
- Each row: `slug` (must be one of the snapshot's protocol slugs, no whitespace, once each), `name` (non-empty), `rank` (positive whole number), `implied_value_usd` (positive whole number ≤ 100,000,000,000,000), `farm_steps` (array of 3 to 12 strings, each 20 to 600 characters after trimming).
- Ranks are exactly 1..N, each once. `implied_value_usd` must NOT rise as rank ascends (rank 1 = most valuable).
- Not all implied values may be equal.
- **Every slug in `snapshot.watchlist` must appear.**

**dashboard/**
- `index.html` plus at least one `.css` and one `.js` file, anywhere under `dashboard/`.
- At most 400 files, 4 MiB total. File names: letters, digits, `.`, `_`, `-`, 1..128 chars, not starting with `.` or `-`. No directory starting with `.`.
- **No network**: no `http://` or `https://` in any HTML attribute value, `<style>` body, inline `<script>` import, CSS file, or JS import/export-from/require/dynamic-import specifier. Visible text and comments may contain URLs.
- Keep the dashboard source under **64 KB total** — the judge reads it whole only while it fits.

**screenshots/**
- 3 to 4 images, each a whole PNG, ≤ 512 KiB, long side ≤ 1440 px, short side ≥ 800 px.
- We generate these after you finish; just make sure `dashboard/` renders well at 1440×900.

## How you are judged (this is the actual scoring rubric, verbatim priorities)

1. **A working radar** — the board covers every watchlist protocol, ranks the pre-token ones by an implied value it states, and the screenshots and the code agree.
2. **The value model** — the implied value must follow from the snapshot's own figures: TVL, seven-day growth, and how long the protocol has run with no token. **Not** from a hardcoded list of names. The board must separate protocols whose token already trades from those still to come.
3. **Farm plans** — each protocol's plan gives concrete steps with what they cost and how long they take. Not slogans.
4. **The dashboard as a page** — sortable and filterable, readable at a glance, with a detail view for each protocol.
5. **It looks made** — a chosen palette, consistent spacing, type that reads, not a framework pasted wholesale.

A second AI model compares your dossier against other entries pairwise and must pick a winner. Be decisively better than an ordinary table.

## What to build, concretely

### `lib/value.ts` — the value model (this is the differentiator)

Write a transparent, defensible model. Suggested shape (improve it if you can justify it):

- A protocol is **pre-token** when `gecko_id === null && symbol === null`. Otherwise its token already trades and it is listed separately, never ranked as an opportunity.
- Base: `implied_fdv = tvl_usd × multiple(category)`.
  Build `multiple(category)` from a table of category classes with a documented rationale in a comment: e.g. lending 0.55, dex 0.70, perps 0.90, liquid staking 0.35, yield 0.45, restaking 0.40, bridge 0.30, cdp 0.60, rwa 0.80, lrt 0.35, options 0.50, insurance 0.25, launchpad 0.60, unknown 0.40. Match case-insensitively on substrings so unseen categories fall back gracefully.
- Growth factor from `change_7d` (null = neutral): `1 + clamp(change_7d, -0.5, 0.5) × 0.35`.
- Maturity factor from `listed_at` (days since listing, relative to `snapshot.as_of`): young protocols carry more upside but more risk — use a curve that peaks around 180–540 days and decays for both very new and very old, e.g. `0.85 + 0.35 × exp(-((ln(days/300))^2) / 0.9)`.
- Chain breadth: `1 + 0.04 × min(chains.length - 1, 5)`.
- Concentration/dust guard: protocols under $5M TVL scale down.
- Round to whole dollars. Make sure values are distinct enough that ranks are meaningful (never all equal).
- Export a `explain(protocol)` returning the factor breakdown so the dashboard can SHOW the reasoning for each protocol. This is a big scoring win: the detail view can display "TVL × category multiple × growth × maturity × chains = implied value".

### `lib/farm.ts` — farm plans

Generate 3 to 12 concrete steps per protocol, 20–600 chars each, **derived from the protocol's own fields** (category, chains, TVL, age, growth). Each step should name an action, an expected cost, and a time. Vary the plan by category (lending → supply/borrow, dex → provide liquidity in a range, perps → trade volume, restaking → restake LSTs, rwa → mint/redeem, etc.) and by age (a protocol listed 30 days ago gets an "early points window" step; one listed 1200 days ago gets a "legacy, low airdrop probability" step). Include at least one risk step and one "verify the claim" step. No two protocols should get byte-identical plans — vary amounts by TVL tier.

### `lib/model.ts` — assembly

`parseSnapshot(text)`, `buildBoard(snapshot)` returning `{ rows, radar }` where `radar` is the dashboard payload:
```
{
  as_of, floor_usd, source,
  totals: { protocols, watchlist, preToken, liveToken, rows },
  rows: [ { slug, name, category, chains, tvl_usd, change_7d, listed_at, age_days,
            implied_value_usd, rank, multiple, factors: {...}, farm_steps, tokenStatus } ],
  categories: [ { name, count, medianMultiple } ],
  buckets: [ { label, min, max, count } ]   // implied-value histogram
}
```
`boardIssue(board, snapshot)` returns a string when the board would fail the gate, else null. Check: row count, unique slugs that exist in the snapshot, rank sequence, monotone implied values, not-all-equal, farm step lengths, watchlist coverage. This is your own safety net.

### `dashboard/` — the page

- `index.html` — semantic structure, a `<link>` to `app.css`, a `<script src="app.js">`, and `<script src="data.js">` before it. No inline styles needed beyond nothing. No http(s) anywhere in attributes.
- `app.css` — a deliberate dark palette (pick one: e.g. deep navy #0b1020 with an amber accent #f0b429 and a mint #4ade80 for gains). Consistent 8px spacing scale. A real type scale. Table rows that read at a glance, sticky header, zebra tint, right-aligned numerics with tabular-nums.
- `app.js` — renders from `window.RADAR`:
  - **Header**: title, as-of date, three KPI cards (protocols scanned, pre-token opportunities, total implied value).
  - **Filters**: text search over name/slug/category; category chips (multi-select); a "token status" toggle (pre-token / already trading); a TVL range; a sort control (implied value, TVL, 7d growth, age, name).
  - **Board**: the ranked table. Columns: rank, name (+chains), category, TVL, 7d, age, implied value, and a small inline bar showing implied value relative to rank 1.
  - **Detail view**: clicking a row opens a panel (side drawer or expanding row) showing the full factor breakdown, the farm steps as a numbered list with cost/time chips, and the token status.
  - **Empty state** and a footer explaining the model in one sentence.
- Everything must work from `file://` with no network and no build step.

### `tools/shoot.mjs`

A Playwright script that loads `dashboard/index.html` with the generated `data.js` next to it and writes three PNGs into `screenshots/`: `1-board.png` (the full board), `2-detail.png` (a detail view open), `3-filtered.png` (a filter applied). Viewport 1440×900, deviceScaleFactor 1. It may be run by the operator, not by the grader.

## Working method (required)

1. Read the starter's `main.ts` and `lib/model.ts` first so you match the exact I/O contract.
2. Write `lib/value.ts`, then `lib/farm.ts`, then `lib/model.ts`, then `main.ts`, then the dashboard files, then `tools/shoot.mjs`.
3. After the first full version: `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /tmp/tr-kit/token-radar-01-kit/input/snapshot.json`
4. Read the real output. Then **improve** the code with `edit_file` — at least three separate edits that add real capability (e.g. better maturity curve, richer farm steps, a histogram, a keyboard shortcut). Re-run after each edit.
5. Verify the board by running your own `boardIssue` and by checking counts with `node -e`.

Start now. Read the starter files first.
