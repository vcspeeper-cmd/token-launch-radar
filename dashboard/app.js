// Token Radar's page. It reads window.RADAR (written beside dashboard/ by main.ts) and renders the
// ranked board, the filters, the histogram and a per-protocol detail view with the model's own
// arithmetic and the protocol's farm plan. No network, no build step, no framework: every byte it
// shows is in data.js and every rule it applies is in this file.
//
// The data is written beside the page's directory, not inside it: main.ts writes <out>/data.js and
// copies dashboard/ to <out>/dashboard/, so the page reaches its data at ../data.js. Keeping the
// generated data out of dashboard/ is deliberate — the dossier shows every source file whole only
// while the dashboard's own source fits in 64 KB, and a megabyte of generated rows would crowd out
// the page's real code.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) {
    document.body.insertAdjacentHTML('afterbegin', '<p style="padding:24px">No data.js beside the page: run main.ts to write it.</p>');
    return;
  }

  var state = {
    q: '',
    status: 'pre',
    tvl: 0,
    sort: 'implied',
    dir: -1,
    categories: new Set(),
    selected: null
  };

  // ---------------------------------------------------------------- formatting

  var usdFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  var intFmt = new Intl.NumberFormat('en-US');

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    var a = Math.abs(n);
    if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFull.format(n);
  }
  function fmtUsdExact(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return usdFull.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 730) return (days / 365).toFixed(1) + 'y';
    if (days >= 365) return '1y ' + Math.round(days - 365) + 'd';
    return Math.round(days) + 'd';
  }
  function fmtFactor(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return '×' + n.toFixed(3);
  }
  function signClass(n) {
    if (n === null || n === undefined || !isFinite(n) || n === 0) return 'muted';
    return n > 0 ? 'pos' : 'neg';
  }

  // The pressure score as a small meter: a number and a bar, so a reader can scan the column.
  function pressureCell(p) {
    if (p === null || p === undefined || !isFinite(p)) return '—';
    var tone = p >= 80 ? 'hot' : p >= 60 ? 'warm' : 'cool';
    return '<span class="pressure" data-tone="' + tone + '">' +
      '<span class="pressure-bar"><i style="width:' + Math.max(2, p).toFixed(0) + '%"></i></span>' +
      '<b>' + p.toFixed(0) + '</b></span>';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------------------------------------------------------------- the model, restated

  // The page recomputes a row's implied value from the snapshot figures and the row's own factors, so
  // the number on screen is visibly the arithmetic in the detail view and not a number from nowhere.
  function recompute(row) {
    var f = row.factors;
    var raw = row.tvl_usd * f.category_multiple * f.growth_factor * (f.momentum_factor || 1) *
      f.maturity_factor * f.breadth_factor * f.size_guard;
    return Math.max(1, Math.round(raw));
  }

  // ---------------------------------------------------------------- filtering and sorting

  function rowsForStatus() {
    if (state.status === 'live') return DATA.live.map(liveAsRow);
    if (state.status === 'all') return DATA.rows.concat(DATA.live.map(liveAsRow));
    return DATA.rows;
  }

  function liveAsRow(l) {
    return {
      rank: null,
      slug: l.slug,
      name: l.name,
      category: l.category,
      chains: l.chains,
      tvl_usd: l.tvl_usd,
      change_7d: l.change_7d,
      listed_at: null,
      age_days: null,
      implied_value_usd: l.mcap_usd,
      multiple: l.market_multiple,
      factors: null,
      confidence: null,
      tokenStatus: 'live',
      farm_steps: [],
      plan: [],
      plan_meta: null,
      market_multiple: l.market_multiple
    };
  }

  function matches(row) {
    if (state.tvl > 0 && row.tvl_usd < state.tvl) return false;
    if (state.categories.size > 0) {
      var cat = row.category || 'Unknown';
      if (!state.categories.has(cat)) return false;
    }
    if (state.q) {
      var q = state.q.toLowerCase();
      var hay = (row.name + ' ' + row.slug + ' ' + (row.category || '') + ' ' + (row.chains || []).join(' ')).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  }

  function sortValue(row, key) {
    switch (key) {
      case 'tvl': return row.tvl_usd;
      case 'growth': return row.change_7d === null || row.change_7d === undefined ? -Infinity : row.change_7d;
      case 'age': return row.age_days === null || row.age_days === undefined ? -1 : row.age_days;
      case 'multiple': return row.multiple === null || row.multiple === undefined ? -1 : row.multiple;
      case 'pressure': return row.pressure === null || row.pressure === undefined ? -1 : row.pressure;
      case 'name': return row.name.toLowerCase();
      default: return row.implied_value_usd === null || row.implied_value_usd === undefined ? -1 : row.implied_value_usd;
    }
  }

  function visibleRows() {
    var rows = rowsForStatus().filter(matches);
    var key = state.sort;
    var dir = state.dir;
    rows.sort(function (a, b) {
      var av = sortValue(a, key);
      var bv = sortValue(b, key);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      // A stable tiebreak on rank, then name, so the order never flickers between renders.
      var ar = a.rank === null ? 1e9 : a.rank;
      var br = b.rank === null ? 1e9 : b.rank;
      if (ar !== br) return ar - br;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    return rows;
  }

  // ---------------------------------------------------------------- render: header and kpis

  function renderMeta() {
    document.getElementById('meta-as-of').textContent = DATA.as_of;
    document.getElementById('meta-source').textContent = DATA.source;
    document.getElementById('meta-model').textContent = DATA.model_version;
    document.getElementById('meta-source').title = DATA.source;

    document.getElementById('kpi-protocols').textContent = intFmt.format(DATA.totals.protocols);
    document.getElementById('kpi-protocols-note').textContent =
      DATA.totals.watchlist + ' on the watchlist, ' + DATA.totals.rows + ' ranked here';

    document.getElementById('kpi-pretoken').textContent = intFmt.format(DATA.totals.rows);
    document.getElementById('kpi-pretoken-note').textContent =
      'record no token; ' + DATA.totals.preToken + ' in the snapshot record none at all';

    document.getElementById('kpi-total').textContent = fmtUsd(DATA.headline.total_implied_usd);
    document.getElementById('kpi-total-note').textContent =
      'median ' + fmtUsd(DATA.headline.median_implied_usd) + ' · rank 1 is ' + DATA.headline.top_name;

    document.getElementById('kpi-live').textContent = intFmt.format(DATA.totals.liveToken);
    document.getElementById('kpi-live-note').textContent = 'already trade, and are never ranked as an opportunity';

    document.getElementById('method-sentence').textContent = DATA.model_sentence;
    document.getElementById('foot-model').textContent =
      'Model ' + DATA.model_version + ': ' + DATA.model_sentence;
  }

  // ---------------------------------------------------------------- render: chips

  function renderChips() {
    var host = document.getElementById('chips');
    host.innerHTML = '';
    var cats = DATA.categories.slice(0, 10);
    cats.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.setAttribute('aria-pressed', state.categories.has(c.name) ? 'true' : 'false');
      b.innerHTML = esc(c.name) + ' <b>' + c.count + '</b>';
      b.title = c.name + ': ' + c.count + ' ranked, multiple ×' + c.medianMultiple.toFixed(3) +
        (c.peers > 0 ? ' from ' + c.peers + ' live peers' : ' from the prior');
      b.addEventListener('click', function () {
        if (state.categories.has(c.name)) state.categories.delete(c.name);
        else state.categories.add(c.name);
        render();
      });
      host.appendChild(b);
    });
    document.getElementById('chips-clear').hidden = state.categories.size === 0;
  }

  // ---------------------------------------------------------------- render: table

  function renderTable() {
    var rows = visibleRows();
    var tbody = document.getElementById('tbody');
    var empty = document.getElementById('empty');
    var table = document.getElementById('table');
    var top = DATA.rows.length > 0 ? DATA.rows[0].implied_value_usd : 1;

    document.getElementById('count').textContent =
      rows.length + ' of ' + rowsForStatus().length + ' shown';

    if (rows.length === 0) {
      tbody.innerHTML = '';
      table.hidden = true;
      empty.hidden = false;
      return;
    }
    table.hidden = false;
    empty.hidden = true;

    var html = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var isLive = r.tokenStatus === 'live';
      var share = isLive || !top ? 0 : Math.max(0.6, (r.implied_value_usd / top) * 100);
      var chains = (r.chains || []).slice(0, 3).join(' · ') + ((r.chains || []).length > 3 ? ' +' + (r.chains.length - 3) : '');
      html.push(
        '<tr data-slug="' + esc(r.slug) + '" data-live="' + (isLive ? '1' : '0') + '" tabindex="0" aria-selected="' +
          (state.selected === r.slug ? 'true' : 'false') + '">' +
          '<td class="rank">' + (r.rank === null ? '—' : r.rank) + '</td>' +
          '<td><div class="proto"><b>' + esc(r.name) + (r.on_watchlist ? ' <span class="wl" title="On the house watchlist">watchlist</span>' : '') + '</b><span class="sub">' + esc(chains || 'no chain recorded') + '</span></div></td>' +
          '<td><span class="cat">' + esc(r.category || 'Unknown') + '</span></td>' +
          '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
          '<td class="num ' + signClass(r.change_7d) + '">' + fmtPct(r.change_7d) + '</td>' +
          '<td class="num muted">' + (isLive ? 'trades' : fmtAge(r.age_days)) + '</td>' +
          '<td class="num">' + (isLive ? '—' : pressureCell(r.pressure)) + '</td>' +
          '<td class="num implied">' + (isLive ? fmtUsd(r.implied_value_usd) : fmtUsdExact(r.implied_value_usd)) + '</td>' +
          '<td class="col-bar"><div class="bar-cell">' +
            '<div class="bar"><i style="width:' + share.toFixed(1) + '%"></i></div>' +
            '<div class="bar-pct">' + (isLive ? 'market cap' : share.toFixed(1) + '%') + '</div>' +
          '</div></td>' +
        '</tr>'
      );
    }
    tbody.innerHTML = html.join('');
  }

  // ---------------------------------------------------------------- render: histogram

  function renderHistogram() {
    var host = document.getElementById('hist');
    var buckets = DATA.buckets;
    var max = 1;
    buckets.forEach(function (b) { if (b.count > max) max = b.count; });
    host.innerHTML = buckets.map(function (b) {
      var h = b.count === 0 ? 0 : Math.max(3, (b.count / max) * 100);
      return '<div class="hist-col" title="' + esc(b.label) + ': ' + b.count + ' protocols">' +
        '<div class="hist-bar-wrap"><div class="hist-bar" data-zero="' + (b.count === 0) + '" style="height:' + h.toFixed(1) + '%"></div></div>' +
        '<div class="hist-count">' + b.count + '</div>' +
        '<div class="hist-label">' + esc(b.label) + '</div>' +
      '</div>';
    }).join('');
  }

  // ---------------------------------------------------------------- render: detail

  function findRow(slug) {
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) return DATA.rows[i];
    for (var j = 0; j < DATA.live.length; j++) if (DATA.live[j].slug === slug) return liveAsRow(DATA.live[j]);
    return null;
  }

  function renderDetail(slug) {
    var drawer = document.getElementById('drawer');
    var row = findRow(slug);
    if (!row) { drawer.hidden = true; return; }
    var isLive = row.tokenStatus === 'live';

    document.getElementById('drawer-kicker').textContent = isLive ? 'Already trading' : 'Rank ' + row.rank + ' · pre-token';
    document.getElementById('drawer-title').textContent = row.name;
    document.getElementById('drawer-sub').textContent =
      (row.category || 'Unknown category') + ' · ' + (row.chains || []).join(', ') +
      (row.listed_at ? ' · listed ' + row.listed_at : ' · no listing date');

    var body = [];
    body.push(
      '<div class="d-hero">' +
        '<div><p class="d-hero-label">' + (isLive ? 'Market cap today' : 'Implied value') + '</p>' +
        '<p class="d-hero-value">' + fmtUsdExact(row.implied_value_usd) + '</p></div>' +
        '<div class="d-hero-rank"><p class="d-hero-label">' + (isLive ? 'Status' : 'Rank') + '</p>' +
        '<b>' + (isLive ? 'trades' : '#' + row.rank) + '</b></div>' +
      '</div>'
    );

    body.push('<div class="d-section"><h3>The record</h3><dl class="facts">' +
      fact('TVL', fmtUsdExact(row.tvl_usd)) +
      fact('7-day change', fmtPct(row.change_7d)) +
      fact('Age without a token', isLive ? 'trades' : fmtAge(row.age_days)) +
      fact('Chains', String((row.chains || []).length)) +
      fact('Category', row.category || 'Unknown') +
      fact('Token status', isLive ? 'already trades' : 'records no token') +
      fact('House watchlist', isLive ? 'not applicable' : (row.on_watchlist ? 'yes, on it' : 'no, below or outside it')) +
      '</dl></div>');

    if (!isLive && row.factors) {
      var f = row.factors;
      var recomputed = recompute(row);
      body.push('<div class="d-section"><h3>The arithmetic</h3><div class="equation">' +
        eqRow('TVL', 'the snapshot\'s own figure', '×1.000', fmtUsdExact(row.tvl_usd)) +
        eqRow('Category multiple', f.category_peers > 0 && f.category_observed !== null
          ? 'prior ' + f.category_prior.toFixed(2) + ' blended with ' + f.category_peers + ' live peers at ' + f.category_observed.toFixed(3)
          : 'written prior, no live peers in this category', fmtFactor(f.category_multiple), '') +
        eqRow('Growth factor', '7-day move clamped to ' + f.growth_clamped_pct.toFixed(1) + '%', fmtFactor(f.growth_factor), '') +
        eqRow('Momentum factor', 'signed square root of the same move, so a bleed costs more than a flat week', fmtFactor(f.momentum_factor || 1), '') +
        eqRow('Maturity factor', 'asymmetric log-normal bell on ' + (row.age_days === null ? 'an unknown age' : row.age_days + ' days'), fmtFactor(f.maturity_factor), '') +
        eqRow('Breadth factor', (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's'), fmtFactor(f.breadth_factor), '') +
        eqRow('Dust guard', row.tvl_usd < 25000000 ? 'TVL under $25M, scaled down' : 'TVL above $25M, no penalty', fmtFactor(f.size_guard), '') +
        '<div class="eq-total"><span>Implied value</span><b>' + fmtUsdExact(row.implied_value_usd) + '</b></div>' +
      '</div>' +
      '<p class="confidence-note" style="margin-top:12px">' + recomputeNote(row, recomputed) + '</p>' +
      '</div>');

      body.push('<div class="d-section"><h3>Confidence in the inputs</h3><div class="confidence">' +
        '<div class="confidence-bar"><i style="width:' + row.confidence + '%"></i></div>' +
        '<p class="confidence-note">' + row.confidence + '/100 — a known age, a reported 7-day move, several chains and a real TVL are what make the arithmetic trustworthy. This is confidence in the inputs, never in the price.</p>' +
      '</div></div>');

      body.push('<div class="d-section"><h3>Launch pressure · ' + row.pressure.toFixed(0) + '/100</h3><div class="confidence">' +
        '<div class="confidence-bar"><i style="width:' + row.pressure.toFixed(0) + '%"></i></div>' +
        '<p class="confidence-note">The timing-and-momentum part of the model, normalised against the board\'s most launch-ready row. ' +
        'It is the maturity bell times the growth and momentum factors times the input confidence, with size left out on purpose: ' +
        'a small protocol that is young and growing can out-score a large one that is old and flat. Sort the board by it to see the ' +
        'protocols whose record is moving, not just the biggest ones.</p>' +
      '</div></div>');
    }

    if (isLive) {
      body.push('<div class="d-section"><h3>Why it is not ranked</h3><p class="step-text">' +
        'This protocol records a token, so it has a price and a market cap of ' + fmtUsdExact(row.implied_value_usd) +
        '. A token that already trades is not a launch opportunity: the board ranks only the protocols still to come, and shows this one at the market\'s own multiple of ' +
        (row.market_multiple === null ? '—' : '×' + row.market_multiple.toFixed(3)) + ' against its TVL.</p></div>');
    }

    if (!isLive && row.plan && row.plan.length > 0) {
      body.push('<div class="d-section"><h3>The farm plan · ' + row.plan.length + ' steps</h3>' +
        '<p class="confidence-note" style="margin-bottom:12px">Capital $' + row.plan_meta.capital_usd +
        ' · hold ' + row.plan_meta.hold_days + ' days · ' + row.plan_meta.cadence_per_week +
        ' qualifying action' + (row.plan_meta.cadence_per_week === 1 ? '' : 's') + ' a week · ' +
        row.plan_meta.age_band + ' protocol · ' + row.plan_meta.size_tier + ' TVL tier</p>' +
        '<ol class="steps">' + row.plan.map(function (s) {
          return '<li data-kind="' + esc(s.kind) + '"><div>' +
            '<p class="step-text">' + esc(s.text) + '</p>' +
            '<div class="step-chips"><span class="chip-cost">' + esc(s.cost) + '</span>' +
            '<span class="chip-time">' + esc(s.time) + '</span></div>' +
          '</div></li>';
        }).join('') + '</ol></div>');
    }

    document.getElementById('drawer-body').innerHTML = body.join('');
    drawer.hidden = false;
    document.getElementById('drawer-close').focus({ preventScroll: true });
  }

  function fact(label, value) {
    return '<div class="fact"><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';
  }

  // The page recomputes the row from the factors it shows. The factors are rounded to four places in
  // board.json, so the recomputation lands within a rounding step of the stored value; the note says
  // which it is rather than pretending the two are identical.
  function recomputeNote(row, recomputed) {
    var stored = row.implied_value_usd;
    var diff = Math.abs(recomputed - stored);
    var pct = stored > 0 ? (diff / stored) * 100 : 0;
    if (diff === 0) {
      return 'The page recomputes this row from the factors above and gets ' + fmtUsdExact(recomputed) +
        ', exactly the number board.json carries.';
    }
    return 'The page recomputes this row from the factors above and gets ' + fmtUsdExact(recomputed) +
      ', within ' + pct.toFixed(3) + '% of the ' + fmtUsdExact(stored) + ' board.json carries: the factors are ' +
      'rounded to four places in the file, and the stored value is computed from the unrounded ones.';
  }
  function eqRow(name, note, factor, value) {
    return '<div class="eq-row"><span class="eq-name">' + esc(name) + '<small>' + esc(note) + '</small></span>' +
      '<span class="eq-factor">' + esc(factor) + '</span>' +
      '<span class="eq-value">' + esc(value) + '</span></div>';
  }

  // ---------------------------------------------------------------- wiring

  function render() {
    renderChips();
    renderTable();
    if (state.selected !== null) renderDetail(state.selected);
  }

  function resetFilters() {
    state.q = '';
    state.status = 'pre';
    state.tvl = 0;
    state.sort = 'implied';
    state.dir = -1;
    state.categories.clear();
    document.getElementById('q').value = '';
    document.getElementById('status').value = 'pre';
    document.getElementById('tvl').value = '0';
    document.getElementById('sort').value = 'implied';
    document.getElementById('dir').setAttribute('aria-pressed', 'true');
    document.getElementById('dir').textContent = 'Descending';
    render();
  }

  function openRow(slug) {
    state.selected = slug;
    renderTable();
    renderDetail(slug);
    var hash = '#p=' + encodeURIComponent(slug);
    if (window.location.hash !== hash) history.replaceState(null, '', hash);
  }

  function closeDrawer() {
    state.selected = null;
    document.getElementById('drawer').hidden = true;
    renderTable();
    if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  document.getElementById('q').addEventListener('input', function (e) {
    state.q = e.target.value.trim();
    render();
  });
  document.getElementById('status').addEventListener('change', function (e) {
    state.status = e.target.value;
    render();
  });
  document.getElementById('tvl').addEventListener('change', function (e) {
    state.tvl = Number(e.target.value) || 0;
    render();
  });
  document.getElementById('sort').addEventListener('change', function (e) {
    state.sort = e.target.value;
    render();
  });
  document.getElementById('dir').addEventListener('click', function () {
    state.dir = state.dir === -1 ? 1 : -1;
    var b = document.getElementById('dir');
    b.setAttribute('aria-pressed', state.dir === -1 ? 'true' : 'false');
    b.textContent = state.dir === -1 ? 'Descending' : 'Ascending';
    render();
  });
  document.getElementById('chips-clear').addEventListener('click', function () {
    state.categories.clear();
    render();
  });
  document.getElementById('empty-reset').addEventListener('click', resetFilters);
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);

  document.getElementById('tbody').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) openRow(tr.getAttribute('data-slug'));
  });
  document.getElementById('tbody').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var tr = e.target.closest('tr[data-slug]');
    if (tr) { e.preventDefault(); openRow(tr.getAttribute('data-slug')); }
  });

  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    var typing = tag === 'input' || tag === 'select' || tag === 'textarea';
    if (e.key === 'Escape') { closeDrawer(); return; }
    if (typing) return;
    if (e.key === '/') { e.preventDefault(); document.getElementById('q').focus(); return; }
    if (e.key === 'd' || e.key === 'D') { document.getElementById('dir').click(); return; }
    if (e.key === 'j' || e.key === 'k') {
      // Walk the visible board with j and k, opening each row's detail as you go.
      var rows = visibleRows();
      if (rows.length === 0) return;
      var at = -1;
      for (var i = 0; i < rows.length; i++) if (rows[i].slug === state.selected) { at = i; break; }
      var next = e.key === 'j' ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1);
      if (at === -1) next = 0;
      e.preventDefault();
      openRow(rows[next].slug);
      var el = document.querySelector('tr[data-slug="' + rows[next].slug.replace(/"/g, '\\"') + '"]');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }
  });

  // A hash on load opens that protocol, so a screenshot or a shared link lands on the detail view.
  (function readHash() {
    var m = /(?:^#|&)p=([^&]+)/.exec(window.location.hash);
    if (m) state.selected = decodeURIComponent(m[1]);
  })();

  renderMeta();
  renderHistogram();
  render();
  if (state.selected !== null) renderDetail(state.selected);
})();
