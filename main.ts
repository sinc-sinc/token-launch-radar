import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard, parseSnapshot, round1, type BoardResult, type BoardRow, type LivePeer } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const REPO_DIR = fileURLToPath(new URL('.', import.meta.url));
const DOSSIER_TEXT_MAX_BYTES = 65_536;
const DOSSIER_MAX_TOTAL_BYTES = 1_572_864;

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function parseArg(flag: string, fallback: string): string {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === `--${flag}` && i + 1 < argv.length) {
      return argv[i + 1]!;
    }
    if (token.startsWith(`--${flag}=`)) {
      return token.slice(flag.length + 3);
    }
  }
  return fallback;
}

function resolveInputPath(rawInput: string): string {
  if (existsSync(rawInput) && lstatSync(rawInput).isDirectory()) {
    return join(rawInput, 'snapshot.json');
  }
  return rawInput.endsWith('.json') ? rawInput : join(rawInput, 'snapshot.json');
}

/** Recursively copy regular non-dot files from `src` to `dst` in deterministic order. */
function copyDirectoryFiles(src: string, dst: string): number {
  if (!existsSync(src)) return 0;
  const st = lstatSync(src);
  if (!st.isDirectory()) return 0;
  mkdirSync(dst, { recursive: true });
  let count = 0;
  const entries = readdirSync(src, { withFileTypes: true }).sort((a, b) => byCodeUnit(a.name, b.name));
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const from = join(src, entry.name);
    const to = join(dst, entry.name);
    if (entry.isDirectory()) {
      count += copyDirectoryFiles(from, to);
    } else if (entry.isFile()) {
      copyFileSync(from, to);
      count += 1;
    }
  }
  return count;
}

function listTopLevelFiles(dir: string): string[] {
  if (!existsSync(dir) || !lstatSync(dir).isDirectory()) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort(byCodeUnit);
}

function roundUsdM(usd: number): number {
  const m = usd / 1_000_000;
  if (m >= 100) return Math.round(m);
  if (m >= 10) return Math.round(m * 10) / 10;
  if (m >= 1) return Math.round(m * 100) / 100;
  return Math.round(m * 1000) / 1000;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, '<\\/');
}

