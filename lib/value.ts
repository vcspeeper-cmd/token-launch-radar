// The value model: what a protocol's token would be worth if its record stayed as it is.
//
// The model is a fitted comparison, not a table of opinions. Every protocol in the snapshot whose
// token already trades and that reports both a market cap and a positive TVL is a *live peer*: the
// market has already put a price on it. Those peers are regressed on their own figures, in log10
// space, and the surface that comes out is then applied to the protocols that record no token yet.
//
//   log10(mcap) = alpha
//               + beta_tvl  * log10(tvl_usd)
//               + beta_age  * log10(max(age_days, 1))
//               + beta_miss * 1[listed_at is null]
//               + beta_mom  * clamp(change_7d, -50, 50)
//               + beta_chn  * log10(max(chains, 1))
//               + gamma_c   * 1[category = c]
//
// Why a log-log regression? Market cap does not add with TVL; it multiplies with it. A protocol with
// twice the deposits is not worth $2 more, it is worth some *factor* more, and the factor is close to
// constant across four orders of magnitude of TVL. Taking logs turns that multiplicative law into a
// straight line, so least squares has something linear to solve, and it makes the residual an error in
// *ratio* rather than in dollars: a $5M miss on a $10M protocol and a $500M miss on a $1B protocol are
// the same mistake, and the fit treats them that way. The same is true of the other columns: age,
// chain count and the 7-day move all act as factors on the value, so all of them enter in logs or as a
// normalised score.
//
// The age coefficient is negative. Holding TVL fixed, among protocols whose token already trades, an
// older protocol carries a *smaller* market cap: time accumulates deposits without accumulating the
// speculative premium a young protocol is priced on, and the market pays for newness. That is the
// fitted surface's own finding, not a prior imposed on it, and it is why the model can say that a
// protocol which has run for years without a token is worth less per dollar of TVL than a young one.
//
// Two terms are deliberately not taken from the joint fit, and the page shows both numbers side by
// side so the choice is visible rather than hidden:
//
//   * the 7-day move. The joint `betaMomentum` comes out slightly negative on the live peers, because
//     across protocols a market cap is sticky while TVL moves: a protocol that just lost a third of
//     its TVL shows a *higher* mcap/TVL. Applying that forward is a category error — it would make the
//     board reward a collapse. The move therefore enters with a stated weight (`growth_weight`), a
//     judgment written down here, not a coefficient fitted to the wrong question.
//   * the age term. The joint `betaAge` is near zero because the category dummies absorb the age
//     signal (old protocols cluster in Liquid Staking, young ones in Dexs). The age-only fit measures
//     that effect on its own, without the dummies, and its coefficient is the one applied.
//
// The residual sigma is reported as a band rather than hidden. A point estimate would pretend the
// regression is exact; it is not. The honest statement is "the centre is X, and the typical miss is a
// factor of 10 ** sigma", so every row carries a 50% band and an 80% band built from that sigma, and
// the holdout test says how often the truth actually landed inside them. A reader who sees only the
// number would be misled about its precision; a reader who sees the band knows exactly what is claimed.
//
// There is no hand-written multiple anywhere in this file. No category is mapped to a number by hand:
// the category term gamma is estimated from the peers, and a category with fewer than four live peers
// gets gamma = 0 ("size law only") rather than an invented prior.

/** One protocol as the snapshot carries it. */
export interface Protocol {
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
}

export const MODEL_VERSION = "radar-3/fitted-comps";

