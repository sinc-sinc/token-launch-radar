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

export interface Snapshot {
  as_of: string;
  source?: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface CategoryMultiple {
  category: string;
  peer_count: number;
  category_median: number | null;
  category_p25: number | null;
  category_p75: number | null;
  global_median: number;
  multiple: number;
  p25_multiple: number;
  p75_multiple: number;
}

export interface MultipleTable {
  global_median: number;
  global_p25: number;
  global_p75: number;
  multiple_cap: number;
  global_peer_count: number;
  by_category: Record<string, CategoryMultiple>;
}

export interface CategoryModelStats {
  peers: number;
  median_multiple: number;
  p25_multiple: number;
  p75_multiple: number;
  launch_prior: number;
}

export interface ValidationStats {
  count: number;
  median_ratio: number;
  within_2x: number;
  within_3x: number;
  within_2x_pct: number;
  within_3x_pct: number;
}

export interface ModelStats {
  global_median_multiple: number;
  global_p25_multiple: number;
  global_p75_multiple: number;
  multiple_cap_p90: number;
  global_peer_count: number;
  shrinkage_weight: number;
  validation: ValidationStats;
  categories: Record<string, CategoryModelStats>;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  tvl_usd: number;
  category: string;
  chains: string[];
  change_7d: number | null;
  listed_at: string | null;
  watchlist: boolean;
  multiple_used: number;
  momentum_mult: number;
  maturity_mult: number;
  breadth_mult: number;
  launch_prior: number;
  farm_score: number;
  farm_steps: string[];
}

export interface BoardResult {
  as_of: string;
  floor_usd: number;
  rows: BoardRow[];
  multiples: MultipleTable;
  model_stats: ModelStats;
}

const MIN_MULTIPLE = 0.05;
const MULTIPLE_CAP_QUANTILE = 0.9;
const SHRINKAGE_WEIGHT = 5;
const MIN_VALIDATION_TVL_USD = 5_000_000;
const MATURITY_NULL_FACTOR = 0.95;
const MATURITY_TAU_DAYS = 540;
const MS_PER_DAY = 86_400_000;

const EXCLUDED_CATEGORIES = new Set<string>([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const VERSION_MARKER_RE = / [Vv]?\d+(?:\.\d+)?$/;
const WRAPPED_OR_STAKED_RE = /\b(?:wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX_RE = /^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)(?: |$)/;

export function isTokenized(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

/**
 * Determine whether a snapshot protocol is a token-launch candidate.
 * A protocol qualifies only when it records no token (both `gecko_id` and
 * `symbol` are null) and does not match wrapped, bridged, versioned, or
 * exchange-product exclusion rules.
 */
export function isLaunchCandidate(p: Protocol): boolean {
  if (isTokenized(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_MARKER_RE.test(p.name)) return false;
  if (WRAPPED_OR_STAKED_RE.test(p.name)) return false;
  if (EXCHANGE_PREFIX_RE.test(p.name)) return false;
  return true;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Linear-interpolated percentile (p in [0, 1]) over a non-empty numeric series. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    throw new Error('percentile requires at least one value');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const q = clamp(p, 0, 1);
  const idx = q * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (idx - lo) * (sorted[hi]! - sorted[lo]!);
}

export function median(values: readonly number[]): number {
  return percentile(values, 0.5);
}

/** Deterministic 32-bit FNV-1a hash of a string. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pick<T>(items: readonly T[], slug: string, salt: string): T {
  const idx = hashString(`${slug}:${salt}`) % items.length;
  return items[idx]!;
}

/** Parse and validate a sealed DefiLlama snapshot JSON string. */
export function parseSnapshot(raw: string): Snapshot {
  const data = JSON.parse(raw) as Partial<Snapshot>;
  if (!data || typeof data !== 'object') {
    throw new Error('Snapshot JSON must be an object');
  }
  if (typeof data.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.as_of)) {
    throw new Error(`Invalid snapshot as_of: ${String(data.as_of)}`);
  }
  if (typeof data.floor_usd !== 'number' || !Number.isFinite(data.floor_usd)) {
    throw new Error(`Invalid snapshot floor_usd: ${String(data.floor_usd)}`);
  }
  if (!Array.isArray(data.protocols)) {
    throw new Error('Snapshot protocols must be an array');
  }
  if (!Array.isArray(data.watchlist)) {
    throw new Error('Snapshot watchlist must be an array');
  }
  return {
    as_of: data.as_of,
    source: typeof data.source === 'string' ? data.source : undefined,
    floor_usd: data.floor_usd,
    protocols: data.protocols as Protocol[],
    watchlist: data.watchlist as string[],
  };
}

function hasValidPeerMultiple(p: Protocol): boolean {
  return (
    isTokenized(p) &&
    p.mcap_usd !== null &&
    p.mcap_usd > 0 &&
    p.tvl_usd > 0 &&
    Number.isFinite(p.mcap_usd / p.tvl_usd)
  );
}

function shrinkStatistic(n: number, catValue: number, globalValue: number): number {
  return (n * catValue + SHRINKAGE_WEIGHT * globalValue) / (n + SHRINKAGE_WEIGHT);
}

/**
 * Derive shrunk mcap/TVL multiples (median, p25, p75) per category directly
 * from the snapshot's tokenised protocols (mcap_usd > 0 and tvl_usd > 0;
 * non-positive mcap_usd entries in DefiLlama represent missing supply data
 * rather than $0 tokens). Upper cap is the data-derived 90th percentile of
 * all tokenised peers' multiples.
 */
export function computeCategoryMultiples(protocols: readonly Protocol[]): MultipleTable {
  const allRatios: number[] = [];
  const ratiosByCategory = new Map<string, number[]>();
  const allCategories = new Set<string>();

  for (const p of protocols) {
    const cat = p.category ?? 'Uncategorized';
    allCategories.add(cat);
    if (hasValidPeerMultiple(p)) {
      const ratio = p.mcap_usd! / p.tvl_usd;
      allRatios.push(ratio);
      const list = ratiosByCategory.get(cat);
      if (list) {
        list.push(ratio);
      } else {
        ratiosByCategory.set(cat, [ratio]);
      }
    }
  }

  const globalMedian = allRatios.length > 0 ? percentile(allRatios, 0.5) : 1;
  const globalP25 = allRatios.length > 0 ? percentile(allRatios, 0.25) : 1;
  const globalP75 = allRatios.length > 0 ? percentile(allRatios, 0.75) : 1;
  const multipleCap = Math.max(
    MIN_MULTIPLE,
    allRatios.length > 0 ? percentile(allRatios, MULTIPLE_CAP_QUANTILE) : 1,
  );

  const clampedGlobalMed = clamp(globalMedian, MIN_MULTIPLE, multipleCap);
  const clampedGlobalP25 = Math.min(clampedGlobalMed, Math.max(0, globalP25));
  const clampedGlobalP75 = clamp(globalP75, clampedGlobalMed, multipleCap);

  const byCategory: Record<string, CategoryMultiple> = {};
  for (const cat of [...allCategories].sort(byCodeUnit)) {
    const ratios = ratiosByCategory.get(cat) ?? [];
    const n = ratios.length;
    if (n === 0) {
      byCategory[cat] = {
        category: cat,
        peer_count: 0,
        category_median: null,
        category_p25: null,
        category_p75: null,
        global_median: globalMedian,
        multiple: clampedGlobalMed,
        p25_multiple: clampedGlobalP25,
        p75_multiple: clampedGlobalP75,
      };
    } else {
      const catMed = percentile(ratios, 0.5);
      const catP25 = percentile(ratios, 0.25);
      const catP75 = percentile(ratios, 0.75);
      const med = clamp(shrinkStatistic(n, catMed, globalMedian), MIN_MULTIPLE, multipleCap);
      const p25 = Math.min(med, Math.max(0, shrinkStatistic(n, catP25, globalP25)));
      const p75 = clamp(shrinkStatistic(n, catP75, globalP75), med, multipleCap);
      byCategory[cat] = {
        category: cat,
        peer_count: n,
        category_median: catMed,
        category_p25: catP25,
        category_p75: catP75,
        global_median: globalMedian,
        multiple: med,
        p25_multiple: p25,
        p75_multiple: p75,
      };
    }
  }

  return {
    global_median: globalMedian,
    global_p25: globalP25,
    global_p75: globalP75,
    multiple_cap: multipleCap,
    global_peer_count: allRatios.length,
    by_category: byCategory,
  };
}

/**
 * Per-category launch prior: share (%) of snapshot protocols with TVL >= $5M
 * in that category that already have a token, rounded to 1 decimal.
 */
export function computeCategoryLaunchPriors(protocols: readonly Protocol[]): Record<string, number> {
  const counts = new Map<string, { total: number; tokenized: number }>();
  const allCategories = new Set<string>();

  for (const p of protocols) {
    const cat = p.category ?? 'Uncategorized';
    allCategories.add(cat);
    if (p.tvl_usd < MIN_VALIDATION_TVL_USD) continue;
    let entry = counts.get(cat);
    if (!entry) {
      entry = { total: 0, tokenized: 0 };
      counts.set(cat, entry);
    }
    entry.total += 1;
    if (isTokenized(p)) {
      entry.tokenized += 1;
    }
  }

  const priors: Record<string, number> = {};
  for (const cat of [...allCategories].sort(byCodeUnit)) {
    const entry = counts.get(cat);
    priors[cat] = entry && entry.total > 0 ? round1((entry.tokenized / entry.total) * 100) : 0;
  }
  return priors;
}

/**
 * Leave-one-out validation across every tokenised snapshot protocol with
 * TVL >= $5M and a valid positive market cap. Each protocol's market cap is
 * predicted with its category multiple, global median, and p90 cap computed
 * strictly without that protocol.
 */
export function computeLeaveOneOutValidation(snapshot: Snapshot): ValidationStats {
  const peerEntries: Array<{ idx: number; category: string; ratio: number }> = [];
  const evalIndices: number[] = [];

  for (let i = 0; i < snapshot.protocols.length; i++) {
    const p = snapshot.protocols[i]!;
    if (hasValidPeerMultiple(p)) {
      peerEntries.push({
        idx: i,
        category: p.category ?? 'Uncategorized',
        ratio: p.mcap_usd! / p.tvl_usd,
      });
      if (p.tvl_usd >= MIN_VALIDATION_TVL_USD) {
        evalIndices.push(i);
      }
    }
  }

  if (evalIndices.length === 0) {
    return {
      count: 0,
      median_ratio: 0,
      within_2x: 0,
      within_3x: 0,
      within_2x_pct: 0,
      within_3x_pct: 0,
    };
  }

  const ratios: number[] = [];
  let within2 = 0;
  let within3 = 0;

  for (const targetIdx of evalIndices) {
    const p = snapshot.protocols[targetIdx]!;
    const targetCat = p.category ?? 'Uncategorized';
    const otherAll: number[] = [];
    const otherCat: number[] = [];

    for (const entry of peerEntries) {
      if (entry.idx === targetIdx) continue;
      otherAll.push(entry.ratio);
      if (entry.category === targetCat) {
        otherCat.push(entry.ratio);
      }
    }

    const globalMed = otherAll.length > 0 ? percentile(otherAll, 0.5) : 1;
    const cap = Math.max(
      MIN_MULTIPLE,
      otherAll.length > 0 ? percentile(otherAll, MULTIPLE_CAP_QUANTILE) : 1,
    );
    const n = otherCat.length;
    const rawMult = n === 0 ? globalMed : shrinkStatistic(n, percentile(otherCat, 0.5), globalMed);
    const mult = clamp(rawMult, MIN_MULTIPLE, cap);

    const factors =
      computeMomentumMult(p.change_7d) *
      computeMaturityMult(p.listed_at, snapshot.as_of) *
      computeBreadthMult(p.chains);
    const predicted = Math.max(1, Math.round(p.tvl_usd * mult * factors));
    const ratio = predicted / p.mcap_usd!;
    ratios.push(ratio);

    if (ratio >= 0.5 && ratio <= 2) within2 += 1;
    if (ratio >= 1 / 3 && ratio <= 3) within3 += 1;
  }

  const count = ratios.length;
  return {
    count,
    median_ratio: round4(median(ratios)),
    within_2x: round4(within2 / count),
    within_3x: round4(within3 / count),
    within_2x_pct: round1((within2 / count) * 100),
    within_3x_pct: round1((within3 / count) * 100),
  };
}

export function daysBetweenUtc(startDate: string, endDate: string): number {
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.max(0, (endMs - startMs) / MS_PER_DAY);
}

export function computeMomentumMult(change7d: number | null): number {
  const clamped = clamp(change7d ?? 0, -30, 50);
  return 1 + (clamped / 100) * 0.5;
}

export function computeMaturityMult(listedAt: string | null, asOf: string): number {
  if (listedAt === null) return MATURITY_NULL_FACTOR;
  const ageDays = daysBetweenUtc(listedAt, asOf);
  return 0.8 + 0.35 * (1 - Math.exp(-ageDays / MATURITY_TAU_DAYS));
}

export function computeBreadthMult(chains: readonly string[]): number {
  return chains.length >= 3 ? 1.05 : 1;
}

export interface CapitalTier {
  capitalUsd: number;
  capital: string;
  half: string;
  quarter: string;
  weeks: number;
}

interface FarmContext {
  slug: string;
  name: string;
  category: string;
  mainChain: string;
  capitalUsd: number;
  capital: string;
  halfCapital: string;
  quarterCapital: string;
  weeks: number;
  weeklyMinutes: number;
  gas: string;
  isEthereum: boolean;
}

/** Single source of truth for TVL-banded farm plan capital & duration tiers. */
export function getCapitalTier(tvlUsd: number): CapitalTier {
  if (tvlUsd < 10_000_000) {
    return { capitalUsd: 250, capital: '$250', half: '$125', quarter: '$60', weeks: 8 };
  }
  if (tvlUsd < 50_000_000) {
    return { capitalUsd: 500, capital: '$500', half: '$250', quarter: '$125', weeks: 10 };
  }
  if (tvlUsd < 250_000_000) {
    return { capitalUsd: 1_000, capital: '$1,000', half: '$500', quarter: '$250', weeks: 12 };
  }
  return { capitalUsd: 2_500, capital: '$2,500', half: '$1,250', quarter: '$625', weeks: 16 };
}

function estimateWeeklyMinutes(category: string | null): number {
  const group = resolveCategoryGroup(category);
  if (group === 'PerpDerivatives' || group === 'Chain' || category === 'Prediction Market') {
    return 20;
  }
  return 15;
}

function makeFarmContext(p: Protocol): FarmContext {
  const mainChain = p.chains[0] ?? 'Ethereum';
  const isEthereum = mainChain === 'Ethereum';
  const tier = getCapitalTier(p.tvl_usd);
  return {
    slug: p.slug,
    name: p.name,
    category: p.category ?? 'DeFi',
    mainChain,
    capitalUsd: tier.capitalUsd,
    capital: tier.capital,
    halfCapital: tier.half,
    quarterCapital: tier.quarter,
    weeks: tier.weeks,
    weeklyMinutes: estimateWeeklyMinutes(p.category),
    gas: isEthereum ? '$8-$25 per tx' : '$0.10-$2 per tx',
    isEthereum,
  };
}

function step1WalletAndBridge(ctx: FarmContext): string {
  const budgetPrefix = `Budget: ${ctx.capital} over ~${ctx.weeks} weeks, ~${ctx.weeklyMinutes} min/week.`;
  const templates = [
    `${budgetPrefix} Create a dedicated wallet for ${ctx.name} on ${ctx.mainChain} and bridge ${ctx.capital} in USDC or native gas via a canonical bridge; est. gas ${ctx.gas}, ~20 min setup.`,
    `${budgetPrefix} Fund a fresh ${ctx.mainChain} address with ${ctx.capital} plus gas buffer for ${ctx.name} using an audited bridge; expect ${ctx.gas} in fees and ~25 min initial setup.`,
    `${budgetPrefix} Set up an isolated ${ctx.mainChain} wallet and transfer ${ctx.capital} in liquid collateral for ${ctx.name} interactions; budget ${ctx.gas} in gas and ~20 min onboarding.`,
    `${budgetPrefix} Configure a clean ${ctx.mainChain} signer and bridge ${ctx.capital} in stablecoins or ETH/native gas for ${ctx.name}; gas cost ${ctx.gas}, ~15 min one-time setup.`,
  ];
  return pick(templates, ctx.slug, 's1');
}

function step5TrackLaunch(ctx: FarmContext): string {
  const templates = [
    `Track ${ctx.name} announcements on ${ctx.mainChain}, export tx hashes for your ${ctx.capital} position for airdrop claims, and reserve ${ctx.gas} for claiming; ~15 min monthly.`,
    `Monitor ${ctx.name} governance posts and snapshot notices on ${ctx.mainChain}, archive proofs for your ${ctx.capital} activity, and keep ${ctx.gas} ready to claim; ~20 min monthly.`,
    `Follow ${ctx.name} official channels for TGE dates on ${ctx.mainChain}, log weekly receipts on your ${ctx.capital} stake, and hold ${ctx.gas} for claim gas; ~15 min monthly.`,
    `Check ${ctx.name} points dashboards and ${ctx.mainChain} eligibility notices, keep a ledger of your ${ctx.capital} deposits, and budget ${ctx.gas} for claim tx; ~10 min monthly.`,
  ];
  return pick(templates, ctx.slug, 's5');
}

function farmLending(ctx: FarmContext): string[] {
  const s2 = pick(
    [
      `Supply ${ctx.capital} of blue-chip collateral into ${ctx.name}'s deepest ${ctx.mainChain} lending market to build deposit duration; gas ${ctx.gas}, ~15 min execution.`,
      `Deposit ${ctx.capital} in USDC or liquid ETH/stables on ${ctx.name} (${ctx.mainChain}) to activate lender points and interest accrual; est. gas ${ctx.gas}, ~15 min.`,
      `Open a primary supply position of ${ctx.capital} in ${ctx.name} on ${ctx.mainChain}, choosing high-utilization reserves for steady score weight; cost ${ctx.gas}, ~20 min.`,
      `Commit ${ctx.capital} to ${ctx.name}'s core ${ctx.mainChain} money market and verify receipt tokens appear on-chain; est. gas ${ctx.gas}, ~15 min.`,
    ],
    ctx.slug,
    'lend-s2',
  );
  const s3 = pick(
    [
      `Borrow ${ctx.quarterCapital} safely against your ${ctx.capital} ${ctx.name} collateral on ${ctx.mainChain} (keep health factor >2.0) to record borrower activity; gas ${ctx.gas}, ~15 min.`,
      `Draw a conservative ${ctx.quarterCapital} loan backed by your ${ctx.capital} ${ctx.name} deposit on ${ctx.mainChain} and repay half after 48h for dual-side history; gas ${ctx.gas}, ~20 min.`,
      `Activate a second market on ${ctx.name} (${ctx.mainChain}) by borrowing ${ctx.quarterCapital} against ${ctx.capital} collateral at low LTV; est. gas ${ctx.gas}, ~15 min.`,
      `Create borrow-side footprint on ${ctx.name} (${ctx.mainChain}) by minting or borrowing ${ctx.quarterCapital} from your ${ctx.capital} line while keeping LTV under 35%; gas ${ctx.gas}, ~15 min.`,
    ],
    ctx.slug,
    'lend-s3',
  );
  const s4 = pick(
    [
      `Weekly on ${ctx.mainChain}: check health factor on your ${ctx.capital} ${ctx.name} position, harvest rewards, and repay or top up borrow dust; gas ${ctx.gas}, ~10 min weekly.`,
      `Run a weekly ${ctx.mainChain} check on ${ctx.name}: rebalance your ${ctx.capital} collateral ratio, claim incentives, and log one small repay tx; cost ${ctx.gas}, ~10 min weekly.`,
      `Each week on ${ctx.mainChain}, verify ${ctx.name} borrow APRs on your ${ctx.capital} deposit and execute a small interest repayment to stay active; gas ${ctx.gas}, ~15 min weekly.`,
    ],
    ctx.slug,
    'lend-s4',
  );
  return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
}

function farmDexs(ctx: FarmContext): string[] {
  const s2 = pick(
    [
      `Provide ${ctx.capital} in liquidity to ${ctx.name}'s highest-volume stable or major pair on ${ctx.mainChain} to accumulate LP fee history; gas ${ctx.gas}, ~20 min.`,
      `Deploy ${ctx.capital} across a major ${ctx.name} pool on ${ctx.mainChain} using a balanced range to avoid frequent out-of-range resets; est. gas ${ctx.gas}, ~20 min.`,
      `Seed a ${ctx.capital} LP position on ${ctx.name} (${ctx.mainChain}) in a top-TVL pair to earn organic swap fees and protocol weight; cost ${ctx.gas}, ~15 min.`,
      `Add ${ctx.capital} of paired assets into ${ctx.name}'s flagship ${ctx.mainChain} pool and stake the LP receipt if a gauge exists; est. gas ${ctx.gas}, ~20 min.`,
    ],
    ctx.slug,
    'dex-s2',
  );
  const s3 = pick(
    [
      `Execute 3-4 organic spot swaps totaling ${ctx.halfCapital} across distinct pairs on ${ctx.name} (${ctx.mainChain}) alongside your ${ctx.capital} LP; gas ${ctx.gas}, ~15 min.`,
      `Place a limit order or route ${ctx.quarterCapital} of multi-hop swaps on ${ctx.name} (${ctx.mainChain}) to pair trader volume with your ${ctx.capital} LP; gas ${ctx.gas}, ~15 min.`,
      `Route ${ctx.halfCapital} in spot swaps across two ${ctx.name} fee tiers on ${ctx.mainChain} so your ${ctx.capital} wallet records both LP and taker flow; gas ${ctx.gas}, ~15 min.`,
      `Use ${ctx.name}'s router on ${ctx.mainChain} for ${ctx.quarterCapital} in cross-pair swaps to diversify beyond your ${ctx.capital} liquidity deposit; gas ${ctx.gas}, ~10 min.`,
    ],
    ctx.slug,
    'dex-s3',
  );
  const s4 = pick(
    [
      `Weekly on ${ctx.mainChain}: collect accrued fees on your ${ctx.capital} ${ctx.name} LP, recenter if out of range, and execute one fresh swap; gas ${ctx.gas}, ~10 min weekly.`,
      `Each week on ${ctx.mainChain}, audit range utilization on your ${ctx.capital} ${ctx.name} pool and compound earned fees with a small swap; cost ${ctx.gas}, ~15 min weekly.`,
      `Maintain weekly ${ctx.mainChain} cadence on ${ctx.name}: claim LP fees from your ${ctx.capital} stake and route a ${ctx.quarterCapital} swap; gas ${ctx.gas}, ~10 min weekly.`,
    ],
    ctx.slug,
    'dex-s4',
  );
  return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
}

function farmYieldGroup(ctx: FarmContext): string[] {
  const s2 = pick(
    [
      `Deposit ${ctx.capital} into ${ctx.name}'s flagship ${ctx.mainChain} curated vault or yield strategy to start continuous share-time accrual; gas ${ctx.gas}, ~15 min.`,
      `Allocate ${ctx.capital} into the highest-liquidity ${ctx.name} vault on ${ctx.mainChain}, verifying share token minting on-chain; est. gas ${ctx.gas}, ~15 min.`,
      `Mint ${ctx.name} vault shares with ${ctx.capital} on ${ctx.mainChain}, prioritizing audited stablecoin or ETH yield strategies; cost ${ctx.gas}, ~20 min.`,
      `Enter ${ctx.name}'s core ${ctx.mainChain} yield pool with ${ctx.capital} to build durable TVL-weighted history across epochs; est. gas ${ctx.gas}, ~15 min.`,
    ],
    ctx.slug,
    'yld-s2',
  );
  const s3 = pick(
    [
      `Split ${ctx.quarterCapital} from your ${ctx.capital} budget into a second ${ctx.name} strategy or boosted lock vault on ${ctx.mainChain} for multi-vault coverage; gas ${ctx.gas}, ~15 min.`,
      `Pair your ${ctx.capital} ${ctx.name} vault deposit on ${ctx.mainChain} with a ${ctx.quarterCapital} entry into a secondary risk tier or PT/YT pool; gas ${ctx.gas}, ~20 min.`,
      `Use your ${ctx.name} receipt token on ${ctx.mainChain} (or allocate ${ctx.quarterCapital} of your ${ctx.capital} cap) in an integrated DeFi pool for composable activity; gas ${ctx.gas}, ~15 min.`,
      `Diversify across two ${ctx.name} curated vaults on ${ctx.mainChain} by moving ${ctx.quarterCapital} of your ${ctx.capital} allocation into an alternate strategy; gas ${ctx.gas}, ~15 min.`,
    ],
    ctx.slug,
    'yld-s3',
  );
  const s4 = pick(
    [
      `Weekly on ${ctx.mainChain}: review ${ctx.name} vault APY and curator risk updates on your ${ctx.capital} stake, then claim or compound rewards; gas ${ctx.gas}, ~10 min weekly.`,
      `Every week on ${ctx.mainChain}, verify ${ctx.name} share exchange rates on your ${ctx.capital} allocation and roll maturing epochs if applicable; cost ${ctx.gas}, ~10 min weekly.`,
      `Hold a weekly ${ctx.mainChain} routine on ${ctx.name}: check curator exposure on your ${ctx.capital} vaults and harvest accrued incentives; gas ${ctx.gas}, ~15 min weekly.`,
    ],
    ctx.slug,
    'yld-s4',
  );
  return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
}

function farmRwa(ctx: FarmContext): string[] {
  const s2 = pick(
    [
      `Complete any required wallet allowlisting and mint or acquire ${ctx.capital} of ${ctx.name}'s core RWA token on ${ctx.mainChain}; gas ${ctx.gas}, ~25 min.`,
      `Deploy ${ctx.capital} into ${ctx.name}'s primary tokenized treasury or credit vault on ${ctx.mainChain} to establish real-yield duration; cost ${ctx.gas}, ~20 min.`,
      `Subscribe ${ctx.capital} in USDC into ${ctx.name}'s liquid ${ctx.mainChain} RWA product and verify balance accrual on-chain; est. gas ${ctx.gas}, ~20 min.`,
      `Convert ${ctx.capital} into ${ctx.name}'s flagship ${ctx.mainChain} RWA instrument to build long-duration holder history; est. gas ${ctx.gas}, ~20 min.`,
    ],
    ctx.slug,
    'rwa-s2',
  );
  const s3 = pick(
    [
      `Wrap or supply ${ctx.halfCapital} of your ${ctx.capital} ${ctx.name} RWA tokens on ${ctx.mainChain} into a secondary liquidity or collateral pool; gas ${ctx.gas}, ~15 min.`,
      `Test a ${ctx.quarterCapital} swap or redemption cycle on ${ctx.name} (${ctx.mainChain}) alongside your ${ctx.capital} core holding to log two contract paths; gas ${ctx.gas}, ~15 min.`,
      `Stake ${ctx.halfCapital} of your ${ctx.capital} ${ctx.name} RWA position in a partnered ${ctx.mainChain} yield or LP vault for extra on-chain depth; gas ${ctx.gas}, ~20 min.`,
      `Use ${ctx.quarterCapital} of your ${ctx.capital} ${ctx.name} balance on ${ctx.mainChain} to interact with a secondary RWA pool or wrapper contract; gas ${ctx.gas}, ~15 min.`,
    ],
    ctx.slug,
    'rwa-s3',
  );
  const s4 = pick(
    [
      `Weekly on ${ctx.mainChain}: verify NAV yield accrual on your ${ctx.capital} ${ctx.name} position and claim any bonus reward distributions; gas ${ctx.gas}, ~10 min weekly.`,
      `Each week on ${ctx.mainChain}, check ${ctx.name} redemption queue liquidity for your ${ctx.capital} holding and compound yield distributions; cost ${ctx.gas}, ~10 min weekly.`,
      `Maintain a weekly ${ctx.mainChain} review of ${ctx.name}: confirm attestation updates on your ${ctx.capital} RWA balance and log one maintenance tx; gas ${ctx.gas}, ~10 min weekly.`,
    ],
    ctx.slug,
    'rwa-s4',
  );
  return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
}

function farmChain(ctx: FarmContext): string[] {
  const s2 = pick(
    [
      `Bridge ${ctx.capital} into the ${ctx.name} ecosystem on ${ctx.mainChain} and deposit ${ctx.halfCapital} into its leading native DEX or lending pool; gas ${ctx.gas}, ~20 min.`,
      `Deploy ${ctx.capital} across ${ctx.name}'s native ${ctx.mainChain} DeFi stack by providing liquidity or staking in a core ecosystem protocol; cost ${ctx.gas}, ~20 min.`,
      `Activate your ${ctx.mainChain} address on ${ctx.name} by committing ${ctx.capital} to a top native liquidity or staking contract for TVL time; gas ${ctx.gas}, ~20 min.`,
      `Move ${ctx.capital} onto ${ctx.name} (${ctx.mainChain}) and lock ${ctx.halfCapital} in a flagship ecosystem vault to establish sustained chain TVL; gas ${ctx.gas}, ~20 min.`,
    ],
    ctx.slug,
    'chn-s2',
  );
  const s3 = pick(
    [
      `Interact with 3 distinct ${ctx.name} contracts on ${ctx.mainChain} using ${ctx.quarterCapital} from your ${ctx.capital} budget (swap, domain/NFT mint, lend); gas ${ctx.gas}, ~20 min.`,
      `Build diverse ${ctx.name} contract breadth on ${ctx.mainChain} by routing ${ctx.quarterCapital} of your ${ctx.capital} funds across a bridge, DEX, and money market; gas ${ctx.gas}, ~20 min.`,
      `Register an on-chain identity or deploy a simple contract on ${ctx.name} (${ctx.mainChain}) alongside ${ctx.quarterCapital} of your ${ctx.capital} swaps; gas ${ctx.gas}, ~15 min.`,
      `Spread ${ctx.quarterCapital} of your ${ctx.capital} ${ctx.name} stack across two additional ${ctx.mainChain} dApps to increase unique contract count; gas ${ctx.gas}, ~20 min.`,
    ],
    ctx.slug,
    'chn-s3',
  );
  const s4 = pick(
    [
      `Weekly on ${ctx.mainChain}: execute 2-3 organic transactions across ${ctx.name} dApps while maintaining your ${ctx.capital} TVL footprint; gas ${ctx.gas}, ~15 min weekly.`,
      `Every week on ${ctx.mainChain}, rotate a small ${ctx.quarterCapital} swap and claim rewards on your ${ctx.capital} ${ctx.name} positions to sustain active-week streaks; gas ${ctx.gas}, ~15 min weekly.`,
      `Keep a weekly ${ctx.mainChain} cadence on ${ctx.name}: touch two native apps and rebalance your ${ctx.capital} liquidity; cost ${ctx.gas}, ~10 min weekly.`,
    ],
    ctx.slug,
    'chn-s4',
  );
  return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
}

function farmPerpDerivatives(ctx: FarmContext): string[] {
  const s2 = pick(
    [
      `Deposit ${ctx.capital} margin into ${ctx.name} on ${ctx.mainChain} and execute low-leverage (1x-3x) delta-managed perp trades to build volume; gas ${ctx.gas}, ~20 min.`,
      `Fund your ${ctx.name} ${ctx.mainChain} margin account with ${ctx.capital} and place maker limit orders on BTC/ETH perps to accrue trading points; cost ${ctx.gas}, ~20 min.`,
      `Post ${ctx.capital} USDC collateral on ${ctx.name} (${ctx.mainChain}) and open hedged or tight-stop perp trades for consistent taker/maker volume; gas ${ctx.gas}, ~25 min.`,
      `Transfer ${ctx.capital} into ${ctx.name}'s ${ctx.mainChain} trading engine and run conservative 2x perp positions across major markets; est. gas ${ctx.gas}, ~20 min.`,
    ],
    ctx.slug,
    'perp-s2',
  );
  const s3 = pick(
    [
      `Allocate ${ctx.halfCapital} of your ${ctx.capital} capital into ${ctx.name}'s LP/HLP liquidity vault on ${ctx.mainChain} to pair passive LP with trading volume; gas ${ctx.gas}, ~15 min.`,
      `Stake ${ctx.quarterCapital} from your ${ctx.capital} margin into ${ctx.name}'s insurance or market-making vault on ${ctx.mainChain} for a second footprint; gas ${ctx.gas}, ~15 min.`,
      `Trade an altcoin or options/funding market on ${ctx.name} (${ctx.mainChain}) with ${ctx.quarterCapital} of your ${ctx.capital} margin to widen product usage; gas ${ctx.gas}, ~15 min.`,
      `Combine your ${ctx.capital} ${ctx.name} perp trading on ${ctx.mainChain} with a ${ctx.halfCapital} liquidity vault deposit so both maker and LP tiers score; gas ${ctx.gas}, ~15 min.`,
    ],
    ctx.slug,
    'perp-s3',
  );
  const s4 = pick(
    [
      `Weekly on ${ctx.mainChain}: generate fresh maker/taker volume with your ${ctx.capital} ${ctx.name} margin, review funding rates, and settle PnL; gas ${ctx.gas}, ~15 min weekly.`,
      `Each week on ${ctx.mainChain}, run 2-3 disciplined perp cycles on ${ctx.name} using your ${ctx.capital} account and harvest vault yields; cost ${ctx.gas}, ~15 min weekly.`,
      `Maintain weekly ${ctx.mainChain} cadence on ${ctx.name}: rotate ${ctx.halfCapital} in limit-order volume from your ${ctx.capital} margin and check fee rebates; gas ${ctx.gas}, ~15 min weekly.`,
    ],
    ctx.slug,
    'perp-s4',
  );
  return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
}

function farmPayments(ctx: FarmContext): string[] {
  const s2 = pick(
    [
      `Load ${ctx.capital} in USDC into ${ctx.name}'s payment or card account on ${ctx.mainChain} and complete your first settlement or spend transaction; gas ${ctx.gas}, ~20 min.`,
      `Deposit ${ctx.capital} onto ${ctx.name} (${ctx.mainChain}) to activate merchant payments, card spending, or yield-bearing spend balances; est. gas ${ctx.gas}, ~20 min.`,
      `Fund ${ctx.name} on ${ctx.mainChain} with ${ctx.capital} and route an initial payment transfer or invoice settlement to record real usage; cost ${ctx.gas}, ~15 min.`,
      `Initialize a ${ctx.capital} balance in ${ctx.name} on ${ctx.mainChain} and execute an on-chain checkout or peer transfer to start activity tracking; gas ${ctx.gas}, ~20 min.`,
    ],
    ctx.slug,
    'pay-s2',
  );
  const s3 = pick(
    [
      `Enable ${ctx.name}'s secondary rail on ${ctx.mainChain}—auto-yield savings, recurring payroll, or cross-asset convert—with ${ctx.quarterCapital} of your ${ctx.capital}; gas ${ctx.gas}, ~15 min.`,
      `Create a second ${ctx.name} footprint on ${ctx.mainChain} by sending ${ctx.quarterCapital} of your ${ctx.capital} via a payment link or merchant QR flow; gas ${ctx.gas}, ~15 min.`,
      `Stake or park ${ctx.halfCapital} of your ${ctx.capital} ${ctx.name} funds on ${ctx.mainChain} in its settlement liquidity or cashback tier; est. gas ${ctx.gas}, ~15 min.`,
      `Test ${ctx.name}'s off-ramp or stablecoin conversion feature on ${ctx.mainChain} with ${ctx.quarterCapital} from your ${ctx.capital} balance; gas ${ctx.gas}, ~15 min.`,
    ],
    ctx.slug,
    'pay-s3',
  );
  const s4 = pick(
    [
      `Weekly on ${ctx.mainChain}: route regular spending or transfers through your ${ctx.capital} ${ctx.name} account and top up settled balances; gas ${ctx.gas}, ~10 min weekly.`,
      `Each week on ${ctx.mainChain}, settle 2-3 routine transfers on ${ctx.name} from your ${ctx.capital} balance and redeem cashback points; cost ${ctx.gas}, ~10 min weekly.`,
      `Keep weekly ${ctx.mainChain} payment velocity on ${ctx.name}: cycle ${ctx.quarterCapital} from your ${ctx.capital} account and reconcile receipts; gas ${ctx.gas}, ~10 min weekly.`,
    ],
    ctx.slug,
    'pay-s4',
  );
  return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
}

function formatCategoryLabel(category: string): string {
  return category
    .split(' ')
    .map((word) => (/^[A-Z0-9-]+$/.test(word) ? word : word.toLowerCase()))
    .join(' ');
}

function farmPredictionMarket(ctx: FarmContext): string[] {
  const s2 = pick(
    [
      `Deposit ${ctx.capital} in USDC into ${ctx.name} on ${ctx.mainChain} and trade YES/NO outcome shares across 3-5 high-liquidity markets; gas ${ctx.gas}, ~20 min.`,
      `Fund your ${ctx.name} ${ctx.mainChain} account with ${ctx.capital} and place limit bids/asks on major event markets to build maker volume; cost ${ctx.gas}, ~20 min.`,
      `Allocate ${ctx.capital} across liquid ${ctx.name} prediction markets on ${ctx.mainChain}, pairing near-term and longer-dated event contracts; est. gas ${ctx.gas}, ~20 min.`,
    ],
    ctx.slug,
    'pm-s2',
  );
  const s3 = pick(
    [
      `Provide two-sided limit-order liquidity with ${ctx.quarterCapital} of your ${ctx.capital} ${ctx.name} balance on ${ctx.mainChain} to capture liquidity-reward weight; gas ${ctx.gas}, ~15 min.`,
      `Spread ${ctx.quarterCapital} from your ${ctx.capital} ${ctx.name} stake across a second category (macro, crypto, or sports) on ${ctx.mainChain} for breadth; gas ${ctx.gas}, ~15 min.`,
      `Split or merge ${ctx.quarterCapital} of outcome shares on ${ctx.name} (${ctx.mainChain}) alongside your ${ctx.capital} trades to record contract diversity; gas ${ctx.gas}, ~15 min.`,
    ],
    ctx.slug,
    'pm-s3',
  );
  const s4 = pick(
    [
      `Weekly on ${ctx.mainChain}: redeem resolved ${ctx.name} positions, rotate ${ctx.quarterCapital} from your ${ctx.capital} bankroll into fresh markets, and log PnL; gas ${ctx.gas}, ~15 min weekly.`,
      `Each week on ${ctx.mainChain}, claim settled ${ctx.name} markets and place 3-4 disciplined limit orders using your ${ctx.capital} account; cost ${ctx.gas}, ~15 min weekly.`,
      `Keep a weekly ${ctx.mainChain} cadence on ${ctx.name}: refresh resting limit orders on your ${ctx.capital} balance and claim liquidity rebates; gas ${ctx.gas}, ~10 min weekly.`,
    ],
    ctx.slug,
    'pm-s4',
  );
  return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
}

function farmDefault(ctx: FarmContext): string[] {
  if (ctx.category === 'Prediction Market') {
    return farmPredictionMarket(ctx);
  }
  const catLabel = formatCategoryLabel(ctx.category);
  const s2 = pick(
    [
      `Commit ${ctx.capital} to ${ctx.name}'s primary ${catLabel} flow on ${ctx.mainChain} to establish sustained TVL-weighted on-chain history; gas ${ctx.gas}, ~20 min.`,
      `Deposit or transfer ${ctx.capital} through ${ctx.name}'s flagship ${ctx.mainChain} ${catLabel} product and verify balances on-chain; cost ${ctx.gas}, ~15 min.`,
      `Deploy ${ctx.capital} into ${ctx.name} (${ctx.mainChain}) via its core ${catLabel} route to begin accumulating early-user duration; est. gas ${ctx.gas}, ~20 min.`,
      `Activate your ${ctx.mainChain} footprint on ${ctx.name} by committing ${ctx.capital} to its highest-liquidity ${catLabel} market; gas ${ctx.gas}, ~15 min.`,
    ],
    ctx.slug,
    'def-s2',
  );
  const s3 = pick(
    [
      `Create a second footprint on ${ctx.name} (${ctx.mainChain}) by deploying ${ctx.quarterCapital} of your ${ctx.capital} into a secondary route, pool, or LP pair; gas ${ctx.gas}, ~15 min.`,
      `Use ${ctx.quarterCapital} from your ${ctx.capital} ${ctx.name} stack on ${ctx.mainChain} in a complementary DeFi integration or staking tier; est. gas ${ctx.gas}, ~15 min.`,
      `Pair your core ${ctx.capital} ${ctx.name} ${catLabel} position on ${ctx.mainChain} with a ${ctx.quarterCapital} secondary transfer, swap, or mint; gas ${ctx.gas}, ~15 min.`,
      `Diversify your ${ctx.name} ${ctx.mainChain} history by routing ${ctx.quarterCapital} of your ${ctx.capital} through a second supported asset or route; gas ${ctx.gas}, ~15 min.`,
    ],
    ctx.slug,
    'def-s3',
  );
  const s4 = pick(
    [
      `Weekly on ${ctx.mainChain}: check ${ctx.name} position health on your ${ctx.capital} allocation, claim accrued rewards, and log one fresh interaction; gas ${ctx.gas}, ~10 min weekly.`,
      `Each week on ${ctx.mainChain}, review ${ctx.name} ${catLabel} metrics for your ${ctx.capital} stake and compound or rebalance incentives; cost ${ctx.gas}, ~10 min weekly.`,
      `Keep a weekly ${ctx.mainChain} cadence on ${ctx.name}: harvest rewards from your ${ctx.capital} position and refresh active-epoch eligibility; gas ${ctx.gas}, ~10 min weekly.`,
    ],
    ctx.slug,
    'def-s4',
  );
  return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
}

export type CategoryGroup =
  | 'Lending'
  | 'Dexs'
  | 'Yield'
  | 'RWA'
  | 'Chain'
  | 'PerpDerivatives'
  | 'Payments'
  | 'Default';

export function resolveCategoryGroup(category: string | null): CategoryGroup {
  switch (category) {
    case 'Lending':
    case 'Uncollateralized Lending':
    case 'CDP':
    case 'CDP Manager':
    case 'Collateral Markets':
      return 'Lending';
    case 'Dexs':
    case 'Liquidity Manager':
    case 'OTC Marketplace':
      return 'Dexs';
    case 'Yield':
    case 'Yield Aggregator':
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
    case 'Farm':
    case 'Leveraged Farming':
    case 'Basis Trading':
    case 'Options Vault':
      return 'Yield';
    case 'RWA':
      return 'RWA';
    case 'Chain':
      return 'Chain';
    case 'Perp Dexs':
    case 'Derivatives':
    case 'Interest Rate Derivatives':
      return 'PerpDerivatives';
    case 'Payments':
    case 'Crypto Card Issuer':
      return 'Payments';
    default:
      return 'Default';
  }
}

export function buildFarmSteps(p: Protocol): string[] {
  const ctx = makeFarmContext(p);
  const group = resolveCategoryGroup(p.category);
  switch (group) {
    case 'Lending':
      return farmLending(ctx);
    case 'Dexs':
      return farmDexs(ctx);
    case 'Yield':
      return farmYieldGroup(ctx);
    case 'RWA':
      return farmRwa(ctx);
    case 'Chain':
      return farmChain(ctx);
    case 'PerpDerivatives':
      return farmPerpDerivatives(ctx);
    case 'Payments':
      return farmPayments(ctx);
    default:
      return farmDefault(ctx);
  }
}

/** Build the full ranked token-launch radar board from a sealed snapshot. */
export function buildBoard(snapshot: Snapshot): BoardResult {
  const multiples = computeCategoryMultiples(snapshot.protocols);
  const launchPriors = computeCategoryLaunchPriors(snapshot.protocols);
  const validation = computeLeaveOneOutValidation(snapshot);
  const watchlistSet = new Set(snapshot.watchlist);

  // Select launch candidates that record no token and are not wrapped/bridged/exchange products.
  const candidates = snapshot.protocols.filter(isLaunchCandidate);

  const fallbackMed = clamp(multiples.global_median, MIN_MULTIPLE, multiples.multiple_cap);
  const fallbackP25 = Math.min(fallbackMed, Math.max(0, multiples.global_p25));
  const fallbackP75 = clamp(multiples.global_p75, fallbackMed, multiples.multiple_cap);

  const draftRows: BoardRow[] = candidates.map((p) => {
    const category = p.category ?? 'Uncategorized';
    const catInfo = multiples.by_category[category];
    const mult = catInfo ? catInfo.multiple : fallbackMed;
    let p25Mult = Math.min(catInfo ? catInfo.p25_multiple : fallbackP25, mult);
    let p75Mult = Math.max(catInfo ? catInfo.p75_multiple : fallbackP75, mult);
    if (!(p25Mult > 0 && p75Mult / p25Mult >= 1.25)) {
      p25Mult = Math.min(p25Mult, fallbackP25);
      p75Mult = Math.max(p75Mult, fallbackP75);
    }
    const momentumMult = computeMomentumMult(p.change_7d);
    const maturityMult = computeMaturityMult(p.listed_at, snapshot.as_of);
    const breadthMult = computeBreadthMult(p.chains);
    const factors = momentumMult * maturityMult * breadthMult;

    const implied = Math.max(1, Math.round(p.tvl_usd * mult * factors));
    const impliedLow = Math.max(
      1,
      Math.min(Math.floor(implied * 0.99), Math.round(p.tvl_usd * p25Mult * factors)),
    );
    const impliedHigh = Math.max(
      Math.ceil(implied * 1.01),
      Math.round(p.tvl_usd * p75Mult * factors),
    );
    const launchPrior = launchPriors[category] ?? 0;

    return {
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: implied,
      implied_low_usd: impliedLow,
      implied_high_usd: impliedHigh,
      tvl_usd: p.tvl_usd,
      category,
      chains: [...p.chains],
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      watchlist: watchlistSet.has(p.slug),
      multiple_used: round4(mult),
      momentum_mult: round4(momentumMult),
      maturity_mult: round4(maturityMult),
      breadth_mult: round4(breadthMult),
      launch_prior: launchPrior,
      farm_score: 1,
      farm_steps: buildFarmSteps(p),
    };
  });

  draftRows.sort((a, b) => {
    if (b.implied_value_usd !== a.implied_value_usd) return b.implied_value_usd - a.implied_value_usd;
    if (b.tvl_usd !== a.tvl_usd) return b.tvl_usd - a.tvl_usd;
    return byCodeUnit(a.slug, b.slug);
  });

  const rawFarmScores: number[] = [];
  for (let i = 0; i < draftRows.length; i++) {
    const row = draftRows[i]!;
    row.rank = i + 1;
    if (i > 0) {
      const prev = draftRows[i - 1]!;
      if (row.implied_value_usd >= prev.implied_value_usd) {
        row.implied_value_usd = Math.max(1, prev.implied_value_usd - 1);
      }
    }
    row.implied_low_usd = Math.max(
      1,
      Math.min(row.implied_low_usd, Math.floor(row.implied_value_usd * 0.99)),
    );
    row.implied_high_usd = Math.max(
      row.implied_high_usd,
      Math.ceil(row.implied_value_usd * 1.01),
    );

    const tier = getCapitalTier(row.tvl_usd);
    rawFarmScores.push((row.implied_value_usd * row.launch_prior) / 100 / tier.capitalUsd);
  }

  const positiveLogs: number[] = [];
  for (const raw of rawFarmScores) {
    if (raw > 0) {
      positiveLogs.push(Math.log10(raw));
    }
  }

  if (positiveLogs.length === 0) {
    for (const row of draftRows) {
      row.farm_score = 50;
    }
  } else {
    let minLog = Infinity;
    let maxLog = -Infinity;
    for (const logVal of positiveLogs) {
      if (logVal < minLog) minLog = logVal;
      if (logVal > maxLog) maxLog = logVal;
    }
    const span = maxLog - minLog;
    for (let i = 0; i < draftRows.length; i++) {
      const row = draftRows[i]!;
      const raw = rawFarmScores[i]!;
      if (raw <= 0) {
        row.farm_score = 1;
      } else if (span === 0) {
        row.farm_score = 50;
      } else {
        const scaled = 1 + (99 * (Math.log10(raw) - minLog)) / span;
        row.farm_score = clamp(Math.round(scaled), 1, 100);
      }
    }
  }

  const categoryStats: Record<string, CategoryModelStats> = {};
  for (const cat of Object.keys(multiples.by_category).sort(byCodeUnit)) {
    const info = multiples.by_category[cat]!;
    categoryStats[cat] = {
      peers: info.peer_count,
      median_multiple: round4(info.multiple),
      p25_multiple: round4(info.p25_multiple),
      p75_multiple: round4(info.p75_multiple),
      launch_prior: launchPriors[cat] ?? 0,
    };
  }

  const modelStats: ModelStats = {
    global_median_multiple: round4(multiples.global_median),
    global_p25_multiple: round4(multiples.global_p25),
    global_p75_multiple: round4(multiples.global_p75),
    multiple_cap_p90: round4(multiples.multiple_cap),
    global_peer_count: multiples.global_peer_count,
    shrinkage_weight: SHRINKAGE_WEIGHT,
    validation,
    categories: categoryStats,
  };

  return {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    rows: draftRows,
    multiples,
    model_stats: modelStats,
  };
}
