// The value model: what a protocol's token would be worth if its record stayed as it is.
//
// Every number here is derived from the snapshot's own figures. Nothing is keyed on a protocol name.
//
//   implied_value = tvl_usd
//                 x category_multiple      (calibrated from the snapshot's own live-token peers)
//                 x growth_factor          (from change_7d)
//                 x maturity_factor        (from days since listed_at, relative to as_of)
//                 x breadth_factor         (from chains.length)
//                 x size_guard             (from tvl_usd, for dust)
//
// The category multiple is the interesting part. A hardcoded table of "lending 0.55, dex 0.70" is a
// guess. The snapshot already contains the answer: 144 protocols whose token trades carry both a
// market cap and a TVL, so the median mcap/TVL of a category's live peers is an observed multiple for
// that category. We take that observation, clamp it against outliers, and shrink it toward a written
// prior by sample size (empirical Bayes). A category with 15 live peers is trusted; one with a single
// peer falls back to the prior. The prior is documented below with its rationale, and it is only ever
// a starting point that the data moves.

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

/** The model's tunable constants, stated in the dashboard and used by every row. */
export interface ModelConstants {
  /** How hard a 7-day move pushes the value: a +50% week is worth +17.5%, not +50%. */
  growth_weight: number;
  /** How hard the signed-square-root momentum read of the same move pushes the value. */
  momentum_weight: number;
  /** The 7-day move is clamped here, in per cent, so one parabolic week cannot own the board. */
  growth_clamp_pct: number;
  /** The maturity curve's peak, in days since listing. */
  maturity_peak_days: number;
  /** The maturity curve's width in log-space below the peak: young protocols keep more upside. */
  maturity_width_young: number;
  /** The maturity curve's width in log-space above the peak: old protocols decay faster. */
  maturity_width_old: number;
  /** The maturity curve's floor and lift: factor = floor + lift * bell(age). */
  maturity_floor: number;
  maturity_lift: number;
  /** The maturity factor for a protocol with no listing date: no view, so neutral. */
  maturity_unknown: number;
  /** Each extra chain beyond the first adds this much, up to `breadth_cap` extra chains. */
  breadth_step: number;
  breadth_cap: number;
  /** Below `dust_floor_usd` a protocol is scaled down; by `dust_full_usd` it is at full weight. */
  dust_floor_usd: number;
  dust_full_usd: number;
  dust_min_factor: number;
  /** The shrinkage strength: a category needs this many live peers to be half-trusted. */
  shrink_k: number;
  /** An observed category multiple is clamped into this absolute band before it is trusted. */
  observed_min: number;
  observed_max: number;
  /** The observation may move the prior by at most this factor down and up. */
  observed_band_low: number;
  observed_band_high: number;
  /** Below this many live peers an observation is noise and carries no weight at all. */
  min_peers: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.35,
  momentum_weight: 0.12,
  growth_clamp_pct: 50,
  maturity_peak_days: 300,
  maturity_width_young: 1.15,
  maturity_width_old: 0.62,
  maturity_floor: 0.72,
  maturity_lift: 0.48,
  maturity_unknown: 1,
  breadth_step: 0.04,
  breadth_cap: 5,
  dust_floor_usd: 5_000_000,
  dust_full_usd: 25_000_000,
  dust_min_factor: 0.75,
  shrink_k: 8,
  observed_min: 0.02,
  observed_max: 3,
  observed_band_low: 0.5,
  observed_band_high: 2,
  min_peers: 3,
};

export const MODEL_VERSION = 'radar-2/empirical-bayes';

/**
 * The written prior, by category class, with the reasoning for each. These are the multiples a
 * protocol's fully diluted value would carry against its TVL if the market priced it like the median
 * protocol in its class. They are deliberately conservative: a pre-token protocol has no float, no
 * price discovery and no buyback, so the prior sits below the observed median of live peers.
 *
 *   class            prior  why
 *   chain            1.00   an L1/L2 is valued on the whole economy it secures, not its TVL alone
 *   perps/options    0.85   derivatives venues earn fees on volume, which is a multiple of TVL
 *   rwa              0.80   tokenised assets carry an off-chain asset and a fee stream
 *   dex              0.70   an AMM's TVL is its inventory; fee take is thin but the venue is durable
 *   launchpad        0.60   a launchpad's TVL is idle raise capacity, but its deal flow is scarce
 *   stable/cdp       0.60   a stablecoin's TVL is its supply and its value is the seigniorage share
 *   lending          0.55   a lender's TVL is deposits; the spread is real but competes away
 *   curator/allocator 0.50  a curator's TVL is other people's capital, and its fee is a few bps
 *   yield/basis      0.45   yield wrappers are commoditised and their TVL chases the best rate
 *   prediction       0.55   a prediction market's TVL is open interest, thin but high-margin
 *   restaking/lrt    0.35   a restaking receipt is a claim on an asset that already trades
 *   bridge           0.30   a bridge's TVL is in transit and its fee is a rounding error
 *   insurance        0.25   cover is priced on loss expectancy, not on the pool it sits in
 *   unknown          0.40   no category: the middle of the table, and the model says so
 */