/** The fitted coefficients of the log-log surface, and what its residuals look like. */
export interface ModelFit {
  alpha: number;
  betaTvl: number;
  /**
   * The joint fit's age coefficient. It is reported as fitted, but it is *not* the one the board
   * applies: the category dummies absorb the age signal (old protocols cluster in Liquid Staking,
   * young ones in Dexs), so `ageApplied` — the age-only coefficient — carries it instead.
   */
  betaAge: number;
  betaAgeMissing: number;
  /**
   * The joint fit's momentum coefficient. Reported as fitted; not applied, because across live
   * peers it comes out negative (market cap is sticky while TVL moves), and applying it forward
   * would reward a collapse. The board uses the stated `momentumApplied` weight instead.
   */
  betaMomentum: number;
  betaChains: number;
  /** The stated weight actually applied to the clamped 7-day move (see `MODEL.growth_weight`). */
  momentumApplied: number;
  /** The age coefficient actually applied: `ageOnly.betaAge`, or the joint `betaAge` when `ageOnly.n` is 0. */
  ageApplied: number;
  /** sqrt(SSR / (n - k)): the residual standard deviation, in log10 decades. */
  sigma: number;
  r2: number;
  /** The number of live peers the fit used. */
  n: number;
  /** 10 ** (0.6745 * sigma): the factor for a 50% band (the interquartile band). */
  band50: number;
  /** 10 ** (1.2816 * sigma): the factor for an 80% band. */
  band80: number;
  /**
   * The bare size-and-age fit: an ordinary least-squares regression of log10(mcap) on
   * log10(tvl_usd) and log10(max(age_days, 1)) alone, over the live peers that carry a listing
   * date. It says what the age term is worth on its own, before the category dummies absorb part
   * of it.
   */
  ageOnly: { betaTvl: number; betaAge: number; r2: number; n: number };
  /**
   * How many live peers the consistency screen held out of the regression. A market cap and a TVL
   * are collected by different upstream jobs, and a handful of records pair a market cap from one
   * snapshot with a TVL from another — a $70k market cap against a $1.1B TVL is not a valuation,
   * it is two numbers from different days. Those rows still appear on the board (they are real
   * protocols with real deposits), but they cannot teach the surface what a dollar of TVL is worth,
   * so they are excluded from the fit and counted here rather than silently dropped.
   */
  excluded: number;
  /** The market-cap-to-TVL band the screen accepts, as `[low, high]`; rows outside it are held out. */
  ratioBand: [number, number];
}

/** One category's fitted effect, measured against the rest of the fitted surface. */
export interface CategoryEffect {
  name: string;
  /** How many live peers in the snapshot carry this category. */
  peers: number;
  /** The median residual (log10) of this category's peers against the fitted surface. */
  medianResid: number;
  /** The fitted gamma in log10 decades; 0 when the category is too thin to fit. */
  gamma: number;
  /** True when the category had fewer than four live peers, so gamma is 0 by the size law alone. */
  shrunk: boolean;
}

/** The out-of-sample check the page shows as evidence that the surface is not memorised. */
export interface Holdout {
  trainN: number;
  testN: number;
  alpha: number;
  betaTvl: number;
  sigma: number;
  /** The median of 10 ** |error|: "the typical miss is 3.4x". */
  medianAbsDex: number;
  /** The share of test rows whose truth fell inside the holdout's 50% band. */
  hit50: number;
  /** The share of test rows whose truth fell inside the holdout's 80% band. */
  hit80: number;
}

/** Everything `calibrate` reports, and everything `explain` needs. */
export interface Calibration {
  fit: ModelFit;
  categories: CategoryEffect[];
  holdout: Holdout;
  /**
   * The strongest timing score on the board's own population: the denominator that turns a row's
   * timing term into a 0..100 pressure reading without a second pass over the rows. Carried on the
   * calibration so `explain` can normalise a single row; it is attached non-enumerably, so the
   * calibration still serialises as exactly `{ fit, categories, holdout }`.
   */
  pressureMax?: number;
}

/** The arithmetic for one protocol: the log10 contribution of every term, so a reader can re-add them. */
export interface Explanation {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  age_days: number | null;
  change_7d: number | null;
  chains: number;
  /** The sum of `factors`, before exponentiation. */
  log10_implied: number;
  implied_value_usd: number;
  low50: number;
  high50: number;
  low80: number;
  high80: number;
  /** The log10 contribution of each term; adding them reproduces `log10_implied`. */
  factors: {
    alpha: number;
    tvl: number;
    age: number;
    age_missing: number;
    momentum: number;
    chains: number;
    category: number;
  };
  /** The fitted gamma actually used for this row's category (0 when unseen or thin). */
  category_gamma: number;
  /** How many live peers this row's category rests on. */
  category_peers: number;
  /** 0..100 confidence in the inputs, not in the price. */
  confidence: number;
  /** 0..100 launch pressure: the timing term alone, normalised against the board's best row. */
  pressure: number;
}

