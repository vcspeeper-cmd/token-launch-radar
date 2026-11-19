// Farm plans: what a reader should actually do about a protocol, before or after it issues a token.
//
// Every step is derived from the protocol's own record: its category decides the action, its TVL
// decides the capital and the gas, its age decides the hold window and whether an early-points window
// is still open, its chain count decides how much bridging is involved. No protocol name is ever
// special-cased, and no two protocols get the same plan because the name, the chain, the capital and
// the hold window all enter the text.
//
// A plan is 8 to 10 steps. Each step carries the action, what it costs and how long it takes, so the
// dashboard can show the cost and the time as chips beside the sentence and board.json can carry the
// same step as one string inside the gate's 20..600 character window.

import type { Protocol } from './value.ts';

/** One farm step: the action, its cost and its time, kept apart so the page can render chips. */
export interface FarmStep {
  /** The action, one sentence, no cost or time inside it. */
  text: string;
  /** What it costs, as a short phrase. */
  cost: string;
  /** How long it takes, as a short phrase. */
  time: string;
  /** What kind of step this is, so the page can colour it. */
  kind: 'setup' | 'position' | 'activity' | 'hold' | 'window' | 'risk' | 'verify' | 'exit' | 'log';
}

/** A protocol's plan: the steps, plus the figures the plan was built from. */
export interface FarmPlan {
  steps: FarmStep[];
  /** The capital one position needs, in whole dollars. */
  capital_usd: number;
  /** The hold window in days. */
  hold_days: number;
  /** The weekly qualifying actions the plan asks for. */
  cadence_per_week: number;
  /** The age band the plan was written for. */
  age_band: 'new' | 'young' | 'established' | 'legacy' | 'unknown';
  /** The size tier the capital and the competition note came from. */
  size_tier: 'mega' | 'large' | 'mid' | 'small' | 'micro';
  /** The category class the action came from. */
  action_class: string;
}

/** The age band a protocol falls in, from its days since listing. */
export function ageBand(age: number | null): FarmPlan['age_band'] {
  if (age === null) return 'unknown';
  if (age < 120) return 'new';
  if (age < 365) return 'young';
  if (age < 900) return 'established';
  return 'legacy';
}

/** The capital tier from TVL: a bigger protocol needs a bigger position to register. */
export function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 500;
  if (tvl >= 1_000_000_000) return 300;
  if (tvl >= 250_000_000) return 200;
  if (tvl >= 50_000_000) return 120;
  if (tvl >= 15_000_000) return 75;
  return 50;
}

/**
 * The tier a protocol's TVL puts it in, as a word the plan can use. The tier changes the plan's
 * language as well as its numbers: a mega protocol's programme is competitive and its points are
 * diluted, while a small one's is thin and its position can be a meaningful share of the pool.
 */
export function sizeTier(tvl: number): 'mega' | 'large' | 'mid' | 'small' | 'micro' {
  if (tvl >= 5_000_000_000) return 'mega';
  if (tvl >= 1_000_000_000) return 'large';
  if (tvl >= 250_000_000) return 'mid';
  if (tvl >= 50_000_000) return 'small';
  return 'micro';
}

/** How competitive a protocol's programme is, from its size tier. */
function competitionNote(tvl: number): string {
  switch (sizeTier(tvl)) {
    case 'mega':
      return 'a protocol this size attracts thousands of farmers, so your share of any programme will be thin and the position is a long shot rather than a payday';
    case 'large':
      return 'a protocol this size has a crowded programme, so expect your share to be diluted and size the position accordingly';
    case 'mid':
      return 'a protocol this size has a real but not crowded programme, which is the sweet spot for a position of this size';
    case 'small':
      return 'a protocol this size has a thin programme, so a position of this size can be a meaningful share of it';
    default:
      return 'a protocol this size has almost no competition for its programme, but also the least certainty that one exists';
  }
}

/** The gas estimate from the chain count and the capital: more chains, more bridging, more gas. */
function gasFor(capital: number, chains: number): number {
  const base = capital >= 300 ? 12 : capital >= 120 ? 8 : 5;
  return base + Math.min(Math.max(chains - 1, 0), 4) * 2;
}

