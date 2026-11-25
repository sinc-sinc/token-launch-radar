import { existsSync, readFileSync, statSync } from 'node:fs';

const MAX_BOARD_BYTES = 8 * 1024 * 1024;
const MIN_ROWS = 100;
const MAX_ROWS = 4000;
const MIN_STEPS = 3;
const MAX_STEPS = 12;
const MIN_STEP_CHARS = 20;
const MAX_STEP_CHARS = 600;
const MAX_REPORTED_FAILURES = 20;

const DEFAULT_SNAPSHOTS = [
  '/home/muse/token-radar/token-radar-01-kit/input/snapshot.json',
  '/input/snapshot.json',
];

const EXCLUDED_CATEGORIES = new Set([
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

/**
 * Independently verify launch-candidate eligibility from a snapshot protocol:
 * protocol records no token (gecko_id and symbol both null) and fails none of
 * the wrapped, bridged, versioned, or exchange-product exclusion tests.
 */
function candidateExclusionReasons(p) {
  const reasons = [];
  if (p.gecko_id !== null || p.symbol !== null) {
    reasons.push(`records a token (gecko_id=${JSON.stringify(p.gecko_id)}, symbol=${JSON.stringify(p.symbol)})`);
  }
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) {
    reasons.push(`excluded category "${p.category}"`);
  }
  if (typeof p.name === 'string') {
    if (VERSION_MARKER_RE.test(p.name)) {
      reasons.push(`version marker in name "${p.name}"`);
    }
    if (WRAPPED_OR_STAKED_RE.test(p.name)) {
      reasons.push(`wrapped/staked/staking in name "${p.name}"`);
    }
    if (EXCHANGE_PREFIX_RE.test(p.name)) {
      reasons.push(`exchange prefix in name "${p.name}"`);
    }
  }
  return reasons;
}

function resolveArgs(argv) {
  let boardPath = null;
  let snapshotPath = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--snapshot' && i + 1 < argv.length) {
      snapshotPath = argv[++i];
    } else if (a.startsWith('--snapshot=')) {
      snapshotPath = a.slice('--snapshot='.length);
    } else if (!boardPath) {
      boardPath = a;
    } else if (!snapshotPath) {
      snapshotPath = a;
    }
  }
  if (!snapshotPath) {
    snapshotPath = DEFAULT_SNAPSHOTS.find((p) => existsSync(p)) ?? null;
  }
  return { boardPath, snapshotPath };
}

