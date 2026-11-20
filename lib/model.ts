// The radar's assembly: one snapshot in, one ranked board and one dashboard payload out.
//
// The board ranks the protocols that record no token — the ones still to come — by the implied value
// lib/value.ts derives from the snapshot's own figures. The protocols whose token already trades are
// kept apart in `live`, shown at the market's own value, and never ranked as an opportunity: a token
// that trades has a price, and a price is not a launch.
//
// The watchlist is the floor, never the ceiling. Every watchlist slug is on the board, and the board
// adds the pre-token protocols below the floor that the radar exists to find.
//
// Every protocol the snapshot carries is accounted for exactly once: the ones on the board are
// `ranked`, and every other one is filed by the ledger into the class that explains why it is not —
// it records a token, it is a bridge, a staking receipt, a custody brand, a versioned pool, a
// wrapped product, or simply too small. The ledger's counts sum to the snapshot's protocol count,
// so no protocol is silently dropped.
//
// Everything written to data.js is deterministic: no clock, no random, no iteration over a Set or
// Map without sorting first. Two runs over the same snapshot write the same bytes.

import { calibrate, explain, isLaunchCandidate, isPreToken, median, MODEL_SENTENCE, MODEL_VERSION, type Calibration, type Explanation, type Holdout, type ModelFit, type Protocol } from './value.ts';
import { farmPlan, planTexts, type FarmPlan } from './farm.ts';

/** The snapshot document, exactly as the sealed input carries it. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/**
 * The model's terms for one row, in log10 decades.
 *
 * Adding `intercept + tvl + age + ageMissing + momentum + chains + category` reproduces the row's
 * log10 implied value, so a reader holding only the row can re-add the arithmetic and land on the
 * dollar figure the board claims. The numbers are rounded to four places, which is a tenth of a
 * percent of the dollar figure: the sum is honest to the digit the page prints.
 */
export interface RowFactors {
  intercept: number;
  tvl: number;
  age: number;
  ageMissing: number;
  momentum: number;
  chains: number;
  category: number;
}

/** One row of board.json: the gate's shape plus the model's reasoning. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  low50: number;
  high50: number;
  low80: number;
  high80: number;
  /** The six model terms, plus the intercept, as log10 decades: re-add them to audit the value. */
  factors: RowFactors;
  /** 0..100 confidence in the inputs, never in the price. */
  confidence: number;
  /** The launch-pressure score, normalised so the board's most launch-ready row is 100. */
  pressure: number;
  farm_steps: string[];
  /** What the plan nets once gas and the capital's opportunity cost are paid. */
  verdict: 'FARM' | 'THIN' | 'SKIP';
  net_usd: number;
}

/** A plan step as the dashboard renders it: the action, its cost and its time kept apart. */
export interface RadarPlanStep {
  text: string;
  cost: string;
  time: string;
  kind: string;
}

/** A row as the dashboard renders it: the board row plus the plan's structured steps. */
export interface RadarRow extends BoardRow {
  tokenStatus: 'pre-token';
  /** Whether the house's watchlist names this protocol: the floor the board must cover. */
  on_watchlist: boolean;
  /** The plan's steps with cost and time kept apart, for the detail view's chips. */
  plan: RadarPlanStep[];
  plan_meta: {
    capital_usd: number;
    gas_usd: number;
    opportunity_usd: number;
    expected_airdrop_usd: number;
    cost_usd: number;
    hold_days: number;
    cadence_per_week: number;
    age_band: string;
    size_tier: string;
    action_class: string;
  };
}

/** A protocol whose token already trades: the market's own value, never the model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  /** The market's own multiple, mcap/TVL, for comparison with the model's claim. */
  market_multiple: number | null;
}

