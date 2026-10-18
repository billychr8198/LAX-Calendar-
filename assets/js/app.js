/* =============================================================
   LAX MISSION CONTROL — application
   ============================================================= */
(function () {
  'use strict';

  var D = window.LAX_DATA, SIM = window.LAX_SIM, VIEW = window.LAX_VIEWER;
  var KEY = 'lax-mission-control:v1';          // same key as before, so old saves carry over
  var MAX_PER_DAY = 16, REV_COST = 4, SEASON_LEN = D.ROUTES.length;

  /* ==========================================================
     1. Storage — window.storage, then localStorage, then memory
     ========================================================== */
  var Store = (function () {
    var mem = {};
    var localOK = (function () {
      try { var k = '__lax_probe__'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; }
      catch (e) { return false; }
    })();
    function hasWin() { return !!(window.storage && typeof window.storage.get === 'function' && typeof window.storage.set === 'function'); }
    return {
      where: function () { return hasWin() ? 'window.storage' : (localOK ? 'localStorage' : 'this tab only'); },
      get: function (key) {
        if (hasWin()) {
          return Promise.resolve().then(function () { return window.storage.get(key, false); })
            .then(function (r) { return r && r.value != null ? r.value : null; })
            .catch(function () { return localOK ? localStorage.getItem(key) : (mem[key] || null); });
        }
        if (localOK) { try { return Promise.resolve(localStorage.getItem(key)); } catch (e) {} }
        return Promise.resolve(mem[key] != null ? mem[key] : null);
      },
      set: function (key, value) {
        if (hasWin()) {
          return Promise.resolve().then(function () { return window.storage.set(key, value, false); })
            .catch(function () { if (localOK) { try { localStorage.setItem(key, value); } catch (e) {} } mem[key] = value; });
        }
        if (localOK) { try { localStorage.setItem(key, value); return Promise.resolve(true); } catch (e) {} }
        mem[key] = value; return Promise.resolve(true);
      }
    };
  })();

  /* ==========================================================
     2. State
     ========================================================== */
  var DEFAULTS = {
    v: 2, ceo: '', days: {}, routes: 0, won: false, wonAt: null,
    cfg: {
      theme: 'night', sound: true, motion: true, tpl: 'ops', ytThumbs: true, ask: true,
      start: D.SEASON.start, zoom: 2,
      custom: D.TEMPLATES.ops.tasks.slice()
    }
  };
  var state = clone(DEFAULTS);
  var saveTimer = null, simCache = null;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function save() {
    simCache = null;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { Store.set(KEY, JSON.stringify(state)); }, 200);
  }
  function migrate(d) {
    var s = Object.assign(clone(DEFAULTS), d);
    s.cfg = Object.assign(clone(DEFAULTS.cfg), d.cfg || {});
    s.days = d.days || {};
    Object.keys(s.days).forEach(function (k) {
      var day = s.days[k];
      day.t = (day.t || []).map(function (t) {
        var s0 = t.s === undefined ? null : t.s, e0 = t.e === undefined ? null : t.e;
        if (s0 !== null && (e0 === null || e0 <= s0)) e0 = e0 === null ? Math.min(1440, s0 + 60) : 1440;  // old blocks past midnight end at 24.00
        return { x: t.x, d: !!t.d, s: s0, e: s0 === null ? null : e0 };
      });
      day.rev = day.rev || 0;
      day.revLog = day.revLog || [];
      if (day.committed === undefined) day.committed = !!day.logged;
      if (day.logged) day.pts = tierOf(doneCount(day), day.t.length).pts - REV_COST * day.rev;
    });
    s.v = 2;
    return s;
  }
  function load() {
    return Store.get(KEY).then(function (raw) {
      if (!raw) return;
      try { var d = JSON.parse(raw); if (d && typeof d === 'object') state = migrate(d); } catch (e) {}
    });
  }

  /* ==========================================================
     3. Dates & the season
     ========================================================== */
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  function key(y, m, d) { return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
  function parseKey(k) { var p = k.split('-'); return { y: +p[0], m: +p[1] - 1, d: +p[2] }; }
  function prettyDate(k) {
    var p = parseKey(k), dt = new Date(Date.UTC(p.y, p.m, p.d));
    return DOW[dt.getUTCDay()] + ' ' + p.d + ' ' + MONTHS[p.m] + ' ' + p.y;
  }
  function shortDate(k) { var p = parseKey(k); return p.d + ' ' + MONTHS[p.m].slice(0, 3) + ' ' + p.y; }
  function todayKey() { var n = new Date(); return key(n.getFullYear(), n.getMonth(), n.getDate()); }

  var SEASON = [], SEASON_INDEX = {}, MONTH_LIST = [], TOTAL_DAYS = SEASON_LEN, MAX_POINTS = SEASON_LEN * MAX_PER_DAY;
  function buildSeason() {
    var p = parseKey(state.cfg.start || D.SEASON.start);
    if (isNaN(p.y)) p = parseKey(D.SEASON.start);
    SEASON = []; SEASON_INDEX = {}; MONTH_LIST = [];
    var d = new Date(Date.UTC(p.y, p.m, p.d));
    for (var i = 0; i < SEASON_LEN; i++) {
      var k = key(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      SEASON.push(k); SEASON_INDEX[k] = i;
      var last = MONTH_LIST[MONTH_LIST.length - 1];
      if (!last || last.y !== d.getUTCFullYear() || last.m !== d.getUTCMonth()) MONTH_LIST.push({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
      d.setUTCDate(d.getUTCDate() + 1);
    }
    simCache = null;
  }

  /* ==========================================================
     4. Scoring
     ========================================================== */
  function tierOf(done, total) {
    if (!total) return { k: 'none', pts: 0, label: 'No flights scheduled' };
    var p = done / total;
    if (p >= 1)    return { k: 'gold',   pts: 16, label: 'Full schedule flown' };
    if (p >= 0.75) return { k: 'silver', pts: 8,  label: 'Strong operating day' };
    if (p >= 0.5)  return { k: 'bronze', pts: 4,  label: 'Schedule kept' };
    return { k: 'none', pts: 0, label: 'Below the line' };
  }
  function needFor(frac, total) { return Math.ceil(frac * total - 1e-9); }
  function dayOf(k) {
    if (!state.days[k]) state.days[k] = { t: [], logged: false, pts: 0, note: '', committed: false, rev: 0, revLog: [] };
    var d = state.days[k];
    d.rev = d.rev || 0; d.revLog = d.revLog || [];
    return d;
  }
  function doneCount(day) { return day.t.filter(function (x) { return x.d; }).length; }
  function dayNet(day) { return tierOf(doneCount(day), day.t.length).pts - REV_COST * (day.rev || 0); }

  function totals() {
    var pts = 0, logged = 0, gold = 0, tasksDone = 0, revs = 0;
    SEASON.forEach(function (k) {
      var d = state.days[k];
      if (!d) return;
      tasksDone += doneCount(d);
      revs += d.rev || 0;
      if (d.logged) { logged++; pts += d.pts || 0; if (tierOf(doneCount(d), d.t.length).pts === 16) gold++; }
      else pts -= REV_COST * (d.rev || 0);
    });
    return { pts: pts, logged: logged, gold: gold, tasksDone: tasksDone, revs: revs };
  }
  function streak() {
    var best = 0, run = 0, cur = 0, last = -1;
    for (var i = 0; i < SEASON.length; i++) {
      var d = state.days[SEASON[i]];
      if (d && d.logged) { run++; if (run > best) best = run; last = i; } else run = 0;
    }
    for (var m = last; m >= 0; m--) { var e = state.days[SEASON[m]]; if (e && e.logged) cur++; else break; }
    return { best: best, cur: cur };
  }
  function title() {
    var t = totals(), pct = Math.max(0, t.pts) / MAX_POINTS, r = D.RANKS[0];
    D.RANKS.forEach(function (x) { if (pct >= x.at) r = x; });
    if (r === D.RANKS[D.RANKS.length - 1] && !state.won) r = D.RANKS[D.RANKS.length - 2];
    if (state.won && t.logged >= TOTAL_DAYS && pct >= 0.78) r = D.RANKS[D.RANKS.length - 1];
    return { r: r, pct: pct };
  }
  function sim() {
    if (!simCache) simCache = SIM.run({ days: state.days, season: SEASON, routes: D.ROUTES, table: D.WORLD_PAX_2025, openRoutes: state.routes });
    return simCache;
  }

  /* ==========================================================
     5. Helpers
     ========================================================== */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function motionOn() {
    return state.cfg.motion && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  var TICK = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 6.2 4.4 9 10.5 2.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* number formats */
  function fmtBig(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 1 : 2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M';
    if (n >= 1e4) return Math.round(n / 1e3) + 'K';
    return Math.round(n).toLocaleString();
  }
  function fmtMoney(n) { return '$' + fmtBig(n); }
  function fmtInt(n) { return Math.round(n).toLocaleString(); }
  function pct(x, dp) { return (x * 100).toFixed(dp == null ? 0 : dp) + '%'; }
  function signed(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n); }

  /* time */
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtHM(m) { if (m === null || m === undefined) return ''; return pad(Math.floor(m / 60)) + 'h.' + pad(m % 60) + 'm'; }
  function fmtRange(a, b) { return a === null || a === undefined ? '' : fmtHM(a) + ' - ' + fmtHM(b); }
  function shortHM(m) { return pad(Math.floor(m / 60)) + '.' + pad(m % 60); }
  function fmtDur(d) { if (d === null || d === undefined) return ''; var h = Math.floor(d / 60), n = d % 60; return !h ? n + 'm' : !n ? h + 'h' : h + 'h ' + n + 'm'; }
  function isTimed(t) { return t.s !== null && t.s !== undefined && t.e !== null && t.e !== undefined; }

  /* "08.00-09.30 Deep work" -> { s:480, e:570, x:'Deep work' } */
  var RE_BLOCK = /^\s*(\d{1,2})(?:\s*[.:h]\s*\.?\s*(\d{1,2}))?\s*m?\s*(?:-|\u2013|\u2014)\s*(\d{1,2})(?:\s*[.:h]\s*\.?\s*(\d{1,2}))?\s*m?\s*[\s:\u00B7|,]*(.*)$/;
  function parseTaskLine(line) {
    var m = RE_BLOCK.exec(line);
    if (!m) return { s: null, e: null, x: String(line).trim() };
    var h1 = +m[1], n1 = m[2] ? +m[2] : 0, h2 = +m[3], n2 = m[4] ? +m[4] : 0, rest = (m[5] || '').trim();
    if (h1 > 23 || h2 > 24 || n1 > 59 || n2 > 59 || (h2 === 24 && n2 > 0) || !rest) return { s: null, e: null, x: String(line).trim() };
    var s = h1 * 60 + n1, e = h2 * 60 + n2;
    if (e <= s) e = (e === 0) ? 1440 : Math.min(1440, s + 60);
    return { s: s, e: e, x: rest };
  }
  function mkTask(line) { var p = parseTaskLine(line); return { x: p.x, d: false, s: p.s, e: p.e }; }
  function sortDay(day) {
    if (!day || !day.t) return;
    day.t.forEach(function (t, i) { t.__i = i; });
    day.t.sort(function (a, b) {
      var au = isTimed(a) ? 0 : 1, bu = isTimed(b) ? 0 : 1;
      if (au !== bu) return au - bu;
      if (au) return a.__i - b.__i;
      return a.s - b.s || a.e - b.e || a.__i - b.__i;
    });
    day.t.forEach(function (t) { delete t.__i; });
  }
  function clashSet(list) {
    var out = {};
    for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) {
      var a = list[i], b = list[j];
      if (isTimed(a) && isTimed(b) && a.s < b.e && b.s < a.e) { out[i] = out[j] = true; }
    }
    return out;
  }

  /* ---------- audio ---------- */
  var Sound = (function () {
    var cache = {};
    function play(name, vol) {
      if (!state.cfg.sound) return;
      try {
        var a = cache[name] || (cache[name] = new Audio('assets/audio/' + name + '.wav'));
        a.currentTime = 0; a.volume = vol || 0.5;
        var p = a.play(); if (p && p.catch) p.catch(function () {});
      } catch (e) {}
    }
    return { play: play };
  })();

  /* ---------- toast ---------- */
  function toast(t, d, kind, icon) {
    var t0 = el('div', 'toast' + (kind ? ' toast--' + kind : ''));
    t0.innerHTML = '<div class="toast__ic">' + (icon || '\u2708\uFE0F') + '</div><div><div class="toast__t">' + esc(t) + '</div>' +
      (d ? '<div class="toast__d">' + esc(d) + '</div>' : '') + '</div>';
    $('#toasts').appendChild(t0);
    setTimeout(function () { t0.classList.add('out'); setTimeout(function () { t0.remove(); }, 300); }, 4200);
  }

  /* ---------- modal ---------- */
  var modalOnClose = null;
  function openModal(html, cls) {
    $('#modal-body').innerHTML = html;
    $('#modal-card').className = 'modal__card' + (cls ? ' ' + cls : '');
    $('#modal').hidden = false;
    document.body.classList.add('modal-open');
    var f = $('#modal-body').querySelector('[autofocus], input, button, a');
    (f || $('#modal-x')).focus();
    return $('#modal-body');
  }
  function closeModal() {
    if ($('#modal').hidden) return;
    $('#modal').hidden = true;
    document.body.classList.remove('modal-open');
    var cb = modalOnClose; modalOnClose = null;
    if (cb) cb();
  }

  function confirmBox(o) {
    return new Promise(function (resolve) {
      var done = false;
      function fin(v) { if (done) return; done = true; modalOnClose = null; closeModal(); resolve(v); }
      var body = openModal(
        '<div class="cfm' + (o.kind ? ' cfm--' + o.kind : '') + '">' +
          '<div class="cfm__ic">' + (o.icon || '⚠️') + '</div>' +
          '<h3>' + esc(o.title) + '</h3>' +
          '<p class="cfm__t">' + o.text + '</p>' +
          (o.extra || '') +
          '<div class="cfm__acts">' +
            '<button type="button" class="btn ' + (o.okCls || 'btn--go') + '" data-ok autofocus>' + esc(o.ok || 'OK') + '</button>' +
            '<button type="button" class="btn btn--ghost" data-no>' + esc(o.no || 'Cancel') + '</button>' +
          '</div></div>', 'modal__card--sm');
      modalOnClose = function () { if (!done) { done = true; resolve(false); } };
      body.querySelector('[data-ok]').addEventListener('click', function () { fin(o.read ? o.read(body) : true); });
      body.querySelector('[data-no]').addEventListener('click', function () { fin(false); });
    });
  }

  /* ---------- count-up numbers ---------- */
  function countTo(node, to, fmt) {
    if (!node) return;
    var from = parseFloat(node.dataset.v || '0');
    node.dataset.v = to;
    if (!motionOn() || Math.abs(from - to) < 1e-9) { node.textContent = fmt(to); return; }
    var t0 = performance.now(), dur = 900;
    (function f(now) {
      var u = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - u, 3);
      node.textContent = fmt(from + (to - from) * e);
      if (u < 1) requestAnimationFrame(f);
    })(t0);
  }

  /* ==========================================================
     6. Router
     ========================================================== */
  var VIEWS = ['tower', 'schedule', 'routemap', 'performance', 'network', 'airfield', 'keepflying', 'discover', 'settings'];
  var ALIAS = { briefing: 'keepflying' };
  var current = 'tower';
  var RENDER = {};
  var routeMap = null;

  function go(name) {
    name = ALIAS[name] || name;
    if (VIEWS.indexOf(name) < 0) name = 'tower';
    if (current === 'routemap' && name !== 'routemap' && routeMap) routeMap.hide();
    if (!$('#modal').hidden && !modalOnClose) closeModal();
    current = name;
    VIEWS.forEach(function (v) { var n = $('#view-' + v); if (n) n.hidden = (v !== name); });
    $$('.tab').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.go === name ? 'true' : 'false'); });
    var on = $('.tab[aria-selected="true"]');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
    if (RENDER[name]) RENDER[name]();
    if (name === 'schedule' && planner) planner.rescroll();
    window.scrollTo({ top: 0, behavior: motionOn() ? 'smooth' : 'auto' });
  }

  /* ==========================================================
     7. Header
     ========================================================== */
  function updateChips() {
    var t = totals(), s = sim();
    $('#hd-rank').textContent = s.cur.world.label;
    $('#hd-pax').textContent = fmtBig(s.cur.pax);
    $('#hd-pts').textContent = t.pts.toLocaleString();
    $('#hd-routes').textContent = state.routes;
  }

  /* ==========================================================
     8. Tower
     ========================================================== */
  var heroIdx = 0, heroTimer = null;
  function buildHero() {
    var host = $('#hero-slides');
    if (host.dataset.built) return;
    D.PHOTOS.forEach(function (p, i) {
      var d = el('div', 'hero__slide' + (i === 0 ? ' is-on' : ''));
      d.style.backgroundImage = 'url("assets/img/footage/' + p.f + '")';
      host.appendChild(d);
    });
    host.dataset.built = '1';
    heroCap();
    clearInterval(heroTimer);
    heroTimer = setInterval(function () {
      if (current !== 'tower' || !motionOn() || document.hidden) return;
      var s = $$('.hero__slide');
      s[heroIdx].classList.remove('is-on');
      heroIdx = (heroIdx + 1) % s.length;
      s[heroIdx].classList.add('is-on');
      heroCap();
    }, 6500);
  }
  function heroCap() { $('#hero-cap').innerHTML = '<span>📷</span> ' + esc(D.PHOTOS[heroIdx].t) + ' <i>⤢</i>'; }

  var KPI_DEF = [
    { k: 'pax',  ic: '🧳', name: 'Passengers', unit: 'per year', v: function (c) { return c.pax; }, f: fmtBig,
      sub: function (c) { return fmtInt(c.paxDaily) + ' a day · ' + pct(c.LF) + ' load factor'; } },
    { k: 'sat',  ic: '⭐', name: 'Service & satisfaction', unit: 'out of 1,000', v: function (c) { return c.sat; }, f: function (x) { return Math.round(x).toString(); },
      sub: function (c) { return c.asq.toFixed(2) + '/5 ASQ · ' + c.otp.toFixed(1) + '% on time'; } },
    { k: 'econ', ic: '💵', name: 'Economic impact', unit: 'output per year', v: function (c) { return c.econ; }, f: fmtMoney,
      sub: function (c) { return fmtBig(c.jobs) + ' regional jobs · ' + fmtMoney(c.taxes) + ' taxes'; } },
    { k: 'ops',  ic: '🛫', name: 'Aircraft operations', unit: 'per year', v: function (c) { return c.ops; }, f: fmtBig,
      sub: function (c) { return fmtInt(c.opsDaily) + ' a day · ' + pct(c.completion, 1) + ' completed'; } },
    { k: 'emp',  ic: '🧑‍✈️', name: 'Employees', unit: 'on the airport', v: function (c) { return c.emp; }, f: fmtInt,
      sub: function (c) { return fmtInt(c.empParts.airline) + ' airline · ' + fmtInt(c.empParts.lawa) + ' LAWA'; } }
  ];

  function spark(vals, cls) {
    if (vals.length < 2) vals = [vals[0] || 0, vals[0] || 0];
    var W = 120, H = 34, mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    if (mx - mn < 1e-9) mx = mn + 1;
    var pts = vals.map(function (v, i) { return [(i / (vals.length - 1)) * W, H - 3 - (v - mn) / (mx - mn) * (H - 6)]; });
    var d = 'M' + pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' L');
    return '<svg class="spark ' + (cls || '') + '" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<path class="spark__a" d="' + d + ' L' + W + ',' + H + ' L0,' + H + ' Z"/><path class="spark__l" d="' + d + '"/></svg>';
  }

  function renderKPIs() {
    var s = sim(), c = s.cur, host = $('#kpis');
    var series = [s.start].concat(s.snaps);
    if (!host.dataset.built) {
      host.innerHTML = KPI_DEF.map(function (k) {
        return '<button type="button" class="kpi kpi--' + k.k + '" data-goto="performance">' +
          '<div class="kpi__top"><span class="kpi__ic">' + k.ic + '</span><span class="kpi__n">' + k.name + '</span></div>' +
          '<div class="kpi__v" data-kv></div><div class="kpi__u">' + k.unit + '</div>' +
          '<div class="kpi__s" data-ks></div><div class="kpi__spark" data-sp></div><div class="kpi__d" data-kd></div></button>';
      }).join('');
      host.dataset.built = '1';
    }
    KPI_DEF.forEach(function (k, i) {
      var card = host.children[i];
      countTo(card.querySelector('[data-kv]'), k.v(c), k.f);
      card.querySelector('[data-ks]').textContent = k.sub(c);
      card.querySelector('[data-sp]').innerHTML = spark(series.map(k.v));
      var base = k.v(s.start), now = k.v(c), ratio = now / base;
      card.querySelector('[data-kd]').innerHTML = s.snaps.length
        ? (k.k === 'sat' ? '▲ ' + signed(Math.round(now - base)) + ' pts' : '▲ ×' + (ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1))) + ' since day one'
        : 'Day one baseline';
    });
  }

  function rankCard() {
    var s = sim(), c = s.cur, w = c.world, ti = title();
    var nextUp = null;
    var tbl = D.WORLD_PAX_2025;
    for (var i = tbl.length - 1; i >= 0; i--) if (tbl[i].p * 1e6 > c.pax) { nextUp = tbl[i]; break; }
    var gap = nextUp ? nextUp.p * 1e6 - c.pax : 0;
    $('#rank-card').innerHTML =
      '<div class="rk">' +
        '<div class="rk__l">' +
          '<div class="stat__k">World ranking · passengers</div>' +
          '<div class="rk__num">' + w.label + '</div>' +
          '<div class="rk__t">' + esc(ti.r.title) + '</div>' +
          '<p class="rk__n">' + esc(ti.r.note) + '</p>' +
        '</div>' +
        '<div class="rk__r">' +
          (w.rank === 1 ? '<p class="rk__msg">🏆 Busiest airport on the planet. Atlanta is looking at <b>you</b> now.</p>'
            : w.reserved ? '<p class="rk__msg">Your traffic beats Atlanta — <b>#1 unlocks</b> when every day of the season is logged.</p>'
            : nextUp ? '<p class="rk__msg">Next to pass: <b>' + esc(nextUp.n) + '</b> (' + nextUp.p + 'M). You need <b>' + fmtBig(gap) + '</b> more passengers a year.</p>'
            : '') +
          '<div class="rk__bar"><div class="meter"><div class="meter__fill gold" style="width:' + Math.min(100, c.pax / 106.3e6 * 100).toFixed(1) + '%"></div></div>' +
          '<div class="rk__ends"><span>LAX now · ' + fmtBig(c.pax) + '</span><span>ATL · 106.3M</span></div></div>' +
          '<p class="rk__proj">' + (s.logged ? 'On today’s form' : 'Average 80% from day one and') + ' you finish the season at <b>' + fmtBig(s.projectSame.pax) + '</b> passengers, world <b>' + s.projectSame.world.label + '</b>. ' +
          'Perfect from here: <b>' + s.projectPerfect.world.label + '</b>.</p>' +
        '</div>' +
      '</div>';
  }

  RENDER.tower = function () {
    var t = totals(), s = streak(), st = sim();
    buildHero();
    var done = state.won;
    $('#hero-title').textContent = done ? (st.cur.world.rank === 1 ? 'LAX is number one in the world' : 'Season complete. LAX is ' + st.cur.world.label) : 'Make LAX the number one airport in the world';
    $('#hero-sub').textContent = done
      ? 'You logged all ' + TOTAL_DAYS + ' days. Every route on the board is open. ' + (st.cur.world.rank === 1 ? 'Nobody moves more people than you.' : 'Start a new season and chase the top spot.')
      : 'You run Los Angeles World Airports. Keep your own schedule and LAX grows: every logged day opens a real route, and every kept plan pulls in passengers, jobs and billions of dollars. ' + TOTAL_DAYS + ' days. ' + TOTAL_DAYS + ' routes. One goal.';
    $('#hero-cta').textContent = t.logged ? 'Open today’s board' : 'Start day one';
    $('#season-label').textContent = 'Season 01 · ' + shortDate(SEASON[0]) + ' — ' + shortDate(SEASON[SEASON.length - 1]);

    var py = $('#pylons'); py.innerHTML = '';
    var lit = Math.round(t.logged / TOTAL_DAYS * 30);
    for (var i = 0; i < 30; i++) {
      var p = el('i', 'pylon' + (i < lit ? ' on' : '') + (i < lit && i >= 24 ? ' hot' : ''));
      p.style.height = (26 + ((i * 37) % 32)) + 'px';
      p.style.animationDelay = (i * 0.11) + 's';
      py.appendChild(p);
    }

    renderKPIs();
    rankCard();
    updateChips();
    countTo($('#st-pts'), t.pts, function (x) { return Math.round(x).toLocaleString(); });
    $('#st-pts-n').textContent = 'of ' + MAX_POINTS.toLocaleString() + ' possible';
    $('#st-days').textContent = t.logged + '/' + TOTAL_DAYS;
    $('#st-days-n').textContent = Math.round(t.logged / TOTAL_DAYS * 100) + '% of the season logged';
    $('#st-streak').textContent = s.cur;
    $('#st-streak-n').textContent = 'best run: ' + s.best + ' day' + (s.best === 1 ? '' : 's');
    $('#st-rev').textContent = t.revs;
    $('#st-rev-n').textContent = '−' + (t.revs * REV_COST) + ' points paid';

    var box = $('#latest-route');
    if (state.routes > 0) {
      box.innerHTML = passCard(state.routes - 1, true);
      var mm = box.querySelector('.pass__map');
      if (mm) window.LAX_MAPS.mini(mm, D.ROUTES[state.routes - 1], { reduced: !motionOn() });
    } else {
      box.innerHTML = '<div class="card empty"><div class="empty__ic">🛫</div><h3>The board is empty</h3>' +
        '<p class="lede">Log your first day and LAX opens its first new route of the season.</p></div>';
    }
    var a = pick(D.AFFIRMATIONS);
    $('#nudge').textContent = a.q;
    buildGallery();
  };

  function photoItems() {
    return D.PHOTOS.map(function (p) {
      return { src: 'assets/img/footage/' + p.f, thumb: 'assets/img/footage/thumb/' + p.f, title: p.t, caption: p.c };
    });
  }
  function openPhotoFile(f) {
    var i = D.PHOTOS.findIndex(function (p) { return p.f === f; });
    VIEW.open(photoItems(), Math.max(0, i));
  }
  function buildGallery() {
    var g = $('#photo-grid');
    if (g.dataset.built) return;
    D.PHOTOS.forEach(function (p, i) {
      var b = el('button', 'gal');
      b.type = 'button';
      b.innerHTML = '<span class="gal__img"><img src="assets/img/footage/thumb/' + p.f + '" alt="' + esc(p.t) + '" loading="lazy"><span class="gal__zoom">⤢ Zoom</span></span>' +
        '<span class="gal__cap"><span class="gal__t">' + esc(p.t) + '</span><span class="gal__c">' + esc(p.c) + '</span></span>';
      b.addEventListener('click', function () { VIEW.open(photoItems(), i); });
      g.appendChild(b);
    });
    g.dataset.built = '1';
  }

  /* ---------- boarding passes ---------- */
  function routePhoto(i) {
    var r = D.ROUTES[i], ph = D.TERMINAL_PHOTOS[r.t] || D.TERMINAL_PHOTOS.TBIT;
    return ph[i % ph.length];
  }
  function passCard(i, feature) {
    var r = D.ROUTES[i], al = D.AIRLINES[r.al], ph = routePhoto(i);
    var dep = 6 * 60 + ((i * 47) % (15 * 60)); dep -= dep % 5;
    return '<article class="pass' + (feature ? ' pass--feature' : '') + ' pass--' + (r.k === 'I' ? 'intl' : 'dom') + '" data-route="' + i + '">' +
      '<div class="pass__main">' +
        '<div class="pass__head">' +
          '<button type="button" class="route__logo" data-logo="' + i + '" aria-label="View the ' + esc(al.name) + ' logo full size"><img src="assets/img/airlines/' + r.al + '.webp" alt="' + esc(al.name) + '" loading="lazy"></button>' +
          '<span class="pass__cls">' + (r.k === 'I' ? 'International' : 'Domestic') + '</span>' +
        '</div>' +
        '<div class="pass__route">' +
          '<div><span class="pass__code">LAX</span><span class="pass__cty">Los Angeles</span></div>' +
          '<div class="pass__fly"><span class="pass__line"></span><span class="pass__pl">✈</span><span class="pass__dur">' + fmtDur(r.block) + '</span></div>' +
          '<div class="ta-r"><span class="pass__code">' + r.a + '</span><span class="pass__cty">' + esc(r.c) + '</span></div>' +
        '</div>' +
        '<p class="pass__b">' + esc(r.b) + '</p>' +
        '<div class="pass__grid">' +
          '<span><i>Flight</i>' + esc(r.fn) + '</span><span><i>Terminal</i>' + r.t + '</span>' +
          '<span><i>Distance</i>' + r.mi.toLocaleString() + ' mi</span><span><i>Daily</i>' + r.deps + ' flt' + (r.deps === 1 ? '' : 's') + '</span>' +
          '<span class="w2"><i>Aircraft</i>' + esc(r.gauge) + '</span><span><i>Region</i>' + esc(r.r) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="pass__stub">' +
        '<button type="button" class="pass__photo" data-photo="' + ph + '" aria-label="View terminal photo full size"><img src="assets/img/footage/thumb/' + ph + '" alt="" loading="lazy"></button>' +
        (feature ? '<div class="pass__map" aria-label="Animated map of the route"></div>' : '') +
        '<div class="pass__day">Day <b>' + (i + 1) + '</b></div>' +
        '<div class="pass__bar" aria-hidden="true"></div>' +
        '<button type="button" class="btn btn--sm btn--ghost pass__go" data-fly="' + i + '">Fly it on the map →</button>' +
      '</div>' +
    '</article>';
  }
  function logoItems(onlyOpen) {
    var seen = {}, out = [];
    D.ROUTES.slice(0, onlyOpen ? state.routes : D.ROUTES.length).forEach(function (r) {
      if (seen[r.al]) return; seen[r.al] = 1;
      var al = D.AIRLINES[r.al];
      out.push({ k: r.al, src: 'assets/img/airlines/' + r.al + '.webp', light: true, title: al.name + ' · ' + al.code,
                 caption: 'Flies ' + D.ROUTES.slice(0, Math.max(state.routes, 1)).filter(function (x) { return x.al === r.al; }).map(function (x) { return 'LAX–' + x.a; }).slice(0, 8).join(', ') });
    });
    return out;
  }
  function openLogo(alKey) {
    var items = logoItems(true);
    if (!items.some(function (x) { return x.k === alKey; })) items = logoItems(false);
    VIEW.open(items, Math.max(0, items.findIndex(function (x) { return x.k === alKey; })));
  }

  /* ==========================================================
     9. Schedule
     ========================================================== */
  var selectedDay = null, calMonth = 0, planner = null;

  function phaseOf(day) { return day.logged ? 'logged' : day.committed ? 'operation' : 'planning'; }

  RENDER.schedule = function () {
    renderCalendar();
    renderDay();
    updateChips();
  };

  function renderCalendar() {
    var mo = MONTH_LIST[calMonth];
    $('#cal-month').textContent = MONTHS[mo.m].toUpperCase() + ' ' + mo.y;
    $('#cal-prev').disabled = calMonth === 0;
    $('#cal-next').disabled = calMonth === MONTH_LIST.length - 1;
    $('#sched-count').textContent = TOTAL_DAYS;
    var grid = $('#cal-grid'); grid.innerHTML = '';
    DOW.forEach(function (d) { grid.appendChild(el('div', 'cal-dow', d)); });
    var first = new Date(Date.UTC(mo.y, mo.m, 1)).getUTCDay();
    var count = new Date(Date.UTC(mo.y, mo.m + 1, 0)).getUTCDate();
    for (var b = 0; b < first; b++) grid.appendChild(el('div', 'day is-empty'));
    var monthPts = 0, monthLogged = 0, tk = todayKey();
    for (var d = 1; d <= count; d++) {
      var k = key(mo.y, mo.m, d), rec = state.days[k], inSeason = k in SEASON_INDEX;
      var btn = el('button', 'day');
      btn.type = 'button'; btn.dataset.k = k;
      btn.setAttribute('aria-label', prettyDate(k));
      var total = rec ? rec.t.length : 0, done = rec ? doneCount(rec) : 0, pc = total ? done / total : 0;
      if (!inSeason) { btn.classList.add('is-out'); btn.disabled = true; }
      if (rec && rec.logged) {
        var tier = tierOf(done, total).k;
        btn.classList.add('tier-' + tier);
        monthPts += rec.pts || 0; monthLogged++;
      } else if (rec && rec.committed) btn.classList.add('is-run');
      if (total) btn.classList.add('has-tasks');
      if (k === selectedDay) btn.classList.add('is-sel');
      if (k === tk) btn.classList.add('is-today');
      btn.innerHTML = '<span class="day__n">' + d + '</span>' +
        (rec && rec.rev ? '<span class="day__rev" title="' + rec.rev + ' revision(s)">✎' + rec.rev + '</span>' : '') +
        (total ? '<span class="day__bar"><i style="width:' + (pc * 100) + '%"></i></span>' : '') +
        '<span class="day__pts">' + (rec && rec.logged ? signed(rec.pts) : (total ? done + '/' + total : '')) + '</span>';
      if (inSeason) btn.addEventListener('click', function () { selectDay(this.dataset.k); });
      grid.appendChild(btn);
    }
    $('#cal-summary').textContent = monthLogged + ' logged this month · ' + monthPts + ' points · day ' +
      (SEASON_INDEX[selectedDay] + 1) + ' of ' + TOTAL_DAYS + ' selected';
  }

  function selectDay(k) {
    selectedDay = k;
    var p = parseKey(k);
    var idx = MONTH_LIST.findIndex(function (m) { return m.y === p.y && m.m === p.m; });
    if (idx >= 0) calMonth = idx;
    RENDER.schedule();
    if (window.innerWidth < 980) { var h = $('#day-head'); if (h) h.scrollIntoView({ behavior: motionOn() ? 'smooth' : 'auto', block: 'start' }); }
  }

  function curDay() { return state.days[selectedDay] || { t: [], logged: false, pts: 0, note: '', committed: false, rev: 0, revLog: [] }; }

  function renderDay() {
    var k = selectedDay, day = curDay();
    sortDay(day);
    var total = day.t.length, done = doneCount(day), tier = tierOf(done, total), idx = SEASON_INDEX[k], ph = phaseOf(day);

    $('#day-date').textContent = prettyDate(k);
    $('#day-idx').textContent = 'Day ' + (idx + 1) + ' of ' + TOTAL_DAYS + (k === todayKey() ? ' · today' : '');
    var PH = {
      planning:  ['📝', 'Planning', 'Edit freely. Push back when the plan is ready — or tick your first task — and the day starts running.'],
      operation: ['🛫', 'In operation', 'The plan is locked. Ticking is free; every change to the plan costs ' + REV_COST + ' points.'],
      logged:    ['✅', 'Logged', 'Scored and closed. You can reopen it — the plan stays locked, so changes still cost points.']
    }[ph];
    $('#day-phase').className = 'phase phase--' + ph;
    $('#day-phase').innerHTML = '<span class="phase__ic">' + PH[0] + '</span><span><b>' + PH[1] + '</b>' +
      (day.rev ? ' · ' + day.rev + ' revision' + (day.rev === 1 ? '' : 's') + ' (−' + day.rev * REV_COST + ')' : '') +
      '<small>' + PH[2] + '</small></span>';

    var net = tier.pts - REV_COST * (day.rev || 0);
    $('#day-status').innerHTML = day.logged
      ? '<b class="ok">Logged · ' + signed(day.pts) + ' points</b> — ' + esc(tier.label)
      : total ? '<b>' + done + ' of ' + total + ' done</b> — logging now scores <b>' + signed(net) + ' point' + (Math.abs(net) === 1 ? '' : 's') + '</b>' +
                (day.rev ? ' (' + tier.pts + ' − ' + day.rev * REV_COST + ' for revisions)' : '')
      : 'Add what you want to get done, give it a time on the planner, then push back.';

    var push = $('#btn-push');
    push.hidden = ph !== 'planning';
    push.disabled = !total;
    var lg = $('#btn-log');
    lg.textContent = day.logged ? 'Reopen this day' : 'Log this day';
    lg.className = 'btn ' + (day.logged ? 'btn--ghost' : 'btn--go');
    lg.disabled = !total && !day.logged;

    var tr = $('#tier-row'); tr.innerHTML = '';
    [[0.5, 4, '50%'], [0.75, 8, '75%'], [1, 16, '100%']].forEach(function (t) {
      var need = total ? needFor(t[0], total) : 0, hit = total && done >= need;
      tr.appendChild(el('div', 'tier-card' + (hit ? ' hit' : '') + (!hit && total ? ' next' : ''),
        '<div class="tier-card__t">' + t[2] + ' done</div><div class="tier-card__p">' + t[1] + ' pts</div>' +
        '<div class="tier-card__n">' + (!total ? 'add tasks first' : hit ? 'reached ✓' : (need - done) + ' more to go') + '</div>'));
    });

    renderBoard(day);
    renderTray(day);
    if (planner) planner.render();
    renderRevCard(day);

    var rn = $('#day-route');
    if (idx < state.routes) {
      var rt = D.ROUTES[idx];
      rn.innerHTML = '<div class="stat__k">This day opened</div><div class="dr">' +
        '<button type="button" class="route__logo" data-logo="' + idx + '"><img src="assets/img/airlines/' + rt.al + '.webp" alt="' + esc(D.AIRLINES[rt.al].name) + '"></button>' +
        '<div><b class="mono">LAX → ' + rt.a + '</b><br><span class="muted-s">' + esc(rt.c) + ' · ' + rt.mi.toLocaleString() + ' mi</span></div>' +
        '<button type="button" class="btn btn--sm btn--ghost" data-fly="' + idx + '">Map</button></div>';
    } else {
      rn.innerHTML = '<div class="stat__k">Sealed route</div><div class="dr dr--lock"><span class="dr__lock">🔒</span>' +
        '<p class="muted-s">Log this day to find out where LAX flies next. ' + (TOTAL_DAYS - state.routes) + ' routes are still sealed.</p></div>';
    }
    $('#day-note').value = day.note || '';
  }

  function renderBoard(day) {
    var clash = clashSet(day.t), rows = $('#board-rows');
    rows.innerHTML = '';
    if (!day.t.length) {
      rows.innerHTML = '<div class="board__empty">No flights on the board yet.<br>Add a task below, load your template, or draw a block on the planner.</div>';
      return;
    }
    day.t.forEach(function (task, i) {
      var row = el('div', 'flap' + (task.d ? ' is-done' : '') + (clash[i] ? ' is-clash' : ''));
      row.style.animationDelay = motionOn() ? (i * 40) + 'ms' : '0ms';
      var timed = isTimed(task);
      row.innerHTML =
        '<div class="flap__lead" role="checkbox" tabindex="0" aria-checked="' + (task.d ? 'true' : 'false') + '" aria-label="' + (task.d ? 'Mark as not done: ' : 'Mark as done: ') + esc(task.x) + '">' +
          '<span class="flap__tick" aria-hidden="true">' + TICK + '</span>' +
          '<span class="flap__no">LX' + String(i + 1).padStart(3, '0') + '</span></div>' +
        '<button class="flap__time' + (timed ? '' : ' is-unset') + '" type="button" aria-label="' + (timed ? 'Time block ' + fmtRange(task.s, task.e) + '. Edit.' : 'No time set. Add a time block.') + '">' +
          '<span class="flap__time-v">' + (timed ? fmtRange(task.s, task.e) : '+ set time') + '</span>' +
          (timed ? '<span class="flap__time-d">' + fmtDur(task.e - task.s) + '</span>' : '') + '</button>' +
        '<div class="flap__txt' + (task.d ? ' done' : '') + '" tabindex="0" role="textbox" aria-label="Task ' + (i + 1) + '. Click to rename.">' + esc(task.x) + '</div>' +
        '<div class="flap__st ' + (task.d ? 'st--gone' : 'st--wait') + '">' + (task.d ? 'Departed' : 'Boarding') + '</div>' +
        '<button class="flap__x" type="button" aria-label="Remove this task">×</button>';

      var lead = row.querySelector('.flap__lead');
      lead.addEventListener('click', function () { toggleTask(task); });
      lead.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleTask(task); } });
      row.querySelector('.flap__time').addEventListener('click', function () { openEditor(task); });

      var txt = row.querySelector('.flap__txt');
      function edit() {
        if (txt.querySelector('input')) return;
        var inp = el('input', 'flap__edit'); inp.type = 'text'; inp.value = task.x;
        txt.textContent = ''; txt.appendChild(inp); inp.focus(); inp.select();
        var finished = false;
        function commit() {
          if (finished) return; finished = true;
          var v = inp.value.trim();
          if (!v || v === task.x) { renderDay(); return; }
          var old = task.x;
          mutate('Renamed “' + old + '” to “' + v + '”', function () { task.x = v; });
        }
        inp.addEventListener('blur', commit);
        inp.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
          if (e.key === 'Escape') { finished = true; renderDay(); }
        });
      }
      txt.addEventListener('click', edit);
      txt.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); edit(); } });
      row.querySelector('.flap__x').addEventListener('click', function () {
        mutate('Removed “' + task.x + '”', function (d) { var j = d.t.indexOf(task); if (j >= 0) d.t.splice(j, 1); });
      });
      rows.appendChild(row);
    });
  }

  function renderTray(day) {
    var tray = $('#tray');
    var un = day.t.filter(function (t) { return !isTimed(t); });
    if (!un.length) { tray.hidden = true; tray.innerHTML = ''; return; }
    tray.hidden = false;
    tray.innerHTML = '<div class="tray__h">Unscheduled · drag onto the planner</div><div class="tray__list"></div>';
    var list = tray.querySelector('.tray__list');
    un.forEach(function (t) {
      var c = el('button', 'tray__chip' + (t.d ? ' is-done' : ''), '<span class="tray__grip">⋮⋮</span>' + esc(t.x));
      c.type = 'button';
      c.addEventListener('pointerdown', function (e) {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        planner.trayDrag(t, curDay().t.indexOf(t), e, c);
      });
      c.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditor(t); } });
      list.appendChild(c);
    });
  }

  function renderRevCard(day) {
    var box = $('#rev-card');
    var log = (day.revLog || []).slice().reverse();
    box.innerHTML = '<div class="stat__k">Revision ledger</div>' +
      (log.length
        ? '<ul class="ledger">' + log.map(function (r) {
            var t = new Date(r.at);
            return '<li><span class="ledger__c">−' + REV_COST + '</span><span class="ledger__d">' + esc(r.d) + '<small>' + pad(t.getHours()) + '.' + pad(t.getMinutes()) + '</small></span></li>';
          }).join('') + '</ul><p class="muted-s">' + day.rev + ' change' + (day.rev === 1 ? '' : 's') + ' · −' + day.rev * REV_COST + ' points · each one also knocks 4 pp off the day’s quality.</p>'
        : '<p class="muted-s">' + (day.committed ? 'Clean so far — no changes since push back. Keep it that way and the full tier is yours.' : 'Nothing charged. Changes are free until you push back.') + '</p>');
  }

  /* ---------- changing the plan ---------- */
  function afterChange() {
    var day = state.days[selectedDay];
    if (day && day.logged) day.pts = dayNet(day);
    save();
    renderCalendar(); renderDay(); updateChips();
    if (routeMap) routeMap.refresh();
  }

  /* Every edit to a running plan goes through here. Before push back it
     is free; after it, the player pays REV_COST points per change. */
  function mutate(desc, fn) {
    var day = dayOf(selectedDay);
    if (!day.committed) { fn(day); afterChange(); return Promise.resolve(true); }
    var ask = state.cfg.ask && !day.noAsk ? confirmBox({
      title: 'Revise a running plan?', icon: '✏️', kind: 'warn',
      text: '<b>' + esc(desc) + '</b><br>This day is in operation, so changing the plan costs <b>' + REV_COST + ' points</b> and a little reliability. Ticking tasks off is always free.',
      extra: '<label class="cfm__chk"><input type="checkbox" data-noask> Don’t ask again for this day</label>' +
             '<p class="cfm__sum">This day so far: ' + (day.rev || 0) + ' revision' + (day.rev === 1 ? '' : 's') + ' · next one makes it −' + ((day.rev || 0) + 1) * REV_COST + '</p>',
      ok: 'Pay ' + REV_COST + ' points & change', okCls: 'btn--danger-solid', no: 'Keep the plan',
      read: function (b) { if (b.querySelector('[data-noask]').checked) day.noAsk = true; return true; }
    }) : Promise.resolve(true);
    return ask.then(function (ok) {
      if (!ok) { renderDay(); return false; }
      fn(day);
      day.rev = (day.rev || 0) + 1;
      day.revLog.push({ at: Date.now(), d: desc });
      Sound.play('penalty', 0.45);
      toast('−' + REV_COST + ' points · plan revised', desc, 'mag', '✏️');
      afterChange();
      return true;
    });
  }

  function commitDay(auto) {
    var day = dayOf(selectedDay);
    if (day.committed) return;
    day.committed = true;
    day.pushedAt = Date.now();
    Sound.play('pushback');
    toast(auto ? 'Day is running — plan locked' : 'Pushed back. Plan locked.',
          'From now on each change to the plan costs ' + REV_COST + ' points. Ticking is free.', 'gold', '🛫');
  }

  function toggleTask(task) {
    var day = dayOf(selectedDay);
    if (day.t.indexOf(task) < 0) return;
    if (!day.committed && !task.d) commitDay(true);
    task.d = !task.d;
    if (task.d) Sound.play('chime-task');
    afterChange();
  }

  /* ---------- the task editor (hours and minutes) ---------- */
  function openEditor(task, preset) {
    var isNew = !task;
    var s0 = isNew ? preset.s : task.s, e0 = isNew ? preset.e : task.e;
    var hasTime = s0 !== null && s0 !== undefined;
    if (!hasTime) { s0 = 9 * 60; e0 = 10 * 60; }
    function hmInputs(id, m) {
      return '<div class="hm" data-hm="' + id + '">' +
        '<button type="button" class="hm__st" data-step="-5" aria-label="5 minutes earlier">−</button>' +
        '<input type="number" class="hm__h" min="0" max="24" value="' + pad(Math.floor(m / 60)) + '" aria-label="' + id + ' hour" inputmode="numeric">' +
        '<span>h</span>' +
        '<input type="number" class="hm__m" min="0" max="59" step="1" value="' + pad(m % 60) + '" aria-label="' + id + ' minute" inputmode="numeric">' +
        '<span>m</span>' +
        '<button type="button" class="hm__st" data-step="5" aria-label="5 minutes later">+</button>' +
      '</div>';
    }
    var body = openModal(
      '<div class="ed">' +
        '<div class="eyebrow">' + (isNew ? 'New flight' : 'Edit flight') + ' · ' + prettyDate(selectedDay) + '</div>' +
        '<label class="ed__lbl">Task<input class="field ed__name" type="text" maxlength="140" value="' + (isNew ? '' : esc(task.x)) + '" placeholder="What are you doing?" ' + (isNew ? 'autofocus' : '') + '></label>' +
        '<label class="ed__chk"><input type="checkbox" class="ed__time"' + (hasTime ? ' checked' : '') + '> Give it a time block</label>' +
        '<div class="ed__times"' + (hasTime ? '' : ' hidden') + '>' +
          '<div class="ed__row"><span class="ed__k">From</span>' + hmInputs('Start', s0) + '</div>' +
          '<div class="ed__row"><span class="ed__k">To</span>' + hmInputs('End', e0) + '</div>' +
          '<div class="ed__chips">' + [15, 30, 45, 60, 90, 120, 180].map(function (m) { return '<button type="button" data-len="' + m + '">' + fmtDur(m) + '</button>'; }).join('') +
            '<button type="button" data-now>Start now</button></div>' +
          '<div class="ed__line"><div class="ed__bar"><i></i></div><span class="ed__lab"></span></div>' +
          '<p class="ed__err" hidden></p>' +
        '</div>' +
        (!isNew ? '<label class="ed__chk"><input type="checkbox" class="ed__done"' + (task.d ? ' checked' : '') + '> Done (departed)</label>' : '') +
        (dayOf(selectedDay).committed ? '<p class="ed__warn">⚠️ This day is running. Saving a change to the plan costs ' + REV_COST + ' points.</p>' : '') +
        '<div class="ed__acts">' +
          '<button type="button" class="btn btn--go" data-save>' + (isNew ? 'Add to plan' : 'Save') + '</button>' +
          (!isNew ? '<button type="button" class="btn btn--danger" data-del>Delete</button>' : '') +
          '<button type="button" class="btn btn--ghost" data-close>Cancel</button>' +
        '</div>' +
      '</div>', 'modal__card--sm');

    var nameI = body.querySelector('.ed__name'), useT = body.querySelector('.ed__time'), times = body.querySelector('.ed__times'), err = body.querySelector('.ed__err');
    function read(id) {
      var w = body.querySelector('[data-hm="' + id + '"]');
      var h = parseInt(w.querySelector('.hm__h').value, 10), m = parseInt(w.querySelector('.hm__m').value, 10);
      if (isNaN(h)) h = 0; if (isNaN(m)) m = 0;
      h = Math.max(0, Math.min(24, h)); m = Math.max(0, Math.min(59, m));
      if (h === 24) m = 0;
      return h * 60 + m;
    }
    function write(id, v) {
      v = Math.max(0, Math.min(1440, v));
      var w = body.querySelector('[data-hm="' + id + '"]');
      w.querySelector('.hm__h').value = pad(Math.floor(v / 60));
      w.querySelector('.hm__m').value = pad(v % 60);
    }
    function check() {
      var s = read('Start'), e = read('End');
      var bad = !useT.checked ? '' : s >= 1440 ? 'A block has to start before 24.00.' : e <= s ? 'The end has to be later than the start (up to 24.00).' : '';
      err.hidden = !bad; err.textContent = bad;
      body.querySelector('.ed__bar i').style.cssText = 'left:' + (s / 14.4) + '%;width:' + Math.max(0.5, (e - s) / 14.4) + '%';
      body.querySelector('.ed__lab').textContent = e > s ? fmtRange(s, e) + ' · ' + fmtDur(e - s) : '—';
      return !bad;
    }
    useT.addEventListener('change', function () { times.hidden = !useT.checked; check(); });
    body.querySelectorAll('.hm input').forEach(function (i) {
      i.addEventListener('input', check);
      i.addEventListener('blur', function () { var id = i.closest('[data-hm]').dataset.hm; write(id, read(id)); check(); });
    });
    body.querySelectorAll('.hm__st').forEach(function (b) {
      b.addEventListener('click', function () { var id = b.closest('[data-hm]').dataset.hm; write(id, read(id) + (+b.dataset.step)); check(); });
    });
    body.querySelectorAll('[data-len]').forEach(function (b) {
      b.addEventListener('click', function () { var s = read('Start'); write('End', Math.min(1440, s + (+b.dataset.len))); check(); });
    });
    body.querySelector('[data-now]').addEventListener('click', function () {
      var n = new Date(), m = n.getHours() * 60 + n.getMinutes(); m -= m % 5;
      var len = Math.max(15, read('End') - read('Start'));
      write('Start', m); write('End', Math.min(1440, m + len)); check();
    });
    check();

    body.querySelector('[data-save]').addEventListener('click', function () {
      var name = nameI.value.trim();
      if (!name) { nameI.focus(); nameI.classList.add('is-bad'); return; }
      if (!check()) return;
      var s = useT.checked ? read('Start') : null, e = useT.checked ? read('End') : null;
      var doneBox = body.querySelector('.ed__done');
      closeModal();
      if (isNew) {
        mutate('Added “' + name + '”' + (s !== null ? ' at ' + shortHM(s) : ''), function (d) { d.t.push({ x: name, d: false, s: s, e: e }); });
        return;
      }
      var changes = [];
      if (name !== task.x) changes.push('renamed to “' + name + '”');
      if (s !== task.s || e !== task.e) changes.push(s === null ? 'time removed' : (isTimed(task) ? shortHM(task.s) + '–' + shortHM(task.e) : 'no time') + ' → ' + shortHM(s) + '–' + shortHM(e));
      var nd = doneBox ? doneBox.checked : task.d;
      if (nd !== task.d) { toggleTask(task); }
      if (!changes.length) return;
      mutate('“' + task.x + '”: ' + changes.join(', '), function () { task.x = name; task.s = s; task.e = e; });
    });
    var del = body.querySelector('[data-del]');
    if (del) del.addEventListener('click', function () {
      closeModal();
      mutate('Removed “' + task.x + '”', function (d) { var j = d.t.indexOf(task); if (j >= 0) d.t.splice(j, 1); });
    });
    body.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') { e.preventDefault(); body.querySelector('[data-save]').click(); } });
  }

  /* ---------- logging ---------- */
  function takeoff() {
    if (!motionOn()) return;
    var t = $('#takeoff');
    t.classList.remove('go'); void t.offsetWidth; t.classList.add('go');
  }

  function logDay() {
    var k = selectedDay, day = dayOf(k);
    if (day.logged) {
      day.logged = false; day.pts = 0;
      save(); RENDER.schedule();
      toast('Day reopened', 'Routes you have already opened stay open. The plan stays locked.', null, '↩️');
      return;
    }
    if (!day.t.length) return;
    var tier = tierOf(doneCount(day), day.t.length);
    var before = sim().cur;
    day.logged = true; day.committed = true;
    day.pts = dayNet(day);
    day.loggedAt = Date.now();
    var t = totals();
    var newRoutes = Math.max(state.routes, t.logged);
    var opened = newRoutes > state.routes ? newRoutes - 1 : -1;
    state.routes = Math.min(newRoutes, D.ROUTES.length);
    save();
    var after = sim().cur;

    Sound.play('takeoff', 0.4);
    takeoff();
    toast(tier.k === 'none' ? 'Day logged' : signed(day.pts) + ' points', pick(D.CHEERS[tier.k]),
          tier.k === 'gold' ? 'gold' : null, tier.k === 'gold' ? '🏆' : tier.k === 'none' ? '🌧️' : '✅');
    if (tier.k === 'gold') confetti(60);
    RENDER.schedule();

    var finale = false;
    if (t.logged >= TOTAL_DAYS && !state.won) { state.won = true; state.wonAt = Date.now(); save(); finale = true; }
    if (opened >= 0) setTimeout(function () {
      showUnlock(opened, before, after);
      if (finale) modalOnClose = function () { setTimeout(function () { showVictory(); RENDER.tower(); }, 350); };
    }, motionOn() ? 900 : 100);
    else if (finale) setTimeout(showVictory, 900);
  }

  /* ==========================================================
     10. Unlock, victory, confetti
     ========================================================== */
  function showUnlock(i, before, after) {
    var r = D.ROUTES[i], al = D.AIRLINES[r.al];
    Sound.play('chime-route');
    var deltas = '';
    if (before && after) {
      deltas = '<div class="gain">' +
        '<div><b>+' + fmtBig(Math.max(0, after.pax - before.pax)) + '</b><span>passengers / yr</span></div>' +
        '<div><b>+' + fmtBig(Math.max(0, after.ops - before.ops)) + '</b><span>flights / yr</span></div>' +
        '<div><b>+' + fmtMoney(Math.max(0, after.econ - before.econ)) + '</b><span>economic output</span></div>' +
        '<div><b>' + (after.emp - before.emp >= 0 ? '+' : '−') + fmtInt(Math.abs(after.emp - before.emp)) + '</b><span>jobs on airport</span></div>' +
      '</div>';
    }
    var body = openModal(
      '<div class="unlock">' +
        '<div class="eyebrow eyebrow--c">New route unlocked · ' + (r.k === 'I' ? 'International' : 'Domestic') + ' · Day ' + (i + 1) + '</div>' +
        passCard(i, true) + deltas +
        '<div class="unlock__acts">' +
          '<button class="btn btn--go" data-close>Back to work</button>' +
          '<button class="btn" data-fly="' + i + '">Watch it on the map</button>' +
        '</div>' +
        '<p class="unlock__foot">Route ' + (i + 1) + ' of ' + TOTAL_DAYS + ' · ' + (TOTAL_DAYS - i - 1) + ' still sealed · ' + esc(al.name) + '</p>' +
      '</div>', 'modal__card--wide');
    var mm = body.querySelector('.pass__map');
    if (mm) window.LAX_MAPS.mini(mm, r, { reduced: !motionOn() });
  }

  function confetti(n) {
    if (!motionOn()) return;
    var host = el('div', 'confetti'), cols = ['#00A5CE', '#F5B32E', '#E85BA8', '#34D399', '#FFFFFF'];
    for (var i = 0; i < (n || 120); i++) {
      var p = el('i');
      p.style.left = Math.random() * 100 + '%';
      p.style.background = cols[i % cols.length];
      p.style.animationDuration = (2.6 + Math.random() * 2.6) + 's';
      p.style.animationDelay = (Math.random() * 1.2) + 's';
      p.style.transform = 'rotate(' + (Math.random() * 360) + 'deg)';
      host.appendChild(p);
    }
    document.body.appendChild(host);
    setTimeout(function () { host.remove(); }, 7000);
  }

  function showVictory() {
    var t = totals(), s = streak(), c = sim().cur, one = c.world.rank === 1;
    Sound.play('fanfare-win');
    confetti(160);
    openModal(
      '<div class="win">' +
        '<div class="eyebrow eyebrow--c">Season complete</div>' +
        '<div class="win__num">' + c.world.label + '</div>' +
        '<h2>' + (one ? 'LAX is the number one<br>airport in the world' : 'Every route is open.<br>LAX is ' + c.world.label + ' in the world') + '</h2>' +
        '<p class="muted big">All ' + TOTAL_DAYS + ' days logged. ' + fmtBig(c.pax) + ' passengers a year, ' + fmtBig(c.ops) + ' flights, ' + fmtMoney(c.econ) +
          ' of economic output and ' + fmtInt(c.emp) + ' people working at the airport. ' + (one ? 'You kept your own schedule for four months, and this is what it built.' : 'Next season, keep more plans intact and Atlanta falls.') + '</p>' +
        '<div class="stats" style="margin:20px 0 0;text-align:left">' +
          '<div class="stat stat--gold"><div class="stat__k">Final score</div><div class="stat__v">' + t.pts.toLocaleString() + '</div><div class="stat__n">of ' + MAX_POINTS.toLocaleString() + '</div></div>' +
          '<div class="stat stat--green"><div class="stat__k">Perfect days</div><div class="stat__v">' + t.gold + '</div><div class="stat__n">at 100%</div></div>' +
          '<div class="stat stat--mag"><div class="stat__k">Longest run</div><div class="stat__v">' + s.best + '</div><div class="stat__n">days in a row</div></div>' +
          '<div class="stat"><div class="stat__k">Tasks finished</div><div class="stat__v">' + t.tasksDone.toLocaleString() + '</div><div class="stat__n">across the season</div></div>' +
        '</div>' +
        '<div class="unlock__acts"><button class="btn btn--gold" data-goto="routemap">See all ' + TOTAL_DAYS + ' routes fly</button><button class="btn" data-close>Close</button></div>' +
      '</div>', 'modal__card--wide');
  }

  /* ==========================================================
     11. Performance
     ========================================================== */
  var chartData = {};
  function areaChart(id, pts, o) {
    // pts: [{x: dayNumber, y}]
    o = o || {};
    if (pts.length < 2) pts = [pts[0], { x: (pts[0].x || 0) + 1, y: pts[0].y }];
    var W = 980, H = 250, L = 58, R = 14, T = 16, B = 26;
    var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y1 = Math.max.apply(null, ys.concat(o.ref ? [o.ref.y] : []));
    var y0 = o.min != null ? o.min : 0;
    if (y1 - y0 < 1e-9) y1 = y0 + 1;
    y1 *= 1.06;
    function X(v) { return L + (v - x0) / Math.max(1e-9, x1 - x0) * (W - L - R); }
    function Y(v) { return T + (1 - (v - y0) / (y1 - y0)) * (H - T - B); }
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p.x).toFixed(1) + ',' + Y(p.y).toFixed(1); }).join('');
    var area = line + 'L' + X(x1).toFixed(1) + ',' + Y(y0) + 'L' + X(x0).toFixed(1) + ',' + Y(y0) + 'Z';
    var grid = '';
    for (var g = 0; g <= 4; g++) {
      var v = y0 + (y1 - y0) * g / 4;
      grid += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" class="ch__g"/>' +
              '<text x="' + (L - 7) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" class="ch__yl">' + o.fmt(v) + '</text>';
    }
    var xl = '';
    var step = Math.max(1, Math.ceil((x1 - x0) / 6));
    for (var xv = x0; xv <= x1; xv += step) xl += '<text x="' + X(xv).toFixed(1) + '" y="' + (H - 7) + '" class="ch__xl">' + (xv === 0 ? 'Start' : 'D' + xv) + '</text>';
    var ref = o.ref ? '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(o.ref.y).toFixed(1) + '" y2="' + Y(o.ref.y).toFixed(1) + '" class="ch__ref"/>' +
      '<text x="' + (W - R - 4) + '" y="' + (Y(o.ref.y) - 5).toFixed(1) + '" class="ch__refl">' + esc(o.ref.label) + '</text>' : '';
    var last = pts[pts.length - 1];
    chartData[id] = { pts: pts, X: X, Y: Y, fmt: o.fmt, W: W, H: H, L: L, R: R };
    return '<div class="ch" data-chart="' + id + '"><svg viewBox="0 0 ' + W + ' ' + H + '" class="ch__svg ch--' + (o.cls || 'brand') + '" role="img" aria-label="' + esc(o.label || '') + '">' +
      grid + xl + ref +
      '<path d="' + area + '" class="ch__a"/><path d="' + line + '" class="ch__l"/>' +
      '<circle cx="' + X(last.x).toFixed(1) + '" cy="' + Y(last.y).toFixed(1) + '" r="4.5" class="ch__end"/>' +
      '<g class="ch__hover" style="display:none"><line class="ch__cross" y1="' + T + '" y2="' + (H - B) + '"/><circle r="5" class="ch__dot"/></g>' +
      '</svg><div class="ch__tip" hidden></div></div>';
  }
  function bindCharts(root) {
    $$('[data-chart]', root).forEach(function (c) {
      var d = chartData[c.dataset.chart], svg = c.querySelector('svg'), hv = c.querySelector('.ch__hover'), tip = c.querySelector('.ch__tip');
      function at(ev) {
        var r = svg.getBoundingClientRect(), vx = (ev.clientX - r.left) / r.width * d.W;
        var best = d.pts[0], bd = 1e9;
        d.pts.forEach(function (p) { var dd = Math.abs(d.X(p.x) - vx); if (dd < bd) { bd = dd; best = p; } });
        hv.style.display = '';
        hv.querySelector('line').setAttribute('x1', d.X(best.x)); hv.querySelector('line').setAttribute('x2', d.X(best.x));
        hv.querySelector('circle').setAttribute('cx', d.X(best.x)); hv.querySelector('circle').setAttribute('cy', d.Y(best.y));
        tip.hidden = false;
        tip.innerHTML = '<b>' + d.fmt(best.y) + '</b><span>' + (best.x === 0 ? 'Season start' : 'Day ' + best.x + (best.k ? ' · ' + shortDate(best.k) : '')) + '</span>';
        var px = d.X(best.x) / d.W * r.width;
        tip.style.left = Math.min(r.width - 120, Math.max(0, px - 60)) + 'px';
      }
      svg.addEventListener('pointermove', at);
      svg.addEventListener('pointerdown', at);
      svg.addEventListener('pointerleave', function () { hv.style.display = 'none'; tip.hidden = true; });
    });
  }

  function seriesOf(f) {
    var s = sim();
    return [{ x: 0, y: f(s.start) }].concat(s.snaps.map(function (sn) { return { x: sn.i + 1, y: f(sn), k: sn.key }; }));
  }
  function metric(k, v, n) { return '<div class="met"><span class="met__k">' + k + '</span><b class="met__v">' + v + '</b>' + (n ? '<span class="met__n">' + n + '</span>' : '') + '</div>'; }

  RENDER.performance = function () {
    var s = sim(), c = s.cur, st = s.start, host = $('#perf');
    chartData = {};
    var lead = D.WORLD_PAX_2025.map(function (r) { return { n: r.n, a: r.a, p: r.p, you: false }; });
    lead.push({ n: 'Your LAX', a: 'LAX', p: c.pax / 1e6, you: true });
    lead.sort(function (a, b) { return b.p - a.p; });
    var youIdx = lead.findIndex(function (r) { return r.you; });
    var showLead = lead.slice(0, 20);
    if (youIdx >= 20) showLead.push(lead[youIdx]);
    var maxP = lead[0].p;
    var leadHtml = showLead.map(function (r, i) {
      var rank = r.you ? c.world.label : '#' + (lead.indexOf(r) + 1);
      return '<div class="lb__row' + (r.you ? ' is-you' : '') + '"><span class="lb__r">' + rank + '</span><span class="lb__n">' + esc(r.n) + ' <i>' + r.a + '</i></span>' +
        '<span class="lb__bar"><i style="width:' + Math.max(0.6, r.p / maxP * 100).toFixed(1) + '%"></i></span><span class="lb__v">' + (r.p >= 1 ? r.p.toFixed(1) + 'M' : fmtBig(r.p * 1e6)) + '</span></div>';
    }).join('');

    var opsLead = D.WORLD_OPS_2025.map(function (r) { return { n: r.n, a: r.a, o: r.o } });
    opsLead.push({ n: 'Your LAX', a: 'LAX', o: c.ops, you: true });
    opsLead.sort(function (a, b) { return b.o - a.o; });
    var opsRank = opsLead.findIndex(function (r) { return r.you; }) + 1;

    var p = c.empParts;
    var SECTIONS = [
      { id: 'pax', ic: '🧳', t: 'Number of passengers', big: fmtBig(c.pax), u: 'passengers a year', cls: 'brand',
        mets: metric('A day', fmtInt(c.paxDaily)) + metric('Load factor', pct(c.LF, 1), 'seats filled') + metric('International', pct(c.intlShare), fmtBig(c.intlPax) + ' a year') +
              metric('Seats offered', fmtBig(c.seats * c.G), 'per year') + metric('Airline growth', '+' + pct(c.G - 1), 'extra frequency & bigger jets') + metric('Routes', c.routes + ' / ' + TOTAL_DAYS),
        chart: areaChart('pax', seriesOf(function (x) { return x.pax; }), { fmt: fmtBig, ref: { y: 106.3e6, label: 'ATL 106.3M · world #1' }, label: 'Passengers per year over the season' }),
        math: 'Passengers = annual seats × airline growth × load factor.<br>Annual seats = Σ (daily flights × 2 directions × 365 × seats) over the routes you have opened, plus the skeleton schedule (6 regional flights a day).<br>' +
              'Load factor = 38% + 52% × reliability → now ' + pct(c.LF, 1) + '. Airline growth = 1 + 0.30 × reliability² → now ×' + c.G.toFixed(3) + '.' },
      { id: 'sat', ic: '⭐', t: 'Service & passenger satisfaction', big: Math.round(c.sat) + '<small>/1000</small>', u: 'passenger satisfaction index', cls: 'gold',
        mets: metric('ASQ score', c.asq.toFixed(2) + ' / 5', 'airport service quality') + metric('On-time departures', c.otp.toFixed(1) + '%') + metric('Security wait', Math.round(c.wait) + ' min', 'average') +
              metric('Net promoter', signed(c.nps)) + metric('Bags on time', c.bags.toFixed(1) + '%') + metric('Reliability', pct(c.R, 1), 'your consistency'),
        chart: areaChart('sat', seriesOf(function (x) { return x.sat; }), { fmt: function (v) { return Math.round(v); }, min: 300, cls: 'gold', label: 'Satisfaction index over the season' }),
        math: 'Index = 380 + 500 × (0.5 × reliability + 0.3 × last-7-day quality + 0.2 × streak) − 10 × revisions in the last 7 days (max −120).<br>' +
              'Streak counts up to 30 days. On-time = 55% + 33% × (0.6 R + 0.4 recent) − 1.5 pp per recent revision. ASQ = 1 + 4 × (index − 200) / 800.' },
      { id: 'econ', ic: '💵', t: 'Economic impact', big: fmtMoney(c.econ), u: 'regional economic output a year', cls: 'green',
        mets: metric('Regional jobs', fmtBig(c.jobs), 'supported in SoCal') + metric('Labor income', fmtMoney(c.labor)) + metric('State & local taxes', fmtMoney(c.taxes)) +
              metric('Per passenger', '$' + fmtInt(c.spend), 'visitor & airline spend') + metric('Capital program', fmtMoney(c.capital), 'construction a year'),
        chart: areaChart('econ', seriesOf(function (x) { return x.econ; }), { fmt: fmtMoney, cls: 'green', label: 'Economic output over the season' }),
        math: 'Output = passengers × spend per passenger + capital program.<br>Spend per passenger = $1,050 domestic / $2,450 international, weighted by your international share, × (0.85 → 1.05 with satisfaction).<br>' +
              'Capital program = $0.12B + $4.4B × reliability × share of network opened. Jobs, labor income and taxes use the ratios of LAWA’s published economic-impact study (4.9 jobs per $1M, 29.5% labor, 4.9% taxes).' },
      { id: 'ops', ic: '🛫', t: 'Aircraft operations', big: fmtBig(c.ops), u: 'take-offs and landings a year', cls: 'brand',
        mets: metric('A day', fmtInt(c.opsDaily)) + metric('Scheduled departures', fmtInt(c.deps * c.G), 'per day') + metric('Completion', pct(c.completion, 1), 'flights not cancelled') +
              metric('Cargo & general aviation', fmtBig(c.cargoGA)) + metric('Network miles', fmtInt(c.miles)) + metric('Movements rank', '#' + opsRank, 'vs the world’s busiest'),
        chart: areaChart('ops', seriesOf(function (x) { return x.ops; }), { fmt: fmtBig, ref: { y: 857392, label: 'ORD 857K · world #1' }, label: 'Aircraft operations over the season' }),
        math: 'Operations = daily departures × 2 (take-off + landing) × 365 × airline growth × completion rate + cargo & general aviation.<br>' +
              'Completion = 90% + 9.5% × reliability. Cargo & GA = 2,500 + 42,000 × network share × (0.5 + 0.5 R).' },
      { id: 'emp', ic: '🧑‍✈️', t: 'Number of employees', big: fmtInt(c.emp), u: 'people badged to work on the airport', cls: 'mag',
        mets: metric('Airlines & ground', fmtInt(p.airline)) + metric('Shops & restaurants', fmtInt(p.concessions)) + metric('TSA, CBP, FAA', fmtInt(p.federal)) +
              metric('Contractors & security', fmtInt(p.contractors)) + metric('LAWA staff', fmtInt(p.lawa)),
        chart: areaChart('emp', seriesOf(function (x) { return x.emp; }), { fmt: fmtBig, cls: 'mag', label: 'Employees over the season' }),
        math: 'Airlines = 0.031 per annual operation. Concessions = 120 per million passengers. Federal = 55 per million + 60 per million international. Contractors = 45 per million. LAWA = 300 + 3,700 × network share × (0.6 + 0.4 R).' }
    ];

    var sections = SECTIONS.map(function (sx) {
      var base = KPI_DEF.filter(function (k) { return k.k === sx.id; })[0];
      var from = base ? base.v(st) : 0, now = base ? base.v(c) : 0;
      return '<section class="ind ind--' + sx.cls + '" id="ind-' + sx.id + '">' +
        '<div class="ind__head"><span class="ind__ic">' + sx.ic + '</span><div><h3>' + sx.t + '</h3><p class="ind__u">' + sx.u + '</p></div>' +
        '<div class="ind__big">' + sx.big + '</div></div>' +
        '<p class="ind__from">Day one: <b>' + (base ? base.f(from) : '') + '</b> → now <b>' + (base ? base.f(now) : '') + '</b>' +
          (sx.id === 'pax' ? ' · season-end on current form: <b>' + fmtBig(s.projectSame.pax) + '</b>' : '') + '</p>' +
        '<div class="ind__mets">' + sx.mets + '</div>' + sx.chart +
        '<details class="ind__math"><summary>The maths behind it</summary><p>' + sx.math + '</p></details>' +
      '</section>';
    }).join('');

    var ps = s.projectSame, pp = s.projectPerfect;
    host.innerHTML =
      '<div class="perf-top">' +
        '<div class="card card--pad perf-rank">' +
          '<div class="stat__k">World ranking by passengers</div>' +
          '<div class="perf-rank__n">' + c.world.label + '</div>' +
          '<p class="muted">' + (c.world.est ? 'Outside the top 20 the rank is an estimate from the global traffic curve.' : 'Among the 20 busiest airports in the world (ACI World 2025 traffic, real LAX removed).') +
          (c.world.reserved ? ' <b>#1 is reserved</b> until every day of the season is logged.' : '') + '</p>' +
          '<div class="perf-rank__row"><span>Reliability</span><div class="meter"><div class="meter__fill" style="width:' + (c.R * 100).toFixed(1) + '%"></div></div><b>' + pct(c.R, 1) + '</b></div>' +
          '<div class="perf-rank__row"><span>Recent form</span><div class="meter"><div class="meter__fill gold" style="width:' + (c.F7 * 100).toFixed(1) + '%"></div></div><b>' + pct(c.F7) + '</b></div>' +
          '<div class="perf-rank__row"><span>Streak</span><div class="meter"><div class="meter__fill green" style="width:' + (c.S * 100).toFixed(1) + '%"></div></div><b>' + streak().cur + 'd</b></div>' +
        '</div>' +
        '<div class="card card--pad proj">' +
          '<div class="stat__k">Where this season is heading</div>' +
          '<div class="proj__grid">' +
            '<div class="proj__c"><span>Keep today’s form</span><b>' + ps.world.label + '</b><i>' + fmtBig(ps.pax) + ' pax · ' + fmtMoney(ps.econ) + '</i><small>every remaining day at ' + pct(s.avgQ) + ' quality, no revisions</small></div>' +
            '<div class="proj__c proj__c--gold"><span>Perfect from here</span><b>' + pp.world.label + '</b><i>' + fmtBig(pp.pax) + ' pax · ' + fmtMoney(pp.econ) + '</i><small>every remaining day at 100%, plans kept</small></div>' +
          '</div>' +
          '<p class="muted-s">' + ps.remaining + ' day' + (ps.remaining === 1 ? '' : 's') + ' left to log. The biggest routes — Las Vegas, New York, San Francisco — open last, so the numbers accelerate hard at the end of the season.</p>' +
        '</div>' +
      '</div>' +
      sections +
      '<div class="lb-grid">' +
        '<div class="card card--pad"><div class="stat__k">World’s busiest airports · passengers</div><div class="lb">' + leadHtml + '</div>' +
          '<p class="muted-s">Source: ACI World, 2025 airport traffic (published July 2026). The real LAX handled 73.7M passengers (#13).</p></div>' +
        '<div class="card card--pad"><div class="stat__k">Busiest by aircraft movements</div><div class="lb">' +
          opsLead.slice(0, 11).map(function (r, i) {
            return '<div class="lb__row' + (r.you ? ' is-you' : '') + '"><span class="lb__r">#' + (i + 1) + '</span><span class="lb__n">' + esc(r.n) + ' <i>' + r.a + '</i></span>' +
              '<span class="lb__bar"><i style="width:' + Math.max(0.6, r.o / opsLead[0].o * 100).toFixed(1) + '%"></i></span><span class="lb__v">' + fmtBig(r.o) + '</span></div>';
          }).join('') + (opsRank > 11 ? '<div class="lb__row is-you"><span class="lb__r">#' + opsRank + '</span><span class="lb__n">Your LAX <i>LAX</i></span><span class="lb__bar"><i style="width:' + Math.max(0.6, c.ops / opsLead[0].o * 100).toFixed(1) + '%"></i></span><span class="lb__v">' + fmtBig(c.ops) + '</span></div>' : '') +
          '</div><p class="muted-s">The real LAX: 580,996 movements in 2025 (#6).</p></div>' +
      '</div>';
    bindCharts(host);
  };

  /* ==========================================================
     12. Network (boarding passes)
     ========================================================== */
  var netFilter = 'all';
  RENDER.network = function () {
    var grid = $('#route-grid'), open = state.routes;
    $('#net-count').textContent = open + ' of ' + TOTAL_DAYS + ' routes open';
    $('#net-bar').style.width = (open / TOTAL_DAYS * 100) + '%';
    var intl = D.ROUTES.slice(0, open).filter(function (r) { return r.k === 'I'; }).length;
    $('#net-split').textContent = intl + ' international · ' + (open - intl) + ' domestic';
    var html = '', shown = 0;
    if (netFilter !== 'locked') for (var i = open - 1; i >= 0; i--) {
      var r = D.ROUTES[i];
      if (netFilter === 'intl' && r.k !== 'I') continue;
      if (netFilter === 'dom' && r.k !== 'D') continue;
      html += passCard(i, false); shown++;
    }
    if (netFilter === 'all' || netFilter === 'locked') {
      var lockShow = Math.min(TOTAL_DAYS - open, netFilter === 'locked' ? 999 : 6);
      for (var j = 0; j < lockShow; j++) {
        html += '<article class="sealed' + (j === 0 ? ' is-next' : '') + '" style="animation-delay:' + (j * 60) + 'ms"><div class="sealed__ic">' + (j === 0 ? '✉️' : '🔒') + '</div>' +
          '<div><div class="sealed__d">Day ' + (open + j + 1) + '</div><div class="sealed__t">' + (j === 0 ? 'Opens on your next logged day' : 'Sealed until you get here') + '</div></div></article>';
        shown++;
      }
    }
    if (!shown) html = '<div class="card empty"><h3>Nothing here yet</h3><p class="lede">Log a day on the schedule and your first route opens.</p></div>';
    grid.innerHTML = html;
  };

  /* ==========================================================
     13. Airfield
     ========================================================== */
  var mapZ = 1, mapX = 0, mapY = 0, activeTerm = null;
  RENDER.airfield = function () {
    var host = $('#map-pan');
    if (!host.dataset.built) {
      D.TERMINALS.forEach(function (t) {
        var b = el('button', 'hotspot' + (t.id === 'THEME' || t.id === 'WCTA' || t.id === 'ECTA' ? ' small' : ''));
        b.type = 'button'; b.style.left = t.x + '%'; b.style.top = t.y + '%';
        b.textContent = t.short; b.title = t.name; b.setAttribute('aria-label', t.name); b.dataset.id = t.id;
        b.addEventListener('click', function (e) { e.stopPropagation(); showTerminal(t.id); });
        host.appendChild(b);
      });
      host.dataset.built = '1';
    }
    var list = $('#term-list');
    if (!list.dataset.built) {
      D.TERMINALS.forEach(function (t) {
        var b = el('button', 'filt'); b.type = 'button'; b.textContent = t.chip || t.name;
        b.addEventListener('click', function () { showTerminal(t.id); });
        list.appendChild(b);
      });
      list.dataset.built = '1';
    }
    showTerminal(activeTerm || 'TBIT');
  };
  function showTerminal(id) {
    activeTerm = id;
    var t = D.TERMINALS.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    $$('.hotspot').forEach(function (h) { h.classList.toggle('is-on', h.dataset.id === id); });
    var opened = D.ROUTES.slice(0, state.routes).map(function (r, i) { return { r: r, i: i }; }).filter(function (o) { return o.r.t === id; });
    var term = /^T\d|TBIT|MSC/.test(t.id);
    var photos = D.TERMINAL_PHOTOS[t.id];
    var html = '<div class="eyebrow">' + (term ? 'Terminal' : 'Landmark') + '</div><h3>' + esc(t.name) + '</h3>' +
      '<p class="term__lead">' + esc(t.lead) + '</p><p class="muted">' + esc(t.body) + '</p>';
    if (photos) html += '<button type="button" class="term__ph" data-photo="' + photos[0] + '"><img src="assets/img/footage/thumb/' + photos[0] + '" alt=""><span>⤢</span></button>';
    if (term) {
      html += '<div class="stat__k" style="margin-top:14px">Your departures from here</div>';
      if (!opened.length) html += '<p class="muted-s">Nothing yet. Log days to open routes and they will show up on this board.</p>';
      else {
        html += '<div class="term__deps">';
        opened.reverse().forEach(function (o) {
          html += '<button type="button" class="dep-row" data-fly="' + o.i + '"><span class="dep-row__logo"><img src="assets/img/airlines/' + o.r.al + '.webp" alt="" loading="lazy"></span>' +
            '<span class="dep-row__c"><b>' + o.r.fn + ' · ' + o.r.a + '</b><i>' + esc(o.r.c) + '</i></span></button>';
        });
        html += '</div>';
      }
    }
    $('#term-info').innerHTML = html;
  }
  function applyMap() { $('#map-pan').style.transform = 'translate(' + mapX + 'px,' + mapY + 'px) scale(' + mapZ + ')'; }
  function clampMap() {
    var st = $('#map-stage'), w = st.clientWidth, h = st.clientHeight;
    mapX = Math.min(0, Math.max(w - w * mapZ, mapX));
    mapY = Math.min(0, Math.max(h - h * mapZ, mapY));
  }
  function zoomBy(f, cx, cy) {
    var r = $('#map-stage').getBoundingClientRect();
    if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
    var nz = Math.min(6, Math.max(1, mapZ * f)), k = nz / mapZ;
    mapX = cx - (cx - mapX) * k; mapY = cy - (cy - mapY) * k; mapZ = nz;
    clampMap(); applyMap();
  }

  /* ==========================================================
     14. Keep Flying
     ========================================================== */
  var affIdx = 0;
  function showAff(i) {
    affIdx = (i + D.AFFIRMATIONS.length) % D.AFFIRMATIONS.length;
    var a = D.AFFIRMATIONS[affIdx], q = $('#aff-q');
    q.classList.remove('pop'); void q.offsetWidth; q.classList.add('pop');
    q.textContent = a.q; $('#aff-s').textContent = a.s;
  }
  RENDER.keepflying = function () {
    var s = sim(), c = s.cur, t = totals();
    if (!$('#aff-q').dataset.set) { showAff(Math.floor(Math.random() * D.AFFIRMATIONS.length)); $('#aff-q').dataset.set = '1'; }
    var target = Math.min(0.99, Math.max(c.R + 0.1, 0.8));
    var need = SIM.daysToReach(c.R, target);
    var oneBad = c.R * (1 - SIM.C.ALPHA);
    var fix = SIM.daysToReach(oneBad, c.R);
    var lastDay = s.snaps.length ? s.snaps[s.snaps.length - 1] : null;
    var mood = !t.logged ? ['🌅', 'Clear skies, first flight', 'Nothing has gone wrong yet, because nothing has started. Log one day — any day — and LAX opens its first route.']
      : lastDay && lastDay.q < 0.5 ? ['🌦️', 'Rough last day? Totally normal.', 'Your reliability only moved ' + (SIM.C.ALPHA * 100) + '% of the way toward that one day. One good day pulls it straight back up. The route opened anyway.']
      : ['☀️', 'You are climbing', 'Reliability ' + pct(c.R) + ' and rising. Every logged day adds a real city to the map — keep stacking them.'];
    $('#comeback').innerHTML =
      '<div class="cb cb--mood"><div class="cb__ic">' + mood[0] + '</div><div><h3>' + mood[1] + '</h3><p>' + mood[2] + '</p></div></div>' +
      '<div class="cb"><div class="cb__k">Comeback maths</div><div class="cb__n">' + fix + ' day' + (fix === 1 ? '' : 's') + '</div>' +
        '<p>is all it takes to fully repair a bad day from where you are now (' + pct(c.R) + ' reliability) — at 100%.</p></div>' +
      '<div class="cb"><div class="cb__k">Next milestone</div><div class="cb__n">' + need + ' perfect day' + (need === 1 ? '' : 's') + '</div>' +
        '<p>lifts reliability to ' + pct(target) + ', which means fuller planes, happier passengers and more airlines asking for gates.</p></div>' +
      '<div class="cb"><div class="cb__k">Nothing is ever lost</div><div class="cb__n">' + state.routes + ' route' + (state.routes === 1 ? '' : 's') + '</div>' +
        '<p>are open for good. Routes never close — not after a zero day, not after a gap, not after a reopen.</p></div>';

    $('#creed').innerHTML = D.CREED.map(function (c2, i) {
      return '<div class="creed__i"><span class="creed__n">' + (i + 1) + '</span><b>' + esc(c2[0]) + '</b><p>' + esc(c2[1]) + '</p></div>';
    }).join('');

    $('#maths').innerHTML =
      '<h3>The maths, in plain words</h3>' +
      '<div class="maths__grid">' +
        '<div><h4>Day quality</h4><p><code>quality = tasks done ÷ tasks planned − 0.04 × revisions</code><br>Kept between 0 and 1. A missed day between logged days counts as 0.</p></div>' +
        '<div><h4>Reliability (your reputation)</h4><p><code>R ← R + 0.05 × (quality − R)</code><br>Starts at 20%. It is a slow moving average, so one bad day barely dents it and consistency builds it. Now: <b>' + pct(c.R, 1) + '</b>.</p></div>' +
        '<div><h4>Network</h4><p>Each logged day opens the next of 122 real routes, each with its real daily flights and aircraft size. Small hops first, mega-routes last.</p></div>' +
        '<div><h4>Passengers</h4><p><code>seats × (1 + 0.3 R²) × (38% + 52% R)</code><br>Perfect play ends near 113M — past Atlanta’s 106.3M.</p></div>' +
        '<div><h4>Satisfaction</h4><p><code>380 + 500 × (0.5 R + 0.3 form + 0.2 streak) − 10 × recent revisions</code></p></div>' +
        '<div><h4>Economy, flights, jobs</h4><p>Built on passengers and flights with ratios from LAWA’s economic-impact study — open the Performance tab for every formula.</p></div>' +
        '<div><h4>World ranking</h4><p>Your passengers against the 2025 top 20 (ACI World). Outside the top 20, an estimate. <b>#1 is reserved</b> for a season with every day logged.</p></div>' +
        '<div><h4>Points</h4><p>Tier points (4 / 8 / 16) minus 4 per revision. Points decide your title, from Incoming CEO to Legend of LAX.</p></div>' +
      '</div>';
    videoCards(D.VIDEOS_GUIDE, '#vid-guide', 0);
  };

  /* ---------- videos ---------- */
  function videoCards(list, hostId, posterOffset) {
    var host = $(hostId);
    if (host.dataset.built) return;
    list.forEach(function (v, i) {
      var fallback = 'assets/img/footage/thumb/' + D.PHOTOS[(i + (posterOffset || 0)) % D.PHOTOS.length].f;
      var real = state.cfg.ytThumbs !== false;
      var chain = real ? ['https://i.ytimg.com/vi/' + v.id + '/maxresdefault.jpg', 'https://i.ytimg.com/vi/' + v.id + '/mqdefault.jpg', fallback] : [fallback];
      var c = el('article', 'vid');
      c.innerHTML = '<div class="vid__frame"><button class="vid__poster' + (real ? ' is-real' : '') + '" type="button" aria-label="Play video: ' + esc(v.t) + '">' +
          '<img alt="" loading="lazy" decoding="async"><span class="vid__play"><svg width="22" height="22" viewBox="0 0 22 22" fill="currentColor"><path d="M6 3.4v15.2L19 11 6 3.4z"/></svg></span></button></div>' +
        '<div class="vid__body"><div class="vid__n">' + v.n + '</div><div class="vid__t">' + esc(v.t) + '</div>' +
          (v.w ? '<div class="vid__w">' + esc(v.w) + '</div>' : '') + '<p class="vid__d">' + esc(v.d) + '</p></div>';
      var img = c.querySelector('.vid__poster img'), step = 0;
      function tryNext() { if (step < chain.length) img.src = chain[step++]; }
      img.addEventListener('error', tryNext);
      img.addEventListener('load', function () { if (img.naturalWidth <= 121 && step < chain.length) tryNext(); });
      tryNext();
      c.querySelector('.vid__poster').addEventListener('click', function () {
        var src = 'https://www.youtube-nocookie.com/embed/' + v.id + '?autoplay=1&rel=0&modestbranding=1' + (v.start ? '&start=' + v.start : '');
        c.querySelector('.vid__frame').innerHTML = '<iframe src="' + src + '" title="' + esc(v.t) + '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>';
      });
      host.appendChild(c);
    });
    host.dataset.built = '1';
  }
  RENDER.discover = function () { videoCards(D.VIDEOS_LA, '#vid-la', 3); };

  RENDER.routemap = function () {
    if (!routeMap) {
      routeMap = window.LAX_MAPS.create({
        host: $('#routemap'), data: D,
        getOpen: function () { return state.routes; },
        toast: function (a, b) { toast(a, b, null, '🗺️'); },
        sound: function (n) { Sound.play(n, 0.35); },
        photo: openPhotoFile, logo: openLogo,
        reduced: function () { return !motionOn(); }
      });
    }
    routeMap.show();
  };

  /* ==========================================================
     15. Settings
     ========================================================== */
  RENDER.settings = function () {
    $('#set-name').value = state.ceo || '';
    $('#set-start').value = state.cfg.start;
    $('#set-tasks').value = (state.cfg.custom || []).join('\n');
    $$('#set-theme button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.v === state.cfg.theme ? 'true' : 'false'); });
    $('#set-sound').setAttribute('aria-checked', state.cfg.sound ? 'true' : 'false');
    $('#set-motion').setAttribute('aria-checked', state.cfg.motion ? 'true' : 'false');
    $('#set-ytthumbs').setAttribute('aria-checked', state.cfg.ytThumbs !== false ? 'true' : 'false');
    $('#set-ask').setAttribute('aria-checked', state.cfg.ask ? 'true' : 'false');
    $('#set-where').textContent = Store.where();
    var t = totals();
    $('#set-stats').textContent = t.logged + ' days logged · ' + t.pts + ' points · ' + state.routes + ' routes · ' + t.revs + ' revisions · ' + Object.keys(state.days).length + ' days with data';
  };

  /* ==========================================================
     16. Theme
     ========================================================== */
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.cfg.theme === 'day' ? 'day' : 'night');
    document.body.classList.toggle('no-motion', !state.cfg.motion);
    var b = $('#theme-toggle');
    b.textContent = state.cfg.theme === 'day' ? '☽' : '☀';
    b.setAttribute('aria-label', state.cfg.theme === 'day' ? 'Switch to night operations' : 'Switch to daylight operations');
    var s = $('#sound-toggle');
    s.textContent = state.cfg.sound ? '🔊' : '🔇';
    s.classList.toggle('is-off', !state.cfg.sound);
    s.setAttribute('aria-label', state.cfg.sound ? 'Turn sound off' : 'Turn sound on');
    var lg = $('#brand-logo');
    lg.onerror = function () { this.onerror = null; this.src = 'assets/img/lax-logo-light.svg'; };
    lg.src = state.cfg.theme === 'day' ? 'assets/img/lax-logo-day.png' : 'assets/img/lax-logo-night.png';
    var mt = document.querySelector('meta[name="theme-color"]');
    if (mt) mt.setAttribute('content', state.cfg.theme === 'day' ? '#EEF3F7' : '#060B13');
  }

  /* ==========================================================
     17. Wire up
     ========================================================== */
  function bind() {
    $$('.tab').forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.go); }); });

    document.addEventListener('click', function (e) {
      var g = e.target.closest('[data-goto]');
      if (g) { closeModal(); go(g.dataset.goto); return; }
      if (e.target.closest('[data-close]')) { closeModal(); return; }
      var fl = e.target.closest('[data-fly]');
      if (fl) { closeModal(); go('routemap'); routeMap.focus(+fl.dataset.fly); return; }
      var lo = e.target.closest('[data-logo]');
      if (lo) { var v = lo.dataset.logo; openLogo(/^\d+$/.test(v) ? D.ROUTES[+v].al : v); return; }
      var ph = e.target.closest('[data-photo]');
      if (ph && !e.target.closest('#routemap')) { openPhotoFile(ph.dataset.photo); return; }
      var pass = e.target.closest('.pass[data-route]');
      if (pass && !e.target.closest('button') && current === 'network') { go('routemap'); routeMap.focus(+pass.dataset.route); }
    });

    $('#theme-toggle').addEventListener('click', function () {
      state.cfg.theme = state.cfg.theme === 'day' ? 'night' : 'day';
      applyTheme(); save(); if (current === 'settings') RENDER.settings();
    });
    $('#sound-toggle').addEventListener('click', function () {
      state.cfg.sound = !state.cfg.sound; applyTheme(); save();
      if (state.cfg.sound) Sound.play('chime-task');
    });
    $('#hero-cap').addEventListener('click', function () { VIEW.open(photoItems(), heroIdx); });
    $('#foot-logo').addEventListener('click', function () {
      VIEW.open([
        { src: 'assets/img/LAX_blue_logo.webp', title: 'LAX — fan made by Billy Christopher', caption: 'The Mission Control fan logo.' },
        { src: 'assets/img/lax-logo-night.png', title: 'LAX wordmark · night', caption: 'Used in the header for Night operations.' },
        { src: 'assets/img/lax-logo-day.png', title: 'LAX wordmark · day', caption: 'Used in the header for Daylight operations.', light: true }
      ], 0);
    });

    // calendar
    $('#cal-prev').addEventListener('click', function () { if (calMonth > 0) { calMonth--; renderCalendar(); } });
    $('#cal-next').addEventListener('click', function () { if (calMonth < MONTH_LIST.length - 1) { calMonth++; renderCalendar(); } });
    $('#btn-today').addEventListener('click', function () {
      var t = todayKey();
      if (t in SEASON_INDEX) selectDay(t);
      else toast('Today is outside the season', 'Pick a day on the calendar, or move the season start in Settings.', null, '🗓');
    });

    // planner
    planner = window.LAX_PLANNER.create($('#planner'), {
      zoom: state.cfg.zoom,
      getTasks: function () { return curDay().t; },
      dayKey: function () { return selectedDay; },
      isToday: function () { return selectedDay === todayKey(); },
      onToggle: function (t) { toggleTask(t); },
      onOpen: function (t) { if (t) openEditor(t); },
      onCreate: function (s, e) { openEditor(null, { s: s, e: e }); },
      onResize: function (t, i, s, e, kind) {
        var verb = kind === 'move' ? 'Moved' : 'Re-timed';
        mutate(verb + ' “' + t.x + '” ' + shortHM(t.s) + '–' + shortHM(t.e) + ' → ' + shortHM(s) + '–' + shortHM(e), function () { t.s = s; t.e = e; });
      },
      onPlace: function (t, i, s, e) { mutate('Scheduled “' + t.x + '” at ' + shortHM(s) + '–' + shortHM(e), function () { t.s = s; t.e = e; }); },
      onZoom: function (z) { state.cfg.zoom = z; save(); }
    });

    // add form
    $('#add-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var inp = $('#add-input'), v = inp.value.trim();
      if (!v) { inp.focus(); return; }
      var nt = mkTask(v);
      var fh = $('#add-fh').value, fm = $('#add-fm').value, th = $('#add-th').value, tm = $('#add-tm').value;
      if (nt.s === null && fh !== '') {
        var s = Math.min(23, Math.max(0, +fh)) * 60 + Math.min(59, Math.max(0, +fm || 0));
        var en = th !== '' ? Math.min(24, Math.max(0, +th)) * 60 + (+th >= 24 ? 0 : Math.min(59, Math.max(0, +tm || 0))) : s + 60;
        if (en <= s) en = Math.min(1440, s + 60);
        nt.s = s; nt.e = Math.min(1440, en);
      }
      ['#add-fh', '#add-fm', '#add-th', '#add-tm'].forEach(function (id) { $(id).value = ''; });
      inp.value = '';
      mutate('Added “' + nt.x + '”' + (nt.s !== null ? ' at ' + shortHM(nt.s) : ''), function (d) { d.t.push(nt); })
        .then(function () { inp.focus(); });
    });

    $('#btn-push').addEventListener('click', function () {
      var day = dayOf(selectedDay);
      if (!day.t.length) return;
      commitDay(false); afterChange();
    });
    $('#btn-log').addEventListener('click', logDay);
    $('#btn-tpl').addEventListener('click', function () {
      var tpl = (state.cfg.custom && state.cfg.custom.length) ? state.cfg.custom : D.TEMPLATES.ops.tasks;
      mutate('Loaded the template (' + tpl.length + ' tasks)', function (d) { tpl.forEach(function (x) { d.t.push(mkTask(x)); }); })
        .then(function (ok) { if (ok) toast('Template loaded', tpl.length + ' tasks added to ' + prettyDate(selectedDay), null, '📋'); });
    });
    $('#btn-copy').addEventListener('click', function () {
      var idx = SEASON_INDEX[selectedDay];
      if (idx === 0) { toast('No day before this one', 'This is day one of the season.', null, 'ℹ️'); return; }
      var prev = state.days[SEASON[idx - 1]];
      if (!prev || !prev.t.length) { toast('Nothing to copy', 'The previous day has no tasks.', null, 'ℹ️'); return; }
      mutate('Copied ' + prev.t.length + ' tasks from yesterday', function (d) {
        prev.t.forEach(function (x) { d.t.push({ x: x.x, d: false, s: x.s === undefined ? null : x.s, e: x.e === undefined ? null : x.e }); });
      });
    });
    $('#btn-clear').addEventListener('click', function () {
      var day = dayOf(selectedDay);
      if (!day.t.length) return;
      confirmBox({ title: 'Clear the whole board?', icon: '🧹', text: 'All tasks on ' + prettyDate(selectedDay) + ' will be removed.', ok: 'Clear it', okCls: 'btn--danger-solid' })
        .then(function (ok) {
          if (!ok) return;
          mutate('Cleared the board', function (d) { d.t = []; if (d.logged) { d.logged = false; d.pts = 0; } });
        });
    });
    $('#btn-all-done').addEventListener('click', function () {
      var day = dayOf(selectedDay);
      if (!day.t.length) return;
      var allDone = day.t.every(function (x) { return x.d; });
      if (!day.committed && !allDone) commitDay(true);
      day.t.forEach(function (x) { x.d = !allDone; });
      if (!allDone) Sound.play('chime-task');
      afterChange();
    });
    $('#btn-fill-month').addEventListener('click', function () {
      var mo = MONTH_LIST[calMonth], tpl = (state.cfg.custom && state.cfg.custom.length) ? state.cfg.custom : D.TEMPLATES.ops.tasks;
      var count = new Date(Date.UTC(mo.y, mo.m + 1, 0)).getUTCDate(), n = 0;
      for (var i = 1; i <= count; i++) {
        var k = key(mo.y, mo.m, i);
        if (!(k in SEASON_INDEX)) continue;
        var day = dayOf(k);
        if (!day.t.length && !day.committed) { tpl.forEach(function (x) { day.t.push(mkTask(x)); }); n++; }
      }
      save(); RENDER.schedule();
      toast('Month filled', n + ' empty day' + (n === 1 ? '' : 's') + ' in ' + MONTHS[mo.m] + ' got your template — free, because none of them had started.', null, '🗓️');
    });
    $('#day-note').addEventListener('input', function () { dayOf(selectedDay).note = this.value; save(); });

    // live board clock
    setInterval(function () { var n = new Date(); $('#board-clock').textContent = pad(n.getHours()) + ':' + pad(n.getMinutes()); }, 10000);
    (function () { var n = new Date(); $('#board-clock').textContent = pad(n.getHours()) + ':' + pad(n.getMinutes()); })();

    // network filters
    $$('.filt[data-f]').forEach(function (b) {
      b.addEventListener('click', function () {
        netFilter = b.dataset.f;
        $$('.filt[data-f]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        RENDER.network();
      });
    });

    // airfield map: drag, wheel, pinch
    var stage = $('#map-stage'), pts = {}, pinch = null, drag = null;
    stage.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.hotspot') || e.target.closest('.map-ctrls')) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      stage.setPointerCapture(e.pointerId);
      var ids = Object.keys(pts);
      if (ids.length === 2) {
        var a = pts[ids[0]], b = pts[ids[1]];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: mapZ }; drag = null;
      } else { drag = { x: e.clientX - mapX, y: e.clientY - mapY }; stage.classList.add('dragging'); }
    });
    stage.addEventListener('pointermove', function (e) {
      if (!pts[e.pointerId]) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pts);
      if (pinch && ids.length >= 2) {
        var a = pts[ids[0]], b = pts[ids[1]], r = stage.getBoundingClientRect();
        var nz = pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d;
        zoomBy(nz / mapZ, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      } else if (drag) { mapX = e.clientX - drag.x; mapY = e.clientY - drag.y; clampMap(); applyMap(); }
    });
    ['pointerup', 'pointercancel'].forEach(function (ev) {
      stage.addEventListener(ev, function (e) {
        delete pts[e.pointerId];
        if (Object.keys(pts).length < 2) pinch = null;
        if (!Object.keys(pts).length) { drag = null; stage.classList.remove('dragging'); }
      });
    });
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = stage.getBoundingClientRect();
      zoomBy(Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    stage.addEventListener('dblclick', function (e) { var r = stage.getBoundingClientRect(); zoomBy(mapZ > 2.5 ? 1 / mapZ : 2, e.clientX - r.left, e.clientY - r.top); });
    $('#map-in').addEventListener('click', function () { zoomBy(1.4); });
    $('#map-out').addEventListener('click', function () { zoomBy(1 / 1.4); });
    $('#map-reset').addEventListener('click', function () { mapZ = 1; mapX = 0; mapY = 0; applyMap(); });
    $('#map-full').addEventListener('click', function () {
      VIEW.open([{ src: 'assets/img/lax-map.jpg', title: 'Los Angeles International Airport', caption: 'Terminals 1–8, Tom Bradley International and the Midfield Satellite Concourse. Zoom in to read every gate number.', light: true }], 0);
    });

    $('#aff-next').addEventListener('click', function () { showAff(affIdx + 1); Sound.play('chime-task', 0.3); });

    // modal
    $('#modal-x').addEventListener('click', closeModal);
    $('#modal-scrim').addEventListener('click', closeModal);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('#modal').hidden && !(VIEW.isOpen && VIEW.isOpen())) closeModal(); });

    /* settings */
    $('#set-name').addEventListener('input', function () {
      state.ceo = this.value.slice(0, 40);
      $('#ceo-name').textContent = state.ceo || 'Chief Executive';
      save();
    });
    $('#set-start').addEventListener('change', function () {
      var v = this.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
      state.cfg.start = v; buildSeason();
      var t = totals();
      state.routes = Math.max(t.logged, 0);
      selectedDay = (todayKey() in SEASON_INDEX) ? todayKey() : SEASON[0];
      calMonth = Math.max(0, MONTH_LIST.findIndex(function (m) { var p = parseKey(selectedDay); return m.y === p.y && m.m === p.m; }));
      save(); boot(true);
      toast('Season moved', 'Now ' + shortDate(SEASON[0]) + ' — ' + shortDate(SEASON[SEASON.length - 1]) + '.', null, '🗓');
    });
    $('#set-tasks').addEventListener('input', function () {
      state.cfg.custom = this.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); save();
    });
    $$('#set-preset button').forEach(function (b) {
      b.addEventListener('click', function () {
        var t = D.TEMPLATES[b.dataset.tpl];
        state.cfg.custom = t.tasks.slice(); $('#set-tasks').value = t.tasks.join('\n'); save();
        toast('Template loaded', '“' + t.name + '” is now your daily starting list.', null, '📋');
      });
    });
    $$('#set-theme button').forEach(function (b) {
      b.addEventListener('click', function () { state.cfg.theme = b.dataset.v; applyTheme(); save(); RENDER.settings(); });
    });
    function sw(id, keyName, after) {
      $(id).addEventListener('click', function () { state.cfg[keyName] = !state.cfg[keyName]; applyTheme(); save(); RENDER.settings(); if (after) after(); });
    }
    sw('#set-sound', 'sound', function () { if (state.cfg.sound) Sound.play('chime-route'); });
    sw('#set-motion', 'motion');
    sw('#set-ask', 'ask');
    $('#set-ytthumbs').addEventListener('click', function () {
      state.cfg.ytThumbs = state.cfg.ytThumbs === false; save(); RENDER.settings();
      ['#vid-guide', '#vid-la'].forEach(function (id) { var h = $(id); h.innerHTML = ''; delete h.dataset.built; });
      videoCards(D.VIDEOS_GUIDE, '#vid-guide', 0); videoCards(D.VIDEOS_LA, '#vid-la', 3);
    });
    $('#set-export').addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'lax-mission-control-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      toast('Progress saved to a file', 'Keep it somewhere safe. You can load it back any time.', null, '💾');
    });
    $('#set-import').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var d = JSON.parse(fr.result);
          if (!d || typeof d !== 'object' || !d.days) throw new Error('bad file');
          state = migrate(d); buildSeason(); selectedDay = null; save(); boot(true);
          toast('Progress restored', 'Welcome back, Chief.', null, '✅');
        } catch (err) { toast('That file would not open', 'It needs to be a progress file exported from this site.', 'mag', '⚠️'); }
        e.target.value = '';
      };
      fr.readAsText(f);
    });
    $('#set-reset').addEventListener('click', function () {
      confirmBox({ title: 'Start the season over?', icon: '🧨', text: 'This erases every logged day, every point and every route. There is no undo.', ok: 'Yes, erase it', okCls: 'btn--danger-solid' })
        .then(function (ok) {
          if (!ok) return;
          return confirmBox({ title: 'Really?', icon: '⚠️', text: 'Last chance. The season restarts from day one.', ok: 'Erase everything', okCls: 'btn--danger-solid' });
        }).then(function (ok) {
          if (!ok) return;
          var cfg = state.cfg;
          state = clone(DEFAULTS);
          ['theme', 'sound', 'motion', 'start', 'ask', 'custom', 'ytThumbs', 'zoom'].forEach(function (k) { state.cfg[k] = cfg[k]; });
          Store.set(KEY, JSON.stringify(state));
          buildSeason(); selectedDay = null; boot(true);
          toast('Season reset', 'Clean board, day one.', null, '↻');
        });
    });
    $('#set-replay').addEventListener('click', function () {
      if (state.routes > 0) showUnlock(state.routes - 1);
      else toast('Nothing to replay yet', 'Log a day first and your opening route will appear here.', null, 'ℹ️');
    });

    window.addEventListener('hashchange', function () { go(location.hash.slice(1)); });
  }

  /* ==========================================================
     18. Boot
     ========================================================== */
  function boot(rerender) {
    applyTheme();
    $('#ceo-name').textContent = state.ceo || 'Chief Executive';
    if (!selectedDay || !(selectedDay in SEASON_INDEX)) {
      var t0 = todayKey();
      selectedDay = (t0 in SEASON_INDEX) ? t0 : SEASON[0];
    }
    var p = parseKey(selectedDay);
    calMonth = Math.max(0, MONTH_LIST.findIndex(function (m) { return m.y === p.y && m.m === p.m; }));
    var t = totals();
    if (t.logged > state.routes) state.routes = Math.min(t.logged, D.ROUTES.length);
    simCache = null;
    RENDER.tower();
    RENDER.schedule();
    RENDER.network();
    if (rerender) {
      if ($('#map-pan').dataset.built) showTerminal(activeTerm || 'TBIT');
      RENDER.settings();
      if (RENDER[current]) RENDER[current]();
      if (routeMap) routeMap.refresh();
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    load().then(function () {
      buildSeason();
      bind();
      boot(false);
      go(location.hash.slice(1) || 'tower');
      setTimeout(function () {
        $('#boot-veil').classList.add('gone');
        setTimeout(function () { var v = $('#boot-veil'); if (v) v.remove(); }, 800);
      }, 650);
    });
  });
})();
