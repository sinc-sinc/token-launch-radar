import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT_DIR = join(REPO_DIR, 'out');
const SHOTS_DIR = join(REPO_DIR, 'screenshots');
const DEFAULT_SNAPSHOT = '/home/muse/token-radar/token-radar-01-kit/input/snapshot.json';

const WINDOW_WIDTH = 1440;
const WINDOW_HEIGHT = 900;
const MAX_LONG_SIDE = 1440;
const MIN_SHORT_SIDE = 800;
const MAX_BYTES = 512 * 1024;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

function parsePng(buf) {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_MAGIC)) {
    return { ok: false, error: 'not a PNG (invalid signature)' };
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let sawIhdr = false;
  let sawIend = false;

  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > buf.length) {
      return { ok: false, error: `truncated PNG chunk ${type}` };
    }
    if (!sawIhdr) {
      if (type !== 'IHDR' || length !== 13) {
        return { ok: false, error: 'first PNG chunk is not valid IHDR' };
      }
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      sawIhdr = true;
    }
    offset = chunkEnd;
    if (type === 'IEND') {
      if (length !== 0) {
        return { ok: false, error: 'IEND chunk has non-zero length' };
      }
      sawIend = true;
      break;
    }
  }

  if (!sawIhdr || !sawIend || offset !== buf.length) {
    return { ok: false, error: 'incomplete or trailing data in PNG' };
  }
  return { ok: true, format: 'PNG', width, height };
}

function parseJpeg(buf) {
  if (buf.length < 4 || !buf.subarray(0, 3).equals(JPEG_MAGIC)) {
    return { ok: false, error: 'not a JPEG (invalid SOI)' };
  }
  if (buf[buf.length - 2] !== 0xff || buf[buf.length - 1] !== 0xd9) {
    return { ok: false, error: 'incomplete JPEG (missing EOI)' };
  }
  let offset = 2;
  let width = 0;
  let height = 0;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) return { ok: false, error: 'malformed JPEG marker stream' };
    while (offset < buf.length && buf[offset] === 0xff) offset += 1;
    if (offset >= buf.length) break;
    const marker = buf[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > buf.length) break;
    const len = buf.readUInt16BE(offset);
    if (len < 2 || offset + len > buf.length) {
      return { ok: false, error: 'truncated JPEG segment' };
    }
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof && len >= 7) {
      height = buf.readUInt16BE(offset + 3);
      width = buf.readUInt16BE(offset + 5);
    }
    offset += len;
  }
  if (!width || !height) {
    return { ok: false, error: 'could not find JPEG dimensions' };
  }
  return { ok: true, format: 'JPEG', width, height };
}

function verifyImage(filePath) {
  const buf = readFileSync(filePath);
  const size = buf.length;
  const info = filePath.endsWith('.jpg') ? parseJpeg(buf) : parsePng(buf);
  if (!info.ok) {
    return { ok: false, size, error: info.error };
  }
  const longSide = Math.max(info.width, info.height);
  const shortSide = Math.min(info.width, info.height);
  if (longSide > MAX_LONG_SIDE) {
    return { ok: false, size, width: info.width, height: info.height, error: `long side ${longSide} > ${MAX_LONG_SIDE}` };
  }
  if (shortSide < MIN_SHORT_SIDE) {
    return { ok: false, size, width: info.width, height: info.height, error: `short side ${shortSide} < ${MIN_SHORT_SIDE}` };
  }
  if (size > MAX_BYTES) {
    return { ok: false, tooHeavy: true, size, width: info.width, height: info.height, error: `size ${size} > ${MAX_BYTES}` };
  }
  return { ok: true, format: info.format, size, width: info.width, height: info.height };
}