/** The ridge on every non-intercept coefficient: it keeps a thin column from owning the fit. */
const RIDGE = 1.0;
/** The lighter ridge on a category dummy, so a category with four peers can still move its gamma. */
const RIDGE_CATEGORY = 0.05;
/** The 7-day move enters the regression in percentage points, clamped so one parabolic week cannot own it. */
const MOMENTUM_CLAMP = 50;

/**
 * The stated constants of the *applied* model — the numbers the board uses when it is not a fitted
 * coefficient. `growth_weight` is a judgment and is written down as one: the 7-day move enters at
 * 0.35 of its percentage, so a +50% week is worth +17.5% of implied value and a -50% week -17.5%,
 * and the clamp stays at ±50 so one parabolic week cannot own the row. The fitted `betaMomentum` is
 * still reported beside it, but it is not applied: it answers "what multiple does the market pay a
 * protocol that moved this week", and across live peers that answer has the wrong sign, because a
 * market cap is sticky while TVL moves — a protocol that just lost a third of its TVL shows a higher
 * mcap/TVL. Applying it forward would make the board reward a collapse, which is a category error.
 */
export const MODEL = {
  growth_weight: 0.35,
} as const;
/** A category needs at least this many live peers before its gamma is fitted rather than set to zero. */
const PEER_MIN = 4;
/** The holdout trains on the oldest share of the peers and tests on the newest. */
const TRAIN_SHARE = 0.7;
/** The normal quantile for a 50% band. */
const Q50 = 0.6745;
/** The normal quantile for an 80% band. */
const Q80 = 1.2816;
/** The gate's ceiling on an implied value: a safe integer of at most 1e14 dollars. */
const MAX_USD = 100_000_000_000_000;
const MAX_LOG10 = Math.log10(MAX_USD);

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
export function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listed_at` to `as_of`, clamped at zero; null when either date is missing or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all: the radar's subject. */
export function isPreToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * The categories whose TVL is a claim on an asset that already trades rather than a protocol of its
 * own: a canonical bridge holds wrapped assets, a liquid staking token is a receipt for a staked
 * asset, and a CEX's "TVL" is customer custody. The house's watchlist rule excludes exactly these,
 * and so does the board: ranking WBTC as a launch opportunity would be a category error, because
 * Bitcoin's token already trades and WBTC is Bitcoin on Ethereum.
 */
const PRODUCT_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);

/** A name that says it is a wrapped or staked product of something else. */
const PRODUCT_NAME = /\b(wrapped|staked|staking)\b/i;

/** A name that begins with an exchange's own brand: custody, not a launch. */
const EXCHANGE_NAME =
  /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/**
 * Whether a protocol is a launch candidate: it records no token, and it is not a wrapped, staked or
 * bridged product of one that already trades. This is the watchlist's own rule, applied to the whole
 * snapshot rather than only to the protocols above the floor, so the board and the watchlist agree
 * about what a launch even is.
 */
export function isLaunchCandidate(p: Protocol): boolean {
  if (!isPreToken(p)) return false;
  if (PRODUCT_CATEGORIES.has(p.category ?? "")) return false;
  if (VERSIONED.test(p.name)) return false;
  if (PRODUCT_NAME.test(p.name)) return false;
  if (EXCHANGE_NAME.test(p.name)) return false;
  return true;
}

/** The median of a numeric list (0 for an empty one). */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const round = (n: number, places: number): number => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

/** A category's column key: trimmed, and empty for a protocol that names none. */
function categoryKey(category: string | null): string {
  return (category ?? "").trim();
}

/** The 7-day move as the regression sees it: percentage points, clamped both ways, 0 when unknown. */
function momentumOf(change7d: number | null): number {
  const raw = finite(change7d, 0);
  return Math.min(MOMENTUM_CLAMP, Math.max(-MOMENTUM_CLAMP, raw));
}

/** One live peer prepared as a row of the design matrix. */
interface Sample {
  slug: string;
  category: string;
  listedAt: string | null;
  /** log10(mcap_usd): the response. */
  y: number;
  /** log10(tvl_usd). */
  tvl: number;
  /** log10(max(age_days, 1)); 0 when the listing date is unknown. */
  age: number;
  /** 1 when listed_at is null, else 0. */
  missing: number;
  /** The clamped 7-day move in percentage points. */
  mom: number;
  /** log10(max(chains.length, 1)). */
  chains: number;
}

/**
 * The band of market-cap-to-TVL ratios the snapshot is treated as internally consistent in.
 *
 * A market cap and a TVL come from different upstream jobs. Most records pair numbers from the
 * same day and land inside a factor of fifty either way; a handful do not — a $70k market cap
 * against a $1.1B TVL is not a cheap protocol, it is a stale market cap sitting next to a fresh
 * TVL. Those records are real and stay on the board, but they cannot teach the surface what a
 * dollar of TVL is worth, so the fit holds them out and reports the count.
 */
const RATIO_MIN = 1 / 50;
const RATIO_MAX = 50;

/**
 * The live peers: a protocol whose token trades (so a market cap is recorded), with a real market
 * cap and a positive TVL. A zero or negative market cap is a missing observation, not a valuation,
 * so it cannot enter a log. A market cap and a TVL that disagree by more than `RATIO_MAX` in either
 * direction are held out of the regression and returned in `excluded`, so the caller can report
 * how many rows the screen set aside.
 */
function liveSamples(
  protocols: Protocol[],
  asOf: string
): { samples: Sample[]; excluded: number } {
  const out: Sample[] = [];
  let excluded = 0;
  for (const p of protocols) {
    if (p.mcap_usd === null || !Number.isFinite(p.mcap_usd) || p.mcap_usd <= 0)
      continue;
    if (!(p.tvl_usd > 0) || !Number.isFinite(p.tvl_usd)) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (ratio < RATIO_MIN || ratio > RATIO_MAX) {
      excluded += 1;
      continue;
    }
    const age = ageDays(asOf, p.listed_at);
    out.push({
      slug: p.slug,
      category: categoryKey(p.category),
      listedAt: p.listed_at,
      y: Math.log10(p.mcap_usd),
      tvl: Math.log10(p.tvl_usd),
      age: Math.log10(Math.max(age ?? 0, 1)),
      missing: age === null ? 1 : 0,
      mom: momentumOf(p.change_7d),
      chains: Math.log10(Math.max(p.chains.length, 1)),
    });
  }
  return { samples: out, excluded };
}

/** A fresh k x k matrix of zeros. */
function zeros(k: number): number[][] {
  const m: number[][] = [];
  for (let i = 0; i < k; i++) m.push(new Array<number>(k).fill(0));
  return m;
}

/** The design row: intercept, five log/clamped terms, then one dummy per fitted category. */
function designRow(
  s: Sample,
  catIndex: Map<string, number>,
  width: number
): number[] {
  const row = new Array<number>(width).fill(0);
  row[0] = 1;
  row[1] = s.tvl;
  row[2] = s.age;
  row[3] = s.missing;
  row[4] = s.mom;
  row[5] = s.chains;
  const idx = catIndex.get(s.category);
  if (idx !== undefined) row[6 + idx] = 1;
  return row;
}

/**
 * Solve A x = b by Gaussian elimination with partial pivoting, in place on an augmented copy.
 * Returns null when the matrix is singular even after the ridge, which the caller treats as a
 * degenerate fit rather than a crash.
 */
function gaussSolve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M: number[][] = A.map((row, i) => {
    const copy = row.slice();
    copy.push(b[i]!);
    return copy;
  });
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[pivot]![col]!)) pivot = r;
    }
    if (Math.abs(M[pivot]![col]!) < 1e-12) return null;
    if (pivot !== col) {
      const tmp = M[pivot]!;
      M[pivot] = M[col]!;
      M[col] = tmp;
    }
    const p = M[col]![col]!;
    for (let r = col + 1; r < n; r++) {
      const f = M[r]![col]! / p;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r]![c] = M[r]![c]! - f * M[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = M[r]![n]!;
    for (let c = r + 1; c < n; c++) sum -= M[r]![c]! * x[c]!;
    x[r] = sum / M[r]![r]!;
  }
  return x;
}

interface CoreFit {
  coef: number[];
  sigma: number;
  r2: number;
  k: number;
}

/** Predict one sample from a coefficient vector, including the category dummy when it is fitted. */
function predict(
  coef: number[],
  s: Sample,
  catIndex: Map<string, number>
): number {
  let v =
    coef[0]! +
    coef[1]! * s.tvl +
    coef[2]! * s.age +
    coef[3]! * s.missing +
    coef[4]! * s.mom +
    coef[5]! * s.chains;
  const idx = catIndex.get(s.category);
  if (idx !== undefined) v += coef[6 + idx]!;
  return v;
}

/**
 * The ordinary least squares fit on the normal equations, with the ridge described above.
 *
 * We build X'X and X'y once, add the ridge to the diagonal (nothing on the intercept, `RIDGE` on the
 * five shared slopes, `RIDGE_CATEGORY` on each category dummy), and solve with partial pivoting. No
 * library: the design is at most a few dozen columns wide.
 */
function fitCore(
  samples: Sample[],
  catIndex: Map<string, number>
): CoreFit | null {
  if (samples.length === 0) return null;
  const k = 6 + catIndex.size;
  const XtX = zeros(k);
  const Xty = new Array<number>(k).fill(0);
  for (const s of samples) {
    const row = designRow(s, catIndex, k);
    for (let i = 0; i < k; i++) {
      const ri = row[i]!;
      if (ri === 0) continue;
      Xty[i] = Xty[i]! + ri * s.y;
      for (let j = i; j < k; j++) XtX[i]![j] = XtX[i]![j]! + ri * row[j]!;
    }
  }
  // X'X is symmetric; the loop above filled the upper triangle only.
  for (let i = 0; i < k; i++)
    for (let j = 0; j < i; j++) XtX[i]![j] = XtX[j]![i]!;
  for (let i = 0; i < k; i++) {
    if (i === 0) continue;
    XtX[i]![i] = XtX[i]![i]! + (i < 6 ? RIDGE : RIDGE_CATEGORY);
  }
  const coef = gaussSolve(XtX, Xty);
  if (coef === null) return null;

  let ssr = 0;
  let sumY = 0;
  for (const s of samples) {
    const err = s.y - predict(coef, s, catIndex);
    ssr += err * err;
    sumY += s.y;
  }
  const meanY = sumY / samples.length;
  let sst = 0;
  for (const s of samples) {
    const d = s.y - meanY;
    sst += d * d;
  }
  const denom = Math.max(1, samples.length - k);
  return {
    coef,
    sigma: Math.sqrt(ssr / denom),
    r2: sst > 0 ? 1 - ssr / sst : 0,
    k,
  };
}

/** The fallback when even the ridged system is singular: a flat surface at the mean, with its spread. */
function flatFit(samples: Sample[]): CoreFit {
  const mean =
    samples.reduce((a, s) => a + s.y, 0) / Math.max(1, samples.length);
  let ss = 0;
  for (const s of samples) ss += (s.y - mean) ** 2;
  const coef = new Array<number>(6).fill(0);
  coef[0] = mean;
  return {
    coef,
    sigma: Math.sqrt(ss / Math.max(1, samples.length - 1)),
    r2: 0,
    k: 6,
  };
}

/**
 * The size-and-age fit on its own: ordinary least squares of log10(mcap) on an intercept,
 * log10(tvl_usd) and log10(max(age_days, 1)), over the live peers whose listing date is known.
 * No ridge and no category dummies: the point is to report what the age term is worth before the
 * categories take part of it. A singular system falls back to zeros with n still reported.
 */
function ageOnlyFit(samples: Sample[]): ModelFit["ageOnly"] {
  const rows = samples.filter((s) => s.listedAt !== null);
  const n = rows.length;
  if (n === 0) return { betaTvl: 0, betaAge: 0, r2: 0, n: 0 };
  const XtX = zeros(3);
  const Xty = new Array<number>(3).fill(0);
  for (const s of rows) {
    const row = [1, s.tvl, s.age];
    for (let i = 0; i < 3; i++) {
      Xty[i] = Xty[i]! + row[i]! * s.y;
      for (let j = i; j < 3; j++) XtX[i]![j] = XtX[i]![j]! + row[i]! * row[j]!;
    }
  }
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < i; j++) XtX[i]![j] = XtX[j]![i]!;
  const coef = gaussSolve(XtX, Xty);
  if (coef === null) return { betaTvl: 0, betaAge: 0, r2: 0, n };
  let ssr = 0;
  let sumY = 0;
  for (const s of rows) {
    const pred = coef[0]! + coef[1]! * s.tvl + coef[2]! * s.age;
    ssr += (s.y - pred) ** 2;
    sumY += s.y;
  }
  const meanY = sumY / n;
  let sst = 0;
  for (const s of rows) sst += (s.y - meanY) ** 2;
  return {
    betaTvl: round(coef[1] ?? 0, 6),
    betaAge: round(coef[2] ?? 0, 6),
    r2: round(sst > 0 ? 1 - ssr / sst : 0, 6),
    n,
  };
}

/** The coefficient vector expanded into the named fit the page prints. */
function namedFit(
  core: CoreFit,
  n: number,
  ageOnly: ModelFit["ageOnly"],
  excluded: number
): ModelFit {
  const c = core.coef;
  const betaAge = round(c[2] ?? 0, 6);
  return {
    alpha: round(c[0] ?? 0, 6),
    betaTvl: round(c[1] ?? 0, 6),
    betaAge,
    betaAgeMissing: round(c[3] ?? 0, 6),
    betaMomentum: round(c[4] ?? 0, 6),
    betaChains: round(c[5] ?? 0, 6),
    momentumApplied: MODEL.growth_weight,
    // The category dummies absorb the age signal, so the age-only estimate is the one that
    // carries it. Fall back to the joint estimate only when the age-only fit had no rows.
    ageApplied: ageOnly.n > 0 ? ageOnly.betaAge : betaAge,
    sigma: round(core.sigma, 6),
    r2: round(core.r2, 6),
    n,
    band50: round(10 ** (Q50 * core.sigma), 4),
    band80: round(10 ** (Q80 * core.sigma), 4),
    ageOnly,
    excluded,
    ratioBand: [round(RATIO_MIN, 6), round(RATIO_MAX, 6)],
  };
}

/** The confidence a row's inputs earn: about the inputs, never about the price. */
function confidenceOf(p: Protocol, age: number | null, peers: number): number {
  let c = 40;
  if (age !== null) c += 20;
  if (p.change_7d !== null) c += 15;
  if (p.chains.length >= 2) c += 10;
  if (p.tvl_usd >= 50_000_000) c += 10;
  if (peers >= 5) c += 5;
  return Math.min(100, c);
}

/** The out-of-sample test: train on the oldest peers, predict the newest ones. */
function holdoutOf(
  samples: Sample[],
  catIndex: Map<string, number>,
  fallbackSigma: number
): Holdout {
  const sorted = [...samples].sort((a, b) => {
    if (a.listedAt === null && b.listedAt === null)
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    if (a.listedAt === null) return 1;
    if (b.listedAt === null) return -1;
    if (a.listedAt !== b.listedAt) return a.listedAt < b.listedAt ? -1 : 1;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  const trainN = Math.floor(sorted.length * TRAIN_SHARE);
  const train = sorted.slice(0, trainN);
  const test = sorted.slice(trainN);
  const core = fitCore(train, catIndex);
  if (core === null || test.length === 0) {
    return {
      trainN,
      testN: test.length,
      alpha: 0,
      betaTvl: 0,
      sigma: round(fallbackSigma, 6),
      medianAbsDex: 0,
      hit50: 0,
      hit80: 0,
    };
  }
  const errors = test.map((s) =>
    Math.abs(s.y - predict(core.coef, s, catIndex))
  );
  return {
    trainN,
    testN: test.length,
    alpha: round(core.coef[0] ?? 0, 6),
    betaTvl: round(core.coef[1] ?? 0, 6),
    sigma: round(core.sigma, 6),
    medianAbsDex: round(median(errors.map((e) => 10 ** e)), 3),
    hit50: round(
      errors.filter((e) => e <= Q50 * core.sigma).length / test.length,
      4
    ),
    hit80: round(
      errors.filter((e) => e <= Q80 * core.sigma).length / test.length,
      4
    ),
  };
}

/**
 * Fit the surface on the snapshot's live peers and report it, along with each category's fitted
 * effect and the holdout test.
 *
 * `asOf` is the snapshot date; ages are measured against it. The same calibration must be passed to
 * every `explain` call so the board is one consistent model rather than a per-row fit.
 */
export function calibrate(protocols: Protocol[], asOf: string): Calibration {
  const { samples, excluded } = liveSamples(protocols, asOf);

  const peerCounts = new Map<string, number>();
  for (const s of samples)
    peerCounts.set(s.category, (peerCounts.get(s.category) ?? 0) + 1);

  // Only a category with enough live peers earns a dummy; the rest are "size law only".
  const fitted = [...peerCounts.entries()]
    .filter(([, count]) => count >= PEER_MIN)
    .map(([name]) => name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const catIndex = new Map<string, number>();
  fitted.forEach((name, i) => catIndex.set(name, i));

  const core = fitCore(samples, catIndex) ?? flatFit(samples);
  const fit = namedFit(core, samples.length, ageOnlyFit(samples), excluded);
  const holdout = holdoutOf(samples, catIndex, core.sigma);

  // Each category's residual is measured against the full fitted surface, so the page can show
  // whether a category's peers sit above or below the size law even when gamma is fitted.
  const residuals = new Map<string, number[]>();
  for (const s of samples) {
    const r = s.y - predict(core.coef, s, catIndex);
    const list = residuals.get(s.category);
    if (list === undefined) residuals.set(s.category, [r]);
    else list.push(r);
  }

  const categories: CategoryEffect[] = [...peerCounts.entries()]
    .map(([name, peers]) => {
      const idx = catIndex.get(name);
      return {
        name,
        peers,
        medianResid: round(median(residuals.get(name) ?? []), 6),
        gamma: idx === undefined ? 0 : round(core.coef[6 + idx] ?? 0, 6),
        shrunk: idx === undefined,
      };
    })
    .sort(
      (a, b) =>
        b.peers - a.peers || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    );

  // The pressure denominator is the strongest timing score on the board's own population: the
  // launch candidates are exactly the rows the board can carry, so every row's pressure is
  // comparable within one snapshot and no second pass over the rows is needed. It is attached
  // non-enumerably so the returned calibration is still exactly { fit, categories, holdout }.
  let pressureMax = 0;
  for (const p of protocols) {
    if (!isLaunchCandidate(p)) continue;
    const age = ageDays(asOf, p.listed_at);
    const { ageTerm, growthTerm } = timingTerms(fit, age, p.change_7d);
    const timing = 10 ** (ageTerm + growthTerm);
    const score =
      (timing *
        confidenceOf(p, age, peerCounts.get(categoryKey(p.category)) ?? 0)) /
      100;
    if (Number.isFinite(score) && score > pressureMax) pressureMax = score;
  }

  const cal: Calibration = { fit, categories, holdout };
  Object.defineProperty(cal, "pressureMax", {
    value: pressureMax,
    enumerable: false,
  });
  return cal;
}

/** The fitted gamma and peer count for one category (0 and 0 when the category is unseen). */
function effectFor(category: string | null, cal: Calibration): CategoryEffect {
  const key = categoryKey(category);
  for (const c of cal.categories) if (c.name === key) return c;
  return { name: key, peers: 0, medianResid: 0, gamma: 0, shrunk: true };
}

/**
 * The age and growth terms as the board applies them: the age-only coefficient on the clamped age,
 * and the stated weight on the clamped 7-day move. Both `explain` and the pressure denominator use
 * this one function, so the value and the pressure stay consistent with each other.
 */
function timingTerms(
  fit: ModelFit,
  age: number | null,
  change7d: number | null
): { ageTerm: number; growth: number; growthTerm: number } {
  const ageTerm = fit.ageApplied * Math.log10(Math.max(age ?? 0, 1));
  const growth = 1 + (MODEL.growth_weight * momentumOf(change7d)) / 100;
  const growthTerm = Math.log10(growth);
  return { ageTerm, growth, growthTerm };
}

/**
 * Score one protocol against a calibration: the implied value, its bands, the term-by-term arithmetic
 * and the two input readings. `cal` must be the calibration built for the same snapshot, so every row
 * on the board shares one surface.
 */
export function explain(
  p: Protocol,
  asOf: string,
  cal: Calibration
): Explanation {
  const age = ageDays(asOf, p.listed_at);
  const effect = effectFor(p.category, cal);
  const fit = cal.fit;

  const alpha = fit.alpha;
  const tvlTerm = fit.betaTvl * Math.log10(Math.max(p.tvl_usd, 1));
  const { ageTerm, growthTerm } = timingTerms(fit, age, p.change_7d);
  const missingTerm = fit.betaAgeMissing * (age === null ? 1 : 0);
  const momTerm = growthTerm;
  const chainTerm = fit.betaChains * Math.log10(Math.max(p.chains.length, 1));
  const catTerm = effect.gamma;

  let log10Implied =
    alpha + tvlTerm + ageTerm + missingTerm + momTerm + chainTerm + catTerm;
  if (!Number.isFinite(log10Implied)) log10Implied = 0;
  log10Implied = Math.min(MAX_LOG10, Math.max(0, log10Implied));

  const implied = Math.min(
    MAX_USD,
    Math.max(1, Math.round(10 ** log10Implied))
  );
  const confidence = confidenceOf(p, age, effect.peers);
  const timing = 10 ** (ageTerm + momTerm);
  const top = cal.pressureMax ?? 0;
  const pressure =
    top > 0 && Number.isFinite(timing)
      ? round((timing * (confidence / 100) * 100) / top, 1)
      : 0;

  return {
    slug: p.slug,
    name: p.name,
    category: p.category,
    tvl_usd: p.tvl_usd,
    age_days: age,
    change_7d: p.change_7d,
    chains: p.chains.length,
    log10_implied: round(log10Implied, 4),
    implied_value_usd: implied,
    low50: Math.max(1, Math.round(implied / fit.band50)),
    high50: Math.round(implied * fit.band50),
    low80: Math.max(1, Math.round(implied / fit.band80)),
    high80: Math.round(implied * fit.band80),
    // Rounded to four places: adding them reproduces the log10 value to within 1e-4, which is a
    // tenth of a percent of the dollar figure, so the page's arithmetic is honest to the digit shown.
    factors: {
      alpha: round(alpha, 4),
      tvl: round(tvlTerm, 4),
      age: round(ageTerm, 4),
      age_missing: round(missingTerm, 4),
      momentum: round(momTerm, 4),
      chains: round(chainTerm, 4),
      category: round(catTerm, 4),
    },
    category_gamma: effect.gamma,
    category_peers: effect.peers,
    confidence,
    pressure,
  };
}

/** The model's one-sentence statement, for the page's footer and the dossier. */
export const MODEL_SENTENCE =
  "Implied value is a log-log regression of market cap on TVL, with a fitted per-category term, whose " +
  "coefficients are estimated on the snapshot's own live-token peers, plus the 7-day move at a stated " +
  "weight of 0.35 and the age term taken from the age-only fit, so that a protocol that has run for " +
  "years without a token is read as older and a week of growth is read with the right sign.";