/** One category's fitted effect, as the dashboard shows it. */
export interface CategoryRow {
  name: string;
  /** How many live peers the gamma rests on. */
  peers: number;
  /** The fitted gamma in log10 decades; 0 for a category too thin to fit. */
  gamma: number;
  /** True when peers < 4: the category gets the size law alone, no fitted gamma. */
  size_law_only: boolean;
  /** How many board rows carry this category. */
  rows: number;
  /** The median residual of the category's live peers against the fitted surface, in decades. */
  median_resid: number;
}

/** One class of the ledger: why a protocol is, or is not, on the board. */
export interface LedgerRow {
  code: string;
  count: number;
  reason: string;
  /** Up to three protocol names from the class, the largest by TVL, so the count has a face. */
  examples: string[];
}

/** One implied-value histogram bucket. */
export interface Bucket {
  label: string;
  min: number;
  max: number;
  count: number;
}

/** The board's rows projected onto the fit: live peers at the market's value, board rows at the model's. */
export interface Scatter {
  /** `[log10_tvl, log10_mcap, klass]`: klass 0 for a live peer, 1 for a ranked pre-token row. */
  points: [number, number, number][];
  /** The fitted line across the plotted x-range: `[[x0, y0], [x1, y1]]`. */
  line: [[number, number], [number, number]];
}

/** Everything the dashboard needs, written to data.js as `window.RADAR`. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model_sentence: string;
  fit: ModelFit;
  categories: CategoryRow[];
  holdout: Holdout;
  totals: { protocols: number; watchlist: number; preToken: number; liveToken: number; rows: number; farmable: number };
  ledger: LedgerRow[];
  rows: RadarRow[];
  live: LiveRow[];
  scatter: Scatter;
  buckets: Bucket[];
  /** The board's headline figures, so the page never recomputes a total differently. */
  headline: {
    total_implied_usd: number;
    median_implied_usd: number;
    top_slug: string;
    top_name: string;
    top_value_usd: number;
    farmable: number;
    median_band50: number;
  };
}

/** How many live-token protocols the dashboard's live view carries, by market cap. */
export const LIVE_ROWS = 40;

/** The categories whose TVL is a claim on an asset that already trades rather than a protocol of its own. */
const BRIDGE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge']);
const STAKING_CATEGORIES = new Set(['Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Staking Pool']);

/** A name ending in a release marker: a versioned pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A name that says it is a wrapped or staked product of something else. */
const WRAPPED_NAME = /\b(wrapped|staked|staking)\b/i;

/** A name that begins with an exchange's own brand: custody, not a launch. */
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** Round to `places`, so the written payload is byte-identical between runs. */
function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/**
 * The protocols the board ranks: every watchlist slug, plus every launch candidate in the snapshot.
 *
 * The watchlist is the floor, never the ceiling. Every watchlist slug is on the board by fiat; and
 * so is every other protocol that records no token and is not a wrapped, staked or bridged product
 * of one that trades — including the ones above the floor that the house's rule left out for a
 * reason of its own, and the ones below the floor that the radar exists to find. There is no TVL
 * floor here: a protocol the list leaves out is no worse a subject.
 */
export function boardSubjects(snapshot: Snapshot): Protocol[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, Protocol>();
  // The watchlist first, so a slug the snapshot somehow lost is still accounted for.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (chosen.has(p.slug)) continue;
    if (isLaunchCandidate(p)) chosen.set(p.slug, p);
  }
  return [...chosen.values()];
}

/**
 * Every protocol in the snapshot filed into exactly one class, in the table's order of precedence.
 *
 * The board's subjects are `ranked`; everything else is explained by the first rule it trips: a
 * recorded token, a bridge, a staking receipt, a custody brand, a versioned pool, a wrapped product,
 * or a TVL under the snapshot's floor. The counts sum to `snapshot.protocols.length`, so the ledger
 * is a full accounting and not a sample.
 */