function main() {
  const { boardPath, snapshotPath } = resolveArgs(process.argv.slice(2));
  if (!boardPath) {
    console.error('Usage: node tools/validate.mjs <board.json> [snapshot.json]');
    process.exit(2);
  }

  const failures = [];
  const fail = (msg) => {
    if (failures.length < MAX_REPORTED_FAILURES) failures.push(msg);
  };

  if (!existsSync(boardPath)) {
    console.error(`FAIL: board file not found: ${boardPath}`);
    process.exit(1);
  }

  const sizeBytes = statSync(boardPath).size;
  if (sizeBytes > MAX_BOARD_BYTES) {
    fail(`board.json is ${sizeBytes} bytes, exceeding ${MAX_BOARD_BYTES} bytes (8 MiB)`);
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(boardPath, 'utf8'));
  } catch (err) {
    console.error(`FAIL: board.json is not valid JSON: ${err.message}`);
    process.exit(1);
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.rows)) {
    console.error('FAIL: board.json must be an object with a "rows" array');
    process.exit(1);
  }

  const rows = parsed.rows;
  if (rows.length < MIN_ROWS || rows.length > MAX_ROWS) {
    fail(`row count ${rows.length} outside allowed range [${MIN_ROWS}, ${MAX_ROWS}]`);
  }

  const seenSlugs = new Set();
  let minStepLen = Infinity;
  let maxStepLen = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const expectedRank = i + 1;
    if (!row || typeof row !== 'object') {
      fail(`row[${i}] is not an object`);
      continue;
    }
    if (typeof row.slug !== 'string' || row.slug.length === 0) {
      fail(`row[${i}] missing non-empty string slug`);
    } else if (seenSlugs.has(row.slug)) {
      fail(`duplicate slug "${row.slug}" at row[${i}]`);
    } else {
      seenSlugs.add(row.slug);
    }
    if (typeof row.name !== 'string' || row.name.length === 0) {
      fail(`row[${i}] (${row.slug}) missing non-empty string name`);
    }
    if (row.rank !== expectedRank) {
      fail(`row[${i}] (${row.slug}) has rank ${row.rank}, expected ${expectedRank}`);
    }
    const val = row.implied_value_usd;
    if (typeof val !== 'number' || !Number.isSafeInteger(val) || val <= 0) {
      fail(`row[${i}] (${row.slug}) implied_value_usd=${val} must be a positive integer`);
    } else if (i > 0) {
      const prevVal = rows[i - 1]?.implied_value_usd;
      if (typeof prevVal === 'number' && val >= prevVal) {
        fail(`row[${i}] (${row.slug}) implied_value_usd=${val} is not strictly less than row[${i - 1}] (${prevVal})`);
      }
    }

    const steps = row.farm_steps;
    if (!Array.isArray(steps) || steps.length < MIN_STEPS || steps.length > MAX_STEPS) {
      fail(`row[${i}] (${row.slug}) farm_steps must be an array of ${MIN_STEPS}-${MAX_STEPS} strings`);
    } else {
      for (let s = 0; s < steps.length; s++) {
        const step = steps[s];
        if (typeof step !== 'string') {
          fail(`row[${i}] (${row.slug}) farm_steps[${s}] is not a string`);
          continue;
        }
        if (step.length < minStepLen) minStepLen = step.length;
        if (step.length > maxStepLen) maxStepLen = step.length;
        if (step.length < MIN_STEP_CHARS || step.length > MAX_STEP_CHARS) {
          fail(`row[${i}] (${row.slug}) farm_steps[${s}] length ${step.length} outside [${MIN_STEP_CHARS}, ${MAX_STEP_CHARS}]`);
        }
      }
      // Step 1 vs Step 4 weekly-minutes consistency gate
      if (steps.length >= 4 && typeof steps[0] === 'string' && typeof steps[3] === 'string') {
        const m1 = steps[0].match(/~(\d+)\s*min\/week/i);
        const m4 = steps[3].match(/~(\d+)\s*min\s+weekly/i);
        if (m1 && m4 && m1[1] !== m4[1]) {
          fail(`row[${i}] (${row.slug}) farm_steps weekly-time mismatch: Step 1=${m1[1]}m/wk vs Step 4=${m4[1]}m/wk`);
        }
      }
      // Bitcoin primary-chain EVM leakage gate
      if (Array.isArray(row.chains) && row.chains[0] === 'Bitcoin') {
        const joined = steps.join(' ');
        if (/\b(?:USDC|ETH)\b|canonical bridge|audited bridge/i.test(joined)) {
          fail(`row[${i}] (${row.slug}) Bitcoin primary farm_steps contains EVM-only wording`);
        }
      }
    }
    if (typeof row.farm_score === 'number' && row.farm_score <= 1) {
      fail(`row[${i}] (${row.slug}) farm_score=${row.farm_score} collapsed to floor 1`);
    }
    if (typeof row.launch_prior === 'number' && row.launch_prior <= 0) {
      fail(`row[${i}] (${row.slug}) launch_prior=${row.launch_prior}% collapsed to 0%`);
    }
  }

  // Verify no sharp step-cliff drops (>= 15 pts) across $10M / $50M / $250M within same category
  const byCategory = new Map();
  for (const row of rows) {
    if (!row || typeof row.category !== 'string') continue;
    const list = byCategory.get(row.category) ?? [];
    list.push(row);
    byCategory.set(row.category, list);
  }
  for (const [cat, list] of byCategory) {
    for (const a of list) {
      for (const b of list) {
        if (typeof a.tvl_usd !== 'number' || typeof b.tvl_usd !== 'number') continue;
        if (typeof a.farm_score !== 'number' || typeof b.farm_score !== 'number') continue;
        for (const thr of [10_000_000, 50_000_000, 250_000_000]) {
          if (a.tvl_usd >= thr && b.tvl_usd < thr && a.tvl_usd <= thr * 2 && b.tvl_usd >= thr * 0.5) {
            if (a.farm_score - b.farm_score <= -15) {
              fail(
                `farm_score cliff in ${cat} across $${thr / 1e6}M: ${a.slug} (${a.farm_score}) vs ${b.slug} (${b.farm_score})`,
              );
            }
          }
        }
      }
    }
  }

  let watchlistCount = 0;
  let candidateChecked = false;
  if (snapshotPath) {
    if (!existsSync(snapshotPath)) {
      fail(`snapshot file not found: ${snapshotPath}`);
    } else {
      const snap = JSON.parse(readFileSync(snapshotPath, 'utf8'));
      const watchlist = Array.isArray(snap.watchlist) ? snap.watchlist : [];
      watchlistCount = watchlist.length;
      for (const slug of watchlist) {
        if (!seenSlugs.has(slug)) {
          fail(`watchlist slug "${slug}" missing from board.json`);
        }
      }

      const protocolsBySlug = new Map();
      if (Array.isArray(snap.protocols)) {
        for (const p of snap.protocols) {
          if (p && typeof p.slug === 'string') {
            protocolsBySlug.set(p.slug, p);
          }
        }
      }
      candidateChecked = true;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || typeof row.slug !== 'string') continue;
        const proto = protocolsBySlug.get(row.slug);
        if (!proto) {
          fail(`row[${i}] (${row.slug}) not found in snapshot protocols`);
          continue;
        }
        const reasons = candidateExclusionReasons(proto);
        if (reasons.length > 0) {
          fail(`row[${i}] (${row.slug}) is not a launch candidate: ${reasons.join('; ')}`);
        }
      }
    }
  }

  if (failures.length > 0) {
    console.error(`FAIL (${failures.length} issue${failures.length === 1 ? '' : 's'}):`);
    for (const msg of failures) {
      console.error(`  - ${msg}`);
    }
    process.exit(1);
  }

  console.log(
    `PASS: ${rows.length} rows, ${watchlistCount}/${watchlistCount} watchlist slugs present, ` +
      `${candidateChecked ? 'all rows pass launch-candidate tests, ' : ''}` +
      `ranks 1..${rows.length}, implied_value_usd strictly decreasing, ` +
      `farm_steps length ${minStepLen}..${maxStepLen} chars, size ${sizeBytes} bytes`,
  );
}

main();
