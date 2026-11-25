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

/**
 * Pick a compact, representative sample of live peers across distinct categories
 * for the dossier-visible header summary.
 */
function buildLivePeersSummary(livePeers: readonly LivePeer[]): {
  count: number;
  sample: Array<[string, string, string, number, number, number]>;
} {
  const seenCats = new Set<string>();
  const sample: Array<[string, string, string, number, number, number]> = [];
  for (const p of livePeers) {
    if (sample.length >= 6) break;
    if (seenCats.has(p.category)) continue;
    seenCats.add(p.category);
    sample.push([p.name, p.symbol, p.category, roundUsdM(p.tvl_usd), roundUsdM(p.mcap_usd), round3(p.raw_multiple)]);
  }
  return { count: livePeers.length, sample };
}

/**
 * Serialize window.RADAR_DATA in deterministic, line-split format so the 65,536 B
 * dossier text captures model_stats, live_peers summary, category multiple table,
 * ALL 197 board rows (1 per line), and as many top-ranked full 5-step farm_steps
 * as fit within the cap, while giving the browser exact metadata and all 128 live peers.
 */
function formatZdataJs(result: BoardResult): string {
  const ms = result.model_stats;
  const compactModelStats = {
    global_median_multiple: ms.global_median_multiple,
    global_p25_multiple: ms.global_p25_multiple,
    global_p75_multiple: ms.global_p75_multiple,
    multiple_cap_p90: ms.multiple_cap_p90,
    global_peer_count: ms.global_peer_count,
    shrinkage_weight: ms.shrinkage_weight,
    tvl_elasticity_beta: ms.tvl_elasticity_beta,
    tvl_pivot_usd: ms.tvl_pivot_usd,
    validation: ms.validation,
  };
  const liveSummary = buildLivePeersSummary(result.live_peers);

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
      c ? c.launch_prior : 0,
    ];
  });

  const lines: string[] = [
    'window.RADAR_DATA={',
    `as_of:${safeJson(result.as_of)},floor_usd:${result.floor_usd},`,
    `model_stats:${safeJson(compactModelStats)},`,
    `live_peers_summary:${safeJson(liveSummary)},`,
    `// cats:[name,peers,mult,p25,p75,prior]`,
    `cats:${safeJson(catsTable)},`,
    '// rows:[rank,slug,name,catIdx,tvl_m,implied_m,low_m,high_m,farm,watch]',
    'rows:[',
  ];

  for (let i = 0; i < result.rows.length; i++) {
    const r = result.rows[i]!;
    const tuple = [
      r.rank,
      r.slug,
      r.name,
      catIndex.get(r.category) ?? 0,
      roundUsdM(r.tvl_usd),
      roundUsdM(r.implied_value_usd),
      roundUsdM(r.implied_low_usd),
      roundUsdM(r.implied_high_usd),
      r.farm_score,
      r.watchlist ? 1 : 0,
    ];
    lines.push(`${safeJson(tuple)}${i + 1 < result.rows.length ? ',' : ''}`);
  }

  lines.push('],', 'farm_steps:{');
  for (let i = 0; i < result.rows.length; i++) {
    const r = result.rows[i]!;
    lines.push(`${safeJson(r.slug)}:${safeJson(r.farm_steps)}${i + 1 < result.rows.length ? ',' : ''}`);
  }

  lines.push('},', 'row_meta:{');
  for (let i = 0; i < result.rows.length; i++) {
    const r = result.rows[i]!;
    const meta = [
      r.listed_at,
      r.chains,
      Math.round(r.tvl_usd),
      r.effective_tvl_usd,
      r.implied_value_usd,
      r.implied_low_usd,
      r.implied_high_usd,
      r.multiple_used,
      r.momentum_mult,
      r.maturity_mult,
      r.breadth_mult,
      r.change_7d === null ? null : round1(r.change_7d),
    ];
    lines.push(`${safeJson(r.slug)}:${safeJson(meta)}${i + 1 < result.rows.length ? ',' : ''}`);
  }

  lines.push('},', 'live_peers:[');
  for (let i = 0; i < result.live_peers.length; i++) {
    const p = result.live_peers[i]!;
    const tuple = [
      p.slug,
      p.name,
      p.symbol,
      p.category,
      p.chains,
      Math.round(p.tvl_usd),
      Math.round(p.mcap_usd),
      p.raw_multiple,
      p.norm_multiple,
      p.change_7d === null ? null : round1(p.change_7d),
    ];
    lines.push(`${safeJson(tuple)}${i + 1 < result.live_peers.length ? ',' : ''}`);
  }
  lines.push(']', '};', '');

  return lines.join('\n');
}