function shootChrome(url, destPath) {
  execFileSync(
    'google-chrome',
    [
      '--headless=new',
      `--screenshot=${destPath}`,
      `--window-size=${WINDOW_WIDTH},${WINDOW_HEIGHT}`,
      '--hide-scrollbars',
      url,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

function runGenerator(snapshotPath) {
  mkdirSync(OUT_DIR, { recursive: true });
  execFileSync(process.execPath, [join(REPO_DIR, 'main.ts'), '--input', snapshotPath], {
    cwd: REPO_DIR,
    env: { ...process.env, MAKEFUN_OUTPUT_DIR: OUT_DIR },
    stdio: 'inherit',
  });
}

function pickTopWatchlistCategory(rows) {
  const counts = new Map();
  for (const r of rows) {
    if (!r.watchlist) continue;
    const cat = r.category || 'Uncategorized';
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }
  if (counts.size === 0) {
    throw new Error('No watchlist protocols found in out/board.json');
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { category: sorted[0][0], count: sorted[0][1] };
}

function main() {
  const snapshotPath = process.argv[2] || DEFAULT_SNAPSHOT;
  if (!existsSync(snapshotPath)) {
    console.error(`Snapshot not found: ${snapshotPath}`);
    process.exit(2);
  }

  // 1. Run generator so out/ is current
  runGenerator(snapshotPath);

  const board = JSON.parse(readFileSync(join(OUT_DIR, 'board.json'), 'utf8'));
  const rows = board.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('out/board.json has no rows');
  }
  const rank1 = rows.find((r) => r.rank === 1) || rows[0];
  const topWatchCat = pickTopWatchlistCategory(rows);

  // 2. Copy out/ to a temp preview directory (serve nothing)
  const previewDir = mkdtempSync(join(tmpdir(), 'token-radar-preview-'));
  mkdirSync(SHOTS_DIR, { recursive: true });

  const targets = [
    { baseName: '01-board', hash: '#/' },
    { baseName: '02-detail', hash: `#/protocol/${encodeURIComponent(rank1.slug)}` },
    { baseName: '03-filtered', hash: `#/?cat=${encodeURIComponent(topWatchCat.category)}` },
  ];

  const results = [];
  let hadFailure = false;

  try {
    cpSync(OUT_DIR, previewDir, { recursive: true });
    const pageUrlBase = pathToFileURL(join(previewDir, 'dashboard', 'index.html')).href;

    for (const target of targets) {
      const pngName = `${target.baseName}.png`;
      const jpgName = `${target.baseName}.jpg`;
      const pngPath = join(SHOTS_DIR, pngName);
      const jpgPath = join(SHOTS_DIR, jpgName);

      // Remove stale sibling if present
      if (existsSync(jpgPath)) unlinkSync(jpgPath);

      const url = `${pageUrlBase}${target.hash}`;
      shootChrome(url, pngPath);

      let check = verifyImage(pngPath);
      let finalName = pngName;

      if (!check.ok && check.tooHeavy) {
        // Attempt Chrome screenshot directly into .jpg
        shootChrome(url, jpgPath);
        const jpgCheck = verifyImage(jpgPath);
        if (jpgCheck.ok) {
          unlinkSync(pngPath);
          finalName = jpgName;
          check = jpgCheck;
        } else {
          if (existsSync(jpgPath)) unlinkSync(jpgPath);
          console.error(
            `ERROR: ${pngName} is ${check.size} bytes (> ${MAX_BYTES} bytes) and Chrome JPEG fallback failed (${jpgCheck.error}); cannot reduce short side below ${MIN_SHORT_SIDE}px.`,
          );
          hadFailure = true;
        }
      } else if (!check.ok) {
        console.error(`ERROR: ${pngName} failed verification: ${check.error}`);
        hadFailure = true;
      }

      const bytes = existsSync(join(SHOTS_DIR, finalName)) ? statSync(join(SHOTS_DIR, finalName)).size : 0;
      results.push({
        name: `screenshots/${finalName}`,
        width: check.width ?? 0,
        height: check.height ?? 0,
        bytes,
        ok: check.ok,
      });
    }
  } finally {
    rmSync(previewDir, { recursive: true, force: true });
  }

  console.log(`\nRank 1 protocol: ${rank1.name} (${rank1.slug})`);
  console.log(`Top watchlist category: ${topWatchCat.category} (${topWatchCat.count} watchlist protocols)\n`);
  for (const r of results) {
    console.log(`${r.name}  ${r.width}x${r.height}  ${r.bytes} bytes (${(r.bytes / 1024).toFixed(1)} KiB)  ${r.ok ? 'OK' : 'FAIL'}`);
  }

  if (hadFailure) {
    process.exit(1);
  }
}

main();