const PRIORS: ReadonlyArray<readonly [RegExp, number, string]> = [
  [/^(chain|l1|l2|rollup)$/i, 1.0, 'chain'],
  [/perpetual|derivative|synthetic|option|perps/i, 0.85, 'perps/options'],
  [/rwa|real world|tokeni[sz]ed/i, 0.8, 'rwa'],
  [/dex|amm|exchange|market maker|liquidity manager/i, 0.7, 'dex'],
  [/launchpad|incubator/i, 0.6, 'launchpad'],
  [/stable|cdp|collateral|reserve currency/i, 0.6, 'stable/cdp'],
  [/lend|credit|borrow/i, 0.55, 'lending'],
  [/curator|allocator|vault|index/i, 0.5, 'curator/allocator'],
  [/prediction/i, 0.55, 'prediction'],
  [/yield|farm|basis|staking pool|governance/i, 0.45, 'yield/basis'],
  [/restak|lrt|restaked|liquid staking|staking/i, 0.35, 'restaking/lrt'],
  [/bridge|cross chain|canonical/i, 0.3, 'bridge'],
  [/insurance|cover/i, 0.25, 'insurance'],
];

/** The class a category falls in, and its prior. Unseen categories land on `unknown`. */
export function categoryClass(category: string | null): { klass: string; prior: number } {
  const c = (category ?? '').trim();
  if (c === '') return { klass: 'unknown', prior: 0.4 };
  for (const [re, prior, klass] of PRIORS) if (re.test(c)) return { klass, prior };
  return { klass: 'unknown', prior: 0.4 };
}

/** A finite number, else `fallback`. */
export function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const DAY_MS = 86_400_000;

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

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: Protocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/**
 * The categories whose TVL is a claim on an asset that already trades rather than a protocol of its
 * own: a canonical bridge holds wrapped assets, a liquid staking token is a receipt for a staked
 * asset, and a CEX's "TVL" is customer custody. The house's watchlist rule excludes exactly these,
 * and so does the board: ranking WBTC as a launch opportunity would be a category error, because
 * Bitcoin's token already trades and WBTC is Bitcoin on Ethereum.
 */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name that says it is a wrapped or staked product of something else. */
const PRODUCT_NAME = /\b(wrapped|staked|staking)\b/i;

/** A name that begins with an exchange's own brand: custody, not a launch. */
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/**
 * Whether a protocol is a launch candidate: it records no token, and it is not a wrapped, staked or
 * bridged product of one that already trades. This is the watchlist's own rule, applied to the whole
 * snapshot rather than only to the protocols above the floor, so the board and the watchlist agree
 * about what a launch even is.
 */