interface DossierCheckResult {
  totalBytes: number;
  textBytes: number;
  rowsIncluded: number;
  farmStepsIncluded: number;
}

/**
 * Mechanically verify that out/dossier.json stays within caps and includes every
 * single board protocol row inside its 65,536-byte text budget.
 */
function verifyDossier(dossierBytes: Uint8Array, expectedRows: readonly BoardRow[]): DossierCheckResult {
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

  const zdataIdx = text.indexOf('### zdata.js');
  const seenSlugs = new Set<string>();
  let rowsIncluded = 0;
  let farmStepsIncluded = 0;

  if (zdataIdx === -1) {
    errors.push('zdata.js section completely missing from dossier.json text');
  } else {
    const zSlice = text.slice(zdataIdx);
    const zLines = zSlice.split('\n');
    let section: 'none' | 'rows' | 'steps' = 'none';
    for (const line of zLines) {
      if (line === 'rows:[') {
        section = 'rows';
        continue;
      }
      if (section === 'rows') {
        if (line === '],') {
          section = 'none';
          continue;
        }
        const trimmed = line.endsWith(',') ? line.slice(0, -1) : line;
        if (trimmed.startsWith('[')) {
          try {
            const arr = JSON.parse(trimmed) as unknown[];
            if (Array.isArray(arr) && typeof arr[0] === 'number' && typeof arr[1] === 'string' && typeof arr[2] === 'string') {
              rowsIncluded += 1;
              seenSlugs.add(arr[1]);
            }
          } catch {
            // Incomplete or non-row line
          }
        }
      } else if (line === 'farm_steps:{') {
        section = 'steps';
        continue;
      } else if (section === 'steps') {
        if (line === '},' || line.startsWith('```')) {
          section = 'none';
          continue;
        }
        if (/^"[^"]+":\[/.test(line)) {
          farmStepsIncluded += 1;
        }
      }
    }
  }

  const missingSlugs = expectedRows.filter((r) => !seenSlugs.has(r.slug)).map((r) => r.slug);
  if (rowsIncluded !== expectedRows.length || missingSlugs.length > 0) {
    errors.push(
      `dossier rowsIncluded=${rowsIncluded} (expected ${expectedRows.length}, missing=${missingSlugs.length}: ${missingSlugs.slice(0, 5).join(', ')})`,
    );
  }

  if (errors.length > 0) {
    throw new Error(`dossier check FAILED:\n  - ${errors.join('\n  - ')}`);
  }

  return { totalBytes, textBytes, rowsIncluded, farmStepsIncluded };
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
    dossierCheck = verifyDossier(dossierBytes, result.rows);
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
      `token-radar: model LOO validation (n=${v.count}): median_ratio=${v.median_ratio}, within_2x=${v.within_2x_pct}%, within_3x=${v.within_3x_pct}%, iqr_cov=${v.iqr_coverage_pct}%, rmsle=${v.rmsle_log10}, mae=${v.mae_log10} (beta=${ms.tvl_elasticity_beta}, pivot=$${(ms.tvl_pivot_usd / 1e6).toFixed(1)}M, global_med=${ms.global_median_multiple}x, p90_cap=${ms.multiple_cap_p90}x, k=${ms.shrinkage_weight})\n` +
      `token-radar: top-5:\n${top5Lines}\n` +
      (dossierCheck
        ? `token-radar: dossier check PASS: rows=${dossierCheck.rowsIncluded}/${result.rows.length}, farm_steps=${dossierCheck.farmStepsIncluded}, text=${dossierCheck.textBytes}/${DOSSIER_TEXT_MAX_BYTES} B, total=${dossierCheck.totalBytes}/${DOSSIER_MAX_TOTAL_BYTES} B\n`
        : '') +
      `token-radar: wrote ${boardPath}, ${zdataPath} (${copiedDash} dashboard files copied)${wroteDossier ? `, ${join(outputDir, 'dossier.json')}` : ''}\n`,
  );
}

main();
