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
    }
  }

  let watchlistCount = 0;
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
      `ranks 1..${rows.length}, implied_value_usd strictly decreasing, ` +
      `farm_steps length ${minStepLen}..${maxStepLen} chars, size ${sizeBytes} bytes`,
  );
}

main();