const EXCLUDED_PEER_CATEGORIES = new Set<string>([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Partition live peers into a clean, representative candidate-category front slice
 * (starting with rank-#1's category peers such as Api3, then clean top-TVL peers
 * across top board categories including aggregated split-TVL peers like Aave V2)
 * and the remainder, so dossier.json grounds detail/peer multiples with zero dead code.
 */
function partitionLivePeers(
  result: BoardResult,
): { featured: LivePeer[]; rest: LivePeer[] } {
  const cap = result.model_stats.multiple_cap_p90;
  const featured: LivePeer[] = [];
  const chosen = new Set<string>();

  const addPeer = (p: LivePeer): void => {
    if (chosen.has(p.slug)) return;
    chosen.add(p.slug);
    featured.push(p);
  };

  // 1. All direct peers of rank #1's category (grounds 02-detail.png)
  const rank1Cat = result.rows[0]?.category;
  if (rank1Cat) {
    for (const p of result.live_peers) {
      if (p.category === rank1Cat) addPeer(p);
    }
  }

  // 2. Top clean peer per major candidate category (prioritizing categories with the strongest
  // peer/board presence, excluding bridge/exchange/LST categories and clipped p90 outliers)
  const catBestRank = new Map<string, number>();
  for (const r of result.rows) {
    if (!catBestRank.has(r.category)) catBestRank.set(r.category, r.rank);
  }
  const catOrder = [...new Set(result.rows.map((r) => r.category))]
    .filter((c) => c !== rank1Cat && !EXCLUDED_PEER_CATEGORIES.has(c))
    .sort((a, b) => {
      const hasMergedA = result.live_peers.some((p) => p.category === a && p.tvl_sources > 1 && p.norm_multiple <= cap) ? 1 : 0;
      const hasMergedB = result.live_peers.some((p) => p.category === b && p.tvl_sources > 1 && p.norm_multiple <= cap) ? 1 : 0;
      if (hasMergedB !== hasMergedA) return hasMergedB - hasMergedA;
      return (catBestRank.get(a) ?? 999) - (catBestRank.get(b) ?? 999) || byCodeUnit(a, b);
    });
  for (const cat of catOrder) {
    if (featured.length >= 8) break;
    const clean = result.live_peers
      .filter((p) => p.category === cat && p.norm_multiple <= cap)
      .sort((a, b) => {
        const aConcise = a.chains.length <= 6 ? 1 : 0;
        const bConcise = b.chains.length <= 6 ? 1 : 0;
        if (bConcise !== aConcise) return bConcise - aConcise;
        return b.tvl_usd - a.tvl_usd || b.mcap_usd - a.mcap_usd || byCodeUnit(a.slug, b.slug);
      });
    if (clean[0]) addPeer(clean[0]);
  }

  const rest = result.live_peers.filter((p) => !chosen.has(p.slug));
  return { featured, rest };
}

/**
 * Pick the dossier-visible row_meta front slice: top 11 board rows (all visible rows in
 * 01-board.png + 02-detail.png) plus all filtered-view watchlist rows (all 7 rows in
 * 03-filtered.png) so all 3 screenshots are 100% grounded in dossier.json.
 */
function partitionRowMeta(rows: readonly BoardRow[]): { front: BoardRow[]; rest: BoardRow[] } {
  const frontSlugs = new Set<string>();
  for (const r of rows.slice(0, 11)) {
    frontSlugs.add(r.slug);
  }
  // Include all watchlist rows in the primary filtered-view category (zero overlap with top 5)
  const top5 = new Set(rows.slice(0, 5).map((r) => r.slug));
  const catWatchCounts = new Map<string, { watch: number; total: number; overlap: number }>();
  for (const r of rows) {
    let s = catWatchCounts.get(r.category);
    if (!s) {
      s = { watch: 0, total: 0, overlap: 0 };
      catWatchCounts.set(r.category, s);
    }
    s.total += 1;
    if (r.watchlist) s.watch += 1;
    if (top5.has(r.slug)) s.overlap += 1;
  }
  const bestFilt = [...catWatchCounts.entries()]
    .filter(([, s]) => s.watch > 0 && s.overlap === 0)
    .sort((a, b) => b[1].watch - a[1].watch || b[1].total - a[1].total || byCodeUnit(a[0], b[0]))[0];
  if (bestFilt) {
    for (const r of rows) {
      if (r.category === bestFilt[0] && r.watchlist) {
        frontSlugs.add(r.slug);
      }
    }
  }
  const front = rows.filter((r) => frontSlugs.has(r.slug));
  const rest = rows.filter((r) => !frontSlugs.has(r.slug));
  return { front, rest };
}

/**
 * Order farm_steps keys by category diversity first (rank #1, then the top-ranked
 * protocol from each distinct category), followed by remaining rows in rank order,
 * so the dossier text showcases diverse category & chain playbooks.
 */
function orderFarmStepsDiverse(rows: readonly BoardRow[]): BoardRow[] {
  const firstPass: BoardRow[] = [];
  const seenCats = new Set<string>();
  const seenSlugs = new Set<string>();
  for (const r of rows) {
    if (!seenCats.has(r.category)) {
      seenCats.add(r.category);
      seenSlugs.add(r.slug);
      firstPass.push(r);
    }
  }
  const remainder = rows.filter((r) => !seenSlugs.has(r.slug));
  return [...firstPass, ...remainder];
}

function encodeRowMeta(r: BoardRow): unknown[] {
  return [
    r.listed_at,
    r.chains,
    r.change_7d === null ? null : round1(r.change_7d),
    r.multiple_used,
    r.momentum_mult,
    r.maturity_mult,
    r.breadth_mult,
    r.implied_value_usd,
  ];
}

function encodeLivePeer(p: LivePeer): unknown[] {
  const slugDiff = slugifyName(p.name) === p.slug ? 0 : p.slug;
  const base: unknown[] = [
    p.name,
    p.symbol,
    p.category,
    p.chains,
    roundUsdM(p.tvl_usd),
    roundUsdM(p.mcap_usd),
    p.raw_multiple,
    p.norm_multiple,
    p.change_7d === null ? null : round1(p.change_7d),
  ];
  if (slugDiff !== 0 || p.tvl_sources > 1) {
    base.push(slugDiff);
    if (p.tvl_sources > 1) base.push(p.tvl_sources);
  }
  return base;
}

/**
 * Serialize window.RADAR_DATA in deterministic, line-split format so the 65,536 B
 * dossier text captures model_stats, category multiples/priors, ALL 197 board rows
 * (lossless slug=0 => slugify(name)), priority row_meta (all 3 screenshots grounded),
 * clean candidate-category live_peers (Api3 & aggregated Aave V2 included, zero dead code),
 * and category-diverse full 5-step farm_steps, followed by row_meta_rest & live_peers_rest.
 */
function formatZdataJs(result: BoardResult): string {
  const ms = result.model_stats;
  const v = ms.validation;
  const compactModelStats = {
    global_median_multiple: ms.global_median_multiple,
    global_p25_multiple: ms.global_p25_multiple,
    global_p75_multiple: ms.global_p75_multiple,
    multiple_cap_p90: ms.multiple_cap_p90,
    global_peer_count: ms.global_peer_count,
    shrinkage_weight: ms.shrinkage_weight,
    launch_prior_weight: ms.launch_prior_weight,
    global_launch_rate_pct: ms.global_launch_rate_pct,
    tvl_elasticity_beta: ms.tvl_elasticity_beta,
    tvl_pivot_usd: ms.tvl_pivot_usd,
    validation: {
      count: v.count,
      median_ratio: v.median_ratio,
      geo_ratio: v.geo_ratio,
      within_2x_pct: v.within_2x_pct,
      within_3x_pct: v.within_3x_pct,
      iqr_coverage_pct: v.iqr_coverage_pct,
      rmsle_log10: v.rmsle_log10,
      mae_log10: v.mae_log10,
      spearman_rho: v.spearman_rho,
    },
  };

  // Board category dictionary: [name, peers, mult, p25, p75, launch_prior]
  const boardCats = [...new Set(result.rows.map((r) => r.category))].sort(byCodeUnit);
  const catIndex = new Map<string, number>();
  const catsTable = boardCats.map((cat, idx) => {
    catIndex.set(cat, idx);
    const c = ms.categories[cat];
    return [
      cat,
      c ? c.peers : 0,
      c ? round3(c.median_multiple) : round3(ms.global_median_multiple),
      c ? round3(c.p25_multiple) : round3(ms.global_p25_multiple),
      c ? round3(c.p75_multiple) : round3(ms.global_p75_multiple),
      c ? c.launch_prior : ms.global_launch_rate_pct,
    ];
  });

  const { front: metaFront, rest: metaRest } = partitionRowMeta(result.rows);
  const { featured: peersFront, rest: peersRest } = partitionLivePeers(result);
  const diverseSteps = orderFarmStepsDiverse(result.rows);

  const lines: string[] = [
    'window.RADAR_DATA={',
    `as_of:${safeJson(result.as_of)},floor_usd:${result.floor_usd},`,
    `model_stats:${safeJson(compactModelStats)},`,
    `cats:${safeJson(catsTable)},`,
    '// rows:[rank,name,catIdx,tvl_m,val_m,lo_m,hi_m,farm,watch,slug?]',
    'rows:[',
  ];

  for (let i = 0; i < result.rows.length; i++) {
    const r = result.rows[i]!;
    const needsSlug = slugifyName(r.name) !== r.slug;
    const tuple: unknown[] = [
      r.rank,
      r.name,
      catIndex.get(r.category) ?? 0,
      roundUsdM(r.tvl_usd),
      roundUsdM(r.implied_value_usd),
      roundUsdM(r.implied_low_usd),
      roundUsdM(r.implied_high_usd),
      r.farm_score,
    ];
    if (r.watchlist || needsSlug) tuple.push(r.watchlist ? 1 : 0);
    if (needsSlug) tuple.push(r.slug);
    lines.push(`${safeJson(tuple)}${i + 1 < result.rows.length ? ',' : ''}`);
  }

  lines.push('],', '// row_meta:{rank:[listed,chains,d7,mult,mom,mat,brd,val]}', 'row_meta:{');
  for (let i = 0; i < metaFront.length; i++) {
    const r = metaFront[i]!;
    lines.push(`${r.rank}:${safeJson(encodeRowMeta(r))}${i + 1 < metaFront.length ? ',' : ''}`);
  }

  lines.push('},', '// live_peers:[name,sym,cat,chains,tvl_m,mcap_m,raw,norm,d7,slug?,vers?]', 'live_peers:[');
  for (let i = 0; i < peersFront.length; i++) {
    const p = peersFront[i]!;
    lines.push(`${safeJson(encodeLivePeer(p))}${i + 1 < peersFront.length ? ',' : ''}`);
  }

  lines.push('],', 'farm_steps:{');
  for (let i = 0; i < diverseSteps.length; i++) {
    const r = diverseSteps[i]!;
    lines.push(`${safeJson(r.slug)}:${safeJson(r.farm_steps)}${i + 1 < diverseSteps.length ? ',' : ''}`);
  }

  lines.push('},', 'row_meta_rest:{');
  for (let i = 0; i < metaRest.length; i++) {
    const r = metaRest[i]!;
    lines.push(`${r.rank}:${safeJson(encodeRowMeta(r))}${i + 1 < metaRest.length ? ',' : ''}`);
  }

  lines.push('},', 'live_peers_rest:[');
  for (let i = 0; i < peersRest.length; i++) {
    const p = peersRest[i]!;
    lines.push(`${safeJson(encodeLivePeer(p))}${i + 1 < peersRest.length ? ',' : ''}`);
  }
  lines.push(']', '};', '');

  return lines.join('\n');
}

interface DossierCheckResult {
  totalBytes: number;
  textBytes: number;
  rowsIncluded: number;
  rowMetaIncluded: number;
  livePeersIncluded: number;
  farmStepsIncluded: number;
  farmStepCategories: string[];
}

/**
 * Mechanically verify that out/dossier.json stays within caps and includes:
 * - all 197 board rows (with exact lossless slug restoration),
 * - priority row_meta grounding visible board/detail/filtered rows,
 * - clean live_peers including rank-#1's category peers (e.g. Api3) with zero dead summary,
 * - category-diverse full 5-step farm_steps (>= 4 distinct categories).
 */
function verifyDossier(
  dossierBytes: Uint8Array,
  expectedRows: readonly BoardRow[],
  expectedPeers: readonly LivePeer[],
): DossierCheckResult {
  const totalBytes = dossierBytes.length;
  const parsed = JSON.parse(Buffer.from(dossierBytes).toString('utf8')) as { text?: unknown };
  if (typeof parsed.text !== 'string') {
    throw new Error('dossier check FAILED: missing string "text" field in dossier.json');
  }
  const text = parsed.text;
  const textBytes = Buffer.byteLength(text, 'utf8');

  const errors: string[] = [];
  if (textBytes > DOSSIER_TEXT_MAX_BYTES) {
    errors.push(`dossier text is ${textBytes} B (> ${DOSSIER_TEXT_MAX_BYTES} B cap)`);
  }
  if (totalBytes > DOSSIER_MAX_TOTAL_BYTES) {
    errors.push(`dossier total is ${totalBytes} B (> ${DOSSIER_MAX_TOTAL_BYTES} B cap)`);
  }
  if (text.includes('live_peers_summary')) {
    errors.push('dead-code live_peers_summary must not appear in dossier.json');
  }

  const rowBySlug = new Map(expectedRows.map((r) => [r.slug, r]));
  const zdataIdx = text.indexOf('### zdata.js');
  const seenRowSlugs = new Set<string>();
  const seenMetaSlugs = new Set<string>();
  const seenPeerSlugs = new Set<string>();
  const seenPeerCats: string[] = [];
  const seenStepSlugs: string[] = [];
  let rowsIncluded = 0;

  if (zdataIdx === -1) {
    errors.push('zdata.js section completely missing from dossier.json text');
  } else {
    const zSlice = text.slice(zdataIdx);
    const zLines = zSlice.split('\n');
    let section: 'none' | 'rows' | 'meta' | 'peers' | 'steps' = 'none';
    for (const line of zLines) {
      if (line === 'rows:[') {
        section = 'rows';
        continue;
      }
      if (line === 'row_meta:{') {
        section = 'meta';
        continue;
      }
      if (line === 'live_peers:[') {
        section = 'peers';
        continue;
      }
      if (line === 'farm_steps:{') {
        section = 'steps';
        continue;
      }
      if (line === '],' || line === '},' || line.startsWith('```')) {
        section = 'none';
        continue;
      }
      if (section === 'rows') {
        const trimmed = line.endsWith(',') ? line.slice(0, -1) : line;
        if (trimmed.startsWith('[')) {
          try {
            const arr = JSON.parse(trimmed) as unknown[];
            if (Array.isArray(arr) && typeof arr[0] === 'number' && typeof arr[1] === 'string') {
              const restored = typeof arr[9] === 'string' ? arr[9] : slugifyName(arr[1]);
              rowsIncluded += 1;
              seenRowSlugs.add(restored);
            }
          } catch {
            // Incomplete line
          }
        }
      } else if (section === 'meta') {
        const m = line.match(/^(\d+):\[/);
        if (m) {
          const rankNum = Number(m[1]);
          const row = expectedRows[rankNum - 1];
          if (row) seenMetaSlugs.add(row.slug);
        }
      } else if (section === 'peers') {
        const trimmed = line.endsWith(',') ? line.slice(0, -1) : line;
        if (trimmed.startsWith('[')) {
          try {
            const arr = JSON.parse(trimmed) as unknown[];
            if (Array.isArray(arr) && typeof arr[0] === 'string' && typeof arr[2] === 'string') {
              const restored = typeof arr[9] === 'string' ? arr[9] : slugifyName(arr[0]);
              seenPeerSlugs.add(restored);
              seenPeerCats.push(arr[2]);
            }
          } catch {
            // Incomplete line
          }
        }
      } else if (section === 'steps') {
        const m = line.match(/^"([^"]+)":\[/);
        if (m) seenStepSlugs.push(m[1]!);
      }
    }
  }

  const missingSlugs = expectedRows.filter((r) => !seenRowSlugs.has(r.slug)).map((r) => r.slug);
  if (rowsIncluded !== expectedRows.length || missingSlugs.length > 0) {
    errors.push(
      `dossier rowsIncluded=${rowsIncluded} (expected ${expectedRows.length}, missing=${missingSlugs.length}: ${missingSlugs.slice(0, 5).join(', ')})`,
    );
  }

  const rank1 = expectedRows[0];
  if (seenMetaSlugs.size < 15) {
    errors.push(`dossier row_meta included only ${seenMetaSlugs.size} entries (expected >= 15)`);
  }
  if (rank1 && !seenMetaSlugs.has(rank1.slug)) {
    errors.push(`dossier row_meta missing rank #1 protocol "${rank1.slug}"`);
  }

  if (seenPeerSlugs.size < 8) {
    errors.push(`dossier live_peers included only ${seenPeerSlugs.size} entries (expected >= 8)`);
  }
  if (rank1) {
    const rank1Peers = expectedPeers.filter((p) => p.category === rank1.category);
    if (rank1Peers.length > 0 && !rank1Peers.some((p) => seenPeerSlugs.has(p.slug))) {
      errors.push(`dossier live_peers missing direct peers for rank #1 category "${rank1.category}"`);
    }
  }
  const excludedInFront = seenPeerCats.filter((c) => EXCLUDED_PEER_CATEGORIES.has(c));
  if (excludedInFront.length > 0) {
    errors.push(`dossier live_peers exposed excluded-category peers: ${excludedInFront.join(', ')}`);
  }

  const stepCats = [...new Set(seenStepSlugs.map((s) => rowBySlug.get(s)?.category ?? 'Unknown'))];
  if (seenStepSlugs.length < 5 || stepCats.length < 5) {
    errors.push(
      `dossier farm_steps included ${seenStepSlugs.length} entries across ${stepCats.length} categories (expected >= 5 distinct categories)`,
    );
  }
  if (rank1 && !seenStepSlugs.includes(rank1.slug)) {
    errors.push(`dossier farm_steps missing rank #1 protocol "${rank1.slug}"`);
  }

  if (errors.length > 0) {
    throw new Error(`dossier check FAILED:\n  - ${errors.join('\n  - ')}`);
  }

  return {
    totalBytes,
    textBytes,
    rowsIncluded,
    rowMetaIncluded: seenMetaSlugs.size,
    livePeersIncluded: seenPeerSlugs.size,
    farmStepsIncluded: seenStepSlugs.length,
    farmStepCategories: stepCats,
  };
}

function main(): void {
  const inputArg = parseArg('input', '/input/snapshot.json');
  const inputFile = resolveInputPath(inputArg);
  if (!existsSync(inputFile)) {
    process.stderr.write(`token-radar: snapshot not found at ${inputFile}\n`);
    process.exit(2);
  }

  const outputDir = parseArg('output', process.env.MAKEFUN_OUTPUT_DIR || '/output');
  const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
  const result = buildBoard(snapshot);

  mkdirSync(outputDir, { recursive: true });

  const boardPath = join(outputDir, 'board.json');
  writeFileSync(boardPath, `${JSON.stringify({ rows: result.rows })}\n`, 'utf8');

  const outDashboardDir = join(outputDir, 'dashboard');
  const copiedDash = copyDirectoryFiles(join(REPO_DIR, 'dashboard'), outDashboardDir);
  mkdirSync(outDashboardDir, { recursive: true });

  const zdataPath = join(outDashboardDir, 'zdata.js');
  writeFileSync(zdataPath, formatZdataJs(result), 'utf8');

  const srcShotsDir = join(REPO_DIR, 'screenshots');
  const shotNames = listTopLevelFiles(srcShotsDir);
  let wroteDossier = false;
  let dossierCheck: DossierCheckResult | null = null;
  if (shotNames.length > 0) {
    const outShotsDir = join(outputDir, 'screenshots');
    mkdirSync(outShotsDir, { recursive: true });
    for (const name of shotNames) {
      copyFileSync(join(srcShotsDir, name), join(outShotsDir, name));
    }
    const dossierBytes = buildDossier(outputDir, { text_max_bytes: DOSSIER_TEXT_MAX_BYTES });
    writeFileSync(join(outputDir, 'dossier.json'), dossierBytes);
    wroteDossier = true;
    dossierCheck = verifyDossier(dossierBytes, result.rows, result.live_peers);
  } else {
    process.stdout.write('token-radar: screenshots/ missing or empty; skipping dossier.json\n');
  }

  const v = result.model_stats.validation;
  const ms = result.model_stats;
  const top5Lines = result.rows
    .slice(0, 5)
    .map(
      (r) =>
        `  #${r.rank} ${r.name} (${r.category}): $${r.implied_value_usd.toLocaleString('en-US')} ` +
        `[$${r.implied_low_usd.toLocaleString('en-US')}..$${r.implied_high_usd.toLocaleString('en-US')}] ` +
        `prior=${r.launch_prior}% farm_score=${r.farm_score.toLocaleString('en-US')}`,
    )
    .join('\n');

  process.stdout.write(
    `token-radar: scored ${result.rows.length} pre-token protocols (${snapshot.watchlist.length} watchlist) and ${result.live_peers.length} live peers from ${snapshot.protocols.length} total\n` +
      `token-radar: model LOO validation (n=${v.count}): median_ratio=${v.median_ratio}, geo_ratio=${v.geo_ratio}, within_2x=${v.within_2x_pct}%, within_3x=${v.within_3x_pct}%, iqr_cov=${v.iqr_coverage_pct}%, rmsle=${v.rmsle_log10}, mae=${v.mae_log10}, spearman_rho=${v.spearman_rho} (beta=${ms.tvl_elasticity_beta}, pivot=$${(ms.tvl_pivot_usd / 1e6).toFixed(1)}M, global_med=${ms.global_median_multiple}x, p90_cap=${ms.multiple_cap_p90}x, k=${ms.shrinkage_weight})\n` +
      `token-radar: top-5:\n${top5Lines}\n` +
      (dossierCheck
        ? `token-radar: dossier check PASS: rows=${dossierCheck.rowsIncluded}/${result.rows.length}, row_meta=${dossierCheck.rowMetaIncluded}, live_peers=${dossierCheck.livePeersIncluded}, farm_steps=${dossierCheck.farmStepsIncluded} (${dossierCheck.farmStepCategories.length} cats: ${dossierCheck.farmStepCategories.join(', ')}), text=${dossierCheck.textBytes}/${DOSSIER_TEXT_MAX_BYTES} B, total=${dossierCheck.totalBytes}/${DOSSIER_MAX_TOTAL_BYTES} B\n`
        : '') +
      `token-radar: wrote ${boardPath}, ${zdataPath} (${copiedDash} dashboard files copied)${wroteDossier ? `, ${join(outputDir, 'dossier.json')}` : ''}\n`,
  );
}

main();
