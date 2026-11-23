(() => {
 'use strict';
 const $ = (id) => document.getElementById(id);
 const appEl = $('app'), watchLinkEl = $('stat-watch-link'), DATA = window.RADAR_DATA;
 const WDOT = '<span class="watch-dot" aria-hidden="true"></span>';
 const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
 const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
 const fmtUsd = (n) => {
  if (!isNum(n)) return '--';
  const s = n < 0 ? '-' : '', v = Math.abs(n);
  const f = (x, u) => `${s}$${x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)}${u}`;
  return v >= 1e9 ? f(v / 1e9, 'B') : v >= 1e6 ? f(v / 1e6, 'M') : v >= 1e3 ? f(v / 1e3, 'K') : `${s}$${Math.round(v)}`;
 };
 const fmtUsdExact = (n) => (isNum(n) ? `$${Math.round(n).toLocaleString('en-US')}` : '--');
 const fmtPct = (n) => (isNum(n) ? `${n > 0 ? '+' : ''}${n.toFixed(1)}%` : '\u2014');
 const fmtPrior = (n) => (isNum(n) ? `${n.toFixed(1)}%` : '--');
 const fmtRatio = (i, t) => (isNum(i) && isNum(t) && t > 0 ? `$${(i / t).toFixed(2)}` : '--');
 const fmtMult = (m) => (isNum(m) ? `${m >= 10 ? m.toFixed(2) : m >= 1 ? m.toFixed(3) : m.toFixed(4)}\u00d7` : '--');
 const fmtMultS = (m) => (isNum(m) ? `${m >= 10 ? m.toFixed(1) : m >= 1 ? m.toFixed(2) : m.toFixed(3)}\u00d7` : '--');
 const fmtFac = (m) => (isNum(m) ? `${m.toFixed(3)}\u00d7` : '--');
 const fmtDelta = (m) => {
  if (!isNum(m)) return '';
  const p = (m - 1) * 100;
  return Math.abs(p) < 0.05 ? '0.0%' : `${p > 0 ? '+' : ''}${p.toFixed(1)}%`;
 };
 const daysBetween = (a, b) => {
  if (!a || !b) return null;
  const t1 = Date.parse(`${a}T00:00:00Z`), t2 = Date.parse(`${b}T00:00:00Z`);
  return Number.isFinite(t1) && Number.isFinite(t2) ? Math.max(0, Math.round((t2 - t1) / 86400000)) : null;
 };
 const fmtHrs = (min) => {
  const h = Math.floor(min / 60), m = min % 60;
  return h === 0 ? `~${m}m` : m === 0 ? `~${h}h` : `~${h}h ${m}m`;
 };
 const parsePlan = (row) => {
  const s0 = Array.isArray(row.farm_steps) && typeof row.farm_steps[0] === 'string' ? row.farm_steps[0] : '';
  const m = s0.match(/^Budget:\s*(\$[0-9,]+)\s+over\s+~?(\d+)\s+weeks?,\s*~?(\d+)\s*min\/week/i);
  if (m) {
   const w = Number(m[2]), pm = Number(m[3]);
   return { cap: m[1], time: `${fmtHrs(w * pm)} total (${w} wks \u00b7 ~${pm} min/wk)` };
  }
  const tvl = row.tvl_usd || 0;
  const [cap, w] = tvl < 1e7 ? ['$250', 8] : tvl < 5e7 ? ['$500', 10] : tvl < 2.5e8 ? ['$1,000', 12] : ['$2,500', 16];
  return { cap, time: `${fmtHrs(w * 15)} total (${w} wks \u00b7 ~15 min/wk)` };
 };

 if (!DATA || !Array.isArray(DATA.rows)) {
  appEl.innerHTML = '<section class="notice-card"><h2>Snapshot data not generated yet</h2><p>No <code>window.RADAR_DATA</code> payload found. Run the generator to write <code>zdata.js</code>.</p><pre class="code-block">mkdir -p out &amp;&amp; MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json</pre></section>';
  return;
 }

 const MS = DATA.model_stats || null;
 const rowsByRank = DATA.rows.slice().sort((a, b) => a.rank - b.rank);
 const rowBySlug = new Map();
 const catCounts = Object.create(null), chainCounts = Object.create(null);
 let watchCount = 0;

 for (const r of rowsByRank) {
  rowBySlug.set(r.slug, r);
  if (r.watchlist) watchCount += 1;
  const c = r.category || 'Uncategorized';
  catCounts[c] = (catCounts[c] || 0) + 1;
  if (Array.isArray(r.chains)) for (const ch of r.chains) chainCounts[ch] = (chainCounts[ch] || 0) + 1;
 }

 const top10Sum = rowsByRank.slice(0, 10).reduce((a, r) => a + (r.implied_value_usd || 0), 0);
 const categories = Object.keys(catCounts).sort((a, b) => a.localeCompare(b));
 const chains = Object.keys(chainCounts).sort((a, b) => a.localeCompare(b));

 $('meta-date').textContent = DATA.as_of || '--';
 $('stat-total').textContent = rowsByRank.length.toLocaleString('en-US');
 $('stat-watch').textContent = watchCount.toLocaleString('en-US');
 $('stat-top10').textContent = fmtUsd(top10Sum);
 if (isNum(DATA.floor_usd) && DATA.floor_usd > 0) $('footer-floor').textContent = `TVL FLOOR ${fmtUsd(DATA.floor_usd)}`;

 const state = { view: 'board', slug: null, q: '', cat: '', chain: '', watch: false, minTvl: 0, sortKey: 'rank', sortDir: 'asc' };
 let boardMounted = false, dom = {};

 function parseHash() {
  const raw = (window.location.hash || '').replace(/^#/, '');
  if (!raw || raw === '/') return { view: 'board', cat: '', watch: false };
  const pm = raw.match(/^\/protocol\/(.+?)\/?$/);
  if (pm) {
   let slug = pm[1];
   try { slug = decodeURIComponent(slug); } catch (_) {}
   return { view: 'detail', slug };
  }
  const qi = raw.indexOf('?');
  if (qi !== -1) {
   const p = new URLSearchParams(raw.slice(qi + 1));
   return { view: 'board', cat: p.get('cat') || '', watch: p.get('watch') === '1' };
  }
  return { view: 'board', cat: '', watch: false };
 }

 function syncBoardHash() {
  const p = new URLSearchParams();
  if (state.cat) p.set('cat', state.cat);
  if (state.watch) p.set('watch', '1');
  const qs = p.toString(), target = qs ? `#/?${qs}` : '#/';
  if (window.location.hash !== target) try { window.history.replaceState(null, '', target); } catch (_) {}
 }

 function renderModelStrip() {
  const v = MS && MS.validation ? MS.validation : null;
  const gMed = MS ? fmtMultS(MS.global_median_multiple) : '--';
  const hl = v
   ? `Leave-one-out check on <strong>${v.count.toLocaleString('en-US')}</strong> tokenised protocols: median predicted/actual <strong>\u00d7${v.median_ratio.toFixed(2)}</strong>`
   : 'Peer-derived valuation model from snapshot tokenised protocols';
  const more = MS && v
   ? `Category multiples shrink toward the global median (${gMed}, IQR ${fmtMultS(MS.global_p25_multiple)}\u2013${fmtMultS(MS.global_p75_multiple)}) with prior weight k=${MS.shrinkage_weight} and p90 cap ${fmtMultS(MS.multiple_cap_p90)}. Adjustments apply clamped 7d TVL momentum (&minus;30% to +50%), listing-age maturity, and +5% breadth for 3+ chains. LOO spread across ${v.count} tokenised peers (TVL &ge; $5M): <strong>${v.within_2x_pct.toFixed(1)}%</strong> within 2&times;, <strong>${v.within_3x_pct.toFixed(1)}%</strong> within 3&times;.`
   : 'Category multiples use empirical mcap/TVL medians of tokenised peers in this snapshot.';
  return `<section class="model-strip" aria-label="Valuation model summary"><div class="model-top"><div class="model-left"><h2 class="method-title">Model Card</h2><span class="model-pill">Global median multiple <strong>${gMed}</strong></span></div><div class="method-formula"><strong>Implied Value</strong> = TVL &times; Category Multiple &times; Momentum &times; Maturity &times; Breadth</div></div><p class="model-headline">${hl} <span class="model-clause">&middot; Ranges are category p25&ndash;p75 (half of launched peers landed inside).</span></p><details class="model-more"><summary>Calibration &amp; spread details</summary><p class="model-more-body">${more}</p></details></section>`;
 }

 function buildScatterSvg(matched, hasFilter) {
  const W = 1280, H = 180, padL = 56, padR = 18, padT = 14, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const valid = rowsByRank.filter((r) => r.tvl_usd > 0 && r.implied_value_usd > 0);
  if (!valid.length) return '';

  let minLX = Infinity, maxLX = -Infinity, minLY = Infinity, maxLY = -Infinity;
  for (const r of valid) {
   const lx = Math.log10(r.tvl_usd), ly = Math.log10(r.implied_value_usd);
   if (lx < minLX) minLX = lx; if (lx > maxLX) maxLX = lx;
   if (ly < minLY) minLY = ly; if (ly > maxLY) maxLY = ly;
  }
  const xLo = Math.min(Math.floor(minLX * 2) / 2, minLX - 0.1), xHi = maxLX + 0.12;
  const yLo = Math.min(Math.floor(minLY * 2) / 2, minLY - 0.14), yHi = maxLY + 0.2;
  const sx = (lx) => padL + ((lx - xLo) / (xHi - xLo || 1)) * plotW;
  const sy = (ly) => padT + (1 - (ly - yLo) / (yHi - yLo || 1)) * plotH;
  const f1 = (n) => n.toFixed(1);

  const p = [`<rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="rgba(5,10,7,.72)" stroke="rgba(88,224,144,.16)"/>`];
  for (let e = Math.ceil(xLo); e <= Math.floor(xHi); e++) {
   const x = f1(sx(e));
   p.push(`<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + plotH}" stroke="rgba(88,224,144,.1)"/>`,
    `<text class="sc-tk" x="${x}" y="${H - 11}" text-anchor="middle">${esc(fmtUsd(10 ** e))}</text>`);
  }
  for (let e = Math.ceil(yLo); e <= Math.floor(yHi); e++) {
   const y = sy(e);
   p.push(`<line x1="${padL}" y1="${f1(y)}" x2="${padL + plotW}" y2="${f1(y)}" stroke="rgba(88,224,144,.1)"/>`,
    `<text class="sc-tk" x="${padL - 7}" y="${f1(y + 3.5)}" text-anchor="end">${esc(fmtUsd(10 ** e))}</text>`);
  }
  p.push(`<text class="sc-ax" x="${f1(padL + plotW / 2)}" y="${H - 1}" text-anchor="middle">TVL (LOG SCALE)</text>`,
   `<text class="sc-ax" x="12" y="${f1(padT + plotH / 2)}" text-anchor="middle" transform="rotate(-90 12 ${f1(padT + plotH / 2)})">IMPLIED (LOG)</text>`);

  let medLine = null;
  if (MS && isNum(MS.global_median_multiple) && MS.global_median_multiple > 0) {
   const lm = Math.log10(MS.global_median_multiple);
   const lx1 = Math.max(xLo, yLo - lm), lx2 = Math.min(xHi, yHi - lm);
   if (lx2 > lx1) {
    medLine = { x1: sx(lx1), y1: sy(lx1 + lm), x2: sx(lx2), y2: sy(lx2 + lm) };
    p.push(`<line x1="${f1(medLine.x1)}" y1="${f1(medLine.y1)}" x2="${f1(medLine.x2)}" y2="${f1(medLine.y2)}" stroke="rgba(127,247,178,.36)" stroke-dasharray="4 4"/>`);
   }
  }

  const drawDot = (r) => {
   const x = sx(Math.log10(r.tvl_usd)), y = sy(Math.log10(r.implied_value_usd));
   const top = r.rank <= 5, ok = !hasFilter || matched.has(r.slug);
   const op = ok ? (top ? 1 : r.watchlist ? 0.92 : 0.6) : 0.14;
   const sl = esc(r.slug);
   if (r.watchlist) {
    const s = top ? 4.4 : 3.4;
    const pts = `${f1(x)},${f1(y - s)} ${f1(x + s)},${f1(y)} ${f1(x)},${f1(y + s)} ${f1(x - s)},${f1(y)}`;
    if (top) p.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="7" fill="none" stroke="rgba(245,176,56,.58)" stroke-width="1.2" opacity="${op}"/>`);
    p.push(`<polygon class="pt" data-slug="${sl}" points="${pts}" fill="#f5b038" stroke="#050a07" stroke-width=".7" opacity="${op}"/>`);
   } else {
    if (top) p.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="7" fill="none" stroke="rgba(59,242,138,.64)" stroke-width="1.2" opacity="${op}"/>`);
    p.push(`<circle class="pt" data-slug="${sl}" cx="${f1(x)}" cy="${f1(y)}" r="${top ? 4.2 : 2.9}" fill="${top ? '#3bf28a' : '#58e090'}" stroke="#050a07" stroke-width=".6" opacity="${op}"/>`);
   }
  };
  for (const r of valid) if (!r.watchlist) drawDot(r);
  for (const r of valid) if (r.watchlist) drawDot(r);

  const placed = [];
  const hits = (b) => placed.some((q) => !(b.x2 + 4 < q.x1 || b.x1 - 4 > q.x2 || b.y2 + 3 < q.y1 || b.y1 - 3 > q.y2));
  for (const r of valid.slice(0, 5)) {
   const px = sx(Math.log10(r.tvl_usd)), py = sy(Math.log10(r.implied_value_usd));
   const nm = r.name.length > 25 ? `${r.name.slice(0, 23)}\u2026` : r.name;
   const txt = `#${r.rank} ${nm}`, bw = txt.length * 6.2 + 10, bh = 15;
   const cands = [
    [px - 10 - bw, py - bh / 2], [px + 10, py - bh / 2], [px - 10 - bw, py - bh - 5],
    [px - 10 - bw, py + 7], [px + 10, py - bh - 5], [px + 10, py + 7],
    [px - 14 - bw, py + 23], [px - 14 - bw, py - bh - 20], [px - bw / 2, py + 12],
    [px - bw / 2, py - bh - 12], [px - 18 - bw, py + 39],
   ];
   let box = null;
   for (const [cx, cy] of cands) {
    const x1 = Math.max(padL + 3, Math.min(W - padR - 3 - bw, cx));
    const y1 = Math.max(padT + 2, Math.min(padT + plotH - 2 - bh, cy));
    const b = { x1, y1, x2: x1 + bw, y2: y1 + bh };
    if (!hits(b)) { box = b; break; }
   }
   if (!box) {
    const x1 = Math.max(padL + 3, Math.min(W - padR - 3 - bw, px - 10 - bw));
    const y1 = Math.max(padT + 2, Math.min(padT + plotH - 2 - bh, py + placed.length * 17));
    box = { x1, y1, x2: x1 + bw, y2: y1 + bh };
   }
   placed.push(box);
   const lx = px < box.x1 ? box.x1 : px > box.x2 ? box.x2 : box.x1 + bw / 2;
   const ly = py < box.y1 ? box.y1 : py > box.y2 ? box.y2 : box.y1 + bh / 2;
   const lop = !hasFilter || matched.has(r.slug) ? 1 : 0.3;
   const st = r.watchlist ? 'rgba(245,176,56,.62)' : 'rgba(127,247,178,.54)';
   const tc = r.watchlist ? '#f5b038' : '#e8f5ed';
   p.push(`<g opacity="${lop}"><line x1="${f1(px)}" y1="${f1(py)}" x2="${f1(lx)}" y2="${f1(ly)}" stroke="${st}" stroke-width=".9"/><rect x="${f1(box.x1)}" y="${f1(box.y1)}" width="${f1(bw)}" height="${bh}" rx="3" fill="rgba(5,10,7,.88)" stroke="${st}" stroke-width=".7"/><text class="pt sc-lb" data-slug="${esc(r.slug)}" x="${f1(box.x1 + 5)}" y="${f1(box.y1 + 11)}" fill="${tc}">${esc(txt)}</text></g>`);
  }

  if (medLine) {
   const lbl = `Global med ${fmtMultS(MS.global_median_multiple)}`, lw = lbl.length * 6.2;
   let my = Math.min(padT + plotH - 6, medLine.y2 + 16);
   const mx = medLine.x2 - 6;
   while (my < padT + plotH - 5 && hits({ x1: mx - lw, y1: my - 11, x2: mx, y2: my + 2 })) my += 14;
   p.push(`<text class="sc-tk" x="${f1(mx)}" y="${f1(my)}" text-anchor="end" fill="rgba(127,247,178,.68)">${esc(lbl)}</text>`);
  }
  return `<svg class="scatter-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Log TVL versus log implied value scatter plot for ${valid.length} protocols">${p.join('')}</svg>`;
 }

 function mountBoardShell() {
  const catOpts = `<option value="">All categories (${categories.length})</option>` + categories.map((c) => `<option value="${esc(c)}">${esc(c)} (${catCounts[c]})</option>`).join('');
  const chainOpts = `<option value="">All chains (${chains.length})</option>` + chains.map((c) => `<option value="${esc(c)}">${esc(c)} (${chainCounts[c]})</option>`).join('');
  const sth = (k, lbl, num) => `<th${num ? ' class="col-num"' : ''}><button type="button" class="sort-btn" data-sort="${k}">${lbl} <span class="sort-arrow" aria-hidden="true"></span></button></th>`;
  const cols = ['rank', 'proto', 'cat', 'tvl', 'chg', 'val', 'ratio', 'prior', 'farm'].map((c) => `<col class="col-${c}">`).join('');

  appEl.innerHTML =
   renderModelStrip() +
   `<section class="scatter-panel" aria-label="TVL vs Implied Value scatter plot"><div class="scatter-head"><h2 class="scatter-title">TVL vs Implied Value <span class="scatter-sub">${rowsByRank.length} protocols &middot; log-log scale &middot; click any point to inspect</span></h2><div class="scatter-legend"><span class="leg-item"><span class="leg-dot"></span>Protocol</span><span class="leg-item">${WDOT}Watchlist</span><span class="leg-item"><span class="leg-top"></span>Top 5</span><span class="leg-item"><span class="leg-line"></span>Global median</span></div></div><div class="scatter-wrap" id="scatter-wrap"></div><div class="scatter-tip" id="scatter-tip" hidden></div></section>` +
   `<section class="controls-panel" aria-label="Filter protocols"><div class="field field-search"><label class="field-label" for="f-search">Search</label><input id="f-search" class="input" type="search" placeholder="Filter by protocol name or slug..." autocomplete="off"></div><div class="field"><label class="field-label" for="f-cat">Category</label><select id="f-cat" class="select">${catOpts}</select></div><div class="field"><label class="field-label" for="f-chain">Chain</label><select id="f-chain" class="select">${chainOpts}</select></div><div class="field"><label class="field-label" for="f-min-tvl">Min TVL</label><select id="f-min-tvl" class="select"><option value="0">Any TVL</option><option value="10000000">$10M+</option><option value="50000000">$50M+</option><option value="250000000">$250M+</option></select></div><label class="watch-toggle" id="f-watch-wrap"><input id="f-watch" type="checkbox">${WDOT}<span>Watchlist only</span></label></section>` +
   `<div class="status-bar"><div class="match-summary" id="match-summary"></div><div class="status-actions"><span class="legend-chip">${WDOT}Amber bar = watchlist target</span><button type="button" class="btn-reset" id="btn-reset" hidden>Reset filters</button></div></div>` +
   `<section class="table-frame" aria-label="Ranked pre-token protocols"><table class="radar-table"><colgroup>${cols}</colgroup><thead><tr>${sth('rank', 'Rank')}<th><span class="th-static">Protocol</span></th><th><span class="th-static">Category</span></th>${sth('tvl', 'TVL', 1)}${sth('change', '7d Chg', 1)}${sth('implied', 'Implied (Range)', 1)}<th class="col-num"><span class="th-static">Per $1 TVL</span></th>${sth('prior', 'Launch %', 1)}${sth('farm', 'Farm Score', 1)}</tr></thead><tbody id="board-tbody"></tbody></table></section>`;

  dom = {
   scatterWrap: $('scatter-wrap'), scatterTip: $('scatter-tip'), search: $('f-search'),
   cat: $('f-cat'), chain: $('f-chain'), minTvl: $('f-min-tvl'), watch: $('f-watch'),
   watchWrap: $('f-watch-wrap'), matchSummary: $('match-summary'), resetBtn: $('btn-reset'),
   tbody: $('board-tbody'), sortBtns: appEl.querySelectorAll('.sort-btn'),
  };

  dom.search.addEventListener('input', () => { state.q = dom.search.value; renderBoardRows(); });
  dom.cat.addEventListener('change', () => { state.cat = dom.cat.value; syncBoardHash(); renderBoardRows(); });
  dom.chain.addEventListener('change', () => { state.chain = dom.chain.value; renderBoardRows(); });
  dom.minTvl.addEventListener('change', () => { state.minTvl = Number(dom.minTvl.value) || 0; renderBoardRows(); });
  dom.watch.addEventListener('change', () => { state.watch = dom.watch.checked; syncBoardHash(); renderBoardRows(); });
  dom.resetBtn.addEventListener('click', () => {
   state.q = state.cat = state.chain = ''; state.watch = false; state.minTvl = 0;
   syncControlsFromState(); syncBoardHash(); renderBoardRows();
  });
  for (const btn of dom.sortBtns) {
   btn.addEventListener('click', () => {
    const k = btn.dataset.sort;
    if (state.sortKey === k) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    else { state.sortKey = k; state.sortDir = k === 'rank' ? 'asc' : 'desc'; }
    renderBoardRows();
   });
  }
  dom.scatterWrap.addEventListener('mousemove', (ev) => {
   const t = ev.target.closest('.pt[data-slug]');
   if (!t) { dom.scatterTip.hidden = true; return; }
   const r = rowBySlug.get(t.dataset.slug);
   if (!r) return;
   dom.scatterTip.innerHTML = `<strong>#${r.rank} ${esc(r.name)}</strong> (${esc(r.category)})<br>TVL ${fmtUsd(r.tvl_usd)} &middot; Implied ${fmtUsd(r.implied_value_usd)} (${fmtUsd(r.implied_low_usd)}\u2013${fmtUsd(r.implied_high_usd)})<br>Launch ${fmtPrior(r.launch_prior)} &middot; Farm ${r.farm_score}/100`;
   const rect = dom.scatterWrap.parentElement.getBoundingClientRect();
   let left = ev.clientX - rect.left + 12, top = Math.max(6, ev.clientY - rect.top - 10);
   dom.scatterTip.hidden = false;
   const tw = dom.scatterTip.offsetWidth || 240;
   if (left + tw > rect.width - 8) left = Math.max(8, ev.clientX - rect.left - tw - 12);
   dom.scatterTip.style.left = `${left}px`; dom.scatterTip.style.top = `${top}px`;
  });
  dom.scatterWrap.addEventListener('mouseleave', () => { dom.scatterTip.hidden = true; });
  dom.scatterWrap.addEventListener('click', (ev) => {
   const t = ev.target.closest('.pt[data-slug]');
   if (t) window.location.hash = `#/protocol/${encodeURIComponent(t.dataset.slug)}`;
  });
  const openRow = (ev) => {
   const tr = ev.target.closest('tr[data-slug]');
   if (tr && !ev.target.closest('a')) window.location.hash = `#/protocol/${encodeURIComponent(tr.dataset.slug)}`;
  };
  dom.tbody.addEventListener('click', openRow);
  dom.tbody.addEventListener('keydown', (ev) => {
   if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.closest('tr[data-slug]') && !ev.target.closest('a')) {
    ev.preventDefault(); openRow(ev);
   }
  });
  boardMounted = true;
 }

 function syncControlsFromState() {
  if (!boardMounted) return;
  if (dom.search.value !== state.q) dom.search.value = state.q;
  dom.cat.value = catCounts[state.cat] ? state.cat : '';
  dom.chain.value = chainCounts[state.chain] ? state.chain : '';
  dom.minTvl.value = String(state.minTvl);
  dom.watch.checked = state.watch;
  dom.watchWrap.classList.toggle('is-active', state.watch);
 }

 function getFilteredAndSorted() {
  const q = state.q.trim().toLowerCase();
  const out = rowsByRank.filter((r) => {
   if (state.watch && !r.watchlist) return false;
   if (state.cat && (r.category || 'Uncategorized') !== state.cat) return false;
   if (state.chain && (!Array.isArray(r.chains) || !r.chains.includes(state.chain))) return false;
   if (state.minTvl > 0 && (r.tvl_usd || 0) < state.minTvl) return false;
   if (q && !`${r.name || ''} ${r.slug || ''}`.toLowerCase().includes(q)) return false;
   return true;
  });
  const dir = state.sortDir === 'asc' ? 1 : -1, k = state.sortKey;
  const nm = { tvl: 'tvl_usd', implied: 'implied_value_usd', prior: 'launch_prior', farm: 'farm_score' };
  out.sort((a, b) => {
   if (k === 'rank') return (a.rank - b.rank) * dir;
   if (nm[k]) return ((a[nm[k]] || 0) - (b[nm[k]] || 0)) * dir || a.rank - b.rank;
   if (k === 'change') {
    const an = !isNum(a.change_7d), bn = !isNum(b.change_7d);
    return an && bn ? a.rank - b.rank : an ? 1 : bn ? -1 : (a.change_7d - b.change_7d) * dir || a.rank - b.rank;
   }
   return a.rank - b.rank;
  });
  return out;
 }

 function renderBoardRows() {
  if (!boardMounted) return;
  dom.watchWrap.classList.toggle('is-active', state.watch);
  watchLinkEl.classList.toggle('is-active', state.watch);

  const filtered = getFilteredAndSorted();
  const hasFilter = Boolean(state.q.trim() || state.cat || state.chain || state.watch || state.minTvl > 0);
  dom.resetBtn.hidden = !hasFilter;
  dom.scatterWrap.innerHTML = buildScatterSvg(new Set(filtered.map((r) => r.slug)), hasFilter);
  dom.scatterTip.hidden = true;

  const parts = [`Showing <strong>${filtered.length}</strong> of ${rowsByRank.length} protocols`];
  if (state.cat) parts.push(`Category: ${esc(state.cat)}`);
  if (state.chain) parts.push(`Chain: ${esc(state.chain)}`);
  if (state.minTvl > 0) parts.push(`TVL ${fmtUsd(state.minTvl)}+`);
  if (state.watch) parts.push('Watchlist only');
  dom.matchSummary.innerHTML = parts.join(' &middot; ');

  for (const btn of dom.sortBtns) {
   const act = btn.dataset.sort === state.sortKey;
   btn.classList.toggle('is-sorted', act);
   btn.querySelector('.sort-arrow').textContent = act ? (state.sortDir === 'asc' ? '\u25b2' : '\u25bc') : '\u21c5';
   if (act) btn.parentElement.setAttribute('aria-sort', state.sortDir === 'asc' ? 'ascending' : 'descending');
   else btn.parentElement.removeAttribute('aria-sort');
  }

  if (!filtered.length) {
   dom.tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state"><p>No protocols match the current filters.</p></div></td></tr>';
   return;
  }

  const tn = (v, c = '', t = '') => `<td class="cell-num num${c}"${t}>${v}</td>`;
  dom.tbody.innerHTML = filtered.map((r) => {
   const ch0 = r.chains && r.chains.length ? r.chains[0] : 'Multi-chain';
   const ex = r.chains && r.chains.length > 1 ? `<span class="chain-extra">+${r.chains.length - 1}</span>` : '';
   const cc = !isNum(r.change_7d) ? ' chg-flat' : r.change_7d > 0 ? ' chg-pos' : r.change_7d < 0 ? ' chg-neg' : ' chg-flat';
   const wh = r.watchlist ? `<span class="watch-badge">${WDOT}Watch</span>` : '';
   const rng = `${fmtUsd(r.implied_low_usd)}\u2013${fmtUsd(r.implied_high_usd)}`;
   const sc = isNum(r.farm_score) ? Math.max(0, Math.min(100, Math.round(r.farm_score))) : 0;
   return `<tr class="${r.watchlist ? 'is-watch' : ''}" data-slug="${esc(r.slug)}" tabindex="0"><td class="cell-rank num">#${r.rank}</td><td><div class="proto-cell"><div class="proto-name-row"><a class="proto-link" href="#/protocol/${encodeURIComponent(r.slug)}">${esc(r.name)}</a>${wh}</div><div class="proto-chain">${esc(ch0)}${ex}</div></div></td><td><span class="cat-tag" title="${esc(r.category)}">${esc(r.category)}</span></td>${tn(fmtUsd(r.tvl_usd))}${tn(fmtPct(r.change_7d), cc)}${tn(`<span class="val-main">${fmtUsd(r.implied_value_usd)}</span><span class="val-range">${esc(rng)}</span>`, ' cell-implied', ` title="p25\u2013p75 range: ${esc(rng)}"`)}${tn(fmtRatio(r.implied_value_usd, r.tvl_usd), ' cell-ratio')}${tn(fmtPrior(r.launch_prior), ' cell-prior')}${tn(`<div class="farm-cell" title="Farm score ${sc}/100"><span class="farm-bar" aria-hidden="true"><span class="farm-fill" style="width:${sc}%"></span></span><span class="farm-num">${sc}</span></div>`)}</tr>`;
  }).join('');
 }

 function renderMultBar(m) {
  const d = isNum(m) ? m - 1 : 0, w = Math.min(50, Math.max(2.5, (Math.abs(d) / 0.2) * 50));
  const cls = d > 0.0005 ? 'bar-fill bar-fill-pos' : d < -0.0005 ? 'bar-fill bar-fill-neg' : 'bar-fill bar-fill-flat';
  const st = d > 0.0005 ? `left:50%;width:${w.toFixed(1)}%` : d < -0.0005 ? `left:${(50 - w).toFixed(1)}%;width:${w.toFixed(1)}%` : 'left:49%;width:2%';
  return `<div class="bar-track" aria-hidden="true"><span class="bar-zero"></span><span class="${cls}" style="${st}"></span></div>`;
 }

 function renderRangeBar(row, catStats) {
  const lo = Math.max(1, row.implied_low_usd || row.implied_value_usd || 1);
  const hi = Math.max(lo * 1.01, row.implied_high_usd || row.implied_value_usd || 1);
  const mid = Math.max(lo, Math.min(hi, row.implied_value_usd || lo));
  const span = Math.log10(hi) - Math.log10(lo);
  const pct = Math.max(3, Math.min(97, span > 0 ? ((Math.log10(mid) - Math.log10(lo)) / span) * 100 : 50));
  const peers = catStats ? `${catStats.peers} tokenised ${catStats.peers === 1 ? 'peer' : 'peers'}` : 'category peers';
  return `<div class="signal-card"><div class="signal-head"><span class="stat-label">Implied Range (Log Scale)</span><span class="stat-sub">${(hi / lo).toFixed(1)}&times; band &middot; ${esc(peers)}</span></div><div class="range-bar-box"><div class="range-track" role="img" aria-label="Log scale range ${esc(fmtUsd(lo))} low to ${esc(fmtUsd(hi))} high, headline ${esc(fmtUsd(mid))}"><span class="range-fill-seg" style="width:${pct.toFixed(1)}%"></span><span class="range-mid-tick" style="left:50%" title="Geometric midpoint"></span><span class="range-marker" style="left:${pct.toFixed(1)}%" title="Headline ${esc(fmtUsd(mid))}"></span></div><div class="range-ends"><span>LOW (p25) <strong>${fmtUsd(lo)}</strong></span><span class="range-hl">HEADLINE ${fmtUsd(mid)}</span><span>HIGH (p75) <strong>${fmtUsd(hi)}</strong></span></div></div><p class="signal-desc">Positioned on a log<sub>10</sub> scale between category p25 and p75 peer multiples.</p></div>`;
 }

 function renderDetailView(slug) {
  boardMounted = false;
  watchLinkEl.classList.remove('is-active');
  const row = rowBySlug.get(slug);
  if (!row) {
   appEl.innerHTML = `<div class="detail-topbar"><a class="back-link" href="#/"><span class="ui-arrow">&larr;</span> Back to board</a></div><section class="notice-card"><h2>Protocol not found</h2><p>No protocol with slug <code>${esc(slug)}</code> exists in this snapshot.</p></section>`;
   return;
  }

  const idx = row.rank - 1, prev = idx > 0 ? rowsByRank[idx - 1] : null, next = idx < rowsByRank.length - 1 ? rowsByRank[idx + 1] : null;
  const age = daysBetween(row.listed_at, DATA.as_of);
  const cc = !isNum(row.change_7d) ? 'chg-flat' : row.change_7d > 0 ? 'chg-pos' : row.change_7d < 0 ? 'chg-neg' : 'chg-flat';
  const baseVal = (row.tvl_usd || 0) * (row.multiple_used || 0);
  const rChains = Array.isArray(row.chains) ? row.chains : [];
  const catStats = MS && MS.categories ? MS.categories[row.category] : null;
  const sc = isNum(row.farm_score) ? Math.max(0, Math.min(100, Math.round(row.farm_score))) : 0;
  const plan = parsePlan(row);

  const multRows = [
   { n: 'Momentum', d: isNum(row.change_7d) ? `7d TVL change ${fmtPct(row.change_7d)}` : '7d TVL change unavailable', m: row.momentum_mult },
   { n: 'Maturity', d: age !== null ? `${age.toLocaleString('en-US')} days since ${row.listed_at}` : 'Listing date unavailable', m: row.maturity_mult },
  ];
  if (isNum(row.breadth_mult)) multRows.push({ n: 'Chain Breadth', d: `${rChains.length} ${rChains.length === 1 ? 'chain' : 'chains'} (${rChains.length >= 3 ? 'multi-chain uplift' : 'baseline'})`, m: row.breadth_mult });
  const multHtml = multRows.map((it) => {
   const dc = it.m > 1.0005 ? 'chg-pos' : it.m < 0.9995 ? 'chg-neg' : 'chg-flat';
   return `<div class="bd-row"><div><div class="bd-name">${esc(it.n)}</div><div class="bd-desc">${esc(it.d)}</div></div>${renderMultBar(it.m)}<div class="bd-val num">${fmtFac(it.m)}<span class="bd-delta ${dc}">${fmtDelta(it.m)}</span></div></div>`;
  }).join('');

  const steps = Array.isArray(row.farm_steps) ? row.farm_steps : [];
  const tot = String(steps.length).padStart(2, '0');
  const stepsHtml = steps.map((st, i) => {
   const n = String(i + 1).padStart(2, '0');
   return `<li class="timeline-item"><div class="timeline-node" aria-hidden="true">${n}</div><div class="timeline-card"><div class="timeline-step-label">Step ${n} of ${tot}</div><p class="timeline-text">${esc(st)}</p></div></li>`;
  }).join('');

  const stat = (lbl, main, sub, cls = '', mcls = '') => `<div class="stat-block${cls}"><span class="stat-label">${lbl}</span><span class="stat-main num${mcls}">${main}</span><span class="stat-sub">${sub}</span></div>`;
  const pager = (t, isNext) => {
   const dir = isNext ? 'Next by rank <span class="ui-arrow">&rarr;</span>' : '<span class="ui-arrow">&larr;</span> Previous by rank';
   const cls = `pager-link${isNext ? ' pager-next' : ''}`;
   if (!t) return `<div class="${cls} pager-disabled"><span class="pager-dir">${dir}</span><span class="pager-name">${isNext ? 'End of board' : 'Top of board'}</span><span class="pager-meta">Rank #${isNext ? rowsByRank.length : 1}</span></div>`;
   return `<a class="${cls}" href="#/protocol/${encodeURIComponent(t.slug)}"><span class="pager-dir">${dir}</span><span class="pager-name">#${t.rank} &middot; ${esc(t.name)}</span><span class="pager-meta">${fmtUsd(t.implied_value_usd)} implied &middot; ${esc(t.category)}</span></a>`;
  };

  appEl.innerHTML =
   `<div class="detail-topbar"><a class="back-link" href="#/"><span class="ui-arrow">&larr;</span> Back to board</a><span class="rank-pill">BOARD RANK <strong>#${row.rank}</strong> / ${rowsByRank.length}</span></div>` +
   `<section class="detail-hero"><div class="detail-title-row"><h2 class="detail-title">${esc(row.name)}</h2>${row.watchlist ? `<span class="watch-badge">${WDOT}Watchlist</span>` : ''}<span class="detail-slug">${esc(row.slug)}</span></div><div class="detail-taxonomy"><a class="cat-link" href="#/?cat=${encodeURIComponent(row.category)}" title="Filter board by category">${esc(row.category)}</a>${rChains.map((c, i) => `<span class="chain-chip${i === 0 ? ' chain-chip-primary' : ''}">${esc(c)}</span>`).join('')}</div></section>` +
   `<section class="stat-grid" aria-label="Protocol metrics">${stat('Total Value Locked', fmtUsd(row.tvl_usd), fmtUsdExact(row.tvl_usd))}${stat('7-Day TVL Change', fmtPct(row.change_7d), `Snapshot ${esc(DATA.as_of)}`, '', ` ${cc}`)}${stat('Listed Date &amp; Age', esc(row.listed_at || 'Unlisted'), esc(age !== null ? `${age.toLocaleString('en-US')} days tracked` : 'Default maturity factor'))}${stat('Implied Value', fmtUsd(row.implied_value_usd), `Range ${fmtUsd(row.implied_low_usd)}&ndash;${fmtUsd(row.implied_high_usd)} &middot; ${fmtRatio(row.implied_value_usd, row.tvl_usd)}/$1 TVL`, ' stat-block-highlight', ' kpi-green')}</section>` +
   `<section class="signal-grid" aria-label="Valuation range and launch signals">${renderRangeBar(row, catStats)}` +
   `<div class="signal-card"><div class="signal-head"><span class="stat-label">Launch Prior</span><span class="stat-sub">${esc(row.category)}</span></div><div class="signal-val-row"><span class="signal-val num">${fmtPrior(row.launch_prior)}</span><span class="signal-bar" aria-hidden="true"><span class="signal-bar-fill" style="width:${Math.max(0, Math.min(100, row.launch_prior || 0)).toFixed(1)}%"></span></span></div><p class="signal-desc">Share of &ge;$5M TVL peers in ${esc(row.category)} that have already launched a token.</p></div>` +
   `<div class="signal-card"><div class="signal-head"><span class="stat-label">Farm Score</span><span class="stat-sub">1&ndash;100 board scale</span></div><div class="signal-val-row"><span class="signal-val num kpi-green">${sc}<span class="stat-sub"> / 100</span></span><span class="signal-bar" aria-hidden="true"><span class="signal-bar-fill" style="width:${sc}%"></span></span></div><p class="signal-desc">Log-scaled expected upside per farming dollar (implied value &times; launch prior &divide; tier capital).</p></div></section>` +
   `<div class="detail-columns"><section class="panel" aria-label="Why this value"><h3 class="panel-title">Why this value</h3><p class="panel-subtitle">Factor-by-factor derivation from snapshot TVL and peer multiples.</p><div class="breakdown-list"><div class="bd-row bd-row-base"><div><div class="bd-name">Base Valuation</div><div class="bd-desc">${fmtUsd(row.tvl_usd)} TVL &times; ${fmtMult(row.multiple_used)} shrunk ${esc(row.category)} multiple</div></div><div class="bd-val num">${fmtUsd(baseVal)}</div></div>${multHtml}<div class="bd-row bd-row-total"><div><div class="bd-name">Implied Launch Value</div><div class="bd-desc">${fmtRatio(row.implied_value_usd, row.tvl_usd)} per $1 of TVL &middot; ${fmtUsdExact(row.implied_value_usd)}</div></div><div class="bd-val num">${fmtUsd(row.implied_value_usd)}</div></div></div><p class="bd-footnote">Bars compare each multiplier against a 1.000&times; neutral baseline (&minus;20% to +20% visual scale).</p></section>` +
   `<section class="panel" aria-label="Farm plan"><h3 class="panel-title">Farm plan</h3><p class="panel-subtitle">Actionable onboarding and ongoing cadence tailored to ${esc(row.name)}.</p><div class="plan-summary" aria-label="Farm plan summary"><span>TOTAL CAPITAL <strong>${esc(plan.cap)}</strong></span><span>TOTAL TIME <strong>${esc(plan.time)}</strong></span><span>CHAIN <strong>${esc(rChains[0] || 'Ethereum')}</strong></span></div><ol class="timeline">${stepsHtml}</ol></section></div>` +
   `<nav class="rank-pager" aria-label="Adjacent protocols by rank">${pager(prev, false)}${pager(next, true)}</nav>`;
  window.scrollTo(0, 0);
 }

 function onRoute() {
  const r = parseHash();
  state.view = r.view;
  if (r.view === 'detail') { state.slug = r.slug; renderDetailView(r.slug); return; }
  state.slug = null; state.cat = r.cat; state.watch = r.watch; state.q = state.chain = ''; state.minTvl = 0;
  if (!boardMounted) mountBoardShell();
  syncControlsFromState();
  renderBoardRows();
 }

 window.addEventListener('hashchange', onRoute);
 onRoute();
})();