export function ledger(snapshot: Snapshot): LedgerRow[] {
  const subjects = new Set(boardSubjects(snapshot).map((p) => p.slug));
  const classes: { code: string; reason: string }[] = [
    { code: 'ranked', reason: 'on the board: a watchlist slug, or a protocol that records no token and is no wrapped, staked or bridged product of one that does' },
    { code: 'token', reason: 'records a market cap, a symbol or a CoinGecko id, so its token already trades and its price is the market\'s, not the model\'s' },
    { code: 'bridge', reason: 'a bridge, canonical bridge or cross-chain bridge: its TVL is a claim on assets that already trade elsewhere' },
    { code: 'staking', reason: 'a liquid staking or restaking receipt: its TVL is a claim on a staked asset that already trades' },
    { code: 'custody', reason: 'an exchange or custody brand: its TVL is customer funds, not a protocol of its own' },
    { code: 'versioned', reason: 'a versioned pool of another protocol, so its TVL belongs to the protocol whose name it carries' },
    { code: 'wrapped', reason: 'a wrapped or staked product of another protocol, so its TVL is that protocol\'s asset in another form' },
    { code: 'below', reason: 'under the snapshot\'s floor and none of the above: too small to sit beside the board' },
  ];
  const members = new Map<string, Protocol[]>();
  for (const c of classes) members.set(c.code, []);

  for (const p of snapshot.protocols) {
    if (subjects.has(p.slug)) {
      members.get('ranked')!.push(p);
    } else if (p.mcap_usd !== null || p.symbol !== null || p.gecko_id !== null) {
      members.get('token')!.push(p);
    } else if (BRIDGE_CATEGORIES.has(p.category ?? '')) {
      members.get('bridge')!.push(p);
    } else if (STAKING_CATEGORIES.has(p.category ?? '')) {
      members.get('staking')!.push(p);
    } else if (p.category === 'CEX' || EXCHANGE_NAME.test(p.name)) {
      members.get('custody')!.push(p);
    } else if (VERSIONED.test(p.name)) {
      members.get('versioned')!.push(p);
    } else if (WRAPPED_NAME.test(p.name)) {
      members.get('wrapped')!.push(p);
    } else {
      members.get('below')!.push(p);
    }
  }

  const rows: LedgerRow[] = classes.map((c, order) => {
    const list = members.get(c.code)!;
    // The examples are the class's largest protocols, so the count has a face and the choice is
    // deterministic: TVL descending, then name ascending.
    const examples = [...list]
      .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .slice(0, 3)
      .map((p) => p.name);
    return { code: c.code, count: list.length, reason: c.reason, examples };
  });

  return rows.sort((a, b) => b.count - a.count || classes.findIndex((c) => c.code === a.code) - classes.findIndex((c) => c.code === b.code));
}

/** The implied-value histogram: log decades, so a $1B row and a $2M row are both visible. */
export function histogram(values: number[]): Bucket[] {
  const edges = [0, 1e6, 5e6, 1e7, 5e7, 1e8, 5e8, 1e9, 5e9, 1e10, 1e11, 1e12];
  const labels = ['<1M', '1-5M', '5-10M', '10-50M', '50-100M', '100-500M', '0.5-1B', '1-5B', '5-10B', '10-100B', '>100B'];
  const buckets: Bucket[] = [];
  for (let i = 0; i < labels.length; i++) {
    const min = edges[i]!;
    const max = edges[i + 1]!;
    const count = values.filter((v) => v >= min && v < max).length;
    buckets.push({ label: labels[i]!, min, max, count });
  }
  return buckets;
}