/** The hold window: a young protocol needs a longer qualifying window than a legacy one. */
export function holdDaysFor(age: number | null): number {
  const band = ageBand(age);
  if (band === 'new') return 90;
  if (band === 'young') return 60;
  if (band === 'established') return 45;
  if (band === 'legacy') return 30;
  return 45;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: Protocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The second chain, when there is one, for the bridging step. */
function secondChain(p: Protocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** The category's action class, the same classes the value model prices. */
export function actionClass(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (/lend|credit|borrow|uncollateral/.test(c)) return 'lending';
  if (/cdp|stable|reserve currency|collateral/.test(c)) return 'cdp';
  if (/perpetual|derivative|synthetic|option|perps/.test(c)) return 'perps';
  if (/restak|lrt|restaked/.test(c)) return 'restaking';
  if (/liquid staking|staking pool|staking/.test(c)) return 'staking';
  if (/rwa|real world|tokeni[sz]ed|anchor btc|decentralized btc/.test(c)) return 'rwa';
  if (/bridge|cross chain|canonical/.test(c)) return 'bridge';
  if (/dex|amm|exchange|liquidity manager|market maker/.test(c)) return 'dex';
  if (/curator|allocator|vault|index/.test(c)) return 'curator';
  if (/yield|farm|basis|leveraged/.test(c)) return 'yield';
  if (/prediction/.test(c)) return 'prediction';
  if (/insurance|cover/.test(c)) return 'insurance';
  if (/launchpad|incubator/.test(c)) return 'launchpad';
  if (/chain|l1|l2|rollup/.test(c)) return 'chain';
  if (/privacy|ai|agent|payment|nft|locker|governance/.test(c)) return 'other';
  return 'other';
}

/** The main position step: the category's one action, with the capital and the chain. */
function positionStep(p: Protocol, capital: number, chain: string): string {
  const name = p.name;
  switch (actionClass(p.category)) {
    case 'lending':
      return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow $${Math.round(capital * 0.4)} of a blue-chip asset against it so the position counts as both a deposit and a loan.`;
    case 'cdp':
      return `Open a ${name} vault on ${chain} with $${capital} of ETH or staked ETH, mint the stable asset against it, and keep the debt at or under half the collateral.`;
    case 'perps':
      return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and trade $${capital * 3} of weekly volume in small, hedged positions rather than one large one.`;
    case 'restaking':
      return `Restake $${capital} of liquid staking tokens through ${name} on ${chain} and keep the receipt token in the same wallet that made the deposit.`;
    case 'staking':
      return `Stake $${capital} of ${chain}'s native asset through ${name} and hold the liquid receipt rather than the underlying, so the position stays composable.`;
    case 'rwa':
      return `Mint or subscribe to $${capital} of ${name}'s yield asset on ${chain}, and keep the redemption receipt and the issuer's terms in your records.`;
    case 'bridge':
      return `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds inside the app it points at rather than leaving them parked.`;
    case 'dex':
      return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} in a range around the current price, and rebalance it once a week.`;
    case 'curator':
      return `Deposit $${capital} into a ${name} vault on ${chain}, and note which underlying strategy the vault allocates to before you sign.`;
    case 'yield':
      return `Deposit $${capital} into ${name}'s main vault on ${chain}, and check the fee and the lock-up before you commit the capital.`;
    case 'prediction':
      return `Fund $${capital} on ${name} on ${chain} and place two or three small positions across different markets rather than one concentrated bet.`;
    case 'insurance':
      return `Buy $${capital} of cover from ${name} on ${chain} for a position you already hold, and keep the policy terms with the transaction.`;
    case 'launchpad':
      return `Stake $${capital} of the launchpad's required asset on ${name} on ${chain} and take part in one raise so the wallet has a real allocation history.`;
    case 'chain':
      return `Bridge $${capital} of USDC onto ${name} and use one native app on it, so the address has activity on the chain itself and not only a bridge deposit.`;
    default:
      return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open across several weeks rather than one transaction.`;
  }
}

/** The second action: the category's natural follow-on, which most farmers skip. */
function secondActionStep(p: Protocol, capital: number, chain: string): string {
  const name = p.name;
  switch (actionClass(p.category)) {
    case 'lending':
      return `Repay part of the ${name} loan and re-borrow it once, so the wallet shows a repayment history and not only an opening balance.`;
    case 'cdp':
      return `Repay a slice of the ${name} debt and mint again, which shows the vault is managed rather than opened and abandoned.`;
    case 'perps':
      return `Close one ${name} position at a profit and open another, so the record shows realised volume and not only deposits.`;
    case 'restaking':
      return `Delegate the ${name} receipt to an operator with a published track record, and note the operator's commission before you delegate.`;
    case 'staking':
      return `Claim the ${name} staking rewards once and restake them, so the position compounds and the claim is on the record.`;
    case 'rwa':
      return `Redeem a small slice of the ${name} position and re-subscribe, which proves the redemption path works before you need it.`;
    case 'bridge':
      return `Bridge a small amount back out of ${chain} through ${name}, so both directions of the route are on the wallet's record.`;
    case 'dex':
      return `Add a second, narrower range on ${name} and collect the fees once, so the position shows fee income and not only a deposit.`;
    case 'curator':
      return `Withdraw a slice from the ${name} vault and deposit it again, which tests the exit path while the amount is small.`;
    case 'yield':
      return `Harvest the ${name} rewards once and restake them, and record the harvest date against the position.`;
    case 'prediction':
      return `Resolve one ${name} market and claim the payout, so the wallet has a settled position and not only open interest.`;
    case 'insurance':
      return `Let one ${name} policy run to expiry and renew it, so the record shows a covered period rather than a single purchase.`;
    case 'launchpad':
      return `Claim the allocation from the ${name} raise you joined and hold it, rather than selling into the first hour.`;
    case 'chain':
      return `Make one swap and one vote on ${name}, so the address is a participant on the chain and not only a bridged balance.`;
    default:
      return `Make a second, smaller deposit into ${name} on ${chain} a week after the first, so the record shows a returning user.`;
  }
}

/** The risk step: the failure mode that actually matters for this category. */
function riskStep(p: Protocol, chain: string): string {
  const name = p.name;
  switch (actionClass(p.category)) {
    case 'lending':
      return `Watch ${name}'s utilisation and the collateral factor: a utilisation above 90% can block withdrawals, so keep a second exit in mind.`;
    case 'cdp':
      return `Watch the ${name} collateral ratio daily: a sharp move in the collateral asset can liquidate the vault before you can add margin.`;
    case 'perps':
      return `Cap the ${name} margin at what you can lose outright, because a liquidation on a perps venue takes the whole position and not a slice.`;
    case 'restaking':
      return `Read which operators ${name} delegates to: a slashing event on one operator can cut the restaked principal, not just the reward.`;
    case 'staking':
      return `Check ${name}'s validator set and its slashing history before staking, and keep the receipt token's issuer in view.`;
    case 'rwa':
      return `Read ${name}'s issuer terms for redemption gates and transfer restrictions: an RWA position can be locked when you most want out.`;
    case 'bridge':
      return `Treat ${name} as a smart-contract risk first: bridge exploits are the largest single loss category, so bridge only what you would stake twice.`;
    case 'dex':
      return `Set the ${name} range wide enough to survive a 20% week, because an out-of-range position earns nothing while it waits.`;
    case 'curator':
      return `Read the ${name} vault's allocation and its curator fee: a curator can move the strategy, and your deposit follows it.`;
    case 'yield':
      return `Check whether ${name}'s yield comes from emissions or from fees: an emission-funded rate collapses when the programme ends.`;
    case 'prediction':
      return `Size each ${name} market position as a full loss, because a resolved market pays nothing to the losing side.`;
    case 'insurance':
      return `Read what ${name} actually covers and what it excludes, because a policy that does not pay on the event you fear is not cover.`;
    case 'launchpad':
      return `Check the ${name} vesting and lock-up before joining a raise: an allocation you cannot sell for a year is not a profit.`;
    case 'chain':
      return `Check ${name}'s bridge and sequencer assumptions: a chain whose sequencer stops can strand the balance you bridged in.`;
    default:
      return `Read ${name}'s audit reports and its admin keys before depositing, and prefer a protocol whose upgrade path is timelocked.`;
  }
}

/** The verify step: how to check the claim that this protocol has no token, from primary sources. */
function verifyStep(p: Protocol, chain: string): string {
  const name = p.name;
  const record = p.gecko_id === null && p.symbol === null ? 'records no token and no CoinGecko id' : 'records a token';
  return `Verify the claim yourself: DefiLlama's entry for ${name} ${record}, so open its own docs and its ${chain} contract before you commit capital, and never trust a claim page that asks for a signature.`;
}

/** The age-specific window step: young protocols have an open points window, old ones do not. */
function windowStep(p: Protocol, age: number | null, hold: number): string {
  const name = p.name;
  const band = ageBand(age);
  if (band === 'new') {
    return `${name} has run ${age} days with no token, which is the earliest window there is: join now, because a points programme announced later rarely counts activity from before its start date.`;
  }
  if (band === 'young') {
    return `${name} has run ${age} days with no token, so the first season of any programme is likely still open: start now and keep the position through at least ${hold} days.`;
  }
  if (band === 'established') {
    return `${name} has run ${age} days with no token, which is long enough that a programme may already be running: check for an existing points page before you start a new position.`;
  }
  if (band === 'legacy') {
    return `${name} has run ${age} days with no token, so treat a launch as unlikely and size the position as a yield trade with a lottery ticket attached, not as an airdrop farm.`;
  }
  return `${name} records no listing date, so the age of any programme is unknown: start small and let the first month's activity decide whether to add.`;
}

/** The bridging step, only when the protocol runs on more than one chain. */
function bridgeStep(p: Protocol, capital: number, gas: number): FarmStep | null {
  const second = secondChain(p);
  if (second === null) return null;
  const name = p.name;
  return {
    text: `${name} counts TVL on ${p.chains.length} chains: put a quarter of the position on ${second} as well as ${chainOf(p)}, because a multi-chain protocol usually weights its programme by chain.`,
    cost: `about $${gas} of bridging gas and a quarter of the $${capital}`,
    time: '20 minutes',
    kind: 'position',
  };
}

/**
 * A protocol's farm plan. Eight to ten steps, each an action with a cost and a time, derived from the
 * protocol's category, chains, TVL and age. The plan always carries a risk step and a verify step.
 */
export function farmPlan(p: Protocol, age: number | null): FarmPlan {
  const chain = chainOf(p);
  const capital = capitalFor(p.tvl_usd);
  const gas = gasFor(capital, p.chains.length);
  const hold = holdDaysFor(age);
  const band = ageBand(age);
  const cadence = band === 'new' ? 3 : band === 'young' ? 2 : 1;

  const steps: FarmStep[] = [
    {
      text: `Open a fresh wallet for ${p.name} alone, fund it from an exchange rather than from your main wallet, and keep the seed phrase offline so a contract risk cannot reach the rest of your holdings.`,
      cost: `under $${gas} of gas for the first transaction`,
      time: '10 minutes',
      kind: 'setup',
    },
    {
      text: positionStep(p, capital, chain),
      cost: `$${capital} of capital plus about $${gas} of gas`,
      time: '15 minutes to set up',
      kind: 'position',
    },
    {
      text: secondActionStep(p, capital, chain),
      cost: `no new capital, about $${Math.max(2, Math.round(gas / 2))} of gas`,
      time: '10 minutes',
      kind: 'activity',
    },
    {
      text: `Make ${cadence} qualifying action${cadence === 1 ? '' : 's'} a week on ${p.name} — a deposit, a borrow, a swap or a vote — because programmes weight distinct weeks far above one large transaction.`,
      cost: `about $${cadence * 2} of gas a week`,
      time: `${cadence * 10} minutes a week`,
      kind: 'activity',
    },
    {
      text: `Hold the ${p.name} position for at least ${hold} days so it is counted in more than one snapshot, and do not move the capital out and back to fake activity.`,
      cost: `the $${capital} stays locked in the position`,
      time: `${hold} days`,
      kind: 'hold',
    },
    {
      text: windowStep(p, age, hold),
      cost: 'nothing beyond the position you already hold',
      time: '5 minutes to check',
      kind: 'window',
    },
    {
      text: `Set your expectation before you deposit: ${competitionNote(p.tvl_usd)}. Write down what a 1% share of a plausible programme would be worth, and do not deposit more than that number justifies.`,
      cost: 'no fee, and it is the cheapest step in the plan',
      time: '10 minutes',
      kind: 'risk',
    },
  ];

  const bridge = bridgeStep(p, capital, gas);
  if (bridge !== null) steps.push(bridge);

  steps.push(
    {
      text: riskStep(p, chain),
      cost: 'no fee, but the whole position is at risk',
      time: '15 minutes of reading',
      kind: 'risk',
    },
    {
      text: verifyStep(p, chain),
      cost: 'free, and never pay a fee to claim',
      time: '10 minutes',
      kind: 'verify',
    },
    {
      text: `Before you withdraw from ${p.name}, claim only from the protocol's own published page, and treat any direct message offering an early claim as a theft attempt.`,
      cost: 'no fee to claim, and a signature request is a red flag',
      time: '10 minutes',
      kind: 'exit',
    },
    {
      text: `Write the wallet address, the entry date, the $${capital} and every ${p.name} transaction into a farm log, so you can repeat the position or unwind it without guessing.`,
      cost: 'nothing but the log',
      time: '5 minutes',
      kind: 'log',
    },
  );

  return {
    steps,
    capital_usd: capital,
    hold_days: hold,
    cadence_per_week: cadence,
    age_band: band,
    size_tier: sizeTier(p.tvl_usd),
    action_class: actionClass(p.category),
  };
}

/** One step as the single string board.json carries: the action, then its cost and its time. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** A plan's steps as the strings board.json carries. */
export function planTexts(plan: FarmPlan): string[] {
  return plan.steps.map(stepText);
}
