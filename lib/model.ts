// The radar's assembly: one snapshot in, one ranked board and one dashboard payload out.
//
// The board ranks the protocols that record no token — the ones still to come — by the implied value
// lib/value.ts derives from the snapshot's own figures. The protocols whose token already trades are
// kept apart in `live`, shown at the market's own value, and never ranked as an opportunity: a token
// that trades has a price, and a price is not a launch.
//
// The watchlist is the floor, never the ceiling. Every watchlist slug is on the board, and the board
// adds the pre-token protocols below the floor that the radar exists to find.

import { calibrate, explain, isLaunchCandidate, isPreToken, median, MODEL, MODEL_SENTENCE, MODEL_VERSION, type CategoryCalibration, type Explanation, type ModelConstants, type Protocol } from './value.ts';
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
  /** The category multiple the model used, and where it came from. */
  multiple: number;
  /** Every factor, so the board's number is auditable from the row alone. */
  factors: {
    category_multiple: number;
    category_prior: number;
    category_observed: number | null;
    category_peers: number;
    growth_factor: number;
    growth_clamped_pct: number;
    momentum_factor: number;
    maturity_factor: number;
    breadth_factor: number;
    size_guard: number;
  };
  confidence: number;
  /** The launch-pressure score, normalised so the board's most launch-ready row is 100. */
  pressure: number;
  farm_steps: string[];
}

/** A row as the dashboard renders it: the board row plus the plan's structured steps. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  factors: BoardRow['factors'];
  confidence: number;
  tokenStatus: 'pre-token';
  /** Whether the house's watchlist names this protocol: the floor the board must cover. */
  on_watchlist: boolean;
  /** The launch-pressure score, normalised so the board's most launch-ready row is 100. */
  pressure: number;
  farm_steps: string[];
  /** The plan's steps with cost and time kept apart, for the detail view's chips. */
  plan: { text: string; cost: string; time: string; kind: string }[];
  plan_meta: { capital_usd: number; hold_days: number; cadence_per_week: number; age_band: string; action_class: string };
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

/** One category's calibration, as the dashboard shows it. */
export interface CategoryRow {
  name: string;
  klass: string;
  count: number;
  prior: number;
  observed: number | null;
  peers: number;
  medianMultiple: number;
}

/** One implied-value histogram bucket. */
export interface Bucket {
  label: string;
  min: number;
  max: number;
  count: number;
}

/** Everything the dashboard needs, written to data.js as `window.RADAR`. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model_sentence: string;
  model: ModelConstants;
  totals: { protocols: number; watchlist: number; preToken: number; liveToken: number; rows: number };
  rows: RadarRow[];
  live: LiveRow[];
  categories: CategoryRow[];
  buckets: Bucket[];
  /** The board's headline figures, so the page never recomputes a total differently. */
  headline: { total_implied_usd: number; median_implied_usd: number; top_slug: string; top_name: string; top_value_usd: number };
}

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the dashboard's live view carries, by market cap. */
export const LIVE_ROWS = 40;

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
 * The protocols the board ranks: every launch candidate in the snapshot.
 *
 * The watchlist is the floor, never the ceiling. Every watchlist slug is a launch candidate by
 * construction, so it is on the board; and so is every other protocol that records no token and is
 * not a wrapped, staked or bridged product of one that trades — including the ones above the floor
 * that the house's rule left out for a reason of its own, and the ones below the floor that the
 * radar exists to find. A protocol the list leaves out is no worse a subject.
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

/** The category table the dashboard shows: how many rows, and the multiple the model used. */
export function categoryTable(subjects: Protocol[], table: Map<string, CategoryCalibration>): CategoryRow[] {
  const counts = new Map<string, number>();
  for (const p of subjects) {
    const key = (p.category ?? 'Unknown').trim() || 'Unknown';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const rows: CategoryRow[] = [];
  for (const [name, count] of counts) {
    const cal = table.get(name) ?? table.get('') ?? null;
    const klass = cal?.klass ?? 'unknown';
    const prior = cal?.prior ?? 0.4;
    const observed = cal?.observed ?? null;
    const peers = cal?.peers ?? 0;
    const multiple = cal?.multiple ?? prior;
    rows.push({ name, klass, count, prior, observed, peers, medianMultiple: multiple });
  }
  return rows.sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
}

/** The live-token protocols, by market cap, for the dashboard's "already trading" view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      market_multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? Math.round((p.mcap_usd / p.tvl_usd) * 1e4) / 1e4 : null,
    }));
}

/** The board and the dashboard payload, from one snapshot. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { rows: BoardRow[]; radar: RadarData } {
  const table = calibrate(snapshot.protocols, model);
  const subjects = boardSubjects(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const scored = subjects.map((p) => ({ p, e: explain(p, snapshot.as_of, table, model) }));
  scored.sort((a, b) => b.e.implied_value_usd - a.e.implied_value_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // Normalise the pressure score against the board's own best row, so 100 is the most launch-ready
  // protocol in this snapshot and every other row is read against it.
  const topPressure = scored.reduce((n, s) => Math.max(n, s.e.pressure), 0) || 1;
  const rows: BoardRow[] = [];
  const radarRows: RadarRow[] = [];
  for (let i = 0; i < scored.length; i++) {
    const { p, e } = scored[i]!;
    const plan: FarmPlan = farmPlan(p, e.age_days);
    const factors: BoardRow['factors'] = {
      category_multiple: e.multiple,
      category_prior: e.prior,
      category_observed: e.observed,
      category_peers: e.peers,
      growth_factor: e.growth_factor,
      growth_clamped_pct: e.growth_clamped_pct,
      momentum_factor: e.momentum_factor,
      maturity_factor: e.maturity_factor,
      breadth_factor: e.breadth_factor,
      size_guard: e.size_guard,
    };
    rows.push({
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
      multiple: e.multiple,
      factors,
      confidence: e.confidence,
      pressure: Math.round((e.pressure / topPressure) * 1000) / 10,
      farm_steps: planTexts(plan),
    });
    radarRows.push({
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: e.age_days,
      implied_value_usd: e.implied_value_usd,
      multiple: e.multiple,
      factors,
      confidence: e.confidence,
      tokenStatus: 'pre-token',
      on_watchlist: watchlist.has(p.slug),
      pressure: Math.round((e.pressure / topPressure) * 1000) / 10,
      farm_steps: planTexts(plan),
      plan: plan.steps.map((s) => ({ text: s.text, cost: s.cost, time: s.time, kind: s.kind })),
      plan_meta: {
        capital_usd: plan.capital_usd,
        hold_days: plan.hold_days,
        cadence_per_week: plan.cadence_per_week,
        age_band: plan.age_band,
        action_class: plan.action_class,
      },
    });
  }

  const live = liveRows(snapshot);
  const values = rows.map((r) => r.implied_value_usd);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model_sentence: MODEL_SENTENCE,
    model,
    totals: {
      protocols: snapshot.protocols.length,
      watchlist: snapshot.watchlist.length,
      preToken: snapshot.protocols.filter(isPreToken).length,
      liveToken: snapshot.protocols.filter((p) => !isPreToken(p)).length,
      rows: rows.length,
    },
    rows: radarRows,
    live,
    categories: categoryTable(subjects, table),
    buckets: histogram(values),
    headline: {
      total_implied_usd: values.reduce((n, v) => n + v, 0),
      median_implied_usd: Math.round(median(values)),
      top_slug: rows[0]?.slug ?? '',
      top_name: rows[0]?.name ?? '',
      top_value_usd: rows[0]?.implied_value_usd ?? 0,
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

export type { Explanation };