/** The category table the dashboard shows: how many peers each gamma rests on, and how many rows it scores. */
function categoryTable(subjects: Protocol[], cal: Calibration): CategoryRow[] {
  const rowCounts = new Map<string, number>();
  for (const p of subjects) {
    const key = (p.category ?? 'Unknown').trim() || 'Unknown';
    rowCounts.set(key, (rowCounts.get(key) ?? 0) + 1);
  }
  const names = new Set<string>(rowCounts.keys());
  for (const c of cal.categories) if (c.name !== '') names.add(c.name);

  const rows: CategoryRow[] = [];
  for (const name of [...names].sort()) {
    const effect = cal.categories.find((c) => c.name === name) ?? null;
    rows.push({
      name,
      peers: effect?.peers ?? 0,
      gamma: effect?.gamma ?? 0,
      size_law_only: effect === null || effect.peers < 4,
      rows: rowCounts.get(name) ?? 0,
      median_resid: effect?.medianResid ?? 0,
    });
  }
  return rows.sort((a, b) => b.rows - a.rows || b.peers - a.peers || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The live peers, by market cap: a recorded market cap and a positive TVL, the same population the fit uses. */
function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && Number.isFinite(p.mcap_usd) && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      market_multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round(p.mcap_usd / p.tvl_usd, 4) : null,
    }));
}

/** The factors value.ts explains with, renamed to the six terms the page re-adds. */
function factorsOf(e: Explanation): RowFactors {
  return {
    intercept: e.factors.alpha,
    tvl: e.factors.tvl,
    age: e.factors.age,
    ageMissing: e.factors.age_missing,
    momentum: e.factors.momentum,
    chains: e.factors.chains,
    category: e.factors.category,
  };
}

/**
 * The scatter: every live peer at the market's own value (class 0) and every ranked row at the
 * model's projected value (class 1), with the fitted size law drawn across the plotted range.
 * Every number is rounded to four decimals so two runs write identical bytes.
 */
function scatterOf(snapshot: Snapshot, rows: BoardRow[], fit: ModelFit): Scatter {
  const live = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && Number.isFinite(p.mcap_usd) && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));

  const points: [number, number, number][] = [];
  for (const p of live) {
    points.push([round(Math.log10(p.tvl_usd), 4), round(Math.log10(p.mcap_usd!), 4), 0]);
  }
  for (const r of rows) {
    points.push([round(Math.log10(Math.max(r.tvl_usd, 1)), 4), round(Math.log10(Math.max(r.implied_value_usd, 1)), 4), 1]);
  }

  let x0 = Infinity;
  let x1 = -Infinity;
  for (const [x] of points) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
  }
  if (!Number.isFinite(x0) || !Number.isFinite(x1) || x1 <= x0) {
    x0 = 0;
    x1 = 1;
  }
  // The line is the fitted size law alone: the intercept plus the TVL exponent, drawn across the
  // plotted range so a reader can see how far a row sits above or below the surface.
  const line: [[number, number], [number, number]] = [
    [round(x0, 4), round(fit.alpha + fit.betaTvl * x0, 4)],
    [round(x1, 4), round(fit.alpha + fit.betaTvl * x1, 4)],
  ];
  return { points, line };
}

