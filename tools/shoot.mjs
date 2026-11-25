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
  writeFileSync,
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
const MIN_VISIBLE_BOARD_ROWS = 8;

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

function probeLayout(previewDir, hash) {
  const htmlPath = join(previewDir, 'dashboard', 'index.html');
  const url = `${pathToFileURL(htmlPath).href}${hash}`;
  const dom = execFileSync(
    'google-chrome',
    ['--headless=new', '--dump-dom', `--window-size=${WINDOW_WIDTH},${WINDOW_HEIGHT}`, '--hide-scrollbars', url],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const m = dom.match(/<pre id="LAYOUT_PROBE">(.*?)<\/pre>/);
  if (!m) throw new Error(`Layout probe missing for ${hash}`);
  return JSON.parse(m[1]);
}

function runGenerator(snapshotPath) {
  mkdirSync(OUT_DIR, { recursive: true });
  execFileSync(process.execPath, [join(REPO_DIR, 'main.ts'), '--input', snapshotPath], {
    cwd: REPO_DIR,
    env: { ...process.env, MAKEFUN_OUTPUT_DIR: OUT_DIR },
    stdio: 'inherit',
  });
}

/**
 * Pick the highest-count watchlist category that has zero overlap with the
 * board's top-5 protocols so 03-filtered.png demonstrates distinct filtered data.
 */
function pickDistinctFilterCategory(rows) {
  const top5Slugs = new Set(rows.slice(0, 5).map((r) => r.slug));
  const stats = new Map();
  for (const r of rows) {
    const cat = r.category || 'Uncategorized';
    let s = stats.get(cat);
    if (!s) {
      s = { total: 0, watch: 0, top5Overlap: 0 };
      stats.set(cat, s);
    }
    s.total += 1;
    if (r.watchlist) s.watch += 1;
    if (top5Slugs.has(r.slug)) s.top5Overlap += 1;
  }
  const candidates = [...stats.entries()]
    .filter(([, s]) => s.watch > 0 && s.top5Overlap === 0)
    .sort((a, b) => b[1].watch - a[1].watch || b[1].total - a[1].total || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  if (candidates.length > 0) {
    const [category, s] = candidates[0];
    return { category, watchCount: s.watch, totalCount: s.total, top5Overlap: s.top5Overlap };
  }
  const fallback = [...stats.entries()]
    .filter(([, s]) => s.watch > 0)
    .sort((a, b) => a[1].top5Overlap - b[1].top5Overlap || b[1].watch - a[1].watch);
  if (fallback.length === 0) {
    throw new Error('No watchlist protocols found in out/board.json');
  }
  const [category, s] = fallback[0];
  return { category, watchCount: s.watch, totalCount: s.total, top5Overlap: s.top5Overlap };
}

function main() {
  const snapshotPath = process.argv[2] || DEFAULT_SNAPSHOT;
  if (!existsSync(snapshotPath)) {
    console.error(`Snapshot not found: ${snapshotPath}`);
    process.exit(2);
  }

  // 1. Run generator so out/dashboard and out/board.json are current
  runGenerator(snapshotPath);

  const board = JSON.parse(readFileSync(join(OUT_DIR, 'board.json'), 'utf8'));
  const rows = board.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('out/board.json has no rows');
  }
  const rank1 = rows.find((r) => r.rank === 1) || rows[0];
  const filterCat = pickDistinctFilterCategory(rows);

  // 2. Copy out/ to a temp preview directory (serve nothing)
  const previewDir = mkdtempSync(join(tmpdir(), 'token-radar-preview-'));
  mkdirSync(SHOTS_DIR, { recursive: true });

  const targets = [
    { baseName: '01-board', hash: '#/' },
    { baseName: '02-detail', hash: `#/protocol/${encodeURIComponent(rank1.slug)}` },
    { baseName: '03-filtered', hash: `#/?cat=${encodeURIComponent(filterCat.category)}&watch=1` },
  ];

  const results = [];
  let hadFailure = false;
  let layoutReport = {};

  try {
    cpSync(OUT_DIR, previewDir, { recursive: true });
    const pageUrlBase = pathToFileURL(join(previewDir, 'dashboard', 'index.html')).href;

    for (const target of targets) {
      const pngName = `${target.baseName}.png`;
      const jpgName = `${target.baseName}.jpg`;
      const pngPath = join(SHOTS_DIR, pngName);
      const jpgPath = join(SHOTS_DIR, jpgName);

      if (existsSync(jpgPath)) unlinkSync(jpgPath);

      const url = `${pageUrlBase}${target.hash}`;
      shootChrome(url, pngPath);

      let check = verifyImage(pngPath);
      let finalName = pngName;

      if (!check.ok && check.tooHeavy) {
        shootChrome(url, jpgPath);
        const jpgCheck = verifyImage(jpgPath);
        if (jpgCheck.ok) {
          unlinkSync(pngPath);
          finalName = jpgName;
          check = jpgCheck;
        } else {
          if (existsSync(jpgPath)) unlinkSync(jpgPath);
          console.error(
            `ERROR: ${pngName} is ${check.size} bytes (> ${MAX_BYTES} bytes) and Chrome JPEG fallback failed (${jpgCheck.error}).`,
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

    // 3. Automated DOM clipping & density check on temp preview copy
    const htmlPath = join(previewDir, 'dashboard', 'index.html');
    const origHtml = readFileSync(htmlPath, 'utf8');
    const probeScript =
      `<script>window.addEventListener("load",()=>{const m={};` +
      `const trs=[...document.querySelectorAll(".tbl tbody tr")];` +
      `if(trs.length){m.tableRows=trs.length;m.fullyVis900=trs.filter(r=>r.getBoundingClientRect().bottom<=${WINDOW_HEIGHT}).length;m.slugs=trs.slice(0,5).map(r=>r.dataset.slug||"");m.visSlugs=trs.filter(r=>r.getBoundingClientRect().bottom<=${WINDOW_HEIGHT}).map(r=>r.dataset.slug||"");m.legend=(document.getElementById("scl")?.textContent||"").trim();}` +
      `const steps=[...document.querySelectorAll("#farm-timeline li")];` +
      `if(steps.length){m.steps=steps.length;m.lastStepBottom=Math.round(steps[steps.length-1].getBoundingClientRect().bottom);m.farmPanelBottom=Math.round(document.getElementById("farm-panel").getBoundingClientRect().bottom);m.whyTotalBottom=Math.round(document.getElementById("why-total").getBoundingClientRect().bottom);m.whyPanelBottom=Math.round(document.getElementById("why-panel").getBoundingClientRect().bottom);const pr=[...document.querySelectorAll(".ptbl tbody tr")];m.peerRows=pr.length;m.peerCols=pr[0]?[...pr[0].querySelectorAll("td")].map(td=>td.textContent.trim()):[];const ps=document.querySelector(".ps");m.psHeight=ps?Math.round(ps.getBoundingClientRect().height):0;m.psText=ps?ps.textContent.trim():"";const sTexts=steps.map(li=>li.querySelector(".tlt")?.textContent||"");m.s1Wk=(sTexts[0].match(/~(\\d+)\\s*min\\/week/i)||[])[1]||null;m.s4Wk=(sTexts[3].match(/~(\\d+)\\s*min\\s+weekly/i)||[])[1]||null;}` +
      `const el=document.createElement("pre");el.id="LAYOUT_PROBE";el.textContent=JSON.stringify(m);document.body.appendChild(el);});</script>`;
    writeFileSync(htmlPath, origHtml.replace('</body>', `${probeScript}</body>`), 'utf8');

    const boardProbe = probeLayout(previewDir, targets[0].hash);
    const detailProbe = probeLayout(previewDir, targets[1].hash);
    const filtProbe = probeLayout(previewDir, targets[2].hash);
    const top5Set = new Set(boardProbe.slugs || []);
    const visSet = new Set(boardProbe.visSlugs || []);
    const overlapCount = (filtProbe.slugs || []).filter((s) => s && top5Set.has(s)).length;
    const visOverlapCount = (filtProbe.visSlugs || []).filter((s) => s && visSet.has(s)).length;

    layoutReport = { boardProbe, detailProbe, filtProbe, overlapCount, visOverlapCount };

    if ((boardProbe.fullyVis900 ?? 0) < MIN_VISIBLE_BOARD_ROWS) {
      console.error(`ERROR: 01-board shows only ${boardProbe.fullyVis900} full rows in ${WINDOW_HEIGHT}px (< ${MIN_VISIBLE_BOARD_ROWS})`);
      hadFailure = true;
    }
    if ((detailProbe.steps ?? 0) < 5) {
      console.error(`ERROR: 02-detail rendered ${detailProbe.steps} farm steps (expected 5)`);
      hadFailure = true;
    }
    if ((detailProbe.lastStepBottom ?? Infinity) > WINDOW_HEIGHT) {
      console.error(`ERROR: 02-detail farm plan clipped: lastStepBottom=${detailProbe.lastStepBottom} > ${WINDOW_HEIGHT}`);
      hadFailure = true;
    }
    if ((detailProbe.whyTotalBottom ?? Infinity) > WINDOW_HEIGHT || (detailProbe.whyPanelBottom ?? Infinity) > WINDOW_HEIGHT) {
      console.error(
        `ERROR: 02-detail left panel clipped: whyTotalBottom=${detailProbe.whyTotalBottom}, whyPanelBottom=${detailProbe.whyPanelBottom} > ${WINDOW_HEIGHT}`,
      );
      hadFailure = true;
    }
    if (detailProbe.s1Wk && detailProbe.s4Wk && detailProbe.s1Wk !== detailProbe.s4Wk) {
      console.error(`ERROR: 02-detail Step 1 (${detailProbe.s1Wk}m/wk) != Step 4 (${detailProbe.s4Wk}m/wk)`);
      hadFailure = true;
    }
    if (!String(filtProbe.legend || '').includes('Top 5 matches')) {
      console.error(`ERROR: 03-filtered scatter legend missing "Top 5 matches": ${filtProbe.legend}`);
      hadFailure = true;
    }
    if (overlapCount > 0) {
      console.error(`ERROR: 03-filtered overlaps ${overlapCount}/5 top rows with 01-board`);
      hadFailure = true;
    }
  } finally {
    rmSync(previewDir, { recursive: true, force: true });
  }

  // 4. Re-run generator so out/screenshots and out/dossier.json include the freshly captured PNGs
  runGenerator(snapshotPath);

  const totalPngBytes = results.reduce((sum, r) => sum + r.bytes, 0);
  console.log(`\nRank 1 protocol: ${rank1.name} (${rank1.slug})`);
  console.log(
    `Filtered view target: Category="${filterCat.category}" + Watchlist only (${filterCat.watchCount} watchlist / ${filterCat.totalCount} total, top-5 overlap=${filterCat.top5Overlap})\n`,
  );
  for (const r of results) {
    console.log(`${r.name}  ${r.width}x${r.height}  ${r.bytes} bytes (${(r.bytes / 1024).toFixed(1)} KiB)  ${r.ok ? 'OK' : 'FAIL'}`);
  }
  console.log(`Total PNG size: ${totalPngBytes} bytes (${(totalPngBytes / 1024).toFixed(1)} KiB)`);
  console.log(
    `DOM layout check: board_visible_rows=${layoutReport.boardProbe?.fullyVis900}, detail_steps=${layoutReport.detailProbe?.steps}, ` +
      `last_step_bottom=${layoutReport.detailProbe?.lastStepBottom}px (<= ${WINDOW_HEIGHT}px), ` +
      `why_total_bottom=${layoutReport.detailProbe?.whyTotalBottom}px, why_panel_bottom=${layoutReport.detailProbe?.whyPanelBottom}px, ` +
      `detail_peers=${layoutReport.detailProbe?.peerRows} (${(layoutReport.detailProbe?.peerCols || []).join(' | ')}), ` +
      `detail_timing=${layoutReport.detailProbe?.s1Wk}m==${layoutReport.detailProbe?.s4Wk}m (ps_h=${layoutReport.detailProbe?.psHeight}px), ` +
      `filtered_top5_overlap=${layoutReport.overlapCount}/5 (vis_overlap=${layoutReport.visOverlapCount}/${layoutReport.filtProbe?.tableRows})`,
  );

  if (hadFailure) {
    process.exit(1);
  }
}

main();
