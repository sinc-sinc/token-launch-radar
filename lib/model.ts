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
  tvl_elasticity_beta: number;
  tvl_pivot_usd: number;
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
  geo_ratio: number;
  within_2x: number;
  within_3x: number;
  within_2x_pct: number;
  within_3x_pct: number;
  iqr_coverage: number;
  iqr_coverage_pct: number;
  rmsle_log10: number;
  mae_log10: number;
  spearman_rho: number;
}

export interface ModelStats {
  global_median_multiple: number;
  global_p25_multiple: number;
  global_p75_multiple: number;
  multiple_cap_p90: number;
  global_peer_count: number;
  shrinkage_weight: number;
  launch_prior_weight: number;
  global_launch_rate_pct: number;
  tvl_elasticity_beta: number;
  tvl_pivot_usd: number;
  validation: ValidationStats;
  categories: Record<string, CategoryModelStats>;
}

export interface LivePeer {
  slug: string;
  name: string;
  symbol: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  tvl_sources: number;
  mcap_usd: number;
  raw_multiple: number;
  norm_multiple: number;
  change_7d: number | null;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  tvl_usd: number;
  effective_tvl_usd: number;
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
  live_peers: LivePeer[];
  multiples: MultipleTable;
  model_stats: ModelStats;
}

const MIN_MULTIPLE = 0.05;
const MULTIPLE_CAP_QUANTILE = 0.9;
const SHRINKAGE_WEIGHT = 8;
const LAUNCH_PRIOR_WEIGHT = 8;
const SHRINKAGE_EPS = 1e-6;
const BETA_MIN = 0.35;
const BETA_MAX = 1.0;
const MIN_VALIDATION_TVL_USD = 5_000_000;
const MATURITY_NULL_FACTOR = 0.99;
const MATURITY_TAU_DAYS = 540;
const MS_PER_DAY = 86_400_000;
const FARM_CAPITAL_BASE_USD = 250;
const FARM_CAPITAL_REF_TVL_USD = 5_000_000;
const FARM_CAPITAL_EXPONENT = 0.45;
const FARM_SCORE_MIN = 5;
const FARM_SCORE_MAX = 100;

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

interface SplitTvlEntry {
  totalTvl: number;
  recordCount: number;
  mcapCount: number;
}

/**
 * Data-driven split-TVL aggregator: when DefiLlama splits one protocol across
 * multiple version records sharing the same normalized (symbol, category) and
 * attaches the token's full market cap to a single record (e.g. Aave V1-V4,
 * SushiSwap V2/V3), aggregate TVL across all matching records so peer multiples
 * reflect total protocol TVL rather than one legacy version.
 */
export function buildAggregatedTvlMap(protocols: readonly Protocol[]): Map<string, SplitTvlEntry> {
  const map = new Map<string, SplitTvlEntry>();
  for (const p of protocols) {
    if (p.symbol === null || p.symbol.trim() === '' || !(p.tvl_usd > 0)) continue;
    const key = `${p.symbol.trim().toUpperCase()}||${p.category ?? 'Uncategorized'}`;
    let entry = map.get(key);
    if (!entry) {
      entry = { totalTvl: 0, recordCount: 0, mcapCount: 0 };
      map.set(key, entry);
    }
    entry.totalTvl += p.tvl_usd;
    entry.recordCount += 1;
    if (p.mcap_usd !== null && p.mcap_usd > 0) {
      entry.mcapCount += 1;
    }
  }
  return map;
}

export function resolvePeerTvl(
  p: Protocol,
  aggMap: ReadonlyMap<string, SplitTvlEntry>,
): { tvl_usd: number; tvl_sources: number } {
  if (p.symbol === null || p.symbol.trim() === '') {
    return { tvl_usd: p.tvl_usd, tvl_sources: 1 };
  }
  const key = `${p.symbol.trim().toUpperCase()}||${p.category ?? 'Uncategorized'}`;
  const entry = aggMap.get(key);
  if (entry && entry.recordCount >= 2 && entry.mcapCount === 1) {
    return { tvl_usd: entry.totalTvl, tvl_sources: entry.recordCount };
  }
  return { tvl_usd: p.tvl_usd, tvl_sources: 1 };
}

function spearmanRho(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n < 2 || ys.length !== n) return 0;
  const rankify = (vals: readonly number[]): number[] => {
    const idx = vals.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    const ranks = new Array<number>(n);
    for (let i = 0; i < n; ) {
      let j = i;
      while (j + 1 < n && idx[j + 1]![0] === idx[i]![0]) j++;
      const avgRank = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[idx[k]![1]] = avgRank;
      i = j + 1;
    }
    return ranks;
  };
  const rx = rankify(xs);
  const ry = rankify(ys);
  const mx = rx.reduce((s, v) => s + v, 0) / n;
  const my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i]! - mx;
    const b = ry[i]! - my;
    num += a * b;
    dx2 += a * a;
    dy2 += b * b;
  }
  return dx2 > 0 && dy2 > 0 ? num / Math.sqrt(dx2 * dy2) : 0;
}

/** Log-space (geometric) empirical-Bayes shrinkage toward the global benchmark. */
export function shrinkStatistic(
  n: number,
  catValue: number,
  globalValue: number,
  k = SHRINKAGE_WEIGHT,
): number {
  const c = Math.max(SHRINKAGE_EPS, catValue);
  const g = Math.max(SHRINKAGE_EPS, globalValue);
  return Math.exp((n * Math.log(c) + k * Math.log(g)) / (n + k));
}

/**
 * Estimate TVL power-law elasticity beta via global OLS on log10(mcap) ~ log10(TVL),
 * clamped to [0.35, 1.0], together with the geometric-mean TVL pivot.
 */
export function fitTvlPowerScaling(
  peers: ReadonlyArray<{ tvl_usd: number; mcap_usd: number }>,
): { beta: number; pivot: number } {
  const n = peers.length;
  if (n === 0) return { beta: 1, pivot: 1 };
  let sumLnTvl = 0;
  let sumX = 0;
  let sumY = 0;
  for (const p of peers) {
    sumLnTvl += Math.log(p.tvl_usd);
    sumX += Math.log10(p.tvl_usd);
    sumY += Math.log10(p.mcap_usd);
  }
  const pivot = Math.exp(sumLnTvl / n);
  if (n < 2) return { beta: 1, pivot };
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let den = 0;
  for (const p of peers) {
    const dx = Math.log10(p.tvl_usd) - meanX;
    const dy = Math.log10(p.mcap_usd) - meanY;
    num += dx * dy;
    den += dx * dx;
  }
  const beta = den > 0 ? clamp(num / den, BETA_MIN, BETA_MAX) : 1;
  return { beta, pivot };
}

/** Effective TVL under power-law scaling anchored at geometric pivot T_bar: T_bar * (T / T_bar)^beta. */
export function effectiveTvl(tvlUsd: number, pivotUsd: number, beta: number): number {
  if (!(tvlUsd > 0) || !(pivotUsd > 0)) return Math.max(0, tvlUsd);
  return pivotUsd * Math.pow(tvlUsd / pivotUsd, beta);
}

/**
 * Derive TVL^beta-normalized, pre-Winsorized, log-shrunk multiples (median, p25, p75)
 * per category directly from the snapshot's tokenised protocols (mcap_usd > 0 and
 * tvl_usd > 0). Peer ratios r_i = mcap_i / T_eff(TVL_i) are upper-Winsorized at the
 * data-derived global 90th percentile BEFORE computing category quantiles and shrunk
 * in log space toward global benchmarks with prior weight k.
 */