/** The board and the dashboard payload, from one snapshot. */
export function buildBoard(snapshot: Snapshot): { rows: BoardRow[]; radar: RadarData } {
  const cal = calibrate(snapshot.protocols, snapshot.as_of);
  const subjects = boardSubjects(snapshot);
  const watchlist = new Set(snapshot.watchlist);

  const scored = subjects.map((p) => ({ p, e: explain(p, snapshot.as_of, cal) }));
  scored.sort((a, b) => b.e.implied_value_usd - a.e.implied_value_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  const rows: BoardRow[] = [];
  const radarRows: RadarRow[] = [];
  for (let i = 0; i < scored.length; i++) {
    const { p, e } = scored[i]!;
    const plan: FarmPlan = farmPlan(p, e.age_days, e.implied_value_usd, e.low50, e.high50);
    const factors = factorsOf(e);
    const steps = planTexts(plan);
    const row: BoardRow = {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: e.age_days,
      implied_value_usd: e.implied_value_usd,
      low50: e.low50,
      high50: e.high50,
      low80: e.low80,
      high80: e.high80,
      factors,
      confidence: e.confidence,
      pressure: e.pressure,
      farm_steps: steps,
      verdict: plan.verdict,
      net_usd: plan.net_usd,
    };
    rows.push(row);
    radarRows.push({
      ...row,
      tokenStatus: 'pre-token',
      on_watchlist: watchlist.has(p.slug),
      plan: plan.steps.map((s) => ({ text: s.text, cost: s.cost, time: s.time, kind: s.kind })),
      plan_meta: {
        capital_usd: plan.capital_usd,
        gas_usd: plan.gas_usd,
        opportunity_usd: plan.opportunity_usd,
        expected_airdrop_usd: plan.expected_airdrop_usd,
        cost_usd: plan.cost_usd,
        hold_days: plan.hold_days,
        cadence_per_week: plan.cadence_per_week,
        age_band: plan.age_band,
        size_tier: plan.size_tier,
        action_class: plan.action_class,
      },
    });
  }

  const values = rows.map((r) => r.implied_value_usd);
  // The median 50% band half-width in dollars: how wide a claim the typical row carries.
  const bandWidths = rows.map((r) => r.high50 - r.implied_value_usd);
  const farmable = rows.filter((r) => r.verdict === 'FARM').length;

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model_sentence: MODEL_SENTENCE,
    fit: cal.fit,
    categories: categoryTable(subjects, cal),
    holdout: cal.holdout,
    totals: {
      protocols: snapshot.protocols.length,
      watchlist: snapshot.watchlist.length,
      preToken: snapshot.protocols.filter(isPreToken).length,
      liveToken: snapshot.protocols.filter((p) => !isPreToken(p)).length,
      rows: rows.length,
      farmable,
    },
    ledger: ledger(snapshot),
    rows: radarRows,
    live: liveRows(snapshot),
    scatter: scatterOf(snapshot, rows, cal.fit),
    buckets: histogram(values),
    headline: {
      total_implied_usd: values.reduce((n, v) => n + v, 0),
      median_implied_usd: Math.round(median(values)),
      top_slug: rows[0]?.slug ?? '',
      top_name: rows[0]?.name ?? '',
      top_value_usd: rows[0]?.implied_value_usd ?? 0,
      farmable,
      median_band50: Math.round(median(bandWidths)),
    },
  };
  return { rows, radar };
}

/**
 * Why a board is not one the gate will take, or null. This is the entry's own safety net: it checks
 * every rule the sealed scorer checks, so a bad board fails here and never at the gate.
 */