export function isLaunchCandidate(p: Protocol): boolean {
  if (!isPreToken(p)) return false;
  if (PRODUCT_CATEGORIES.has(p.category ?? '')) return false;
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

/** One category's calibration: the prior, what the live peers show, and the multiple that results. */
export interface CategoryCalibration {
  klass: string;
  prior: number;
  /** The median mcap/TVL of the category's live-token peers, clamped; null when it has none. */
  observed: number | null;
  /** How many live peers with both a market cap and a TVL the observation rests on. */
  peers: number;
  /** The weight the observation carries: peers / (peers + shrink_k). */
  weight: number;
  /** The multiple the model uses: the shrunk blend, rounded to four places. */
  multiple: number;
}

/**
 * Calibrate every category the snapshot names from the snapshot's own live-token protocols.
 *
 * A live protocol carries a market cap and a TVL, so mcap/TVL is the multiple the market actually
 * pays for that category today. We take the median (robust to the 400x outlier a single prediction
 * market produces), clamp it into a sane band, and blend it with the written prior by sample size.
 * The result is a table that is mostly observed where the data is thick and mostly prior where it is
 * thin, and it moves if the snapshot moves.
 */
export function calibrate(protocols: Protocol[], model: ModelConstants = MODEL): Map<string, CategoryCalibration> {
  const peers = new Map<string, number[]>();
  for (const p of protocols) {
    if (isPreToken(p)) continue;
    if (p.mcap_usd === null || !(p.tvl_usd > 0)) continue;
    const key = (p.category ?? '').trim();
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    const list = peers.get(key);
    if (list === undefined) peers.set(key, [ratio]);
    else list.push(ratio);
  }
  const out = new Map<string, CategoryCalibration>();
  const seen = new Set<string>();
  for (const p of protocols) {
    const key = (p.category ?? '').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    const { klass, prior } = categoryClass(p.category);
    const list = peers.get(key) ?? [];
    // An observation is only trusted when it rests on enough peers, and even then it may only move the
    // prior within a band. One live peer in a category is an anecdote, not a multiple: a single
    // curator's market cap would otherwise reprice every curator on the board.
    const enough = list.length >= model.min_peers;
    const rawObserved = enough ? median(list) : null;
    const observed =
      rawObserved === null
        ? null
        : Math.min(
            model.observed_max,
            Math.max(model.observed_min, Math.min(prior * model.observed_band_high, Math.max(prior * model.observed_band_low, rawObserved))),
          );
    const weight = enough ? list.length / (list.length + model.shrink_k) : 0;
    const blended = observed === null ? prior : prior * (1 - weight) + observed * weight;
    out.set(key, {
      klass,
      prior,
      observed: observed === null ? null : round4(observed),
      peers: list.length,
      weight: round4(weight),
      multiple: round4(Math.min(model.observed_max, Math.max(model.observed_min, blended))),
    });
  }
  return out;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The multiple for one protocol's category, from a calibration table. */
export function multipleFor(category: string | null, table: Map<string, CategoryCalibration>): CategoryCalibration {
  const key = (category ?? '').trim();
  const hit = table.get(key);
  if (hit !== undefined) return hit;
  const { klass, prior } = categoryClass(category);
  return { klass, prior, observed: null, peers: 0, weight: 0, multiple: prior };
}

/**
 * The maturity bell: 1 at the peak, falling off in log-space on both sides.
 *
 * The curve is deliberately asymmetric. Below the peak a protocol is still finding its market, so the
 * fall-off is gentle — a 90-day-old protocol keeps most of the upside. Above the peak the fall-off is
 * steep, because a protocol that has run for years with no token has had every chance to issue one,
 * and the market has already priced that absence. A symmetric bell would treat a 60-day protocol and
 * a 1500-day one as equally likely to launch, which is the opposite of what the record says.
 */
export function maturityBell(days: number, model: ModelConstants = MODEL): number {
  if (!(days > 0)) return 0;
  const z = Math.log(days / model.maturity_peak_days);
  const width = z < 0 ? model.maturity_width_young : model.maturity_width_old;
  return Math.exp(-(z * z) / width);
}

/** The maturity factor for an age in days (null: the neutral value). */
export function maturityFactor(days: number | null, model: ModelConstants = MODEL): number {
  if (days === null) return model.maturity_unknown;
  return model.maturity_floor + model.maturity_lift * maturityBell(days, model);
}

/** The growth factor from a 7-day move in per cent (null: neutral). */
export function growthFactor(change7d: number | null, model: ModelConstants = MODEL): number {
  const raw = finite(change7d, 0);
  const clamped = Math.min(model.growth_clamp_pct, Math.max(-model.growth_clamp_pct, raw));
  return 1 + (clamped / 100) * model.growth_weight;
}

/**
 * The momentum factor: a second, smaller read of the same seven-day move, shaped so that a protocol
 * which is *growing* is rewarded more than one which is merely large, and one which is bleeding TVL is
 * penalised more than a flat one.
 *
 * The shape is a signed square root: a +4% week and a -4% week are not symmetric events, because a
 * protocol that is losing a tenth of its TVL a week is losing the deposits a launch would be priced
 * on. The square root also compresses the extremes, so the momentum term nudges the ranking instead of
 * dominating it the way a linear term would.
 */
export function momentumFactor(change7d: number | null, model: ModelConstants = MODEL): number {
  if (change7d === null || !Number.isFinite(change7d)) return 1;
  const clamped = Math.min(model.growth_clamp_pct, Math.max(-model.growth_clamp_pct, change7d));
  const shaped = Math.sign(clamped) * Math.sqrt(Math.abs(clamped) / model.growth_clamp_pct);
  return 1 + shaped * model.momentum_weight;
}

/** The chain-breadth factor: each extra chain is a little more distribution. */
export function breadthFactor(chains: string[], model: ModelConstants = MODEL): number {
  const extra = Math.min(Math.max(chains.length - 1, 0), model.breadth_cap);
  return 1 + model.breadth_step * extra;
}

/** The dust guard: a protocol under the floor is scaled down toward `dust_min_factor`. */
export function sizeGuard(tvl: number, model: ModelConstants = MODEL): number {
  if (!(tvl > model.dust_floor_usd)) return model.dust_min_factor;
  if (tvl >= model.dust_full_usd) return 1;
  const t = (tvl - model.dust_floor_usd) / (model.dust_full_usd - model.dust_floor_usd);
  return model.dust_min_factor + (1 - model.dust_min_factor) * t;
}

/** The full factor breakdown for one protocol: what the dashboard shows as the reasoning. */
export interface Explanation {
  slug: string;
  name: string;
  category: string | null;
  klass: string;
  tvl_usd: number;
  age_days: number | null;
  change_7d: number | null;
  chains: number;
  /** The category multiple and where it came from. */
  multiple: number;
  prior: number;
  observed: number | null;
  peers: number;
  weight: number;
  growth_factor: number;
  growth_clamped_pct: number;
  momentum_factor: number;
  maturity_factor: number;
  maturity_bell: number;
  breadth_factor: number;
  size_guard: number;
  /** The product of every factor, before rounding. */
  raw_value: number;
  /** The whole-dollar value the board carries. */
  implied_value_usd: number;
  /** A 0..100 confidence in the inputs, not in the price. */
  confidence: number;
  /**
   * A 0..100 launch-pressure score: how much of the model's upside is coming from the *timing* and
   * *momentum* signals rather than from raw size. It is the product of the maturity bell, the growth
   * and momentum factors and the input confidence, normalised against the best row on the board, so
   * a small protocol that is young and growing can out-score a large one that is old and flat.
   */
  pressure: number;
}

/**
 * Score one protocol. `table` is the calibration from `calibrate`; pass the same table for every row
 * so the board is one consistent model rather than a per-row guess.
 */
export function explain(p: Protocol, asOf: string, table: Map<string, CategoryCalibration>, model: ModelConstants = MODEL): Explanation {
  const cal = multipleFor(p.category, table);
  const age = ageDays(asOf, p.listed_at);
  const g = growthFactor(p.change_7d, model);
  const mo = momentumFactor(p.change_7d, model);
  const m = maturityFactor(age, model);
  const b = breadthFactor(p.chains, model);
  const s = sizeGuard(p.tvl_usd, model);
  const raw = p.tvl_usd * cal.multiple * g * mo * m * b * s;
  const implied = Math.max(1, Math.round(raw));
  const clamped = Math.min(model.growth_clamp_pct, Math.max(-model.growth_clamp_pct, finite(p.change_7d, 0)));
  // Confidence is about the inputs, never the price: a known age, a reported 7-day move, several
  // chains and a real TVL are what make a row's arithmetic trustworthy.
  let confidence = 40;
  if (age !== null) confidence += 20;
  if (p.change_7d !== null) confidence += 15;
  if (p.chains.length >= 2) confidence += 10;
  if (p.tvl_usd >= 50_000_000) confidence += 10;
  if (cal.peers >= 5) confidence += 5;
  return {
    slug: p.slug,
    name: p.name,
    category: p.category,
    klass: cal.klass,
    tvl_usd: p.tvl_usd,
    age_days: age,
    change_7d: p.change_7d,
    chains: p.chains.length,
    multiple: cal.multiple,
    prior: cal.prior,
    observed: cal.observed,
    peers: cal.peers,
    weight: cal.weight,
    growth_factor: round4(g),
    growth_clamped_pct: round4(clamped),
    momentum_factor: round4(mo),
    maturity_factor: round4(m),
    maturity_bell: round4(maturityBell(age ?? model.maturity_peak_days, model)),
    breadth_factor: round4(b),
    size_guard: round4(s),
    raw_value: Math.round(raw),
    implied_value_usd: implied,
    confidence: Math.min(100, confidence),
    // The raw pressure is the timing-and-momentum part of the model, before size. The board
    // normalises it against its own best row, so the number is comparable within one snapshot.
    pressure: Math.round(m * g * mo * (confidence / 100) * 1000) / 10,
  };
}

/** The model's one-sentence statement, for the page's footer and the dossier. */
export const MODEL_SENTENCE =
  'Implied value is TVL times a category multiple calibrated from the snapshot\'s own live-token peers, ' +
  'times a damped 7-day growth factor, times a maturity bell that peaks near ten months of running with ' +
  'no token, times a chain-breadth bonus and a dust guard.';
