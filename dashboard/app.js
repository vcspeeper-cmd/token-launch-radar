// Token Radar's page: renders window.RADAR (written beside dashboard/ by main.ts) into index.html —
// the KPI strip, the ledger, the fitted model with its holdout evidence, the scatter, the sortable
// board and a per-row drawer. No framework, no network: every figure is in data.js.
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) {
    document.body.insertAdjacentHTML('afterbegin', '<p style="padding:24px">No data.js beside the page: run main.ts to write it.</p>');
    return;
  }
  var $ = function (id) { return document.getElementById(id); };
  var state = { q: '', cat: '', chain: '', verdict: '', tvl: 0, sort: 'implied', dir: -1, open: null };
  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  var int0 = new Intl.NumberFormat('en-US');

  function isNum(n) { return typeof n === 'number' && isFinite(n); }
  function usd(n) {
    if (!isNum(n)) return '—';
    var a = Math.abs(n);
    if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function exact(n) { return isNum(n) ? usd0.format(n) : '—'; }
  function pct(n) { return isNum(n) ? (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(1) + '%' : '—'; }
  function age(d) {
    if (!isNum(d)) return '—';
    if (d >= 730) return (d / 365).toFixed(1) + 'y';
    if (d >= 365) return '1y ' + Math.round(d - 365) + 'd';
    return Math.round(d) + 'd';
  }
  function net(n) { return isNum(n) ? (n >= 0 ? '+' : '−') + '$' + Math.abs(n).toFixed(2) : '—'; }
  function sign(n) { return !isNum(n) || n === 0 ? 'muted' : n > 0 ? 'pos' : 'neg'; }
  function fix(n, d) { return isNum(n) ? n.toFixed(d === undefined ? 4 : d) : '—'; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cut(s, n) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    if (s.length <= n) return s;
    var c = s.slice(0, n), at = c.lastIndexOf(' ');
    return (at > n * 0.6 ? c.slice(0, at) : c).replace(/[,;:.\s]+$/, '') + '…';
  }
  function signed(n) { return (isNum(n) && n >= 0 ? '+ ' : '− ') + Math.abs(n || 0).toFixed(4); }

  // ---------------------------------------------------------------- masthead + kpis
  function renderMeta() {
    var t = D.totals, f = D.fit || {}, h = D.holdout || {}, hl = D.headline;
    $('m-asof').textContent = D.as_of || '—';
    $('m-src').textContent = D.source || '—';
    $('m-src').title = D.source || '';
    $('m-ver').textContent = D.model_version || '—';
    $('m-sentence').textContent = D.model_sentence || '';
    $('foot-model').textContent = 'Model ' + (D.model_version || '—') + ': ' + (D.model_sentence || '');
    $('foot-src').textContent = 'Source: ' + (D.source || '—');
    $('l-total').textContent = int0.format(t.protocols);
    $('k-prot').textContent = int0.format(t.protocols);
    $('k-prot-n').textContent = int0.format(t.watchlist) + ' watchlisted · ' + int0.format(t.liveToken) + ' already trade';
    $('k-pre').textContent = int0.format(t.rows);
    $('k-pre-n').textContent = 'of ' + int0.format(t.preToken) + ' that record no token';
    $('k-tot').textContent = usd(hl.total_implied_usd);
    $('k-tot-n').textContent = 'summed over ' + int0.format(t.rows) + ' ranked rows';
    $('k-med').textContent = usd(hl.median_implied_usd);
    $('k-med-n').textContent = 'top: ' + (hl.top_name || '—') + ', ' + usd(hl.top_value_usd);
    $('k-fit').textContent = 'R² ' + fix(f.r2, 3);
    $('k-fit-n').textContent = 'typical miss ' + fix(h.medianAbsDex, 1) + '× · n=' + int0.format(f.n);
    $('k-farm').textContent = int0.format(t.farmable);
    $('k-farm-n').textContent = 'FARM · ' + int0.format(t.rows - t.farmable) + ' THIN or SKIP';
  }

  // ---------------------------------------------------------------- ledger
  var CCOL = {
    ranked: '#f5b544', token: '#64748b', staking: '#38bdf8', bridge: '#a78bfa',
    custody: '#7d89a8', versioned: '#f472b6', wrapped: '#2dd4bf', below: '#334155'
  };
  var CNAME = {
    ranked: 'on the board', token: 'already trades', staking: 'staking receipt', bridge: 'bridge claim',
    custody: 'exchange', versioned: 'versioned pool', wrapped: 'wrapped asset', below: 'below floor'
  };
  function renderLedger() {
    var rows = D.ledger || [], total = 0;
    rows.forEach(function (r) { total += r.count; });
    $('l-note').textContent = int0.format(total) + ' classified, each exactly once, across ' +
      rows.filter(function (r) { return r.count > 0; }).length + ' non-empty classes.';
    $('lbar').innerHTML = rows.map(function (r) {
      return '<i style="width:' + (total ? (r.count / total * 100).toFixed(3) : 0) + '%;background:' +
        (CCOL[r.code] || '#475569') + '" title="' + esc(r.code + ': ' + r.count) + '"></i>';
    }).join('');
    $('lkey').innerHTML = rows.map(function (r) {
      return '<li data-zero="' + (r.count === 0) + '"><span class="sw" style="background:' + (CCOL[r.code] || '#475569') + '"></span>' +
        '<span><b>' + esc(CNAME[r.code] || r.code) + '</b> <span class="lg-count">' + int0.format(r.count) + '</span></span>' +
        '<span class="lg-why" title="' + esc(r.reason) + '">' + esc(cut(r.reason, 92)) + '</span></li>';
    }).join('');
  }

  // ---------------------------------------------------------------- model
  function renderModel() {
    var f = D.fit || {}, a = f.ageOnly || {}, h = D.holdout || {};
    $('eq').innerHTML = '<span class="op">log₁₀(value) = </span><span class="co">' + fix(f.alpha, 4) + '</span>' +
      ' <span class="co">' + signed(f.betaTvl) + '</span><span class="op">·log₁₀ TVL</span>' +
      ' <span class="co">' + signed(f.betaAge) + '</span><span class="op">·log₁₀ age</span>' +
      ' <span class="co">' + signed(f.betaAgeMissing) + '</span><span class="op">·[no date]</span><br>' +
      '<span class="op">                </span><span class="co">' + (f.betaMomentum >= 0 ? '+ ' : '− ') +
      Math.abs(f.betaMomentum || 0).toFixed(5) + '</span><span class="op">·move%</span> <span class="co">' +
      signed(f.betaChains) + '</span><span class="op">·log₁₀ chains + γ(category)</span>';

    var kv = [
      ['TVL exponent', fix(f.betaTvl, 4), 'each 10× of TVL', ''],
      ['Age exponent · joint', fix(f.betaAge, 4), 'each 10× of days', 'dim'],
      ['Age exponent · age only', fix(a.betaAge, 4), 'applied by the board', 'hot'],
      ['Momentum / point', fix(f.betaMomentum, 6), 'applied at ×' + fix(f.momentumApplied, 2), 'dim'],
      ['Chains exponent', fix(f.betaChains, 4), 'each 10× of chains', ''],
      ['Residual σ', fix(f.sigma, 4) + ' dex', 'log₁₀ decades', ''],
      ['R²', fix(f.r2, 4), 'variance explained', ''],
      ['n', int0.format(f.n), 'live peers fitted', ''],
      ['50% band', '×' + fix(f.band50, 2), '10^(0.6745σ)', ''],
      ['80% band', '×' + fix(f.band80, 2), '10^(1.2816σ)', '']
    ];
    $('factors').innerHTML = '<thead><tr><th>Factor</th><th>Value</th><th>Meaning</th></tr></thead><tbody>' +
      kv.map(function (r) {
        return '<tr><td>' + esc(r[0]) + '</td><td class="' + r[3] + '">' + esc(r[1]) + '</td><td class="small">' + esc(r[2]) + '</td></tr>';
      }).join('') + '</tbody>';

    $('age-note').innerHTML = 'The age term appears twice on purpose. The joint fit puts it at <b>' + fix(f.betaAge, 4) +
      '</b> because the category dummy absorbs most of the age signal; fitted on age alone over ' + int0.format(a.n) +
      ' peers it is <b>' + fix(a.betaAge, 4) + '</b> (age-only R² ' + fix(a.r2, 3) +
      '). That age-only number is what the days run without a token are worth on their own, and it is the one the board applies.';

    var ho = [
      ['Train rows', int0.format(h.trainN), 'oldest 70% by listing date'],
      ['Test rows', int0.format(h.testN), 'newest 30%, never fitted'],
      ['Median miss', fix(h.medianAbsDex, 1) + '×', 'typical |error| in multiples'],
      ['Inside 50% band', fix((h.hit50 || 0) * 100, 0) + '%', 'of holdout rows'],
      ['Inside 80% band', fix((h.hit80 || 0) * 100, 1) + '%', 'of holdout rows'],
      ['Holdout σ', fix(h.sigma, 4) + ' dex', 'refitted on the train rows'],
      ['Holdout α · β TVL', fix(h.alpha, 3) + ' · ' + fix(h.betaTvl, 3), 'coefficients the test used']
    ];
    $('holdout').innerHTML = '<thead><tr><th>Measure</th><th>Value</th><th>Note</th></tr></thead><tbody>' +
      ho.map(function (r) {
        return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td><td class="small">' + esc(r[2]) + '</td></tr>';
      }).join('') + '</tbody>';
    $('ho-note').innerHTML = 'The typical unseen peer misses by <b>' + fix(h.medianAbsDex, 1) + '×</b>, and only <b>' +
      fix((h.hit80 || 0) * 100, 0) + '%</b> land inside the 80% band. A row\'s number is a centre, not a forecast: the band is the claim.';

    var cats = (D.categories || []).slice().sort(function (x, y) { return y.rows - x.rows || x.name.localeCompare(y.name); });
    $('cats').innerHTML = cats.map(function (c) {
      var only = c.peers < 4;
      return '<li data-size="' + (only ? 0 : 1) + '" title="' + esc(c.name + ': ' + c.peers + ' live peers, ' + c.rows + ' ranked rows') + '">' +
        '<span class="cname">' + esc(c.name) + '</span><span class="cval">' +
        (only ? '<span class="only">size law only</span>' : fix(c.gamma, 3) + ' · ' + c.peers + 'p') + '</span></li>';
    }).join('');
  }

  // ---------------------------------------------------------------- scatter
  function renderScatter() {
    var S = D.scatter || {}, pts = S.points || [], line = S.line || [];
    var W = 1360, H = 250, L = 56, R = 16, T = 12, B = 34, xs = [], ys = [];
    pts.forEach(function (p) { xs.push(p[0]); ys.push(p[1]); });
    line.forEach(function (p) { xs.push(p[0]); ys.push(p[1]); });
    if (!xs.length) return;
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var px = (x1 - x0) * 0.03 || 0.5, py = (y1 - y0) * 0.06 || 0.5;
    x0 -= px; x1 += px; y0 -= py; y1 += py;
    function sx(v) { return L + (v - x0) / (x1 - x0) * (W - L - R); }
    function sy(v) { return H - B - (v - y0) / (y1 - y0) * (H - T - B); }
    function money(v) {
      var d = Math.pow(10, v);
      if (d >= 1e9) return '$' + (d / 1e9) + 'B';
      if (d >= 1e6) return '$' + (d / 1e6) + 'M';
      if (d >= 1e3) return '$' + Math.round(d / 1e3) + 'K';
      return '$' + d;
    }
    var xt = [6, 7, 8, 9, 10].filter(function (v) { return v >= x0 && v <= x1; });
    var yt = [5, 6, 7, 8, 9, 10].filter(function (v) { return v >= y0 && v <= y1; });
    var o = ['<g class="grid">'];
    xt.forEach(function (v) { o.push('<line x1="' + sx(v).toFixed(1) + '" y1="' + T + '" x2="' + sx(v).toFixed(1) + '" y2="' + (H - B) + '"/>'); });
    yt.forEach(function (v) { o.push('<line x1="' + L + '" y1="' + sy(v).toFixed(1) + '" x2="' + (W - R) + '" y2="' + sy(v).toFixed(1) + '"/>'); });
    o.push('</g><g class="axis">');
    xt.forEach(function (v) { o.push('<text x="' + sx(v).toFixed(1) + '" y="' + (H - B + 16) + '" text-anchor="middle">' + money(v) + '</text>'); });
    yt.forEach(function (v) { o.push('<text x="' + (L - 8) + '" y="' + (sy(v) + 3.5).toFixed(1) + '" text-anchor="end">' + money(v) + '</text>'); });
    o.push('<text class="axt" x="' + (L + 2) + '" y="' + (H - 2) + '">TVL</text>');
    o.push('<text class="axt" x="' + (L + 2) + '" y="' + (T + 10) + '">market cap</text></g><g>');
    pts.forEach(function (p) {
      o.push('<circle class="' + (p[2] === 1 ? 'dot-pre' : 'dot-live') + '" cx="' + sx(p[0]).toFixed(1) +
        '" cy="' + sy(p[1]).toFixed(1) + '" r="' + (p[2] === 1 ? 2.6 : 2.4) + '"/>');
    });
    o.push('</g>');
    if (line.length === 2) {
      o.push('<line class="fitline" x1="' + sx(line[0][0]).toFixed(1) + '" y1="' + sy(line[0][1]).toFixed(1) +
        '" x2="' + sx(line[1][0]).toFixed(1) + '" y2="' + sy(line[1][1]).toFixed(1) + '"/>');
    }
    $('chart').setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    $('chart').innerHTML = o.join('');
  }

  // ---------------------------------------------------------------- filters
  function fillOptions() {
    var cats = {}, chains = {};
    D.rows.forEach(function (r) {
      var c = r.category || 'Unknown';
      cats[c] = (cats[c] || 0) + 1;
      (r.chains || []).forEach(function (x) { chains[x] = (chains[x] || 0) + 1; });
    });
    function opt(k, n) { return '<option value="' + esc(k) + '">' + esc(k) + ' (' + n + ')</option>'; }
    $('f-cat').innerHTML = '<option value="">All categories</option>' +
      Object.keys(cats).sort().map(function (k) { return opt(k, cats[k]); }).join('');
    $('f-chain').innerHTML = '<option value="">All chains</option>' +
      Object.keys(chains).sort(function (a, b) { return chains[b] - chains[a] || a.localeCompare(b); })
        .slice(0, 70).map(function (k) { return opt(k, chains[k]); }).join('');
  }

  function matches(r) {
    if (state.tvl > 0 && !(r.tvl_usd >= state.tvl)) return false;
    if (state.cat && (r.category || 'Unknown') !== state.cat) return false;
    if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
    if (state.verdict && r.verdict !== state.verdict) return false;
    if (state.q) {
      var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + (r.chains || []).join(' ')).toLowerCase();
      if (hay.indexOf(state.q) < 0) return false;
    }
    return true;
  }
  function sortVal(r, k) {
    switch (k) {
      case 'tvl': return isNum(r.tvl_usd) ? r.tvl_usd : -Infinity;
      case 'change': return isNum(r.change_7d) ? r.change_7d : -Infinity;
      case 'age': return isNum(r.age_days) ? r.age_days : -Infinity;
      case 'net': return isNum(r.net_usd) ? r.net_usd : -Infinity;
      case 'confidence': return isNum(r.confidence) ? r.confidence : -Infinity;
      case 'name': return r.name.toLowerCase();
      default: return isNum(r.implied_value_usd) ? r.implied_value_usd : -Infinity;
    }
  }
  function visible() {
    var rows = D.rows.filter(matches);
    rows.sort(function (a, b) {
      var av = sortVal(a, state.sort), bv = sortVal(b, state.sort);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.rank - b.rank;
    });
    return rows;
  }

  // ---------------------------------------------------------------- board
  // One shared log scale for the 50% band bars, so bar lengths compare across rows.
  var RANGE = (function () {
    var lo = Infinity, hi = 0;
    D.rows.forEach(function (r) {
      if (isNum(r.low50) && r.low50 < lo) lo = r.low50;
      if (isNum(r.high50) && r.high50 > hi) hi = r.high50;
    });
    return [Math.log10(Math.max(1, lo || 1)), Math.log10(hi || 10)];
  })();
  function pctPos(v) { return (Math.log10(Math.max(1, v)) - RANGE[0]) / (RANGE[1] - RANGE[0]) * 100; }

  function band(r) {
    if (!isNum(r.low50) || !isNum(r.high50)) return '';
    var l = Math.max(0, pctPos(r.low50)), h = Math.min(100, pctPos(r.high50));
    var m = Math.max(0, Math.min(99, pctPos(r.implied_value_usd)));
    return '<span class="band" title="50% band ' + esc(usd(r.low50)) + ' – ' + esc(usd(r.high50)) + '">' +
      '<i style="left:' + l.toFixed(2) + '%;width:' + Math.max(1.5, h - l).toFixed(2) + '%"></i>' +
      '<u style="left:' + m.toFixed(2) + '%"></u></span>';
  }
  function rowHtml(r) {
    var cs = r.chains || [], cat = r.category || 'Unknown';
    var chains = cs.length ? cut(cs.slice(0, 3).join(', ') + (cs.length > 3 ? ' +' + (cs.length - 3) : ''), 44) : 'no chain recorded';
    var step = (r.farm_steps && r.farm_steps[0]) || '';
    return '<tr data-slug="' + esc(r.slug) + '" tabindex="0" aria-selected="' + (state.open === r.slug) + '">' +
      '<td class="rank">' + (isNum(r.rank) ? r.rank : '—') + '</td>' +
      '<td><div class="proto"><b>' + esc(r.name) + '</b><span class="sub"><span class="catpill">' + esc(cat) + '</span>' + esc(chains) + '</span></div></td>' +
      '<td class="num">' + usd(r.tvl_usd) + '</td>' +
      '<td class="num ' + sign(r.change_7d) + '">' + pct(r.change_7d) + '</td>' +
      '<td class="num muted">' + age(r.age_days) + '</td>' +
      '<td class="num"><div class="impl"><b>' + usd(r.implied_value_usd) + '</b>' + band(r) + '</div></td>' +
      '<td class="num"><span class="verdict" data-v="' + esc(r.verdict || '') + '"><i class="vdot"></i>' +
      esc(r.verdict || '—') + ' <span class="net">' + net(r.net_usd) + '</span></span></td>' +
      '<td class="tease">' + esc(step ? cut(step.replace(/\s*Cost:[\s\S]*$/, ''), 112) : 'no step recorded') + '</td></tr>';
  }
  function renderBoard() {
    var rows = visible(), tbody = $('tbody');
    $('count').innerHTML = '<b>' + int0.format(rows.length) + '</b> of ' + int0.format(D.rows.length) + ' rows';
    var sel = $('sort').selectedOptions[0];
    $('b-sub').textContent = '· by ' + (sel ? sel.textContent.toLowerCase() : 'implied value') +
      ', ' + (state.dir === -1 ? 'high to low' : 'low to high');
    if (!rows.length) {
      tbody.innerHTML = '';
      $('board-table').hidden = true;
      $('empty').hidden = false;
      return;
    }
    $('board-table').hidden = false;
    $('empty').hidden = true;
    tbody.innerHTML = rows.map(rowHtml).join('');
    syncHead();
  }
  function syncHead() {
    [].forEach.call(document.querySelectorAll('th[data-sort-key]'), function (th) {
      if (th.getAttribute('data-sort-key') === state.sort) th.setAttribute('aria-sort', state.dir === -1 ? 'descending' : 'ascending');
      else th.removeAttribute('aria-sort');
    });
  }

  // ---------------------------------------------------------------- drawer
  function findRow(slug) {
    for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === slug) return D.rows[i];
    return null;
  }
  function fact(k, v) { return '<div class="fact"><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>'; }

  function arithmetic(r) {
    var f = r.factors || {}, fit = D.fit || {};
    var tvlIn = isNum(r.tvl_usd) ? Math.log10(Math.max(1, r.tvl_usd)) : 0;
    var ageIn = isNum(r.age_days) ? Math.log10(Math.max(1, r.age_days)) : 0;
    var nCh = Math.max((r.chains || []).length, 1);
    var move = isNum(r.change_7d) ? r.change_7d : 0;
    var rows = [
      ['Intercept α', 'the fitted constant', '1', fix(f.intercept, 4)],
      ['TVL', 'log₁₀(' + exact(r.tvl_usd) + ') = ' + fix(tvlIn, 4), '×' + fix(fit.betaTvl, 4), fix(f.tvl, 4)],
      ['Age', isNum(r.age_days) ? 'log₁₀(' + r.age_days + ' days) = ' + fix(ageIn, 4) : 'no listing date, log₁₀(1) = 0',
        '×' + fix(fit.ageApplied, 4), fix(f.age, 4)],
      ['No listing date', 'adds for a row with an unknown age', '+' + fix(fit.betaAgeMissing, 4), fix(f.ageMissing, 4)],
      ['7-day move', 'clamp(' + fix(move, 2) + '%, ±50) × ' + fix(fit.momentumApplied, 2) + '%, logged', 'log₁₀(1+w)', fix(f.momentum, 4)],
      ['Chains', 'log₁₀(' + nCh + ' chains) = ' + fix(Math.log10(nCh), 4), '×' + fix(fit.betaChains, 4), fix(f.chains, 4)],
      ['Category γ', r.category || 'Unknown', 'fitted', fix(f.category, 4)]
    ];
    var sum = 0;
    ['intercept', 'tvl', 'age', 'ageMissing', 'momentum', 'chains', 'category'].forEach(function (k) { if (isNum(f[k])) sum += f[k]; });
    var back = Math.round(Math.pow(10, sum));
    var off = Math.abs(back - r.implied_value_usd) / Math.max(1, r.implied_value_usd);
    return '<div class="dsec"><h3>The arithmetic, term by term</h3><table class="eqt"><thead><tr>' +
      '<th>Term</th><th>Coefficient</th><th>Input</th><th>Contribution</th></tr></thead><tbody>' +
      rows.map(function (x) {
        return '<tr><td class="term-name">' + esc(x[0]) + '<small>' + esc(x[1]) + '</small></td>' +
          '<td class="co">' + esc(x[2]) + '</td><td class="in">' + '·' + '</td><td class="val">' + esc(x[3]) + '</td></tr>';
      }).join('') +
      '<tr class="total"><td class="term-name">10 raised to the sum<small>the implied value</small></td>' +
      '<td class="co" colspan="2">Σ ' + fix(sum, 4) + '</td><td class="out">' + exact(r.implied_value_usd) + '</td></tr>' +
      '</tbody></table><p class="note">' + (off < 0.001
        ? 'The factors above re-add to the stored value to the digit shown.'
        : 'The factors are rounded to four places in board.json, so they re-add to ' + exact(back) + ', within ' +
          (off * 100).toFixed(2) + '% of the stored ' + exact(r.implied_value_usd) + '.') + '</p></div>';
  }

  function openDrawer(slug) {
    var r = findRow(slug), dr = $('drawer');
    if (!r) { closeDrawer(); return; }
    state.open = slug;
    $('d-kicker').textContent = 'Rank ' + r.rank + ' · pre-token';
    $('d-title').textContent = r.name;
    $('d-sub').textContent = (r.category || 'Unknown') + ' · ' + ((r.chains || []).join(', ') || 'no chain recorded') +
      ' · ' + (r.listed_at ? 'listed ' + r.listed_at : 'no listing date');
    var t = r.plan_meta || {}, plan = r.plan || [], h = [];
    h.push('<div class="hero"><div><p class="hlabel">Implied value</p><p class="hval">' + exact(r.implied_value_usd) + '</p>' +
      '<p class="hband">50% band ' + usd(r.low50) + ' – ' + usd(r.high50) + '</p></div>' +
      '<div class="hrank"><p class="hlabel">Verdict</p><b>' + esc(r.verdict || '—') + '</b>' +
      '<p class="hband">' + net(r.net_usd) + ' net</p></div></div>');
    h.push('<div class="dcols"><div class="dsec"><h3>The record</h3><dl class="facts">' +
      fact('TVL', exact(r.tvl_usd)) + fact('7-day change', pct(r.change_7d)) + fact('Age without a token', age(r.age_days)) +
      fact('Chains', (r.chains || []).length + (r.chains && r.chains.length ? ' · ' + cut(r.chains.join(', '), 34) : '')) +
      fact('Category', r.category || 'Unknown') + fact('Listed', r.listed_at || '—') +
      fact('Token status', r.token_status || 'pre-token') + fact('Watchlist', r.on_watchlist ? 'on it' : 'not on it') +
      '</dl></div><div class="dsec"><h3>The bands</h3><div class="bands">' +
      '<div class="bandbox"><p class="bl">50% band</p><p class="bv">' + usd(r.low50) + ' – ' + usd(r.high50) + '</p><p class="bm">÷ ×' + fix((D.fit || {}).band50, 2) + '</p></div>' +
      '<div class="bandbox"><p class="bl">80% band</p><p class="bv">' + usd(r.low80) + ' – ' + usd(r.high80) + '</p><p class="bm">÷ ×' + fix((D.fit || {}).band80, 2) + '</p></div></div>' +
      '<div class="meter"><div class="meter-top"><span>Confidence in the inputs</span><b>' + (isNum(r.confidence) ? r.confidence : '—') + '/100</b></div>' +
      '<div class="mtrack"><i style="width:' + (isNum(r.confidence) ? r.confidence : 0) + '%"></i></div>' +
      '<p class="mnote">A known age, a reported move, several chains and a real TVL are what make the arithmetic trustworthy. This is never confidence in a price.</p></div>' +
      '<div class="meter"><div class="meter-top"><span>Launch pressure</span><b>' + (isNum(r.pressure) ? r.pressure.toFixed(1) : '—') + '/100</b></div>' +
      '<div class="mtrack press"><i style="width:' + (isNum(r.pressure) ? Math.max(1, Math.min(100, r.pressure)) : 0) + '%"></i></div>' +
      '<p class="mnote">The timing part alone — maturity × the 7-day move × input confidence — normalised to the board\'s most launch-ready row. Size is left out on purpose.</p></div>' +
      '</div></div>');
    h.push(arithmetic(r));
    h.push('<div class="dsec"><h3>The farm plan · ' + plan.length + ' steps with costs and times</h3><dl class="econ">' +
      '<div><dt>Capital</dt><dd>' + exact(t.capital_usd) + '</dd></div>' +
      '<div><dt>Gas</dt><dd>' + exact(t.gas_usd) + '</dd></div>' +
      '<div><dt>Opportunity</dt><dd>' + exact(t.opportunity_usd) + '</dd></div>' +
      '<div class="' + (isNum(r.net_usd) && r.net_usd < 0 ? 'neg' : 'pos') + '"><dt>Net</dt><dd>' + net(r.net_usd) + '</dd></div>' +
      '<div><dt>Expected airdrop</dt><dd>' + exact(t.expected_airdrop_usd) + '</dd></div>' +
      '<div><dt>Upside · high 50%</dt><dd>' + exact(t.upside_usd) + '</dd></div>' +
      '<div><dt>Hold</dt><dd>' + (isNum(t.hold_days) ? t.hold_days + ' days' : '—') + '</dd></div>' +
      '<div><dt>Cost total</dt><dd>' + exact(t.cost_usd) + '</dd></div></dl>' +
      '<div class="callout">' + esc(r.verdict === 'FARM'
        ? 'FARM: ' + exact(t.capital_usd) + ' of capital, expected airdrop clears the ' + exact(t.cost_usd) + ' cost by ' + net(r.net_usd) + '.'
        : r.verdict === 'THIN'
          ? 'THIN: expected value barely covers cost. Farm it only if you already hold the position.'
          : 'SKIP: on these numbers the expected airdrop does not repay the ' + exact(t.cost_usd) + ' cost. Read the plan anyway — the arithmetic is the point.') + '</div>' +
      '<ol class="steps">' + plan.map(function (s) {
        return '<li data-kind="' + esc(s.kind) + '"><div><p class="stept">' + esc(s.text) + '</p>' +
          '<div class="chips"><span class="chip cost">' + esc(s.cost) + '</span><span class="chip time">' + esc(s.time) + '</span></div></div></li>';
      }).join('') + '</ol></div>');
    $('d-body').innerHTML = h.join('');
    dr.hidden = false;
    dr.scrollTop = 0;
    $('d-close').focus({ preventScroll: true });
    syncRows();
  }
  function closeDrawer() {
    state.open = null;
    $('drawer').hidden = true;
    syncRows();
  }
  function syncRows() {
    [].forEach.call(document.querySelectorAll('#tbody tr[data-slug]'), function (tr) {
      tr.setAttribute('aria-selected', String(tr.getAttribute('data-slug') === state.open));
    });
  }

  // ---------------------------------------------------------------- wiring
  function render() {
    renderBoard();
    if (state.open) { if (findRow(state.open)) openDrawer(state.open); else closeDrawer(); }
  }
  function reset() {
    state.q = ''; state.cat = ''; state.chain = ''; state.verdict = ''; state.tvl = 0; state.sort = 'implied'; state.dir = -1;
    $('q').value = ''; $('f-cat').value = ''; $('f-chain').value = ''; $('f-verdict').value = ''; $('f-tvl').value = '0'; $('sort').value = 'implied';
    render();
  }
  $('q').addEventListener('input', function (e) { state.q = e.target.value.trim().toLowerCase(); render(); });
  $('f-cat').addEventListener('change', function (e) { state.cat = e.target.value; render(); });
  $('f-chain').addEventListener('change', function (e) { state.chain = e.target.value; render(); });
  $('f-verdict').addEventListener('change', function (e) { state.verdict = e.target.value; render(); });
  $('f-tvl').addEventListener('change', function (e) { state.tvl = Number(e.target.value) || 0; render(); });
  $('sort').addEventListener('change', function (e) {
    state.sort = e.target.value;
    if (state.sort === 'name') state.dir = 1;
    render();
  });
  $('reset').addEventListener('click', reset);
  $('empty-reset').addEventListener('click', reset);
  $('d-close').addEventListener('click', closeDrawer);
  $('tbody').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) openDrawer(tr.getAttribute('data-slug'));
  });
  $('tbody').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var tr = e.target.closest('tr[data-slug]');
    if (tr) { e.preventDefault(); openDrawer(tr.getAttribute('data-slug')); }
  });
  // Every sortable header is a real button: click sorts, a second click flips the order.
  [].forEach.call(document.querySelectorAll('.th[data-sort]'), function (btn) {
    btn.parentNode.setAttribute('data-sort-key', btn.getAttribute('data-sort'));
    btn.addEventListener('click', function () {
      var k = btn.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir;
      else { state.sort = k; state.dir = k === 'name' ? 1 : -1; }
      $('sort').value = k;
      render();
    });
  });
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (e.key === 'Escape' && state.open) { closeDrawer(); return; }
    if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.metaKey || e.ctrlKey) return;
    if (e.key === '/') { e.preventDefault(); $('q').focus(); }
  });

  // A hash on load (#p=slug) opens that row, so a shared link lands on the detail view.
  var m = /(?:^#|&)p=([^&]+)/.exec(window.location.hash || '');
  if (m) state.open = decodeURIComponent(m[1]);

  renderMeta();
  renderLedger();
  renderModel();
  renderScatter();
  fillOptions();
  renderBoard();
  if (state.open) { if (findRow(state.open)) openDrawer(state.open); else state.open = null; }
})();