export function boardIssue(rows: BoardRow[], snapshot: Snapshot): string | null {
  if (rows.length < 100) return `the board holds ${rows.length} rows, under the 100 the gate needs`;
  if (rows.length > 4000) return `the board holds ${rows.length} rows, over the 4000 the gate allows`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of rows) {
    if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (/\s/.test(r.slug)) return `${r.slug} carries whitespace`;
    if (typeof r.name !== 'string' || r.name.trim() === '') return `${r.slug} has no name`;
    if (!Number.isSafeInteger(r.rank) || r.rank <= 0) return `${r.slug} has rank ${r.rank}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}, over the cap`;
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps?.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.implied_value_usd > rows[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (rows.length >= 2 && rows[0]!.implied_value_usd === rows[rows.length - 1]!.implied_value_usd) {
    return `all ${rows.length} rows share the same implied value $${rows[0]!.implied_value_usd}`;
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  return null;
}

/**
 * Every way the written board fails its own contract, as human-readable problems.
 *
 * This is the program checking its own output rather than trusting the code that built it: the
 * rows are read back as data, so a rank that skipped, a value that rose as rank ascended, a
 * watchlist slug that fell off or a farm step outside the gate's range is reported here. It never
 * throws — a malformed row is a problem to print, not a crash — and returns [] when the board is
 * clean.
 */
export function verifyBoard(rows: BoardRow[], snapshot: Snapshot): string[] {
  const problems: string[] = [];
  try {
    if (!Array.isArray(rows)) return ['the board is not a list of rows'];
    const list: unknown[] = rows;
    const n = list.length;
    if (n === 0) problems.push('the board holds no rows');

    const known = new Set<string>();
    for (const p of Array.isArray(snapshot?.protocols) ? snapshot.protocols : []) {
      if (p !== null && typeof p === 'object' && typeof p.slug === 'string') known.add(p.slug);
    }

    const rankCounts = new Map<number, number>();
    const seenSlugs = new Set<string>();
    const ranked: { rank: number; value: number; slug: string }[] = [];

    for (let i = 0; i < n; i++) {
      const row = list[i] as Partial<BoardRow> | null | undefined;
      if (row === null || typeof row !== 'object') {
        problems.push(`row ${i + 1} is not an object`);
        continue;
      }
      const slug = typeof row.slug === 'string' ? row.slug : '';
      const at = slug === '' ? `row ${i + 1}` : `row ${i + 1} (${slug})`;

      // The rank: a positive whole number, and the ranks together exactly 1..N.
      const rank = row.rank;
      const rankOk = typeof rank === 'number' && Number.isSafeInteger(rank) && rank > 0;
      if (!rankOk) {
        problems.push(`${at} has rank ${String(rank)}, not a positive whole number`);
      } else {
        rankCounts.set(rank, (rankCounts.get(rank) ?? 0) + 1);
      }

      // The slug: one of the snapshot's protocols.
      if (slug === '') {
        problems.push(`${at} has no slug`);
      } else {
        seenSlugs.add(slug);
        if (!known.has(slug)) problems.push(`${at}: ${slug} is not one of the snapshot's protocols`);
      }

      // The farm steps: 3 to 12 strings, each 20 to 600 characters after trimming.
      const steps = row.farm_steps;
      if (!Array.isArray(steps)) {
        problems.push(`${at} has no farm steps`);
      } else {
        if (steps.length < 3 || steps.length > 12) {
          problems.push(`${at} has ${steps.length} farm steps, not 3 to 12`);
        }
        for (let s = 0; s < steps.length; s++) {
          const step: unknown = steps[s];
          if (typeof step !== 'string') {
            problems.push(`${at} farm step ${s + 1} is not a string`);
            continue;
          }
          const text = step.trim();
          if (text.length < 20 || text.length > 600) {
            problems.push(`${at} farm step ${s + 1} is ${text.length} characters after trimming, not 20 to 600`);
          }
        }
      }

      // The implied value, kept for the monotonic check below.
      const value = row.implied_value_usd;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        problems.push(`${at} has implied value ${String(value)}`);
      } else if (rankOk) {
        ranked.push({ rank: rank as number, value, slug });
      }
    }

    // The ranks are exactly 1..N, once each.
    for (let r = 1; r <= n; r++) {
      const count = rankCounts.get(r) ?? 0;
      if (count === 0) problems.push(`rank ${r} is missing from the board`);
      else if (count > 1) problems.push(`rank ${r} appears ${count} times`);
    }
    for (const [rank, count] of rankCounts) {
      if (rank > n) problems.push(`rank ${rank} is past the board's ${n} rows${count > 1 ? ` (${count} times)` : ''}`);
    }

    // The implied value never rises as rank ascends.
    ranked.sort((a, b) => a.rank - b.rank);
    for (let i = 1; i < ranked.length; i++) {
      const prev = ranked[i - 1]!;
      const cur = ranked[i]!;
      if (cur.value > prev.value) {
        problems.push(
          `rank ${cur.rank} (${cur.slug}) has implied value $${cur.value}, above rank ${prev.rank} (${prev.slug}) at $${prev.value}`,
        );
      }
    }

    // Every watchlist slug is on the board.
    const watchlist = Array.isArray(snapshot?.watchlist) ? snapshot.watchlist : [];
    const missing = watchlist.filter((s) => typeof s === 'string' && !seenSlugs.has(s));
    if (missing.length > 0) {
      problems.push(
        `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`,
      );
    }
  } catch (err) {
    problems.push(`the board could not be checked: ${err instanceof Error ? err.message : String(err)}`);
  }
  return problems;
}

/** The dashboard's data as one script: no fetch, no network, one global. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