export function computeCategoryMultiples(protocols: readonly Protocol[]): MultipleTable {
  const aggTvlMap = buildAggregatedTvlMap(protocols);
  const validPeers: Array<{ category: string; tvl_usd: number; mcap_usd: number }> = [];
  const allCategories = new Set<string>();

  for (const p of protocols) {
    const cat = p.category ?? 'Uncategorized';
    allCategories.add(cat);
    if (hasValidPeerMultiple(p)) {
      const { tvl_usd } = resolvePeerTvl(p, aggTvlMap);
      validPeers.push({ category: cat, tvl_usd, mcap_usd: p.mcap_usd! });
    }
  }

  const { beta, pivot } = fitTvlPowerScaling(validPeers);
  const allRatios: number[] = [];
  const ratiosByCategory = new Map<string, number[]>();

  for (const peer of validPeers) {
    const ratio = peer.mcap_usd / effectiveTvl(peer.tvl_usd, pivot, beta);
    allRatios.push(ratio);
    const list = ratiosByCategory.get(peer.category);
    if (list) {
      list.push(ratio);
    } else {
      ratiosByCategory.set(peer.category, [ratio]);
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
    const rawRatios = ratiosByCategory.get(cat) ?? [];
    const n = rawRatios.length;
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
      const winsorized = rawRatios.map((r) => Math.min(r, multipleCap));
      const catMed = percentile(winsorized, 0.5);
      const catP25 = percentile(winsorized, 0.25);
      const catP75 = percentile(winsorized, 0.75);
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
    tvl_elasticity_beta: beta,
    tvl_pivot_usd: pivot,
    by_category: byCategory,
  };
}

export interface LaunchPriorResult {
  priors: Record<string, number>;
  globalRatePct: number;
  cleanTotal: number;
  cleanTokenized: number;
}

/**
 * Per-category launch prior (%) using a clean denominator (>= $5M TVL protocols
 * that are either non-excluded tokenised protocols or launch candidates) with
 * Beta-Binomial empirical-Bayes smoothing (prior weight LAUNCH_PRIOR_WEIGHT = 8)
 * toward the snapshot's global tokenised share.
 */
export function computeCategoryLaunchPriorsDetailed(protocols: readonly Protocol[]): LaunchPriorResult {
  const counts = new Map<string, { total: number; tokenized: number }>();
  const allCategories = new Set<string>();
  let cleanTotal = 0;
  let cleanTokenized = 0;

  for (const p of protocols) {
    const cat = p.category ?? 'Uncategorized';
    allCategories.add(cat);
    if (p.tvl_usd < MIN_VALIDATION_TVL_USD) continue;
    const isCleanTokenized =
      isTokenized(p) && !(p.category !== null && EXCLUDED_CATEGORIES.has(p.category));
    const isCleanCandidate = isLaunchCandidate(p);
    if (!isCleanTokenized && !isCleanCandidate) continue;

    let entry = counts.get(cat);
    if (!entry) {
      entry = { total: 0, tokenized: 0 };
      counts.set(cat, entry);
    }
    entry.total += 1;
    cleanTotal += 1;
    if (isTokenized(p)) {
      entry.tokenized += 1;
      cleanTokenized += 1;
    }
  }

  const globalRate = cleanTotal > 0 ? cleanTokenized / cleanTotal : 0.5;
  const priors: Record<string, number> = {};
  for (const cat of [...allCategories].sort(byCodeUnit)) {
    const entry = counts.get(cat);
    const total = entry ? entry.total : 0;
    const tokenized = entry ? entry.tokenized : 0;
    const smoothed =
      ((tokenized + LAUNCH_PRIOR_WEIGHT * globalRate) / (total + LAUNCH_PRIOR_WEIGHT)) * 100;
    priors[cat] = round1(smoothed);
  }
  return {
    priors,
    globalRatePct: round1(globalRate * 100),
    cleanTotal,
    cleanTokenized,
  };
}

export function computeCategoryLaunchPriors(protocols: readonly Protocol[]): Record<string, number> {
  return computeCategoryLaunchPriorsDetailed(protocols).priors;
}

/**
 * Leave-one-out validation across every tokenised snapshot protocol with
 * TVL >= $5M and a valid positive market cap. Uses split-TVL aggregation for
 * multi-version peers and recomputes TVL elasticity beta, pivot T_bar, global
 * quantiles, p90 cap, and pre-Winsorized log-shrunk category multiples
 * strictly without each held-out protocol.
 */
export function computeLeaveOneOutValidation(snapshot: Snapshot): ValidationStats {
  const aggTvlMap = buildAggregatedTvlMap(snapshot.protocols);
  const peerEntries: Array<{ idx: number; category: string; tvl_usd: number; mcap_usd: number }> = [];
  const evalEntries: Array<{ idx: number; tvl_usd: number }> = [];

  for (let i = 0; i < snapshot.protocols.length; i++) {
    const p = snapshot.protocols[i]!;
    if (hasValidPeerMultiple(p)) {
      const { tvl_usd } = resolvePeerTvl(p, aggTvlMap);
      peerEntries.push({
        idx: i,
        category: p.category ?? 'Uncategorized',
        tvl_usd,
        mcap_usd: p.mcap_usd!,
      });
      if (p.tvl_usd >= MIN_VALIDATION_TVL_USD) {
        evalEntries.push({ idx: i, tvl_usd });
      }
    }
  }

  if (evalEntries.length === 0) {
    return {
      count: 0,
      median_ratio: 0,
      geo_ratio: 0,
      within_2x: 0,
      within_3x: 0,
      within_2x_pct: 0,
      within_3x_pct: 0,
      iqr_coverage: 0,
      iqr_coverage_pct: 0,
      rmsle_log10: 0,
      mae_log10: 0,
      spearman_rho: 0,
    };
  }

  const ratios: number[] = [];
  const predictedList: number[] = [];
  const actualList: number[] = [];
  let sumLogErr = 0;
  let sumSqLogErr = 0;
  let sumAbsLogErr = 0;
  let within2 = 0;
  let within3 = 0;
  let insideIqr = 0;

  for (const target of evalEntries) {
    const p = snapshot.protocols[target.idx]!;
    const targetCat = p.category ?? 'Uncategorized';
    const others = peerEntries.filter((e) => e.idx !== target.idx);
    const { beta, pivot } = fitTvlPowerScaling(others);

    const otherAll: number[] = [];
    const otherCatRaw: number[] = [];
    for (const entry of others) {
      const r = entry.mcap_usd / effectiveTvl(entry.tvl_usd, pivot, beta);
      otherAll.push(r);
      if (entry.category === targetCat) {
        otherCatRaw.push(r);
      }
    }

    const globalMed = otherAll.length > 0 ? percentile(otherAll, 0.5) : 1;
    const globalP25 = otherAll.length > 0 ? percentile(otherAll, 0.25) : 1;
    const globalP75 = otherAll.length > 0 ? percentile(otherAll, 0.75) : 1;
    const cap = Math.max(
      MIN_MULTIPLE,
      otherAll.length > 0 ? percentile(otherAll, MULTIPLE_CAP_QUANTILE) : 1,
    );

    const fbMed = clamp(globalMed, MIN_MULTIPLE, cap);
    const fbP25 = Math.min(fbMed, Math.max(0, globalP25));
    const fbP75 = clamp(globalP75, fbMed, cap);

    const n = otherCatRaw.length;
    let mult: number;
    let p25Mult: number;
    let p75Mult: number;
    if (n === 0) {
      mult = fbMed;
      p25Mult = fbP25;
      p75Mult = fbP75;
    } else {
      const winsorCat = otherCatRaw.map((r) => Math.min(r, cap));
      mult = clamp(shrinkStatistic(n, percentile(winsorCat, 0.5), globalMed), MIN_MULTIPLE, cap);
      p25Mult = Math.min(mult, Math.max(0, shrinkStatistic(n, percentile(winsorCat, 0.25), globalP25)));
      p75Mult = clamp(shrinkStatistic(n, percentile(winsorCat, 0.75), globalP75), mult, cap);
    }
    if (!(p25Mult > 0 && p75Mult / p25Mult >= 1.25)) {
      p25Mult = Math.min(p25Mult, fbP25);
      p75Mult = Math.max(p75Mult, fbP75);
    }

    const factors =
      computeMomentumMult(p.change_7d) *
      computeMaturityMult(p.listed_at, snapshot.as_of) *
      computeBreadthMult(p.chains);
    const tEff = effectiveTvl(target.tvl_usd, pivot, beta);
    const predicted = Math.max(1, Math.round(tEff * mult * factors));
    const predLow = Math.max(1, Math.min(Math.floor(predicted * 0.99), Math.round(tEff * p25Mult * factors)));
    const predHigh = Math.max(Math.ceil(predicted * 1.01), Math.round(tEff * p75Mult * factors));

    const ratio = predicted / p.mcap_usd!;
    ratios.push(ratio);
    predictedList.push(predicted);
    actualList.push(p.mcap_usd!);
    const logErr = Math.log10(ratio);
    sumLogErr += logErr;
    sumSqLogErr += logErr * logErr;
    sumAbsLogErr += Math.abs(logErr);

    if (ratio >= 0.5 && ratio <= 2) within2 += 1;
    if (ratio >= 1 / 3 && ratio <= 3) within3 += 1;
    if (p.mcap_usd! >= predLow && p.mcap_usd! <= predHigh) insideIqr += 1;
  }

  const count = ratios.length;
  return {
    count,
    median_ratio: round4(median(ratios)),
    geo_ratio: round4(Math.pow(10, sumLogErr / count)),
    within_2x: round4(within2 / count),
    within_3x: round4(within3 / count),
    within_2x_pct: round1((within2 / count) * 100),
    within_3x_pct: round1((within3 / count) * 100),
    iqr_coverage: round4(insideIqr / count),
    iqr_coverage_pct: round1((insideIqr / count) * 100),
    rmsle_log10: round4(Math.sqrt(sumSqLogErr / count)),
    mae_log10: round4(sumAbsLogErr / count),
    spearman_rho: round4(spearmanRho(predictedList, actualList)),
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
  return 1 + (clamped / 100) * 0.15;
}

export function computeMaturityMult(listedAt: string | null, asOf: string): number {
  if (listedAt === null) return MATURITY_NULL_FACTOR;
  const ageDays = daysBetweenUtc(listedAt, asOf);
  return 0.9 + 0.18 * (1 - Math.exp(-ageDays / MATURITY_TAU_DAYS));
}

export function computeBreadthMult(chains: readonly string[]): number {
  return chains.length >= 3 ? 1.02 : chains.length === 2 ? 1.0 : 0.98;
}

export interface CapitalTier {
  capitalUsd: number;
  capital: string;
  half: string;
  quarter: string;
  weeks: number;
}

export type ChainKind =
  | 'bitcoin'
  | 'solana'
  | 'tron'
  | 'sui'
  | 'aptos'
  | 'stellar'
  | 'algorand'
  | 'ripple'
  | 'starknet'
  | 'stacks'
  | 'cosmos'
  | 'other_non_evm'
  | 'evm_l1'
  | 'evm_l2';

interface FarmContext {
  slug: string;
  name: string;
  category: string;
  mainChain: string;
  chainKind: ChainKind;
  coreAsset: string;
  feeLabel: string;
  capitalUsd: number;
  capital: string;
  halfCapital: string;
  quarterCapital: string;
  weeks: number;
  weeklyMinutes: number;
  gas: string;
  isEthereum: boolean;
}

const NATIVE_L1_KEEP = new Set<string>(['Bitcoin', 'Tron']);
const MAJOR_CHAIN_PRIORITY: readonly string[] = [
  'Base',
  'Arbitrum',
  'Optimism',
  'Solana',
  'Polygon',
  'Avalanche',
  'Binance',
  'BSC',
  'Sui',
  'Ethereum',
];
const KNOWN_EVM_L2_CHAINS = new Set<string>([
  'Base',
  'Arbitrum',
  'Optimism',
  'Polygon',
  'Avalanche',
  'Binance',
  'BSC',
  'Hyperliquid L1',
  'Monad',
  'Flare',
  'Arc',
  'Ink',
  'Plasma',
  'Mantle',
  'Robinhood Chain',
  'zkSync Era',
  'Berachain',
  'BSquared',
  'Ronin',
  'Kava',
  'Manta',
  'Mezo',
  'Morph',
  'Plume Mainnet',
  'Pharos',
  'World Chain',
  'Reya Network',
  'RSK',
  'Strato',
  'Klaytn',
  'Tempo',
  'Stable',
  'Fluent',
  'RISE',
  'Bifrost Network',
  'Linea',
  'Scroll',
  'Gnosis',
  'Celo',
  'Blast',
  'Mode',
  'Sonic',
  'Fraxtal',
  'Taiko',
  'Unichain',
  'Katana',
  'Abstract',
  'Core',
  'Bob',
  'Merlin',
  'Bitlayer',
  'Corn',
  'Hemi',
  'Cronos',
  'Metis',
  'Fantom',
  'Moonbeam',
  'Astar',
  'Aurora',
  'Op_Bnb',
  'Sophon',
  'Swellchain',
]);

/**
 * Choose a liquid, low-fee primary chain for farming while preserving native
 * Bitcoin and Tron L1 protocols on their home networks.
 */
export function selectPrimaryChain(chains: readonly string[]): string {
  if (chains.length === 0) return 'Ethereum';
  const first = chains[0]!;
  if (NATIVE_L1_KEEP.has(first)) return first;
  for (const major of MAJOR_CHAIN_PRIORITY) {
    if (chains.includes(major)) return major;
  }
  return first;
}

export function orderChainsWithPrimary(chains: readonly string[]): string[] {
  if (chains.length <= 1) return [...chains];
  const primary = selectPrimaryChain(chains);
  return [primary, ...chains.filter((c) => c !== primary)];
}

export function classifyChain(chain: string): ChainKind {
  switch (chain) {
    case 'Bitcoin':
      return 'bitcoin';
    case 'Solana':
      return 'solana';
    case 'Tron':
      return 'tron';
    case 'Sui':
      return 'sui';
    case 'Aptos':
      return 'aptos';
    case 'Stellar':
      return 'stellar';
    case 'Algorand':
      return 'algorand';
    case 'Ripple':
      return 'ripple';
    case 'Starknet':
      return 'starknet';
    case 'Stacks':
      return 'stacks';
    case 'Noble':
    case 'XION':
    case 'Provenance':
      return 'cosmos';
    case 'Ethereum':
      return 'evm_l1';
    default:
      return KNOWN_EVM_L2_CHAINS.has(chain) ? 'evm_l2' : 'other_non_evm';
  }
}

function chainEconomics(chain: string, kind: ChainKind): { gas: string; coreAsset: string; feeLabel: string } {
  switch (kind) {
    case 'bitcoin':
      return { gas: '$1-$5 per tx', coreAsset: 'BTC', feeLabel: 'network fee' };
    case 'solana':
      return { gas: '<$0.01 per tx', coreAsset: 'USDC or SOL', feeLabel: 'fee' };
    case 'tron':
      return { gas: '$0.50-$2 per tx', coreAsset: 'USDT or TRX', feeLabel: 'energy fee' };
    case 'sui':
      return { gas: '<$0.01 per tx', coreAsset: 'USDC or SUI', feeLabel: 'gas' };
    case 'aptos':
      return { gas: '<$0.01 per tx', coreAsset: 'USDC or APT', feeLabel: 'gas' };
    case 'stellar':
      return { gas: '<$0.01 per tx', coreAsset: 'USDC or XLM', feeLabel: 'fee' };
    case 'algorand':
      return { gas: '<$0.01 per tx', coreAsset: 'USDCa or ALGO', feeLabel: 'fee' };
    case 'ripple':
      return { gas: '<$0.01 per tx', coreAsset: 'RLUSD or XRP', feeLabel: 'fee' };
    case 'starknet':
      return { gas: '$0.05-$0.50 per tx', coreAsset: 'USDC or ETH', feeLabel: 'fee' };
    case 'stacks':
      return { gas: '$0.05-$0.50 per tx', coreAsset: 'sBTC or STX', feeLabel: 'fee' };
    case 'cosmos':
      return { gas: '<$0.05 per tx', coreAsset: 'USDC or native IBC assets', feeLabel: 'fee' };
    case 'other_non_evm':
      return { gas: '$0.05-$1 per tx', coreAsset: `native ${chain} assets`, feeLabel: 'fee' };
    case 'evm_l1':
      return { gas: '$8-$25 per tx', coreAsset: 'USDC or ETH', feeLabel: 'gas' };
    case 'evm_l2':
      return { gas: '$0.10-$2 per tx', coreAsset: 'USDC or ETH', feeLabel: 'gas' };
  }
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
  if (group === 'PerpDerivatives' || group === 'Chain' || group === 'PredictionMarket') {
    return 20;
  }
  return 15;
}

function makeFarmContext(p: Protocol): FarmContext {
  const mainChain = selectPrimaryChain(p.chains);
  const chainKind = classifyChain(mainChain);
  const econ = chainEconomics(mainChain, chainKind);
  const tier = getCapitalTier(p.tvl_usd);
  return {
    slug: p.slug,
    name: p.name,
    category: p.category ?? 'DeFi',
    mainChain,
    chainKind,
    coreAsset: econ.coreAsset,
    feeLabel: econ.feeLabel,
    capitalUsd: tier.capitalUsd,
    capital: tier.capital,
    halfCapital: tier.half,
    quarterCapital: tier.quarter,
    weeks: tier.weeks,
    weeklyMinutes: estimateWeeklyMinutes(p.category),
    gas: econ.gas,
    isEthereum: chainKind === 'evm_l1',
  };
}

function step1WalletAndBridge(ctx: FarmContext): string {
  const budgetPrefix = `Budget: ${ctx.capital} over ~${ctx.weeks} weeks, ~${ctx.weeklyMinutes} min/week.`;
  switch (ctx.chainKind) {
    case 'bitcoin':
      return pick(
        [
          `${budgetPrefix} Fund a self-custodial Bitcoin wallet (Sparrow/Xverse) with ${ctx.capital} in BTC for ${ctx.name}; est. ${ctx.feeLabel} ${ctx.gas}, ~20 min setup.`,
          `${budgetPrefix} Prepare a dedicated Taproot Bitcoin address with ${ctx.capital} in BTC plus UTXO fee buffer for ${ctx.name}; est. ${ctx.feeLabel} ${ctx.gas}, ~20 min setup.`,
        ],
        ctx.slug,
        's1-btc',
      );
    case 'solana':
      return pick(
        [
          `${budgetPrefix} Fund a dedicated Solana wallet (Phantom/Backpack) with ${ctx.capital} in USDC plus SOL for ${ctx.name}; est. ${ctx.feeLabel} ${ctx.gas}, ~15 min setup.`,
          `${budgetPrefix} Set up a clean Solana signer holding ${ctx.capital} in USDC/SOL for ${ctx.name} interactions; est. ${ctx.feeLabel} ${ctx.gas}, ~15 min setup.`,
        ],
        ctx.slug,
        's1-sol',
      );
    case 'tron':
      return `${budgetPrefix} Fund a TronLink wallet with ${ctx.capital} in USDT plus TRX for bandwidth/energy on ${ctx.name}; est. ${ctx.feeLabel} ${ctx.gas}, ~15 min setup.`;
    case 'sui':
      return `${budgetPrefix} Fund a Sui wallet (Slush/Suiet) with ${ctx.capital} in USDC plus SUI gas for ${ctx.name}; est. ${ctx.feeLabel} ${ctx.gas}, ~15 min setup.`;
    case 'aptos':
      return `${budgetPrefix} Fund an Aptos wallet (Petra/Pontem) with ${ctx.capital} in USDC plus APT gas for ${ctx.name}; est. ${ctx.feeLabel} ${ctx.gas}, ~15 min setup.`;
    case 'stellar':
      return `${budgetPrefix} Fund a Stellar wallet (Freighter/Lobstr) with ${ctx.capital} in USDC plus XLM base reserve for ${ctx.name}; est. ${ctx.feeLabel} ${ctx.gas}, ~15 min setup.`;
    case 'algorand':
      return `${budgetPrefix} Fund a Pera Algorand wallet with ${ctx.capital} in USDCa plus ALGO gas and opt in to ${ctx.name} assets; est. ${ctx.feeLabel} ${ctx.gas}, ~15 min setup.`;
    case 'ripple':
      return `${budgetPrefix} Fund a self-custodial XRPL wallet (Xaman) with ${ctx.capital} in XRP/RLUSD and enable ${ctx.name} trustlines; est. ${ctx.feeLabel} ${ctx.gas}, ~15 min setup.`;
    case 'starknet':
      return `${budgetPrefix} Fund a Starknet wallet (Argent X/Braavos) via StarkGate with ${ctx.capital} in USDC plus STRK/ETH fee buffer for ${ctx.name}; est. ${ctx.feeLabel} ${ctx.gas}, ~20 min setup.`;
    case 'stacks':
      return `${budgetPrefix} Fund a Stacks wallet (Leather/Xverse) with ${ctx.capital} in sBTC or STX for ${ctx.name}; est. ${ctx.feeLabel} ${ctx.gas}, ~20 min setup.`;
    case 'cosmos':
      return `${budgetPrefix} Fund a Keplr/Leap wallet on ${ctx.mainChain} via IBC transfer with ${ctx.capital} plus native gas for ${ctx.name}; est. ${ctx.feeLabel} ${ctx.gas}, ~15 min setup.`;
    case 'other_non_evm':
      return `${budgetPrefix} Fund a dedicated ${ctx.mainChain} native wallet with ${ctx.capital} in supported assets plus native fee reserve for ${ctx.name}; est. ${ctx.feeLabel} ${ctx.gas}, ~20 min setup.`;
    case 'evm_l1':
      return pick(
        [
          `${budgetPrefix} Fund an isolated Ethereum wallet with ${ctx.capital} in USDC/ETH plus mainnet gas buffer for ${ctx.name}; est. gas ${ctx.gas}, ~20 min setup.`,
          `${budgetPrefix} Prepare a clean Ethereum mainnet signer holding ${ctx.capital} in liquid collateral for ${ctx.name}; est. gas ${ctx.gas}, ~20 min setup.`,
        ],
        ctx.slug,
        's1-l1',
      );
    case 'evm_l2':
      return pick(
        [
          `${budgetPrefix} Fund a dedicated ${ctx.mainChain} wallet with ${ctx.capital} in USDC plus gas via an official ${ctx.mainChain} bridge for ${ctx.name}; est. gas ${ctx.gas}, ~20 min setup.`,
          `${budgetPrefix} Bridge ${ctx.capital} plus gas buffer onto ${ctx.mainChain} into a clean address for ${ctx.name}; est. gas ${ctx.gas}, ~20 min setup.`,
          `${budgetPrefix} Set up an isolated ${ctx.mainChain} signer and fund ${ctx.capital} in liquid collateral for ${ctx.name}; est. gas ${ctx.gas}, ~20 min setup.`,
        ],
        ctx.slug,
        's1-l2',
      );
  }
}

function step5TrackLaunch(ctx: FarmContext): string {
  const templates = [
    `Track ${ctx.name} announcements on ${ctx.mainChain}, export tx hashes for your ${ctx.capital} position for airdrop claims, and reserve ${ctx.gas} for claiming; ~15 min monthly.`,
    `Monitor ${ctx.name} governance posts and snapshot notices on ${ctx.mainChain}, archive proofs for your ${ctx.capital} activity, and keep ${ctx.gas} ready to claim; ~15 min monthly.`,
    `Follow ${ctx.name} official channels for TGE dates on ${ctx.mainChain}, log weekly receipts on your ${ctx.capital} stake, and hold ${ctx.gas} for claim ${ctx.feeLabel}; ~15 min monthly.`,
    `Check ${ctx.name} points dashboards and ${ctx.mainChain} eligibility notices, keep a ledger of your ${ctx.capital} deposits, and budget ${ctx.gas} for claim tx; ~15 min monthly.`,
  ];
  return pick(templates, ctx.slug, 's5');
}

function farmLending(ctx: FarmContext): string[] {
  const s2 = pick(
    [
      `Supply ${ctx.capital} of ${ctx.coreAsset} into ${ctx.name}'s deepest ${ctx.mainChain} lending market to build deposit duration; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
      `Deposit ${ctx.capital} in ${ctx.coreAsset} on ${ctx.name} (${ctx.mainChain}) to activate lender points and interest accrual; est. ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
      `Open a primary supply position of ${ctx.capital} in ${ctx.name} on ${ctx.mainChain}, choosing high-utilization reserves for steady score weight; cost ${ctx.gas}, ~20 min.`,
      `Commit ${ctx.capital} to ${ctx.name}'s core ${ctx.mainChain} money market and verify receipt tokens appear on-chain; est. ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
    ],
    ctx.slug,
    'lend-s2',
  );
  const s3 = pick(
    [
      `Borrow ${ctx.quarterCapital} safely against your ${ctx.capital} ${ctx.name} collateral on ${ctx.mainChain} (keep health factor >2.0) to record borrower activity; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
      `Draw a conservative ${ctx.quarterCapital} loan backed by your ${ctx.capital} ${ctx.name} deposit on ${ctx.mainChain} and repay half after 48h for dual-side history; ${ctx.feeLabel} ${ctx.gas}, ~20 min.`,
      `Activate a second market on ${ctx.name} (${ctx.mainChain}) by borrowing ${ctx.quarterCapital} against ${ctx.capital} collateral at low LTV; est. ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
      `Create borrow-side footprint on ${ctx.name} (${ctx.mainChain}) by borrowing ${ctx.quarterCapital} from your ${ctx.capital} line while keeping LTV under 35%; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
    ],
    ctx.slug,
    'lend-s3',
  );
  const s4 = pick(
    [
      `Weekly on ${ctx.mainChain}: check health factor on your ${ctx.capital} ${ctx.name} position, harvest rewards, and repay or top up borrow dust; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
      `Run a weekly ${ctx.mainChain} check on ${ctx.name}: rebalance your ${ctx.capital} collateral ratio, claim incentives, and log one small repay tx; cost ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
      `Each week on ${ctx.mainChain}, verify ${ctx.name} borrow APRs on your ${ctx.capital} deposit and execute a small interest repayment to stay active; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
    ],
    ctx.slug,
    'lend-s4',
  );
  return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
}

function farmCdp(ctx: FarmContext): string[] {
  const cdpLabel = /\bCDP\b/i.test(ctx.name) ? '' : ' CDP';
  const s2 = pick(
    [
      `Lock ${ctx.capital} of ${ctx.coreAsset} into a ${ctx.name}${cdpLabel} vault on ${ctx.mainChain} and mint ${ctx.halfCapital} of its protocol stablecoin at >200% collateralization; ${ctx.feeLabel} ${ctx.gas}, ~20 min.`,
      `Open a ${ctx.name} collateralized debt vault on ${ctx.mainChain} with ${ctx.capital} in ${ctx.coreAsset} and mint ${ctx.quarterCapital} in protocol debt at safe LTV; cost ${ctx.gas}, ~20 min.`,
    ],
    ctx.slug,
    'cdp-s2',
  );
  const s3 = pick(
    [
      `Deposit your minted ${ctx.name} stablecoin (${ctx.quarterCapital} from your ${ctx.capital} vault) into the stability pool or flagship stable LP on ${ctx.mainChain}; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
      `Put minted ${ctx.name} stablecoins to work on ${ctx.mainChain} by staking ${ctx.quarterCapital} into the protocol savings module or peg-stability pool alongside your ${ctx.capital} vault; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
    ],
    ctx.slug,
    'cdp-s3',
  );
  const s4 = pick(
    [
      `Weekly on ${ctx.mainChain}: verify collateral ratio and stablecoin peg on your ${ctx.capital} ${ctx.name}${cdpLabel} vault, claim stability yields, and adjust debt if needed; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
      `Each week on ${ctx.mainChain}, audit liquidation buffer on your ${ctx.capital} ${ctx.name}${cdpLabel} position and compound stability-pool rewards; cost ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
    ],
    ctx.slug,
    'cdp-s4',
  );
  return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
}

function farmDexs(ctx: FarmContext): string[] {
  const s2 = pick(
    [
      `Provide ${ctx.capital} in liquidity to ${ctx.name}'s highest-volume stable or major pair on ${ctx.mainChain} to accumulate LP fee history; ${ctx.feeLabel} ${ctx.gas}, ~20 min.`,
      `Deploy ${ctx.capital} across a major ${ctx.name} pool on ${ctx.mainChain} using a balanced range to avoid frequent out-of-range resets; est. ${ctx.feeLabel} ${ctx.gas}, ~20 min.`,
      `Seed a ${ctx.capital} LP position on ${ctx.name} (${ctx.mainChain}) in a top-TVL pair to earn organic swap fees and protocol weight; cost ${ctx.gas}, ~15 min.`,
      `Add ${ctx.capital} of paired assets into ${ctx.name}'s flagship ${ctx.mainChain} pool and stake the LP receipt if a gauge exists; est. ${ctx.feeLabel} ${ctx.gas}, ~20 min.`,
    ],
    ctx.slug,
    'dex-s2',
  );
  const s3 = pick(
    [
      `Execute 3-4 organic spot swaps totaling ${ctx.halfCapital} across distinct pairs on ${ctx.name} (${ctx.mainChain}) alongside your ${ctx.capital} LP; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
      `Place a limit order or route ${ctx.quarterCapital} of multi-hop swaps on ${ctx.name} (${ctx.mainChain}) to pair trader volume with your ${ctx.capital} LP; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
      `Route ${ctx.halfCapital} in spot swaps across two ${ctx.name} fee tiers on ${ctx.mainChain} so your ${ctx.capital} wallet records both LP and taker flow; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
      `Use ${ctx.name}'s router on ${ctx.mainChain} for ${ctx.quarterCapital} in cross-pair swaps to diversify beyond your ${ctx.capital} liquidity deposit; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
    ],
    ctx.slug,
    'dex-s3',
  );
  const s4 = pick(
    [
      `Weekly on ${ctx.mainChain}: collect accrued fees on your ${ctx.capital} ${ctx.name} LP, recenter if out of range, and execute one fresh swap; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
      `Each week on ${ctx.mainChain}, audit range utilization on your ${ctx.capital} ${ctx.name} pool and compound earned fees with a small swap; cost ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
      `Maintain weekly ${ctx.mainChain} cadence on ${ctx.name}: claim LP fees from your ${ctx.capital} stake and route a ${ctx.quarterCapital} swap; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
    ],
    ctx.slug,
    'dex-s4',
  );
  return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
}

function farmYieldGroup(ctx: FarmContext): string[] {
  const s2 = pick(
    [
      `Deposit ${ctx.capital} into ${ctx.name}'s flagship ${ctx.mainChain} curated vault or yield strategy to start continuous share-time accrual; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
      `Allocate ${ctx.capital} into the highest-liquidity ${ctx.name} vault on ${ctx.mainChain}, verifying share token minting on-chain; est. ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
      `Mint ${ctx.name} vault shares with ${ctx.capital} on ${ctx.mainChain}, prioritizing audited ${ctx.coreAsset} yield strategies; cost ${ctx.gas}, ~20 min.`,
      `Enter ${ctx.name}'s core ${ctx.mainChain} yield pool with ${ctx.capital} to build durable TVL-weighted history across epochs; est. ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
    ],
    ctx.slug,
    'yld-s2',
  );
  const s3 = pick(
    [
      `Split ${ctx.quarterCapital} from your ${ctx.capital} budget into a second ${ctx.name} strategy or boosted lock vault on ${ctx.mainChain} for multi-vault coverage; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
      `Pair your ${ctx.capital} ${ctx.name} vault deposit on ${ctx.mainChain} with a ${ctx.quarterCapital} entry into a secondary risk tier or PT/YT pool; ${ctx.feeLabel} ${ctx.gas}, ~20 min.`,
      `Use your ${ctx.name} receipt token on ${ctx.mainChain} (or allocate ${ctx.quarterCapital} of your ${ctx.capital} cap) in an integrated DeFi pool for composable activity; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
      `Diversify across two ${ctx.name} curated vaults on ${ctx.mainChain} by moving ${ctx.quarterCapital} of your ${ctx.capital} allocation into an alternate strategy; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
    ],
    ctx.slug,
    'yld-s3',
  );
  const s4 = pick(
    [
      `Weekly on ${ctx.mainChain}: review ${ctx.name} vault APY and curator risk updates on your ${ctx.capital} stake, then claim or compound rewards; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
      `Every week on ${ctx.mainChain}, verify ${ctx.name} share exchange rates on your ${ctx.capital} allocation and roll maturing epochs if applicable; cost ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
      `Hold a weekly ${ctx.mainChain} routine on ${ctx.name}: check curator exposure on your ${ctx.capital} vaults and harvest accrued incentives; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
    ],
    ctx.slug,
    'yld-s4',
  );
  return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
}

function farmRwa(ctx: FarmContext): string[] {
  const s2 = pick(
    [
      `Complete any required wallet allowlisting and mint or acquire ${ctx.capital} of ${ctx.name}'s core RWA token on ${ctx.mainChain}; ${ctx.feeLabel} ${ctx.gas}, ~25 min.`,
      `Deploy ${ctx.capital} into ${ctx.name}'s primary tokenized treasury or credit vault on ${ctx.mainChain} to establish real-yield duration; cost ${ctx.gas}, ~20 min.`,
      `Subscribe ${ctx.capital} in ${ctx.coreAsset} into ${ctx.name}'s liquid ${ctx.mainChain} RWA product and verify balance accrual on-chain; est. ${ctx.feeLabel} ${ctx.gas}, ~20 min.`,
      `Convert ${ctx.capital} into ${ctx.name}'s flagship ${ctx.mainChain} RWA instrument to build long-duration holder history; est. ${ctx.feeLabel} ${ctx.gas}, ~20 min.`,
    ],
    ctx.slug,
    'rwa-s2',
  );
  const s3 = pick(
    [
      `Wrap or supply ${ctx.halfCapital} of your ${ctx.capital} ${ctx.name} RWA tokens on ${ctx.mainChain} into a secondary liquidity or collateral pool; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
      `Test a ${ctx.quarterCapital} swap or redemption cycle on ${ctx.name} (${ctx.mainChain}) alongside your ${ctx.capital} core holding to log two contract paths; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
      `Stake ${ctx.halfCapital} of your ${ctx.capital} ${ctx.name} RWA position in a partnered ${ctx.mainChain} yield or LP vault for extra on-chain depth; ${ctx.feeLabel} ${ctx.gas}, ~20 min.`,
      `Use ${ctx.quarterCapital} of your ${ctx.capital} ${ctx.name} balance on ${ctx.mainChain} to interact with a secondary RWA pool or wrapper contract; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
    ],
    ctx.slug,
    'rwa-s3',
  );
  const s4 = pick(
    [
      `Weekly on ${ctx.mainChain}: verify NAV yield accrual on your ${ctx.capital} ${ctx.name} position and claim any bonus reward distributions; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
      `Each week on ${ctx.mainChain}, check ${ctx.name} redemption queue liquidity for your ${ctx.capital} holding and compound yield distributions; cost ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
      `Maintain a weekly ${ctx.mainChain} review of ${ctx.name}: confirm attestation updates on your ${ctx.capital} RWA balance and log one maintenance tx; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
    ],
    ctx.slug,
    'rwa-s4',
  );
  return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
}

function farmChain(ctx: FarmContext): string[] {
  const s2 = pick(
    [
      `Deploy ${ctx.capital} into the ${ctx.name} ecosystem on ${ctx.mainChain} and deposit ${ctx.halfCapital} into its leading native DEX or lending pool; ${ctx.feeLabel} ${ctx.gas}, ~20 min.`,
      `Allocate ${ctx.capital} across ${ctx.name}'s native ${ctx.mainChain} DeFi stack by providing liquidity or staking in a core ecosystem protocol; cost ${ctx.gas}, ~20 min.`,
      `Activate your ${ctx.mainChain} address on ${ctx.name} by committing ${ctx.capital} to a top native liquidity or staking contract for TVL time; ${ctx.feeLabel} ${ctx.gas}, ~20 min.`,
      `Move ${ctx.capital} onto ${ctx.name} (${ctx.mainChain}) and lock ${ctx.halfCapital} in a flagship ecosystem vault to establish sustained chain TVL; ${ctx.feeLabel} ${ctx.gas}, ~20 min.`,
    ],
    ctx.slug,
    'chn-s2',
  );
  const s3 = pick(
    [
      `Interact with 3 distinct ${ctx.name} contracts on ${ctx.mainChain} using ${ctx.quarterCapital} from your ${ctx.capital} budget (swap, identity/NFT, lend); ${ctx.feeLabel} ${ctx.gas}, ~20 min.`,
      `Build diverse ${ctx.name} contract breadth on ${ctx.mainChain} by routing ${ctx.quarterCapital} of your ${ctx.capital} funds across a DEX, staking pool, and money market; ${ctx.feeLabel} ${ctx.gas}, ~20 min.`,
      `Register an on-chain identity or stake with a validator on ${ctx.name} (${ctx.mainChain}) alongside ${ctx.quarterCapital} of your ${ctx.capital} swaps; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
      `Spread ${ctx.quarterCapital} of your ${ctx.capital} ${ctx.name} stack across two additional ${ctx.mainChain} dApps to increase unique contract count; ${ctx.feeLabel} ${ctx.gas}, ~20 min.`,
    ],
    ctx.slug,
    'chn-s3',
  );
  const s4 = pick(
    [
      `Weekly on ${ctx.mainChain}: execute 2-3 organic transactions across ${ctx.name} dApps while maintaining your ${ctx.capital} TVL footprint; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
      `Every week on ${ctx.mainChain}, rotate a small ${ctx.quarterCapital} swap and claim rewards on your ${ctx.capital} ${ctx.name} positions to sustain active-week streaks; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
      `Keep a weekly ${ctx.mainChain} cadence on ${ctx.name}: touch two native apps and rebalance your ${ctx.capital} liquidity; cost ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
    ],
    ctx.slug,
    'chn-s4',
  );
  return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
}

function farmPerpDerivatives(ctx: FarmContext): string[] {
  const chainQual = ctx.name.toLowerCase().includes(ctx.mainChain.toLowerCase()) ? '' : ` ${ctx.mainChain}`;
  const s2 = pick(
    [
      `Deposit ${ctx.capital} margin into ${ctx.name} on ${ctx.mainChain} and execute low-leverage (1x-3x) delta-managed perp trades to build volume; ${ctx.feeLabel} ${ctx.gas}, ~20 min.`,
      `Fund your ${ctx.name}${chainQual} margin account with ${ctx.capital} and place maker limit orders on flagship perp markets to accrue trading points; cost ${ctx.gas}, ~20 min.`,
      `Post ${ctx.capital} collateral on ${ctx.name} (${ctx.mainChain}) and open hedged or tight-stop perp trades for consistent taker/maker volume; ${ctx.feeLabel} ${ctx.gas}, ~25 min.`,
      `Transfer ${ctx.capital} into ${ctx.name}'s${chainQual} trading engine and run conservative 2x perp positions across major markets; est. ${ctx.feeLabel} ${ctx.gas}, ~20 min.`,
    ],
    ctx.slug,
    'perp-s2',
  );
  const s3 = pick(
    [
      `Allocate ${ctx.halfCapital} of your ${ctx.capital} capital into ${ctx.name}'s LP/HLP liquidity vault on ${ctx.mainChain} to pair passive LP with trading volume; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
      `Stake ${ctx.quarterCapital} from your ${ctx.capital} margin into ${ctx.name}'s insurance or market-making vault on ${ctx.mainChain} for a second footprint; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
      `Trade an altcoin or options/funding market on ${ctx.name} (${ctx.mainChain}) with ${ctx.quarterCapital} of your ${ctx.capital} margin to widen product usage; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
      `Combine your ${ctx.capital} ${ctx.name} perp trading on ${ctx.mainChain} with a ${ctx.halfCapital} liquidity vault deposit so both maker and LP tiers score; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
    ],
    ctx.slug,
    'perp-s3',
  );
  const s4 = pick(
    [
      `Weekly on ${ctx.mainChain}: generate fresh maker/taker volume with your ${ctx.capital} ${ctx.name} margin, review funding rates, and settle PnL; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
      `Each week on ${ctx.mainChain}, run 2-3 disciplined perp cycles on ${ctx.name} using your ${ctx.capital} account and harvest vault yields; cost ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
      `Maintain weekly ${ctx.mainChain} cadence on ${ctx.name}: rotate ${ctx.halfCapital} in limit-order volume from your ${ctx.capital} margin and check fee rebates; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
    ],
    ctx.slug,
    'perp-s4',
  );
  return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
}

function farmPayments(ctx: FarmContext): string[] {
  if (ctx.chainKind === 'bitcoin') {
    const s2 = `Open a funded ${ctx.name} channel on Bitcoin with ${ctx.capital} in BTC (via Phoenix/Zeus or self-hosted node) and settle your first BOLT11 invoice; ${ctx.feeLabel} ${ctx.gas}, ~20 min.`;
    const s3 = `Establish inbound liquidity and route ${ctx.quarterCapital} of your ${ctx.capital} BTC across 2-3 ${ctx.name} channels or submarine swaps; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`;
    const s4 = `Weekly on Bitcoin: rebalance ${ctx.name} channel capacity on your ${ctx.capital} BTC liquidity, settle routine invoices, and log routing fees; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`;
    return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
  }
  const s2 = pick(
    [
      `Load ${ctx.capital} in ${ctx.coreAsset} into ${ctx.name}'s payment or card account on ${ctx.mainChain} and complete your first settlement or spend transaction; ${ctx.feeLabel} ${ctx.gas}, ~20 min.`,
      `Deposit ${ctx.capital} onto ${ctx.name} (${ctx.mainChain}) to activate merchant payments, card spending, or yield-bearing spend balances; est. ${ctx.feeLabel} ${ctx.gas}, ~20 min.`,
      `Fund ${ctx.name} on ${ctx.mainChain} with ${ctx.capital} and route an initial payment transfer or invoice settlement to record real usage; cost ${ctx.gas}, ~15 min.`,
      `Initialize a ${ctx.capital} balance in ${ctx.name} on ${ctx.mainChain} and execute an on-chain checkout or peer transfer to start activity tracking; ${ctx.feeLabel} ${ctx.gas}, ~20 min.`,
    ],
    ctx.slug,
    'pay-s2',
  );
  const s3 = pick(
    [
      `Enable ${ctx.name}'s secondary rail on ${ctx.mainChain}—auto-yield savings, recurring payroll, or cross-asset convert—with ${ctx.quarterCapital} of your ${ctx.capital}; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
      `Create a second ${ctx.name} footprint on ${ctx.mainChain} by sending ${ctx.quarterCapital} of your ${ctx.capital} via a payment link or merchant QR flow; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
      `Stake or park ${ctx.halfCapital} of your ${ctx.capital} ${ctx.name} funds on ${ctx.mainChain} in its settlement liquidity or cashback tier; est. ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
      `Test ${ctx.name}'s off-ramp or stablecoin conversion feature on ${ctx.mainChain} with ${ctx.quarterCapital} from your ${ctx.capital} balance; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
    ],
    ctx.slug,
    'pay-s3',
  );
  const s4 = pick(
    [
      `Weekly on ${ctx.mainChain}: route regular spending or transfers through your ${ctx.capital} ${ctx.name} account and top up settled balances; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
      `Each week on ${ctx.mainChain}, settle 2-3 routine transfers on ${ctx.name} from your ${ctx.capital} balance and redeem cashback points; cost ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
      `Keep weekly ${ctx.mainChain} payment velocity on ${ctx.name}: cycle ${ctx.quarterCapital} from your ${ctx.capital} account and reconcile receipts; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
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
      `Deposit ${ctx.capital} in USDC into ${ctx.name} on ${ctx.mainChain} and trade YES/NO outcome shares across 3-5 high-liquidity markets; ${ctx.feeLabel} ${ctx.gas}, ~20 min.`,
      `Fund your ${ctx.name} ${ctx.mainChain} account with ${ctx.capital} and place limit bids/asks on major event markets to build maker volume; cost ${ctx.gas}, ~20 min.`,
      `Allocate ${ctx.capital} across liquid ${ctx.name} prediction markets on ${ctx.mainChain}, pairing near-term and longer-dated event contracts; est. ${ctx.feeLabel} ${ctx.gas}, ~20 min.`,
    ],
    ctx.slug,
    'pm-s2',
  );
  const s3 = pick(
    [
      `Provide two-sided limit-order liquidity with ${ctx.quarterCapital} of your ${ctx.capital} ${ctx.name} balance on ${ctx.mainChain} to capture liquidity-reward weight; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
      `Spread ${ctx.quarterCapital} from your ${ctx.capital} ${ctx.name} stake across a second category (macro, crypto, or sports) on ${ctx.mainChain} for breadth; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
      `Split or merge ${ctx.quarterCapital} of outcome shares on ${ctx.name} (${ctx.mainChain}) alongside your ${ctx.capital} trades to record contract diversity; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
    ],
    ctx.slug,
    'pm-s3',
  );
  const s4 = pick(
    [
      `Weekly on ${ctx.mainChain}: redeem resolved ${ctx.name} positions, rotate ${ctx.quarterCapital} from your ${ctx.capital} bankroll into fresh markets, and log PnL; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
      `Each week on ${ctx.mainChain}, claim settled ${ctx.name} markets and place 3-4 disciplined limit orders using your ${ctx.capital} account; cost ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
      `Keep a weekly ${ctx.mainChain} cadence on ${ctx.name}: refresh resting limit orders on your ${ctx.capital} balance and claim liquidity rebates; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
    ],
    ctx.slug,
    'pm-s4',
  );
  return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
}

function farmStakingRestaking(ctx: FarmContext): string[] {
  const isRestake = ctx.category === 'Restaking';
  const s2 = isRestake
    ? `Delegate or restake ${ctx.capital} of ${ctx.coreAsset} through ${ctx.name} on ${ctx.mainChain} to an active operator/AVS to start epoch points; ${ctx.feeLabel} ${ctx.gas}, ~20 min.`
    : `Stake ${ctx.capital} of ${ctx.coreAsset} into ${ctx.name}'s validator or staking pool on ${ctx.mainChain} to earn continuous staking duration; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`;
  const s3 = isRestake
    ? `Split ${ctx.quarterCapital} of your ${ctx.capital} ${ctx.name} stake across a second validator or security tier on ${ctx.mainChain} to diversify slashing risk; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`
    : `Delegate ${ctx.quarterCapital} of your ${ctx.capital} ${ctx.name} stake into a second validator pool or liquid-receipt integration on ${ctx.mainChain}; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`;
  const s4 = `Weekly on ${ctx.mainChain}: verify validator uptime and commission on your ${ctx.capital} ${ctx.name} stake, claim accrued rewards, and restake epoch payouts; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`;
  return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
}

function farmBtcYield(ctx: FarmContext): string[] {
  const s2 = `Lock ${ctx.capital} in BTC through ${ctx.name}'s native minting/peg vault on ${ctx.mainChain} to issue its BTC-backed receipt token with verified UTXO proof; ${ctx.feeLabel} ${ctx.gas}, ~20 min.`;
  const s3 = `Deploy ${ctx.halfCapital} of your ${ctx.capital} ${ctx.name} BTC receipt into a partnered liquidity pool or yield tranche while keeping unbonding terms documented; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`;
  const s4 = `Weekly on ${ctx.mainChain}: verify ${ctx.name} proof-of-reserves and BTC peg ratio on your ${ctx.capital} deposit, then harvest or compound accrued BTC yield; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`;
  return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
}

function farmStablecoin(ctx: FarmContext): string[] {
  const s2 = `Mint or wrap ${ctx.capital} of ${ctx.coreAsset} into ${ctx.name}'s flagship stablecoin or yield-bearing wrapper on ${ctx.mainChain} to establish holder duration; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`;
  const s3 = `Stake ${ctx.halfCapital} of your ${ctx.capital} ${ctx.name} balance in its savings vault or stable-pair DEX pool on ${ctx.mainChain} for dual utility weight; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`;
  const s4 = `Weekly on ${ctx.mainChain}: check ${ctx.name} peg deviation and reserve backing on your ${ctx.capital} position, then claim or compound yield distributions; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`;
  return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
}

function farmCeDeFi(ctx: FarmContext): string[] {
  const s2 = `Complete ${ctx.name} account verification and subscribe ${ctx.capital} in ${ctx.coreAsset} into its flagship ${ctx.mainChain} CeDeFi yield vault; ${ctx.feeLabel} ${ctx.gas}, ~20 min.`;
  const s3 = `Allocate ${ctx.quarterCapital} of your ${ctx.capital} ${ctx.name} balance into a secondary fixed-term tranche or on-chain receipt LP on ${ctx.mainChain}; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`;
  const s4 = `Weekly on ${ctx.mainChain}: review ${ctx.name} custody attestations and yield settlements on your ${ctx.capital} position, and roll maturing terms; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`;
  return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
}

function farmInsurance(ctx: FarmContext): string[] {
  const s2 = `Underwrite ${ctx.capital} in ${ctx.coreAsset} into ${ctx.name}'s primary ${ctx.mainChain} cover pool to earn underwriting premiums and risk-capacity duration; ${ctx.feeLabel} ${ctx.gas}, ~20 min.`;
  const s3 = `Purchase or allocate ${ctx.quarterCapital} from your ${ctx.capital} budget into a second ${ctx.name} protocol-cover tranche on ${ctx.mainChain} for buyer-side history; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`;
  const s4 = `Weekly on ${ctx.mainChain}: inspect active cover utilization and pending claim votes on your ${ctx.capital} ${ctx.name} pool, then harvest earned premiums; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`;
  return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
}

function farmGovernance(ctx: FarmContext): string[] {
  const s2 = `Lock or stake ${ctx.capital} in ${ctx.coreAsset} into ${ctx.name} on ${ctx.mainChain} to activate ve-voting weight and incentive gauge eligibility; ${ctx.feeLabel} ${ctx.gas}, ~20 min.`;
  const s3 = `Allocate gauge votes across 2-3 whitelisted pools and pair ${ctx.quarterCapital} of your ${ctx.capital} ${ctx.name} stake in a boosted LP on ${ctx.mainChain}; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`;
  const s4 = `Weekly on ${ctx.mainChain}: cast epoch gauge votes on ${ctx.name}, claim voter bribes and rebases on your ${ctx.capital} lock, and compound rewards; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`;
  return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
}

function farmIndexes(ctx: FarmContext): string[] {
  const s2 = `Issue or mint ${ctx.capital} of ${ctx.name}'s flagship on-chain index basket on ${ctx.mainChain} using ${ctx.coreAsset} to establish index holder duration; ${ctx.feeLabel} ${ctx.gas}, ~20 min.`;
  const s3 = `Deploy ${ctx.quarterCapital} of your ${ctx.capital} ${ctx.name} index tokens into a secondary index basket or DEX liquidity pool on ${ctx.mainChain}; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`;
  const s4 = `Weekly on ${ctx.mainChain}: verify constituent rebalance weights and NAV tracking on your ${ctx.capital} ${ctx.name} index holding and claim fee rebates; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`;
  return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
}

function farmBridge(ctx: FarmContext): string[] {
  const s2 = `Execute an initial ${ctx.capital} cross-chain ${ctx.coreAsset} transfer via ${ctx.name} starting from ${ctx.mainChain} to a supported destination network; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`;
  const s3 = `Route ${ctx.halfCapital} of your ${ctx.capital} funds across a second ${ctx.name} corridor (or supply bridge pool liquidity) to record multi-route volume; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`;
  const s4 = `Weekly on ${ctx.mainChain}: send one organic ${ctx.quarterCapital} cross-chain transfer via ${ctx.name} and reconcile relayer fees on your ${ctx.capital} balance; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`;
  return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
}

function farmDefault(ctx: FarmContext): string[] {
  const catLabel = formatCategoryLabel(ctx.category);
  const s2 = pick(
    [
      `Commit ${ctx.capital} in ${ctx.coreAsset} to ${ctx.name}'s flagship ${catLabel} market on ${ctx.mainChain} to establish sustained TVL-weighted history; ${ctx.feeLabel} ${ctx.gas}, ~20 min.`,
      `Deposit ${ctx.capital} into ${ctx.name}'s primary ${ctx.mainChain} ${catLabel} contract and verify receipt balances on-chain; cost ${ctx.gas}, ~15 min.`,
    ],
    ctx.slug,
    'def-s2',
  );
  const s3 = pick(
    [
      `Create a second footprint on ${ctx.name} (${ctx.mainChain}) by deploying ${ctx.quarterCapital} of your ${ctx.capital} into a secondary pool or LP pair; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
      `Pair your core ${ctx.capital} ${ctx.name} position on ${ctx.mainChain} with a ${ctx.quarterCapital} secondary transfer, swap, or staking tier; ${ctx.feeLabel} ${ctx.gas}, ~15 min.`,
    ],
    ctx.slug,
    'def-s3',
  );
  const s4 = pick(
    [
      `Weekly on ${ctx.mainChain}: check ${ctx.name} position health on your ${ctx.capital} allocation, claim accrued rewards, and log one fresh interaction; ${ctx.feeLabel} ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
      `Each week on ${ctx.mainChain}, review ${ctx.name} metrics for your ${ctx.capital} stake and compound or rebalance incentives; cost ${ctx.gas}, ~${ctx.weeklyMinutes} min weekly.`,
    ],
    ctx.slug,
    'def-s4',
  );
  return [step1WalletAndBridge(ctx), s2, s3, s4, step5TrackLaunch(ctx)];
}

export type CategoryGroup =
  | 'Lending'
  | 'CDP'
  | 'Dexs'
  | 'Yield'
  | 'RWA'
  | 'Chain'
  | 'PerpDerivatives'
  | 'Payments'
  | 'PredictionMarket'
  | 'StakingRestaking'
  | 'BtcYield'
  | 'Stablecoin'
  | 'CeDeFi'
  | 'Insurance'
  | 'Governance'
  | 'Indexes'
  | 'Bridge'
  | 'Default';

export function resolveCategoryGroup(category: string | null): CategoryGroup {
  switch (category) {
    case 'Lending':
    case 'Uncollateralized Lending':
    case 'Collateral Markets':
      return 'Lending';
    case 'CDP':
    case 'CDP Manager':
      return 'CDP';
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
    case 'Prediction Market':
      return 'PredictionMarket';
    case 'Staking Pool':
    case 'Restaking':
      return 'StakingRestaking';
    case 'Anchor BTC':
    case 'Decentralized BTC':
      return 'BtcYield';
    case 'Dual-Token Stablecoin':
    case 'Stablecoin Wrapper':
      return 'Stablecoin';
    case 'CeDeFi':
      return 'CeDeFi';
    case 'Insurance':
      return 'Insurance';
    case 'Governance Incentives':
      return 'Governance';
    case 'Indexes':
      return 'Indexes';
    case 'Cross Chain Bridge':
      return 'Bridge';
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
    case 'CDP':
      return farmCdp(ctx);
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
    case 'PredictionMarket':
      return farmPredictionMarket(ctx);
    case 'StakingRestaking':
      return farmStakingRestaking(ctx);
    case 'BtcYield':
      return farmBtcYield(ctx);
    case 'Stablecoin':
      return farmStablecoin(ctx);
    case 'CeDeFi':
      return farmCeDeFi(ctx);
    case 'Insurance':
      return farmInsurance(ctx);
    case 'Governance':
      return farmGovernance(ctx);
    case 'Indexes':
      return farmIndexes(ctx);
    case 'Bridge':
      return farmBridge(ctx);
    default:
      return farmDefault(ctx);
  }
}

/** Smooth capital curve matching the tier schedule ($250 at $5M -> ~$2,000 at $500M) without step cliffs. */
export function smoothFarmCapitalUsd(tvlUsd: number): number {
  const scaled = Math.max(tvlUsd, FARM_CAPITAL_REF_TVL_USD) / FARM_CAPITAL_REF_TVL_USD;
  return FARM_CAPITAL_BASE_USD * Math.pow(scaled, FARM_CAPITAL_EXPONENT);
}

/** Build the full ranked token-launch radar board from a sealed snapshot. */
export function buildBoard(snapshot: Snapshot): BoardResult {
  const aggTvlMap = buildAggregatedTvlMap(snapshot.protocols);
  const multiples = computeCategoryMultiples(snapshot.protocols);
  const priorInfo = computeCategoryLaunchPriorsDetailed(snapshot.protocols);
  const launchPriors = priorInfo.priors;
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
    const tEff = effectiveTvl(p.tvl_usd, multiples.tvl_pivot_usd, multiples.tvl_elasticity_beta);

    const implied = Math.max(1, Math.round(tEff * mult * factors));
    const impliedLow = Math.max(
      1,
      Math.min(Math.floor(implied * 0.99), Math.round(tEff * p25Mult * factors)),
    );
    const impliedHigh = Math.max(
      Math.ceil(implied * 1.01),
      Math.round(tEff * p75Mult * factors),
    );
    const launchPrior = launchPriors[category] ?? priorInfo.globalRatePct;

    return {
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: implied,
      implied_low_usd: impliedLow,
      implied_high_usd: impliedHigh,
      tvl_usd: p.tvl_usd,
      effective_tvl_usd: Math.max(1, Math.round(tEff)),
      category,
      chains: orderChainsWithPrimary(p.chains),
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

    const smoothCap = smoothFarmCapitalUsd(row.tvl_usd);
    rawFarmScores.push((row.implied_value_usd * row.launch_prior) / 100 / smoothCap);
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
    const loLog = percentile(positiveLogs, 0.01);
    const hiLog = percentile(positiveLogs, 0.99);
    const span = hiLog - loLog;
    for (let i = 0; i < draftRows.length; i++) {
      const row = draftRows[i]!;
      const raw = rawFarmScores[i]!;
      if (raw <= 0) {
        row.farm_score = FARM_SCORE_MIN;
      } else if (span <= 0) {
        row.farm_score = 50;
      } else {
        const clampedLog = clamp(Math.log10(raw), loLog, hiLog);
        const scaled =
          FARM_SCORE_MIN + ((FARM_SCORE_MAX - FARM_SCORE_MIN) * (clampedLog - loLog)) / span;
        row.farm_score = clamp(Math.round(scaled), FARM_SCORE_MIN, FARM_SCORE_MAX);
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
      launch_prior: launchPriors[cat] ?? priorInfo.globalRatePct,
    };
  }

  const livePeers: LivePeer[] = snapshot.protocols
    .filter(hasValidPeerMultiple)
    .map((p) => {
      const { tvl_usd, tvl_sources } = resolvePeerTvl(p, aggTvlMap);
      const tEff = effectiveTvl(tvl_usd, multiples.tvl_pivot_usd, multiples.tvl_elasticity_beta);
      return {
        slug: p.slug,
        name: p.name,
        symbol: p.symbol ?? p.gecko_id ?? '—',
        category: p.category ?? 'Uncategorized',
        chains: [...p.chains],
        tvl_usd,
        tvl_sources,
        mcap_usd: p.mcap_usd!,
        raw_multiple: round4(p.mcap_usd! / tvl_usd),
        norm_multiple: round4(p.mcap_usd! / tEff),
        change_7d: p.change_7d,
      };
    })
    .sort((a, b) => {
      if (b.mcap_usd !== a.mcap_usd) return b.mcap_usd - a.mcap_usd;
      if (b.tvl_usd !== a.tvl_usd) return b.tvl_usd - a.tvl_usd;
      return byCodeUnit(a.slug, b.slug);
    });

  const modelStats: ModelStats = {
    global_median_multiple: round4(multiples.global_median),
    global_p25_multiple: round4(multiples.global_p25),
    global_p75_multiple: round4(multiples.global_p75),
    multiple_cap_p90: round4(multiples.multiple_cap),
    global_peer_count: multiples.global_peer_count,
    shrinkage_weight: SHRINKAGE_WEIGHT,
    launch_prior_weight: LAUNCH_PRIOR_WEIGHT,
    global_launch_rate_pct: priorInfo.globalRatePct,
    tvl_elasticity_beta: round4(multiples.tvl_elasticity_beta),
    tvl_pivot_usd: Math.round(multiples.tvl_pivot_usd),
    validation,
    categories: categoryStats,
  };

  return {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    rows: draftRows,
    live_peers: livePeers,
    multiples,
    model_stats: modelStats,
  };
}
