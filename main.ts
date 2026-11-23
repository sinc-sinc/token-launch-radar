import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const REPO_DIR = fileURLToPath(new URL('.', import.meta.url));
const DOSSIER_TEXT_MAX_BYTES = 65_536;

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

  const radarPayload = {
    as_of: result.as_of,
    floor_usd: result.floor_usd,
    rows: result.rows,
  };
  const zdataJson = JSON.stringify(radarPayload).replace(/<\//g, '<\\/');
  const zdataPath = join(outDashboardDir, 'zdata.js');
  writeFileSync(zdataPath, `window.RADAR_DATA = ${zdataJson};\n`, 'utf8');

  const srcShotsDir = join(REPO_DIR, 'screenshots');
  const shotNames = listTopLevelFiles(srcShotsDir);
  let wroteDossier = false;
  if (shotNames.length > 0) {
    const outShotsDir = join(outputDir, 'screenshots');
    mkdirSync(outShotsDir, { recursive: true });
    for (const name of shotNames) {
      copyFileSync(join(srcShotsDir, name), join(outShotsDir, name));
    }
    const dossierBytes = buildDossier(outputDir, { text_max_bytes: DOSSIER_TEXT_MAX_BYTES });
    writeFileSync(join(outputDir, 'dossier.json'), dossierBytes);
    wroteDossier = true;
  } else {
    process.stdout.write('token-radar: screenshots/ missing or empty; skipping dossier.json\n');
  }

  process.stdout.write(
    `token-radar: scored ${result.rows.length} pre-token protocols (${snapshot.watchlist.length} watchlist) from ${snapshot.protocols.length} total\n` +
      `token-radar: wrote ${boardPath}, ${zdataPath} (${copiedDash} dashboard files copied)${wroteDossier ? `, ${join(outputDir, 'dossier.json')}` : ''}\n`,
  );
}

main();
