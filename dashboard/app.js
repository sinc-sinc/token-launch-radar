(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const appEl = $('app');
  const watchLinkEl = $('stat-watch-link');
  const DATA = window.RADAR_DATA;

  const esc = (v) =>
    String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const fmtUsd = (n) => {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '--';
    const sign = n < 0 ? '-' : '';
    const v = Math.abs(n);
    const fmt = (val, unit) =>
      `${sign}$${val >= 100 ? val.toFixed(0) : val >= 10 ? val.toFixed(1) : val.toFixed(2)}${unit}`;
    if (v >= 1e9) return fmt(v / 1e9, 'B');
    if (v >= 1e6) return fmt(v / 1e6, 'M');
    if (v >= 1e3) return fmt(v / 1e3, 'K');
    return `${sign}$${Math.round(v)}`;
  };

  const fmtUsdExact = (n) =>
    typeof n === 'number' && Number.isFinite(n) ? `$${Math.round(n).toLocaleString('en-US')}` : '--';

  const fmtPct = (n) =>
    typeof n === 'number' && Number.isFinite(n) ? `${n > 0 ? '+' : ''}${n.toFixed(1)}%` : '\u2014';

  const fmtRatio = (implied, tvl) =>
    typeof implied === 'number' && typeof tvl === 'number' && tvl > 0 ? `$${(implied / tvl).toFixed(2)}` : '--';

  const fmtBaseMult = (m) => {
    if (typeof m !== 'number' || !Number.isFinite(m)) return '--';
    return `${m >= 10 ? m.toFixed(2) : m >= 1 ? m.toFixed(3) : m.toFixed(4)}\u00d7`;
  };

  const fmtFactor = (m) => (typeof m === 'number' && Number.isFinite(m) ? `${m.toFixed(3)}\u00d7` : '--');

  const fmtDeltaPct = (m) => {
    if (typeof m !== 'number' || !Number.isFinite(m)) return '';
    const pct = (m - 1) * 100;
    return Math.abs(pct) < 0.05 ? '0.0%' : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
  };

  const daysBetween = (startIso, endIso) => {
    if (!startIso || !endIso) return null;
    const a = Date.parse(`${startIso}T00:00:00Z`);
    const b = Date.parse(`${endIso}T00:00:00Z`);
    return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / 86400000)) : null;
  };

  if (!DATA || !Array.isArray(DATA.rows)) {
    appEl.innerHTML = `
      <section class="notice-card">
        <h2>Snapshot data not generated yet</h2>
        <p>No <code>window.RADAR_DATA</code> payload was found next to this page. Run the generator to score the snapshot and write <code>zdata.js</code>.</p>
        <pre class="code-block">mkdir -p out &amp;&amp; MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json</pre>
      </section>`;
    return;
  }

  // Precompute indices and summary stats
  const rowsByRank = DATA.rows.slice().sort((a, b) => a.rank - b.rank);
  const rowBySlug = new Map();
  const catCounts = Object.create(null);
  const chainCounts = Object.create(null);
  let watchCount = 0;

  for (const r of rowsByRank) {
    rowBySlug.set(r.slug, r);
    if (r.watchlist) watchCount += 1;
    const cat = r.category || 'Uncategorized';
    catCounts[cat] = (catCounts[cat] || 0) + 1;
    if (Array.isArray(r.chains)) {
      for (const ch of r.chains) chainCounts[ch] = (chainCounts[ch] || 0) + 1;
    }
  }

  const top10Sum = rowsByRank.slice(0, 10).reduce((acc, r) => acc + (r.implied_value_usd || 0), 0);
  const categories = Object.keys(catCounts).sort((a, b) => a.localeCompare(b));
  const chains = Object.keys(chainCounts).sort((a, b) => a.localeCompare(b));

  $('meta-date').textContent = DATA.as_of || '--';
  $('stat-total').textContent = rowsByRank.length.toLocaleString('en-US');
  $('stat-watch').textContent = watchCount.toLocaleString('en-US');
  $('stat-top10').textContent = fmtUsd(top10Sum);
  if (typeof DATA.floor_usd === 'number' && DATA.floor_usd > 0) {
    $('footer-floor').textContent = `TVL FLOOR ${fmtUsd(DATA.floor_usd)}`;
  }

  const state = {
    view: 'board',
    slug: null,
    q: '',
    cat: '',
    chain: '',
    watch: false,
    minTvl: 0,
    sortKey: 'rank',
    sortDir: 'asc',
  };

  let boardMounted = false;
  let dom = {};

  function parseHash() {
    const raw = (window.location.hash || '').replace(/^#/, '');
    if (!raw || raw === '/') return { view: 'board', cat: '', watch: false };
    const protoMatch = raw.match(/^\/protocol\/(.+?)\/?$/);
    if (protoMatch) {
      let slug = protoMatch[1];
      try { slug = decodeURIComponent(slug); } catch (_) { /* keep raw */ }
      return { view: 'detail', slug };
    }
    const qIdx = raw.indexOf('?');
    if (qIdx !== -1) {
      const params = new URLSearchParams(raw.slice(qIdx + 1));
      return { view: 'board', cat: params.get('cat') || '', watch: params.get('watch') === '1' };
    }
    return { view: 'board', cat: '', watch: false };
  }

  function syncBoardHash() {
    const params = new URLSearchParams();
    if (state.cat) params.set('cat', state.cat);
    if (state.watch) params.set('watch', '1');
    const qs = params.toString();
    const target = qs ? `#/?${qs}` : '#/';
    if (window.location.hash !== target) {
      try { window.history.replaceState(null, '', target); } catch (_) { /* noop */ }
    }
  }

  function mountBoardShell() {
    const catOpts = `<option value="">All categories (${categories.length})</option>` +
      categories.map((c) => `<option value="${esc(c)}">${esc(c)} (${catCounts[c]})</option>`).join('');
    const chainOpts = `<option value="">All chains (${chains.length})</option>` +
      chains.map((ch) => `<option value="${esc(ch)}">${esc(ch)} (${chainCounts[ch]})</option>`).join('');

    appEl.innerHTML = `
      <section class="method-panel" aria-label="How the value is derived">
        <div class="method-head">
          <h2 class="method-title">How the value is derived</h2>
          <div class="method-formula"><strong>Implied Value</strong> = TVL &times; Category Multiple &times; Momentum &times; Maturity &times; Breadth</div>
        </div>
        <p class="method-body">
          Each pre-token protocol starts from its category multiple: the median market-cap-to-TVL ratio of already tokenised peers in this same snapshot, shrunk toward the global peer median so thin categories cannot distort estimates.
          That base valuation is then adjusted by 7-day TVL momentum (clamped between &minus;30% and +50% to dampen one-week noise), maturity from time tracked on-chain, and a modest +5% breadth uplift for protocols live on three or more chains.
        </p>
      </section>

      <section class="controls-panel" aria-label="Filter protocols">
        <div class="field field-search">
          <label class="field-label" for="f-search">Search</label>
          <input id="f-search" class="input" type="search" placeholder="Filter by protocol name or slug..." autocomplete="off">
        </div>
        <div class="field">
          <label class="field-label" for="f-cat">Category</label>
          <select id="f-cat" class="select">${catOpts}</select>
        </div>
        <div class="field">
          <label class="field-label" for="f-chain">Chain</label>
          <select id="f-chain" class="select">${chainOpts}</select>
        </div>
        <div class="field">
          <label class="field-label" for="f-min-tvl">Min TVL</label>
          <select id="f-min-tvl" class="select">
            <option value="0">Any TVL</option>
            <option value="10000000">$10M+</option>
            <option value="50000000">$50M+</option>
            <option value="250000000">$250M+</option>
          </select>
        </div>
        <label class="watch-toggle" id="f-watch-wrap">
          <input id="f-watch" type="checkbox">
          <span class="watch-dot" aria-hidden="true"></span>
          <span>Watchlist only</span>
        </label>
      </section>

      <div class="status-bar">
        <div class="match-summary" id="match-summary"></div>
        <div class="status-actions">
          <span class="legend-chip"><span class="watch-dot" aria-hidden="true"></span>Amber bar = watchlist target</span>
          <button type="button" class="btn-reset" id="btn-reset" hidden>Reset filters</button>
        </div>
      </div>

      <section class="table-frame" aria-label="Ranked pre-token protocols">
        <table class="radar-table">
          <colgroup>
            <col class="col-rank"><col class="col-proto"><col class="col-cat">
            <col class="col-tvl"><col class="col-chg"><col class="col-val"><col class="col-ratio">
          </colgroup>
          <thead>
            <tr>
              <th><button type="button" class="sort-btn" data-sort="rank">Rank <span class="sort-arrow" aria-hidden="true"></span></button></th>
              <th><span class="th-static">Protocol</span></th>
              <th><span class="th-static">Category</span></th>
              <th class="col-num"><button type="button" class="sort-btn" data-sort="tvl">TVL <span class="sort-arrow" aria-hidden="true"></span></button></th>
              <th class="col-num"><button type="button" class="sort-btn" data-sort="change">7d Chg <span class="sort-arrow" aria-hidden="true"></span></button></th>
              <th class="col-num"><button type="button" class="sort-btn" data-sort="implied">Implied Value <span class="sort-arrow" aria-hidden="true"></span></button></th>
              <th class="col-num"><span class="th-static">Per $1 TVL</span></th>
            </tr>
          </thead>
          <tbody id="board-tbody"></tbody>
        </table>
      </section>`;

    dom = {
      search: $('f-search'),
      cat: $('f-cat'),
      chain: $('f-chain'),
      minTvl: $('f-min-tvl'),
      watch: $('f-watch'),
      watchWrap: $('f-watch-wrap'),
      matchSummary: $('match-summary'),
      resetBtn: $('btn-reset'),
      tbody: $('board-tbody'),
      sortBtns: appEl.querySelectorAll('.sort-btn'),
    };

    dom.search.addEventListener('input', () => { state.q = dom.search.value; renderBoardRows(); });
    dom.cat.addEventListener('change', () => { state.cat = dom.cat.value; syncBoardHash(); renderBoardRows(); });
    dom.chain.addEventListener('change', () => { state.chain = dom.chain.value; renderBoardRows(); });
    dom.minTvl.addEventListener('change', () => { state.minTvl = Number(dom.minTvl.value) || 0; renderBoardRows(); });
    dom.watch.addEventListener('change', () => { state.watch = dom.watch.checked; syncBoardHash(); renderBoardRows(); });

    dom.resetBtn.addEventListener('click', () => {
      state.q = '';
      state.cat = '';
      state.chain = '';
      state.watch = false;
      state.minTvl = 0;
      syncControlsFromState();
      syncBoardHash();
      renderBoardRows();
    });

    for (const btn of dom.sortBtns) {
      btn.addEventListener('click', () => {
        const key = btn.dataset.sort;
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortKey = key;
          state.sortDir = key === 'rank' ? 'asc' : 'desc';
        }
        renderBoardRows();
      });
    }

    const openRow = (ev) => {
      const tr = ev.target.closest('tr[data-slug]');
      if (!tr || ev.target.closest('a')) return;
      window.location.hash = `#/protocol/${encodeURIComponent(tr.dataset.slug)}`;
    };
    dom.tbody.addEventListener('click', openRow);
    dom.tbody.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        if (ev.target.closest('tr[data-slug]') && !ev.target.closest('a')) {
          ev.preventDefault();
          openRow(ev);
        }
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

  function getFilteredAndSortedRows() {
    const needle = state.q.trim().toLowerCase();
    const out = rowsByRank.filter((r) => {
      if (state.watch && !r.watchlist) return false;
      if (state.cat && (r.category || 'Uncategorized') !== state.cat) return false;
      if (state.chain && (!Array.isArray(r.chains) || !r.chains.includes(state.chain))) return false;
      if (state.minTvl > 0 && (r.tvl_usd || 0) < state.minTvl) return false;
      if (needle && !`${r.name || ''} ${r.slug || ''}`.toLowerCase().includes(needle)) return false;
      return true;
    });

    const dir = state.sortDir === 'asc' ? 1 : -1;
    const key = state.sortKey;
    out.sort((a, b) => {
      if (key === 'rank') return (a.rank - b.rank) * dir;
      if (key === 'tvl') return ((a.tvl_usd || 0) - (b.tvl_usd || 0)) * dir || a.rank - b.rank;
      if (key === 'implied') return ((a.implied_value_usd || 0) - (b.implied_value_usd || 0)) * dir || a.rank - b.rank;
      if (key === 'change') {
        const aNull = typeof a.change_7d !== 'number' || !Number.isFinite(a.change_7d);
        const bNull = typeof b.change_7d !== 'number' || !Number.isFinite(b.change_7d);
        if (aNull && bNull) return a.rank - b.rank;
        if (aNull) return 1;
        if (bNull) return -1;
        return (a.change_7d - b.change_7d) * dir || a.rank - b.rank;
      }
      return a.rank - b.rank;
    });
    return out;
  }

  function renderBoardRows() {
    if (!boardMounted) return;
    dom.watchWrap.classList.toggle('is-active', state.watch);
    watchLinkEl.classList.toggle('is-active', state.watch);

    const filtered = getFilteredAndSortedRows();
    const hasFilter = Boolean(state.q.trim() || state.cat || state.chain || state.watch || state.minTvl > 0);
    dom.resetBtn.hidden = !hasFilter;

    const parts = [`Showing <strong>${filtered.length}</strong> of ${rowsByRank.length} protocols`];
    if (state.cat) parts.push(`Category: ${esc(state.cat)}`);
    if (state.chain) parts.push(`Chain: ${esc(state.chain)}`);
    if (state.minTvl > 0) parts.push(`TVL ${fmtUsd(state.minTvl)}+`);
    if (state.watch) parts.push('Watchlist only');
    dom.matchSummary.innerHTML = parts.join(' &middot; ');

    for (const btn of dom.sortBtns) {
      const active = btn.dataset.sort === state.sortKey;
      btn.classList.toggle('is-sorted', active);
      btn.querySelector('.sort-arrow').textContent = active
        ? (state.sortDir === 'asc' ? '\u25b2' : '\u25bc')
        : '\u21c5';
      if (active) btn.parentElement.setAttribute('aria-sort', state.sortDir === 'asc' ? 'ascending' : 'descending');
      else btn.parentElement.removeAttribute('aria-sort');
    }

    if (filtered.length === 0) {
      dom.tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><p>No protocols match the current filters.</p></div></td></tr>';
      return;
    }

    dom.tbody.innerHTML = filtered.map((r) => {
      const primaryChain = r.chains && r.chains.length ? r.chains[0] : 'Multi-chain';
      const extraChains = r.chains && r.chains.length > 1 ? `<span class="chain-extra">+${r.chains.length - 1}</span>` : '';
      const chgClass = typeof r.change_7d !== 'number' ? 'chg-flat' : r.change_7d > 0 ? 'chg-pos' : r.change_7d < 0 ? 'chg-neg' : 'chg-flat';
      const watchHtml = r.watchlist ? '<span class="watch-badge"><span class="watch-dot" aria-hidden="true"></span>Watch</span>' : '';
      const href = `#/protocol/${encodeURIComponent(r.slug)}`;

      return `<tr class="${r.watchlist ? 'is-watch' : ''}" data-slug="${esc(r.slug)}" tabindex="0">
        <td class="cell-rank num">#${r.rank}</td>
        <td><div class="proto-cell">
          <div class="proto-name-row"><a class="proto-link" href="${href}">${esc(r.name)}</a>${watchHtml}</div>
          <div class="proto-chain">${esc(primaryChain)}${extraChains}</div>
        </div></td>
        <td><span class="cat-tag" title="${esc(r.category)}">${esc(r.category)}</span></td>
        <td class="cell-num num">${fmtUsd(r.tvl_usd)}</td>
        <td class="cell-num num ${chgClass}">${fmtPct(r.change_7d)}</td>
        <td class="cell-num num cell-implied">${fmtUsd(r.implied_value_usd)}</td>
        <td class="cell-num num cell-ratio">${fmtRatio(r.implied_value_usd, r.tvl_usd)}</td>
      </tr>`;
    }).join('');
  }

  function renderMultBar(mult) {
    // Center baseline at 1.00x; +/-20% spans full half-track for clear visual differentiation
    const diff = typeof mult === 'number' && Number.isFinite(mult) ? mult - 1 : 0;
    const width = Math.min(50, Math.max(2.5, (Math.abs(diff) / 0.2) * 50));
    let cls = 'bar-fill bar-fill-flat';
    let style = 'left:49%;width:2%';
    if (diff > 0.0005) {
      cls = 'bar-fill bar-fill-pos';
      style = `left:50%;width:${width.toFixed(1)}%`;
    } else if (diff < -0.0005) {
      cls = 'bar-fill bar-fill-neg';
      style = `left:${(50 - width).toFixed(1)}%;width:${width.toFixed(1)}%`;
    }
    return `<div class="bar-track" aria-hidden="true"><span class="bar-zero"></span><span class="${cls}" style="${style}"></span></div>`;
  }

  function renderDetailView(slug) {
    boardMounted = false;
    watchLinkEl.classList.remove('is-active');
    const row = rowBySlug.get(slug);

    if (!row) {
      appEl.innerHTML = `
        <div class="detail-topbar"><a class="back-link" href="#/"><span class="ui-arrow">&larr;</span> Back to board</a></div>
        <section class="notice-card">
          <h2>Protocol not found</h2>
          <p>No protocol with slug <code>${esc(slug)}</code> exists in this snapshot.</p>
        </section>`;
      return;
    }

    const idx = row.rank - 1;
    const prevRow = idx > 0 ? rowsByRank[idx - 1] : null;
    const nextRow = idx < rowsByRank.length - 1 ? rowsByRank[idx + 1] : null;
    const ageDays = daysBetween(row.listed_at, DATA.as_of);
    const listedText = row.listed_at || 'Unlisted';
    const ageText = ageDays !== null ? `${ageDays.toLocaleString('en-US')} days tracked` : 'Default maturity factor';
    const chgClass = typeof row.change_7d !== 'number' ? 'chg-flat' : row.change_7d > 0 ? 'chg-pos' : row.change_7d < 0 ? 'chg-neg' : 'chg-flat';
    const baseVal = (row.tvl_usd || 0) * (row.multiple_used || 0);
    const rChains = Array.isArray(row.chains) ? row.chains : [];

    const multRows = [
      {
        name: 'Momentum',
        desc: typeof row.change_7d === 'number' ? `7d TVL change ${fmtPct(row.change_7d)}` : '7d TVL change unavailable',
        mult: row.momentum_mult,
      },
      {
        name: 'Maturity',
        desc: ageDays !== null ? `${ageDays.toLocaleString('en-US')} days since ${row.listed_at}` : 'Listing date unavailable',
        mult: row.maturity_mult,
      },
    ];
    if (typeof row.breadth_mult === 'number' && Number.isFinite(row.breadth_mult)) {
      multRows.push({
        name: 'Chain Breadth',
        desc: `${rChains.length} ${rChains.length === 1 ? 'chain' : 'chains'} (${rChains.length >= 3 ? 'multi-chain uplift' : 'baseline'})`,
        mult: row.breadth_mult,
      });
    }

    const multHtml = multRows.map((item) => {
      const dClass = item.mult > 1.0005 ? 'chg-pos' : item.mult < 0.9995 ? 'chg-neg' : 'chg-flat';
      return `<div class="bd-row">
        <div><div class="bd-name">${esc(item.name)}</div><div class="bd-desc">${esc(item.desc)}</div></div>
        ${renderMultBar(item.mult)}
        <div class="bd-val num">${fmtFactor(item.mult)}<span class="bd-delta ${dClass}">${fmtDeltaPct(item.mult)}</span></div>
      </div>`;
    }).join('');

    const steps = Array.isArray(row.farm_steps) ? row.farm_steps : [];
    const totalPad = String(steps.length).padStart(2, '0');
    const stepsHtml = steps.map((step, s) => {
      const numStr = String(s + 1).padStart(2, '0');
      return `<li class="timeline-item">
        <div class="timeline-node" aria-hidden="true">${numStr}</div>
        <div class="timeline-card">
          <div class="timeline-step-label">Step ${numStr} of ${totalPad}</div>
          <p class="timeline-text">${esc(step)}</p>
        </div>
      </li>`;
    }).join('');

    const pagerCard = (target, isNext) => {
      const dirLabel = isNext ? 'Next by rank <span class="ui-arrow">&rarr;</span>' : '<span class="ui-arrow">&larr;</span> Previous by rank';
      const cls = `pager-link${isNext ? ' pager-next' : ''}`;
      if (!target) {
        return `<div class="${cls} pager-disabled"><span class="pager-dir">${dirLabel}</span><span class="pager-name">${isNext ? 'End of board' : 'Top of board'}</span><span class="pager-meta">Rank #${isNext ? rowsByRank.length : 1}</span></div>`;
      }
      return `<a class="${cls}" href="#/protocol/${encodeURIComponent(target.slug)}">
        <span class="pager-dir">${dirLabel}</span>
        <span class="pager-name">#${target.rank} &middot; ${esc(target.name)}</span>
        <span class="pager-meta">${fmtUsd(target.implied_value_usd)} implied &middot; ${esc(target.category)}</span>
      </a>`;
    };

    appEl.innerHTML = `
      <div class="detail-topbar">
        <a class="back-link" href="#/"><span class="ui-arrow">&larr;</span> Back to board</a>
        <span class="rank-pill">BOARD RANK <strong>#${row.rank}</strong> / ${rowsByRank.length}</span>
      </div>

      <section class="detail-hero">
        <div class="detail-title-row">
          <h2 class="detail-title">${esc(row.name)}</h2>
          ${row.watchlist ? '<span class="watch-badge"><span class="watch-dot" aria-hidden="true"></span>Watchlist</span>' : ''}
          <span class="detail-slug">${esc(row.slug)}</span>
        </div>
        <div class="detail-taxonomy">
          <a class="cat-link" href="#/?cat=${encodeURIComponent(row.category)}" title="Filter board by category">${esc(row.category)}</a>
          ${rChains.map((ch, i) => `<span class="chain-chip${i === 0 ? ' chain-chip-primary' : ''}">${esc(ch)}</span>`).join('')}
        </div>
      </section>

      <section class="stat-grid" aria-label="Protocol metrics">
        <div class="stat-block">
          <span class="stat-label">Total Value Locked</span>
          <span class="stat-main num">${fmtUsd(row.tvl_usd)}</span>
          <span class="stat-sub">${fmtUsdExact(row.tvl_usd)}</span>
        </div>
        <div class="stat-block">
          <span class="stat-label">7-Day TVL Change</span>
          <span class="stat-main num ${chgClass}">${fmtPct(row.change_7d)}</span>
          <span class="stat-sub">Snapshot ${esc(DATA.as_of)}</span>
        </div>
        <div class="stat-block">
          <span class="stat-label">Listed Date &amp; Age</span>
          <span class="stat-main num">${esc(listedText)}</span>
          <span class="stat-sub">${esc(ageText)}</span>
        </div>
        <div class="stat-block stat-block-highlight">
          <span class="stat-label">Implied Value</span>
          <span class="stat-main num kpi-green">${fmtUsd(row.implied_value_usd)}</span>
          <span class="stat-sub">Rank #${row.rank} &middot; ${fmtRatio(row.implied_value_usd, row.tvl_usd)} per $1 TVL</span>
        </div>
      </section>

      <div class="detail-columns">
        <section class="panel" aria-label="Why this value">
          <h3 class="panel-title">Why this value</h3>
          <p class="panel-subtitle">Factor-by-factor derivation from snapshot TVL and peer multiples.</p>
          <div class="breakdown-list">
            <div class="bd-row bd-row-base">
              <div>
                <div class="bd-name">Base Valuation</div>
                <div class="bd-desc">${fmtUsd(row.tvl_usd)} TVL &times; ${fmtBaseMult(row.multiple_used)} shrunk ${esc(row.category)} multiple</div>
              </div>
              <div class="bd-val num">${fmtUsd(baseVal)}</div>
            </div>
            ${multHtml}
            <div class="bd-row bd-row-total">
              <div>
                <div class="bd-name">Implied Launch Value</div>
                <div class="bd-desc">${fmtRatio(row.implied_value_usd, row.tvl_usd)} per $1 of TVL &middot; ${fmtUsdExact(row.implied_value_usd)}</div>
              </div>
              <div class="bd-val num">${fmtUsd(row.implied_value_usd)}</div>
            </div>
          </div>
          <p class="bd-footnote">Bars compare each multiplier against a 1.000&times; neutral baseline (&minus;20% to +20% visual scale).</p>
        </section>

        <section class="panel" aria-label="Farm plan">
          <h3 class="panel-title">Farm plan</h3>
          <p class="panel-subtitle">Actionable onboarding and ongoing cadence tailored to ${esc(row.name)}.</p>
          <ol class="timeline">${stepsHtml}</ol>
        </section>
      </div>

      <nav class="rank-pager" aria-label="Adjacent protocols by rank">
        ${pagerCard(prevRow, false)}
        ${pagerCard(nextRow, true)}
      </nav>`;

    window.scrollTo(0, 0);
  }

  function onRoute() {
    const route = parseHash();
    state.view = route.view;

    if (route.view === 'detail') {
      state.slug = route.slug;
      renderDetailView(route.slug);
      return;
    }

    state.slug = null;
    state.cat = route.cat;
    state.watch = route.watch;
    state.q = '';
    state.chain = '';
    state.minTvl = 0;

    if (!boardMounted) mountBoardShell();
    syncControlsFromState();
    renderBoardRows();
  }

  window.addEventListener('hashchange', onRoute);
  onRoute();
})();
