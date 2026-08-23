/* =============================================================
   LAX MISSION CONTROL — application
   ============================================================= */
(function () {
  'use strict';

  var D = window.LAX_DATA;
  var KEY = 'lax-mission-control:v1';
  var MAX_PER_DAY = 16;

  /* ==========================================================
     1. Storage — window.storage first, localStorage second,
        memory last. Everything is awaited so both work.
     ========================================================== */
  var Store = (function () {
    var mem = {};
    var localOK = (function () {
      try {
        var k = '__lax_probe__';
        window.localStorage.setItem(k, '1');
        window.localStorage.removeItem(k);
        return true;
      } catch (e) { return false; }
    })();

    function hasWin() {
      return !!(window.storage && typeof window.storage.get === 'function' &&
                typeof window.storage.set === 'function');
    }

    return {
      where: function () { return hasWin() ? 'window.storage' : (localOK ? 'localStorage' : 'this tab only'); },

      get: function (key) {
        if (hasWin()) {
          return Promise.resolve()
            .then(function () { return window.storage.get(key, false); })
            .then(function (r) { return r && r.value != null ? r.value : null; })
            .catch(function () { return localOK ? window.localStorage.getItem(key) : (mem[key] || null); });
        }
        if (localOK) {
          try { return Promise.resolve(window.localStorage.getItem(key)); } catch (e) {}
        }
        return Promise.resolve(mem[key] != null ? mem[key] : null);
      },

      set: function (key, value) {
        if (hasWin()) {
          return Promise.resolve()
            .then(function () { return window.storage.set(key, value, false); })
            .then(function () { return true; })
            .catch(function () {
              if (localOK) { try { window.localStorage.setItem(key, value); return true; } catch (e) {} }
              mem[key] = value; return true;
            });
        }
        if (localOK) {
          try { window.localStorage.setItem(key, value); return Promise.resolve(true); } catch (e) {}
        }
        mem[key] = value;
        return Promise.resolve(true);
      },

      del: function (key) {
        if (hasWin()) {
          return Promise.resolve()
            .then(function () { return window.storage.delete(key, false); })
            .catch(function () {})
            .then(function () { if (localOK) { try { window.localStorage.removeItem(key); } catch (e) {} } delete mem[key]; });
        }
        if (localOK) { try { window.localStorage.removeItem(key); } catch (e) {} }
        delete mem[key];
        return Promise.resolve();
      }
    };
  })();

  /* ==========================================================
     2. State
     ========================================================== */
  var DEFAULTS = {
    v: 1,
    ceo: '',
    days: {},
    routes: 0,
    won: false,
    wonAt: null,
    cfg: {
      theme: 'night',
      sound: true,
      motion: true,
      tpl: 'ops',
      ytThumbs: true,
      custom: D.TEMPLATES.ops.tasks.slice()
    }
  };

  var state = clone(DEFAULTS);
  var saveTimer = null;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      Store.set(KEY, JSON.stringify(state));
    }, 220);
  }

  function load() {
    return Store.get(KEY).then(function (raw) {
      if (!raw) return;
      try {
        var d = JSON.parse(raw);
        if (d && typeof d === 'object') {
          state = Object.assign(clone(DEFAULTS), d);
          state.cfg = Object.assign(clone(DEFAULTS.cfg), d.cfg || {});
          state.days = d.days || {};
        }
      } catch (e) { /* corrupt save — start clean rather than crash */ }
    });
  }

  /* ==========================================================
     3. Dates
     ========================================================== */
  var MONTHS = ['January','February','March','April','May','June','July',
                'August','September','October','November','December'];
  var DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  function key(y, m, d) {
    return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  function parseKey(k) {
    var p = k.split('-');
    return { y: +p[0], m: +p[1] - 1, d: +p[2] };
  }
  function prettyDate(k) {
    var p = parseKey(k);
    var dt = new Date(Date.UTC(p.y, p.m, p.d));
    return DOW[dt.getUTCDay()] + ' ' + p.d + ' ' + MONTHS[p.m] + ' ' + p.y;
  }

  // every day of the season, in order
  var SEASON = (function () {
    var out = [];
    var d = new Date(Date.UTC(2026, 8, 1));
    var end = new Date(Date.UTC(2026, 11, 31));
    while (d <= end) {
      out.push(key(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
  })();
  var SEASON_INDEX = {};
  SEASON.forEach(function (k, i) { SEASON_INDEX[k] = i; });
  var TOTAL_DAYS = SEASON.length;          // 122
  var MAX_POINTS = TOTAL_DAYS * MAX_PER_DAY;

  var MONTH_LIST = [{ y: 2026, m: 8 }, { y: 2026, m: 9 }, { y: 2026, m: 10 }, { y: 2026, m: 11 }];

  function todayKey() {
    var n = new Date();
    return key(n.getFullYear(), n.getMonth(), n.getDate());
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
    if (!state.days[k]) state.days[k] = { t: [], logged: false, pts: 0, note: '' };
    return state.days[k];
  }
  function doneCount(day) { return day.t.filter(function (x) { return x.d; }).length; }

  function totals() {
    var pts = 0, logged = 0, gold = 0, tasksDone = 0;
    SEASON.forEach(function (k) {
      var d = state.days[k];
      if (!d) return;
      tasksDone += doneCount(d);
      if (d.logged) {
        logged++;
        pts += d.pts || 0;
        if (d.pts === 16) gold++;
      }
    });
    return { pts: pts, logged: logged, gold: gold, tasksDone: tasksDone };
  }

  function streak() {
    var best = 0, cur = 0, run = 0;
    for (var i = 0; i < SEASON.length; i++) {
      var d = state.days[SEASON[i]];
      if (d && d.logged) { run++; if (run > best) best = run; }
      else run = 0;
    }
    // current = run ending at the last logged day
    var last = -1;
    for (var j = SEASON.length - 1; j >= 0; j--) {
      var dd = state.days[SEASON[j]];
      if (dd && dd.logged) { last = j; break; }
    }
    if (last >= 0) {
      cur = 0;
      for (var m = last; m >= 0; m--) {
        var e = state.days[SEASON[m]];
        if (e && e.logged) cur++; else break;
      }
    }
    return { best: best, cur: cur };
  }

  function rankNow() {
    var t = totals();
    var pct = t.pts / MAX_POINTS;
    var r = D.RANKS[0];
    for (var i = 0; i < D.RANKS.length; i++) {
      if (pct >= D.RANKS[i].at) r = D.RANKS[i];
    }
    // #1 is reserved for a completed season
    if (r.world === 1 && !state.won) r = D.RANKS[D.RANKS.length - 2];
    if (state.won) r = D.RANKS[D.RANKS.length - 1];
    return { rank: r, pct: pct, pts: t.pts };
  }

  /* ==========================================================
     5. Small helpers
     ========================================================== */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  var TICK = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 6.2 4.4 9 10.5 2.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* ---------- audio ---------- */
  var Sound = (function () {
    var cache = {};
    function play(name) {
      if (!state.cfg.sound) return;
      try {
        var a = cache[name] || (cache[name] = new Audio('assets/audio/' + name + '.wav'));
        a.currentTime = 0;
        a.volume = 0.5;
        var p = a.play();
        if (p && p.catch) p.catch(function () {});
      } catch (e) {}
    }
    return { play: play };
  })();

  /* ---------- toast ---------- */
  function toast(title, desc, kind, icon) {
    var host = $('#toasts');
    var t = el('div', 'toast' + (kind ? ' toast--' + kind : ''));
    t.innerHTML = '<div class="toast__ic">' + (icon || '\u2708\uFE0F') + '</div>' +
      '<div><div class="toast__t">' + esc(title) + '</div>' +
      (desc ? '<div class="toast__d">' + esc(desc) + '</div>' : '') + '</div>';
    host.appendChild(t);
    setTimeout(function () {
      t.classList.add('out');
      setTimeout(function () { t.remove(); }, 300);
    }, 4200);
  }

  /* ==========================================================
     6. Router / tabs
     ========================================================== */
  var VIEWS = ['tower', 'schedule', 'airfield', 'network', 'briefing', 'discover', 'settings'];
  var current = 'tower';

  function go(name) {
    if (VIEWS.indexOf(name) < 0) name = 'tower';
    current = name;
    VIEWS.forEach(function (v) {
      var n = $('#view-' + v);
      if (n) n.hidden = (v !== name);
    });
    $$('.tab').forEach(function (b) {
      b.setAttribute('aria-selected', b.dataset.go === name ? 'true' : 'false');
    });
    if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
    RENDER[name] && RENDER[name]();
    window.scrollTo({ top: 0, behavior: state.cfg.motion ? 'smooth' : 'auto' });
  }

  /* ==========================================================
     7. Views
     ========================================================== */
  var RENDER = {};
  var selectedDay = null;
  var calMonth = 0;

  // header chips stay live no matter which tab you are on
  function updateChips() {
    var t = totals();
    var r = rankNow();
    $('#hd-rank').textContent = '#' + r.rank.world;
    $('#hd-pts').textContent = t.pts.toLocaleString();
    $('#hd-routes').textContent = state.routes;
  }

  /* ---------- 7a. Mission Control ---------- */
  RENDER.tower = function () {
    var t = totals();
    var r = rankNow();
    var s = streak();
    var pctDays = Math.round(t.logged / TOTAL_DAYS * 100);

    $('#hero-title').textContent = state.won
      ? 'LAX is number one in the world'
      : 'Make LAX the number one airport in the world';

    $('#hero-sub').textContent = state.won
      ? 'You logged all ' + TOTAL_DAYS + ' days of the season. Every route on the board is open. This is what the finish line looks like.'
      : 'You are the Chief Executive of Los Angeles World Airports. Every day you keep your own schedule, this airport gets better and a new route opens. ' +
        TOTAL_DAYS + ' days. ' + TOTAL_DAYS + ' routes. One goal.';

    $('#hero-cta').textContent = t.logged ? 'Open the schedule' : 'Start day one';

    // pylons — 30 light columns across the season
    var py = $('#pylons');
    py.innerHTML = '';
    var lit = Math.round(t.logged / TOTAL_DAYS * 30);
    for (var i = 0; i < 30; i++) {
      var p = el('i', 'pylon' + (i < lit ? ' on' : '') + (i < lit && i >= 24 ? ' hot' : ''));
      p.style.height = (26 + ((i * 37) % 32)) + 'px';
      py.appendChild(p);
    }

    $('#hd-rank').textContent = '#' + r.rank.world;
    $('#hd-pts').textContent = t.pts.toLocaleString();
    $('#hd-routes').textContent = state.routes;

    $('#st-rank').textContent = '#' + r.rank.world;
    $('#st-rank-n').textContent = r.rank.title;
    $('#st-pts').textContent = t.pts.toLocaleString();
    $('#st-pts-n').textContent = 'of ' + MAX_POINTS.toLocaleString() + ' possible';
    $('#st-days').textContent = t.logged + '/' + TOTAL_DAYS;
    $('#st-days-n').textContent = pctDays + '% of the season logged';
    $('#st-routes').textContent = state.routes;
    $('#st-routes-n').textContent = (TOTAL_DAYS - state.routes) + ' still to open';
    $('#st-streak').textContent = s.cur;
    $('#st-streak-n').textContent = 'best run: ' + s.best + ' day' + (s.best === 1 ? '' : 's');
    $('#st-perfect').textContent = t.gold;
    $('#st-perfect-n').textContent = 'days at 100%';

    $('#rank-note').textContent = r.rank.note;
    $('#rank-bar').style.width = Math.min(100, r.pct * 100) + '%';
    $('#rank-pct').textContent = Math.round(r.pct * 100) + '%';

    // latest route
    var box = $('#latest-route');
    if (state.routes > 0) {
      box.innerHTML = routeCard(state.routes - 1, true);
    } else {
      box.innerHTML = '<div class="card" style="text-align:center;padding:30px 18px">' +
        '<div style="font-size:34px">\uD83D\uDEEB</div>' +
        '<h3 style="margin-top:10px">The board is empty</h3>' +
        '<p class="lede" style="margin-inline:auto">Log your first day and LAX opens its first new route of the season.</p></div>';
    }

    $('#nudge').textContent = pick(D.NUDGES);
    $('#storage-where').textContent = Store.where();
  };

  /* ---------- 7b. Schedule ---------- */
  RENDER.schedule = function () {
    var mo = MONTH_LIST[calMonth];
    $('#cal-month').textContent = MONTHS[mo.m].toUpperCase() + ' ' + mo.y;
    $('#cal-prev').disabled = calMonth === 0;
    $('#cal-next').disabled = calMonth === MONTH_LIST.length - 1;

    var grid = $('#cal-grid');
    grid.innerHTML = '';
    DOW.forEach(function (d) { grid.appendChild(el('div', 'cal-dow', d)); });

    var first = new Date(Date.UTC(mo.y, mo.m, 1)).getUTCDay();
    var count = new Date(Date.UTC(mo.y, mo.m + 1, 0)).getUTCDate();
    for (var b = 0; b < first; b++) grid.appendChild(el('div', 'day is-empty'));

    var monthPts = 0, monthLogged = 0;

    for (var d = 1; d <= count; d++) {
      var k = key(mo.y, mo.m, d);
      var rec = state.days[k];
      var btn = el('button', 'day');
      btn.type = 'button';
      btn.dataset.k = k;
      btn.setAttribute('aria-label', prettyDate(k));

      var total = rec ? rec.t.length : 0;
      var done = rec ? doneCount(rec) : 0;
      var pct = total ? done / total : 0;

      if (rec && rec.logged) {
        var tk = rec.pts === 16 ? 'gold' : rec.pts === 8 ? 'silver' : rec.pts === 4 ? 'bronze' : 'none';
        btn.classList.add('tier-' + tk);
        monthPts += rec.pts || 0;
        monthLogged++;
      }
      if (total) btn.classList.add('has-tasks');
      if (k === selectedDay) btn.classList.add('is-sel');

      btn.innerHTML =
        '<span class="day__n">' + d + '</span>' +
        (total ? '<span class="day__dot"></span>' : '') +
        (total ? '<span class="day__bar"><i style="width:' + (pct * 100) + '%"></i></span>' : '') +
        '<span class="day__pts">' + (rec && rec.logged ? '+' + rec.pts : (total ? done + '/' + total : '')) + '</span>';

      btn.addEventListener('click', function () { selectDay(this.dataset.k); });
      grid.appendChild(btn);
    }

    $('#cal-summary').textContent = monthLogged + ' of ' + count + ' days logged this month \u00B7 ' + monthPts + ' points';
    updateChips();

    if (!selectedDay) {
      var t0 = todayKey();
      selectedDay = (t0 in SEASON_INDEX) ? t0 : SEASON[0];
    }
    renderDayPanel();
  };

  function selectDay(k) {
    selectedDay = k;
    var p = parseKey(k);
    var idx = MONTH_LIST.findIndex(function (m) { return m.y === p.y && m.m === p.m; });
    if (idx >= 0) calMonth = idx;
    RENDER.schedule();
    var panel = $('#day-panel');
    if (panel && window.innerWidth < 980) panel.scrollIntoView({ behavior: state.cfg.motion ? 'smooth' : 'auto', block: 'start' });
  }

  /* ---------- Time blocking ---------------------------------------------
     A task may carry s (start) and e (end), both minutes from midnight,
     or null when it is not scheduled. Displayed as 00h.00m - 00h.00m.     */

  function fmtHM(m) {
    if (m === null || m === undefined) return '';
    var h = Math.floor(m / 60), n = m % 60;
    return String(h).padStart(2, '0') + 'h.' + String(n).padStart(2, '0') + 'm';
  }
  function fmtRange(a, b) {
    if (a === null || a === undefined) return '';
    if (b === null || b === undefined) return fmtHM(a);
    return fmtHM(a) + ' - ' + fmtHM(b);
  }
  function toInputTime(m) {
    if (m === null || m === undefined) return '';
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }
  function fromInputTime(v) {
    if (!v) return null;
    var p = String(v).split(':');
    var h = parseInt(p[0], 10), n = parseInt(p[1] || '0', 10);
    if (isNaN(h) || isNaN(n)) return null;
    return Math.max(0, Math.min(1439, h * 60 + n));
  }
  function durOf(a, b) {
    if (a === null || a === undefined || b === null || b === undefined) return null;
    var d = b - a;
    if (d < 0) d += 1440;            // block runs past midnight
    return d;
  }
  function fmtDur(d) {
    if (d === null) return '';
    var h = Math.floor(d / 60), n = d % 60;
    if (!h) return n + 'm';
    if (!n) return h + 'h';
    return h + 'h ' + n + 'm';
  }

  /* "08.00-09.30 Deep work" -> { s:480, e:570, x:'Deep work' }
     Only a dash separator counts, so "Read 10 pages" stays plain text.   */
  var RE_BLOCK = /^\s*(\d{1,2})(?:\s*[.:h]\s*\.?\s*(\d{1,2}))?\s*m?\s*(?:-|\u2013|\u2014)\s*(\d{1,2})(?:\s*[.:h]\s*\.?\s*(\d{1,2}))?\s*m?\s*[\s:\u00B7|,]*(.*)$/;
  function parseTaskLine(line) {
    var m = RE_BLOCK.exec(line);
    if (!m) return { s: null, e: null, x: String(line).trim() };
    var h1 = +m[1], n1 = m[2] ? +m[2] : 0, h2 = +m[3], n2 = m[4] ? +m[4] : 0;
    var rest = (m[5] || '').trim();
    if (h1 > 23 || h2 > 23 || n1 > 59 || n2 > 59 || !rest) {
      return { s: null, e: null, x: String(line).trim() };
    }
    return { s: h1 * 60 + n1, e: h2 * 60 + n2, x: rest };
  }
  function mkTask(line) {
    var p = parseTaskLine(line);
    return { x: p.x, d: false, s: p.s, e: p.e };
  }

  /* earliest first; unscheduled keep their order at the bottom */
  function sortDay(day) {
    if (!day || !day.t) return;
    day.t.forEach(function (t, i) { t.__i = i; });
    day.t.sort(function (a, b) {
      var au = (a.s === null || a.s === undefined) ? 1 : 0;
      var bu = (b.s === null || b.s === undefined) ? 1 : 0;
      if (au !== bu) return au - bu;
      if (au) return a.__i - b.__i;
      if (a.s !== b.s) return a.s - b.s;
      return a.__i - b.__i;
    });
    day.t.forEach(function (t) { delete t.__i; });
  }

  /* indices whose block runs into the one before it */
  function clashSet(list) {
    var out = {}, prevEnd = null, prevIdx = -1;
    list.forEach(function (t, i) {
      if (t.s === null || t.s === undefined || t.e === null || t.e === undefined) return;
      if (prevEnd !== null && t.s < prevEnd) { out[i] = true; out[prevIdx] = true; }
      if (prevEnd === null || t.e > prevEnd) { prevEnd = t.e; prevIdx = i; }
    });
    return out;
  }

  function plannedMinutes(list) {
    var total = 0;
    list.forEach(function (t) {
      var d = durOf(t.s, t.e);
      if (d) total += d;
    });
    return total;
  }

  /* the horizontal day strip above the board */
  function renderTimeline(day) {
    var host = $('#day-tl');
    if (!host) return;
    var timed = day.t.filter(function (t) {
      return t.s !== null && t.s !== undefined && t.e !== null && t.e !== undefined;
    });
    if (!timed.length) { host.hidden = true; host.innerHTML = ''; return; }
    host.hidden = false;

    var lo = 1440, hi = 0;
    timed.forEach(function (t) {
      var end = t.e < t.s ? 1440 : t.e;       // clamp midnight wrap for drawing
      if (t.s < lo) lo = t.s;
      if (end > hi) hi = end;
    });
    lo = Math.max(0, Math.floor(lo / 60) * 60 - 30);
    hi = Math.min(1440, Math.ceil(hi / 60) * 60 + 30);
    if (hi - lo < 240) hi = Math.min(1440, lo + 240);
    var span = hi - lo;

    var ticks = '';
    var step = span > 600 ? 120 : 60;
    for (var m = Math.ceil(lo / step) * step; m <= hi; m += step) {
      var lp = ((m - lo) / span) * 100;
      ticks += '<div class="tl__tick" style="left:' + lp.toFixed(2) + '%"><span>' +
               String(Math.floor(m / 60)).padStart(2, '0') + 'h</span></div>';
    }

    var blocks = '';
    timed.forEach(function (t) {
      var end = t.e < t.s ? 1440 : t.e;
      var L = ((t.s - lo) / span) * 100;
      var W = Math.max(1.6, ((end - t.s) / span) * 100);
      blocks += '<div class="tl__b' + (t.d ? ' is-done' : '') + '" style="left:' + L.toFixed(2) +
                '%;width:' + W.toFixed(2) + '%" title="' + esc(fmtRange(t.s, t.e) + ' \u00B7 ' + t.x) + '">' +
                '<span>' + esc(t.x) + '</span></div>';
    });

    var planned = plannedMinutes(day.t);
    host.innerHTML =
      '<div class="tl__head"><span>Your day, blocked out</span><span class="tl__sum">' +
        timed.length + ' block' + (timed.length === 1 ? '' : 's') + ' \u00B7 ' + fmtDur(planned) + ' planned</span></div>' +
      '<div class="tl__track">' + ticks + '<div class="tl__blocks">' + blocks + '</div></div>';
  }

  function renderDayPanel() {
    var k = selectedDay;
    var day = state.days[k] || { t: [], logged: false, pts: 0, note: '' };
    var total = day.t.length;
    var done = doneCount(day);
    var tier = tierOf(done, total);
    var idx = SEASON_INDEX[k];

    $('#day-date').textContent = prettyDate(k);
    $('#day-idx').textContent = 'Day ' + (idx + 1) + ' of ' + TOTAL_DAYS;

    // the board
    sortDay(day);
    renderTimeline(day);
    var clash = clashSet(day.t);
    var rows = $('#board-rows');
    rows.innerHTML = '';
    if (!total) {
      rows.innerHTML = '<div class="board__empty">No flights on the board yet.<br>Add a task below, or load your template.</div>';
    } else {
      day.t.forEach(function (task, i) {
        var row = el('div', 'flap' + (task.d ? ' is-done' : '') + (clash[i] ? ' is-clash' : ''));
        if (state.cfg.motion) row.style.animationDelay = (i * 46) + 'ms';
        else row.style.animation = 'none';
        var dmin = durOf(task.s, task.e);
        var timed = task.s !== null && task.s !== undefined;
        row.innerHTML =
          '<div class="flap__lead">' +
            '<span class="flap__tick" aria-hidden="true">' + TICK + '</span>' +
            '<span class="flap__no">' + String(i + 1).padStart(2, '0') + '</span>' +
          '</div>' +
          '<button class="flap__time' + (timed ? '' : ' is-unset') + '" type="button" ' +
            'aria-label="' + (timed ? 'Time block ' + fmtRange(task.s, task.e) + '. Click to change.' : 'No time set. Click to add a time block.') + '">' +
            '<span class="flap__time-v">' + (timed ? esc(fmtRange(task.s, task.e)) : 'set time') + '</span>' +
            (dmin ? '<span class="flap__time-d">' + fmtDur(dmin) + '</span>' : '') +
          '</button>' +
          '<div class="flap__txt' + (task.d ? ' done' : '') + '" tabindex="0" role="textbox" ' +
            'aria-label="Task ' + (i + 1) + '. Click to edit.">' + esc(task.x) + '</div>' +
          '<div class="flap__st ' + (task.d ? 'st--gone' : 'st--wait') + '">' + (task.d ? 'Departed' : 'Boarding') + '</div>' +
          '<button class="flap__x" type="button" aria-label="Remove this task">\u00D7</button>';

        // ---- time block editor
        var tbtn = row.querySelector('.flap__time');
        tbtn.addEventListener('click', function () {
          if (row.querySelector('.tedit')) return;
          var box = el('div', 'tedit');
          box.innerHTML =
            '<label>From<input type="time" class="tedit__f" value="' + toInputTime(task.s) + '"></label>' +
            '<span class="tedit__dash">\u2013</span>' +
            '<label>To<input type="time" class="tedit__t" value="' + toInputTime(task.e) + '"></label>' +
            '<div class="tedit__q">' +
              '<button type="button" data-add="30">+30m</button>' +
              '<button type="button" data-add="60">+1h</button>' +
              '<button type="button" data-add="90">+90m</button>' +
            '</div>' +
            '<div class="tedit__go">' +
              '<button type="button" class="btn btn--sm btn--go tedit__save">Save</button>' +
              '<button type="button" class="btn btn--sm tedit__clear">Clear</button>' +
            '</div>';
          tbtn.replaceWith(box);
          var f = box.querySelector('.tedit__f'), t2 = box.querySelector('.tedit__t');
          f.focus();
          box.querySelectorAll('.tedit__q button').forEach(function (q) {
            q.addEventListener('click', function () {
              var st = fromInputTime(f.value);
              if (st === null) { st = 9 * 60; f.value = toInputTime(st); }
              t2.value = toInputTime((st + (+q.dataset.add)) % 1440);
            });
          });
          function commitTime() {
            task.s = fromInputTime(f.value);
            task.e = fromInputTime(t2.value);
            if (task.s === null) task.e = null;      // no start, no block
            save(); renderDayPanel(); RENDER.schedule();
          }
          box.querySelector('.tedit__save').addEventListener('click', commitTime);
          box.querySelector('.tedit__clear').addEventListener('click', function () {
            task.s = null; task.e = null;
            save(); renderDayPanel(); RENDER.schedule();
          });
          box.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); commitTime(); }
            if (e.key === 'Escape') { e.preventDefault(); renderDayPanel(); }
          });
        });

        // toggle
        var lead = row.querySelector('.flap__lead');
        lead.style.cursor = 'pointer';
        lead.setAttribute('role', 'checkbox');
        lead.setAttribute('tabindex', '0');
        lead.setAttribute('aria-checked', task.d ? 'true' : 'false');
        lead.setAttribute('aria-label', (task.d ? 'Mark as not done: ' : 'Mark as done: ') + task.x);
        function toggle() {
          task.d = !task.d;
          if (task.d) Sound.play('chime-task');
          if (day.logged) recomputeLogged(k);
          save(); renderDayPanel(); RENDER.schedule();
        }
        lead.addEventListener('click', toggle);
        lead.addEventListener('keydown', function (e) {
          if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
        });

        // inline edit
        var txt = row.querySelector('.flap__txt');
        function edit() {
          if (txt.querySelector('input')) return;
          var inp = el('input', 'flap__edit');
          inp.type = 'text';
          inp.value = task.x;
          txt.textContent = '';
          txt.appendChild(inp);
          inp.focus(); inp.select();
          function commit() {
            var v = inp.value.trim();
            if (v) task.x = v;
            save(); renderDayPanel();
          }
          inp.addEventListener('blur', commit);
          inp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
            if (e.key === 'Escape') { inp.value = task.x; inp.blur(); }
          });
        }
        txt.addEventListener('click', edit);
        txt.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); edit(); }
        });

        row.querySelector('.flap__x').addEventListener('click', function () {
          day.t.splice(i, 1);
          if (day.logged) recomputeLogged(k);
          save(); renderDayPanel(); RENDER.schedule();
        });

        rows.appendChild(row);
      });
    }

    // tiers
    var tr = $('#tier-row');
    tr.innerHTML = '';
    [[0.5, 4, '50%'], [0.75, 8, '75%'], [1, 16, '100%']].forEach(function (t) {
      var need = total ? needFor(t[0], total) : 0;
      var hit = total && done >= need;
      var c = el('div', 'tier-card' + (hit ? ' hit' : '') + (!hit && total ? ' next' : ''));
      c.innerHTML = '<div class="tier-card__t">' + t[2] + ' of the board</div>' +
        '<div class="tier-card__p">' + t[1] + ' pts</div>' +
        '<div class="tier-card__n">' + (!total ? 'add tasks first'
          : hit ? 'reached \u2713' : (need - done) + ' more to go') + '</div>';
      tr.appendChild(c);
    });

    // status line
    var st = $('#day-status');
    if (day.logged) {
      st.innerHTML = '<b style="color:var(--green)">Logged \u00B7 ' + day.pts + ' points</b> \u2014 ' + esc(tier.label);
    } else if (total) {
      st.innerHTML = '<b>' + done + ' of ' + total + ' done</b> \u2014 logging now scores <b>' + tier.pts + ' point' + (tier.pts === 1 ? '' : 's') + '</b>';
    } else {
      st.innerHTML = 'Add what you want to get done today, then log the day.';
    }

    $('#day-note').value = day.note || '';
    $('#btn-log').textContent = day.logged ? 'Reopen this day' : 'Log this day';
    $('#btn-log').className = 'btn ' + (day.logged ? 'btn--ghost' : 'btn--go');
    $('#btn-log').disabled = !total && !day.logged;

    // which route this day opens
    var rn = $('#day-route');
    if (idx < state.routes) {
      var rt = D.ROUTES[idx];
      rn.innerHTML = '<div class="stat__k">This day opened</div>' +
        '<div style="display:flex;align-items:center;gap:10px;margin-top:8px">' +
        '<span class="route__logo" style="margin:0"><img src="assets/img/airlines/' + rt.al + '.webp" alt="' + esc(D.AIRLINES[rt.al].name) + '" loading="lazy"></span>' +
        '<div><b style="font-family:var(--mono)">LAX \u2192 ' + rt.a + '</b><br><span style="color:var(--dim);font-size:12px">' + esc(rt.c) + '</span></div></div>';
    } else {
      rn.innerHTML = '<div class="stat__k">Locked route</div>' +
        '<p style="color:var(--dim);font-size:12.5px;margin:8px 0 0">Log this day to find out where LAX flies next.</p>';
    }
  }

  function recomputeLogged(k) {
    var day = state.days[k];
    if (!day || !day.logged) return;
    day.pts = tierOf(doneCount(day), day.t.length).pts;
  }

  function logDay() {
    var k = selectedDay;
    var day = dayOf(k);

    if (day.logged) {
      day.logged = false;
      day.pts = 0;
      save(); renderDayPanel(); RENDER.schedule();
      toast('Day reopened', 'Routes you have already opened stay open.', null, '\u21A9\uFE0F');
      return;
    }
    if (!day.t.length) return;

    var done = doneCount(day);
    var tier = tierOf(done, day.t.length);
    day.logged = true;
    day.pts = tier.pts;
    day.loggedAt = Date.now();

    var t = totals();
    var newRoutes = Math.max(state.routes, t.logged);
    var opened = newRoutes > state.routes ? newRoutes - 1 : -1;
    state.routes = newRoutes;

    Sound.play(tier.k === 'gold' ? 'chime-day' : 'chime-day');
    toast(tier.k === 'none' ? 'Day logged' : '+' + tier.pts + ' points',
          pick(D.CHEERS[tier.k]),
          tier.k === 'gold' ? 'gold' : null,
          tier.k === 'gold' ? '\uD83C\uDFC6' : tier.k === 'none' ? '\uD83C\uDF27\uFE0F' : '\u2705');

    save();
    renderDayPanel();
    RENDER.schedule();

    if (opened >= 0) setTimeout(function () { showUnlock(opened); }, 620);

    if (t.logged >= TOTAL_DAYS && !state.won) {
      state.won = true;
      state.wonAt = Date.now();
      save();
      updateChips();
      RENDER.tower();
      setTimeout(showVictory, opened >= 0 ? 2200 : 900);
    }
  }

  /* ---------- 7c. Airfield map ---------- */
  var mapZ = 1, mapX = 0, mapY = 0, activeTerm = null;

  RENDER.airfield = function () {
    var host = $('#map-pan');
    if (!host.dataset.built) {
      D.TERMINALS.forEach(function (t) {
        var b = el('button', 'hotspot' + (t.id === 'THEME' || t.id === 'WCTA' || t.id === 'ECTA' ? ' small' : ''));
        b.type = 'button';
        b.style.left = t.x + '%';
        b.style.top = t.y + '%';
        b.textContent = t.short;
        b.title = t.name;
        b.setAttribute('aria-label', t.name);
        b.dataset.id = t.id;
        b.addEventListener('click', function (e) { e.stopPropagation(); showTerminal(t.id); });
        host.appendChild(b);
      });
      host.dataset.built = '1';
    }
    var list = $('#term-list');
    if (!list.dataset.built) {
      D.TERMINALS.forEach(function (t) {
        var b = el('button', 'filt');
        b.type = 'button';
        b.textContent = t.chip || t.name;
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

    var opened = D.ROUTES.slice(0, state.routes)
      .map(function (r, i) { return { r: r, i: i }; })
      .filter(function (o) { return o.r.t === id; });

    var html =
      '<div class="eyebrow">' + (t.id.length <= 4 && /^T\d|TBIT|MSC/.test(t.id) ? 'Terminal' : 'Landmark') + '</div>' +
      '<h3>' + esc(t.name) + '</h3>' +
      '<p style="font-family:var(--mono);font-size:11.5px;color:var(--brand-lift);margin:7px 0 0;letter-spacing:.06em">' + esc(t.lead) + '</p>' +
      '<p style="color:var(--dim);font-size:13px;margin:10px 0 0;line-height:1.6">' + esc(t.body) + '</p>';

    if (/^T\d|TBIT|MSC/.test(t.id)) {
      html += '<div style="margin-top:16px"><div class="stat__k">Your departures from here</div>';
      if (!opened.length) {
        html += '<p style="color:var(--dim);font-size:12.5px;margin:8px 0 0">Nothing yet. Log days to open routes and they will show up on this board.</p>';
      } else {
        html += '<div style="margin-top:8px;max-height:280px;overflow-y:auto">';
        opened.reverse().forEach(function (o) {
          html += '<div class="dep-row">' +
            '<span class="dep-row__logo"><img src="assets/img/airlines/' + o.r.al + '.webp" alt="" loading="lazy"></span>' +
            '<span class="dep-row__c"><b>' + o.r.fn + ' \u00B7 ' + o.r.a + '</b><i>' + esc(o.r.c) + '</i></span></div>';
        });
        html += '</div>';
      }
      html += '</div>';
    }
    $('#term-info').innerHTML = html;
  }

  function applyMap() {
    $('#map-pan').style.transform = 'translate(' + mapX + 'px,' + mapY + 'px) scale(' + mapZ + ')';
  }
  function clampMap() {
    var st = $('#map-stage');
    var w = st.clientWidth, h = st.clientHeight;
    var maxX = 0, maxY = 0;
    var minX = w - w * mapZ, minY = h - h * mapZ;
    mapX = Math.min(maxX, Math.max(minX, mapX));
    mapY = Math.min(maxY, Math.max(minY, mapY));
  }
  function zoomBy(f, cx, cy) {
    var st = $('#map-stage');
    var rect = st.getBoundingClientRect();
    if (cx == null) { cx = rect.width / 2; cy = rect.height / 2; }
    var nz = Math.min(5, Math.max(1, mapZ * f));
    var k = nz / mapZ;
    mapX = cx - (cx - mapX) * k;
    mapY = cy - (cy - mapY) * k;
    mapZ = nz;
    clampMap(); applyMap();
  }

  /* ---------- 7d. Network ---------- */
  var netFilter = 'all';

  function routeCard(i, feature) {
    var r = D.ROUTES[i];
    var al = D.AIRLINES[r.al];
    return '<article class="route"' + (feature ? ' style="border-color:var(--gold)"' : '') + '>' +
      '<div class="route__day">Day ' + (i + 1) + '</div>' +
      '<div class="route__logo"><img src="assets/img/airlines/' + r.al + '.webp" alt="' + esc(al.name) + ' logo" loading="lazy"></div>' +
      '<div class="route__path">LAX <span class="arr">\u2708</span> ' + r.a + '</div>' +
      '<div class="route__city">' + esc(r.c) + '</div>' +
      '<div class="route__meta">' +
        '<span class="tagx ' + (r.k === 'I' ? 'intl' : 'dom') + '">' + (r.k === 'I' ? 'International' : 'Domestic') + '</span>' +
        '<span class="tagx">' + esc(r.r) + '</span>' +
        '<span class="tagx">' + r.t + '</span>' +
        '<span class="tagx">' + r.mi.toLocaleString() + ' mi</span>' +
        '<span class="tagx">' + r.fn + '</span>' +
      '</div>' +
      '<p class="route__b">' + esc(r.b) + '</p>' +
      '</article>';
  }

  RENDER.network = function () {
    var grid = $('#route-grid');
    var open = state.routes;
    $('#net-count').textContent = open + ' of ' + TOTAL_DAYS + ' routes open';
    $('#net-bar').style.width = (open / TOTAL_DAYS * 100) + '%';

    var intl = D.ROUTES.slice(0, open).filter(function (r) { return r.k === 'I'; }).length;
    $('#net-split').textContent = intl + ' international \u00B7 ' + (open - intl) + ' domestic';

    var html = '';
    var shown = 0;
    for (var i = open - 1; i >= 0; i--) {
      var r = D.ROUTES[i];
      if (netFilter === 'intl' && r.k !== 'I') continue;
      if (netFilter === 'dom' && r.k !== 'D') continue;
      html += routeCard(i);
      shown++;
    }
    if (netFilter === 'all' || netFilter === 'locked') {
      var lockShow = Math.min(TOTAL_DAYS - open, netFilter === 'locked' ? 999 : 6);
      for (var j = 0; j < lockShow; j++) {
        html += '<article class="route locked">' +
          '<div class="route__day">Day ' + (open + j + 1) + '</div>' +
          '<div class="route__lock">' +
            '<span class="route__lockic">\uD83D\uDD12</span>' +
            '<span class="route__lockt">Route ' + (open + j + 1) + '<br>' +
            (j === 0 ? 'Opens on your next logged day' : 'Sealed') + '</span>' +
          '</div></article>';
        shown++;
      }
    }
    if (!shown) html = '<div class="card" style="grid-column:1/-1;text-align:center;padding:34px">' +
      '<h3>Nothing here yet</h3><p class="lede" style="margin-inline:auto">Log a day on the schedule and your first route opens.</p></div>';
    grid.innerHTML = html;
  };

  /* ---------- 7e / 7f. Videos ---------- */
  function videoCards(list, hostId, posterOffset) {
    var host = $(hostId);
    if (host.dataset.built) return;
    list.forEach(function (v, i) {
      var fallback = 'assets/img/footage/thumb/' + D.PHOTOS[(i + (posterOffset || 0)) % D.PHOTOS.length].f;
      var real = state.cfg.ytThumbs !== false;
      // maxres is the clean 16:9 frame; mq always exists and is also 16:9.
      // hq/sd are 4:3 and letterbox 16:9 video, so they are skipped.
      var chain = real
        ? ['https://i.ytimg.com/vi/' + v.id + '/maxresdefault.jpg',
           'https://i.ytimg.com/vi/' + v.id + '/mqdefault.jpg',
           fallback]
        : [fallback];

      var c = el('article', 'vid');
      c.innerHTML =
        '<div class="vid__frame">' +
          '<button class="vid__poster' + (real ? ' is-real' : '') + '" type="button" aria-label="Play video: ' + esc(v.t) + '">' +
            '<img alt="" loading="lazy" decoding="async">' +
            '<span class="vid__play"><svg width="22" height="22" viewBox="0 0 22 22" fill="currentColor"><path d="M6 3.4v15.2L19 11 6 3.4z"/></svg></span>' +
          '</button>' +
        '</div>' +
        '<div class="vid__body">' +
          '<div class="vid__n">' + v.n + '</div>' +
          '<div class="vid__t">' + esc(v.t) + '</div>' +
          (v.w ? '<div class="vid__w">' + esc(v.w) + '</div>' : '') +
          '<p class="vid__d">' + esc(v.d) + '</p>' +
        '</div>';
      // walk the chain until one loads; a tiny maxres placeholder counts as a miss
      var img = c.querySelector('.vid__poster img'), step = 0;
      function tryNext() {
        if (step >= chain.length) return;
        img.src = chain[step++];
      }
      img.addEventListener('error', tryNext);
      img.addEventListener('load', function () {
        if (img.naturalWidth <= 121 && step < chain.length) tryNext();
      });
      tryNext();

      c.querySelector('.vid__poster').addEventListener('click', function () {
        var f = c.querySelector('.vid__frame');
        var src = 'https://www.youtube-nocookie.com/embed/' + v.id +
                  '?autoplay=1&rel=0&modestbranding=1' + (v.start ? '&start=' + v.start : '');
        f.innerHTML = '<iframe src="' + src + '" title="' + esc(v.t) + '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>';
      });
      host.appendChild(c);
    });
    host.dataset.built = '1';
  }

  RENDER.briefing = function () { videoCards(D.VIDEOS_GUIDE, '#vid-guide', 0); };
  RENDER.discover = function () { videoCards(D.VIDEOS_LA, '#vid-la', 3); };

  /* ---------- 7g. Settings ---------- */
  RENDER.settings = function () {
    $('#set-name').value = state.ceo || '';
    $('#set-tasks').value = (state.cfg.custom || []).join('\n');
    $$('#set-theme button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.v === state.cfg.theme ? 'true' : 'false');
    });
    $('#set-sound').setAttribute('aria-checked', state.cfg.sound ? 'true' : 'false');
    $('#set-motion').setAttribute('aria-checked', state.cfg.motion ? 'true' : 'false');
    $('#set-ytthumbs').setAttribute('aria-checked', state.cfg.ytThumbs !== false ? 'true' : 'false');
    $('#set-where').textContent = Store.where();
    var t = totals();
    $('#set-stats').textContent = t.logged + ' days logged \u00B7 ' + t.pts + ' points \u00B7 ' +
      state.routes + ' routes \u00B7 ' + Object.keys(state.days).length + ' days with data';
  };

  /* ==========================================================
     8. Modals
     ========================================================== */
  function openModal(html) {
    var m = $('#modal');
    $('#modal-body').innerHTML = html;
    m.hidden = false;
    document.body.style.overflow = 'hidden';
    var f = $('#modal-body').querySelector('button, a');
    if (f) f.focus(); else $('#modal-x').focus();
  }
  function closeModal() {
    $('#modal').hidden = true;
    document.body.style.overflow = '';
  }

  function showUnlock(i) {
    var r = D.ROUTES[i];
    var al = D.AIRLINES[r.al];
    Sound.play('chime-route');
    openModal(
      '<div style="text-align:center">' +
        '<div class="eyebrow" style="justify-content:center">New route \u00B7 ' + (r.k === 'I' ? 'International' : 'Domestic') + '</div>' +
        '<div class="unlock-logo"><img src="assets/img/airlines/' + r.al + '.webp" alt="' + esc(al.name) + ' logo"></div>' +
        '<div class="unlock-path">LAX <span class="arr">\u2708</span> ' + r.a + '</div>' +
        '<h2 style="margin-top:12px">' + esc(r.c) + '</h2>' +
        '<p style="font-family:var(--mono);font-size:12px;color:var(--dim);margin:8px 0 0">' +
          esc(al.name) + ' \u00B7 ' + r.fn + ' \u00B7 ' + r.t + ' \u00B7 ' + r.mi.toLocaleString() + ' miles</p>' +
        '<p style="margin:16px 0 0;color:var(--dim);font-size:13.5px;line-height:1.6">' + esc(r.b) + '</p>' +
        '<div style="margin-top:22px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' +
          '<button class="btn btn--go" data-close>Back to work</button>' +
          '<button class="btn" data-goto="network">See the network</button>' +
        '</div>' +
        '<p style="margin:16px 0 0;font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;color:var(--dimmer);text-transform:uppercase">Route ' + (i + 1) + ' of ' + TOTAL_DAYS + ' \u00B7 ' + (TOTAL_DAYS - i - 1) + ' still sealed</p>' +
      '</div>'
    );
  }

  function confetti() {
    if (!state.cfg.motion) return;
    var host = el('div', 'confetti');
    var cols = ['#00A5CE', '#F5B32E', '#E85BA8', '#34D399', '#FFFFFF'];
    for (var i = 0; i < 110; i++) {
      var p = el('i');
      p.style.left = Math.random() * 100 + '%';
      p.style.background = cols[i % cols.length];
      p.style.animationDuration = (2.6 + Math.random() * 2.6) + 's';
      p.style.animationDelay = (Math.random() * 1.3) + 's';
      p.style.transform = 'rotate(' + (Math.random() * 360) + 'deg)';
      host.appendChild(p);
    }
    document.body.appendChild(host);
    setTimeout(function () { host.remove(); }, 7000);
  }

  function showVictory() {
    var t = totals();
    var s = streak();
    Sound.play('fanfare-win');
    confetti();
    openModal(
      '<div class="win">' +
        '<div class="eyebrow" style="justify-content:center">Season complete</div>' +
        '<div class="win__num">#1</div>' +
        '<h2 style="margin-top:6px">LAX is the number one<br>airport in the world</h2>' +
        '<p style="color:var(--dim);font-size:14px;margin:14px auto 0;max-width:44ch;line-height:1.65">' +
          'All ' + TOTAL_DAYS + ' days logged. All ' + TOTAL_DAYS + ' routes open. ' +
          'Every terminal full, every gate busy, and a board that reaches every corner of the planet. ' +
          'You kept your own schedule for four months straight, and this is what it built.</p>' +
        '<div class="stats" style="margin:22px 0 0;text-align:left">' +
          '<div class="stat stat--gold"><div class="stat__k">Final score</div><div class="stat__v">' + t.pts.toLocaleString() + '</div><div class="stat__n">of ' + MAX_POINTS.toLocaleString() + '</div></div>' +
          '<div class="stat stat--green"><div class="stat__k">Perfect days</div><div class="stat__v">' + t.gold + '</div><div class="stat__n">logged at 100%</div></div>' +
          '<div class="stat stat--mag"><div class="stat__k">Longest run</div><div class="stat__v">' + s.best + '</div><div class="stat__n">days without a gap</div></div>' +
          '<div class="stat"><div class="stat__k">Tasks finished</div><div class="stat__v">' + t.tasksDone.toLocaleString() + '</div><div class="stat__n">across the season</div></div>' +
        '</div>' +
        '<div style="margin-top:22px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' +
          '<button class="btn btn--gold" data-goto="network">See all ' + TOTAL_DAYS + ' routes</button>' +
          '<button class="btn" data-close>Close</button>' +
        '</div>' +
      '</div>'
    );
  }

  /* ---------- lightbox ---------- */
  function openPhoto(i) {
    var p = D.PHOTOS[i];
    $('#lb-img').src = 'assets/img/footage/' + p.f;
    $('#lb-img').alt = p.t;
    $('#lb-cap').innerHTML = '<b>' + esc(p.t) + '</b>' + esc(p.c);
    $('#lightbox').hidden = false;
    document.body.style.overflow = 'hidden';
    $('#lb-close').focus();
  }
  function closePhoto() {
    $('#lightbox').hidden = true;
    $('#lb-img').src = '';
    document.body.style.overflow = '';
  }

  /* ==========================================================
     9. Theme
     ========================================================== */
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.cfg.theme === 'day' ? 'day' : 'night');
    document.body.classList.toggle('no-motion', !state.cfg.motion);
    var b = $('#theme-toggle');
    if (b) {
      b.textContent = state.cfg.theme === 'day' ? '\u263D' : '\u2600';
      b.setAttribute('aria-label', state.cfg.theme === 'day' ? 'Switch to night operations' : 'Switch to daylight operations');
    }
    var s = $('#sound-toggle');
    if (s) {
      s.textContent = state.cfg.sound ? '\uD83D\uDD0A' : '\uD83D\uDD07';
      s.classList.toggle('is-off', !state.cfg.sound);
      s.setAttribute('aria-label', state.cfg.sound ? 'Turn sound off' : 'Turn sound on');
    }
    // logo swaps so the X stays readable against each theme's topbar
    var lg = $('#brand-logo');
    if (lg) {
      lg.onerror = function () { this.onerror = null; this.src = 'assets/img/lax-logo-light.svg'; };
      lg.src = state.cfg.theme === 'day' ? 'assets/img/lax-logo-day.png' : 'assets/img/lax-logo-night.png';
    }
  }

  /* ==========================================================
     10. Wire up
     ========================================================== */
  function bind() {
    // tabs
    $$('.tab').forEach(function (b) {
      b.addEventListener('click', function () { go(b.dataset.go); });
    });
    document.addEventListener('click', function (e) {
      var g = e.target.closest('[data-goto]');
      if (g) { closeModal(); go(g.dataset.goto); }
      if (e.target.closest('[data-close]')) closeModal();
    });

    // header toggles
    $('#theme-toggle').addEventListener('click', function () {
      state.cfg.theme = state.cfg.theme === 'day' ? 'night' : 'day';
      applyTheme(); save(); if (current === 'settings') RENDER.settings();
    });
    $('#sound-toggle').addEventListener('click', function () {
      state.cfg.sound = !state.cfg.sound;
      applyTheme(); save();
      if (state.cfg.sound) Sound.play('chime-task');
      if (current === 'settings') RENDER.settings();
    });

    // calendar
    $('#cal-prev').addEventListener('click', function () { if (calMonth > 0) { calMonth--; RENDER.schedule(); } });
    $('#cal-next').addEventListener('click', function () { if (calMonth < MONTH_LIST.length - 1) { calMonth++; RENDER.schedule(); } });

    // day board
    $('#add-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var inp = $('#add-input');
      var v = inp.value.trim();
      if (!v) return;
      var day = dayOf(selectedDay);
      var nt = mkTask(v);
      var pf = fromInputTime($('#add-from').value), pt = fromInputTime($('#add-to').value);
      if (nt.s === null && pf !== null) { nt.s = pf; nt.e = pt; }
      day.t.push(nt);
      $('#add-from').value = ''; $('#add-to').value = '';
      if (day.logged) recomputeLogged(selectedDay);
      inp.value = '';
      save(); renderDayPanel(); RENDER.schedule();
      inp.focus();
    });
    $('#btn-log').addEventListener('click', logDay);
    $('#btn-tpl').addEventListener('click', function () {
      var day = dayOf(selectedDay);
      var tpl = (state.cfg.custom && state.cfg.custom.length) ? state.cfg.custom : D.TEMPLATES.ops.tasks;
      tpl.forEach(function (x) { day.t.push(mkTask(x)); });
      if (day.logged) recomputeLogged(selectedDay);
      save(); renderDayPanel(); RENDER.schedule();
      toast('Template loaded', tpl.length + ' tasks added to ' + prettyDate(selectedDay), null, '\uD83D\uDCCB');
    });
    $('#btn-copy').addEventListener('click', function () {
      var idx = SEASON_INDEX[selectedDay];
      if (idx === 0) { toast('No day before this one', 'This is day one of the season.', null, '\u2139\uFE0F'); return; }
      var prev = state.days[SEASON[idx - 1]];
      if (!prev || !prev.t.length) { toast('Nothing to copy', 'The previous day has no tasks.', null, '\u2139\uFE0F'); return; }
      var day = dayOf(selectedDay);
      prev.t.forEach(function (x) {
        day.t.push({ x: x.x, d: false, s: (x.s === undefined ? null : x.s), e: (x.e === undefined ? null : x.e) });
      });
      save(); renderDayPanel(); RENDER.schedule();
      toast('Copied forward', prev.t.length + ' tasks from yesterday.', null, '\uD83D\uDCC5');
    });
    $('#btn-clear').addEventListener('click', function () {
      var day = dayOf(selectedDay);
      if (!day.t.length) return;
      if (!confirm('Clear all tasks on ' + prettyDate(selectedDay) + '?')) return;
      day.t = [];
      day.logged = false; day.pts = 0;
      save(); renderDayPanel(); RENDER.schedule();
    });
    $('#btn-all-done').addEventListener('click', function () {
      var day = dayOf(selectedDay);
      if (!day.t.length) return;
      var allDone = day.t.every(function (x) { return x.d; });
      day.t.forEach(function (x) { x.d = !allDone; });
      if (!allDone) Sound.play('chime-task');
      if (day.logged) recomputeLogged(selectedDay);
      save(); renderDayPanel(); RENDER.schedule();
    });
    $('#btn-fill-month').addEventListener('click', function () {
      var mo = MONTH_LIST[calMonth];
      var tpl = (state.cfg.custom && state.cfg.custom.length) ? state.cfg.custom : D.TEMPLATES.ops.tasks;
      var count = new Date(Date.UTC(mo.y, mo.m + 1, 0)).getUTCDate();
      var n = 0;
      for (var i = 1; i <= count; i++) {
        var k = key(mo.y, mo.m, i);
        var day = dayOf(k);
        if (!day.t.length) { tpl.forEach(function (x) { day.t.push(mkTask(x)); }); n++; }
      }
      save(); RENDER.schedule();
      toast('Month filled', n + ' empty day' + (n === 1 ? '' : 's') + ' in ' + MONTHS[mo.m] + ' got your template.', null, '\uD83D\uDDD3\uFE0F');
    });
    $('#day-note').addEventListener('input', function () {
      dayOf(selectedDay).note = this.value;
      save();
    });

    // network filters
    $$('.filt[data-f]').forEach(function (b) {
      b.addEventListener('click', function () {
        netFilter = b.dataset.f;
        $$('.filt[data-f]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        RENDER.network();
      });
    });

    // map
    var stage = $('#map-stage');
    var drag = null;
    stage.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.hotspot') || e.target.closest('.map-ctrls')) return;
      drag = { x: e.clientX - mapX, y: e.clientY - mapY, id: e.pointerId, moved: false };
      stage.setPointerCapture(e.pointerId);
      stage.classList.add('dragging');
    });
    stage.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      mapX = e.clientX - drag.x; mapY = e.clientY - drag.y;
      drag.moved = true;
      clampMap(); applyMap();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      stage.addEventListener(ev, function () { drag = null; stage.classList.remove('dragging'); });
    });
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = stage.getBoundingClientRect();
      zoomBy(e.deltaY < 0 ? 1.16 : 1 / 1.16, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    $('#map-in').addEventListener('click', function () { zoomBy(1.4); });
    $('#map-out').addEventListener('click', function () { zoomBy(1 / 1.4); });
    $('#map-reset').addEventListener('click', function () { mapZ = 1; mapX = 0; mapY = 0; applyMap(); });

    // photos
    var pg = $('#photo-grid');
    D.PHOTOS.forEach(function (p, i) {
      var b = el('button', 'photo');
      b.type = 'button';
      b.innerHTML = '<img src="assets/img/footage/thumb/' + p.f + '" alt="' + esc(p.t) + '" loading="lazy">' +
        '<div class="photo__cap"><div class="photo__t">' + esc(p.t) + '</div><p class="photo__c">' + esc(p.c) + '</p></div>';
      b.addEventListener('click', function () { openPhoto(i); });
      pg.appendChild(b);
    });

    // modal / lightbox close
    $('#modal-x').addEventListener('click', closeModal);
    $('#modal-scrim').addEventListener('click', closeModal);
    $('#lb-close').addEventListener('click', closePhoto);
    $('#lb-scrim').addEventListener('click', closePhoto);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!$('#lightbox').hidden) closePhoto();
        else if (!$('#modal').hidden) closeModal();
      }
    });

    /* ---------- settings ---------- */
    $('#set-name').addEventListener('input', function () {
      state.ceo = this.value.slice(0, 40);
      $('#ceo-name').textContent = state.ceo ? state.ceo : 'Chief Executive';
      save();
    });
    $('#set-tasks').addEventListener('input', function () {
      state.cfg.custom = this.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      save();
    });
    $$('#set-preset button').forEach(function (b) {
      b.addEventListener('click', function () {
        var t = D.TEMPLATES[b.dataset.tpl];
        state.cfg.custom = t.tasks.slice();
        $('#set-tasks').value = t.tasks.join('\n');
        save();
        toast('Template loaded', '\u201C' + t.name + '\u201D is now your daily starting list.', null, '\uD83D\uDCCB');
      });
    });
    $$('#set-theme button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.cfg.theme = b.dataset.v;
        applyTheme(); save(); RENDER.settings();
      });
    });
    $('#set-sound').addEventListener('click', function () {
      state.cfg.sound = !state.cfg.sound;
      applyTheme(); save(); RENDER.settings();
      if (state.cfg.sound) Sound.play('chime-route');
    });
    $('#set-motion').addEventListener('click', function () {
      state.cfg.motion = !state.cfg.motion;
      applyTheme(); save(); RENDER.settings();
    });
    $('#set-ytthumbs').addEventListener('click', function () {
      state.cfg.ytThumbs = state.cfg.ytThumbs === false;
      save(); RENDER.settings();
      ['#vid-guide', '#vid-la'].forEach(function (id) {
        var h = $(id);
        if (h) { h.innerHTML = ''; delete h.dataset.built; }
      });
      videoCards(D.VIDEOS_GUIDE, '#vid-guide', 0);
      videoCards(D.VIDEOS_LA, '#vid-la', 3);
      toast(state.cfg.ytThumbs ? 'Real thumbnails on' : 'Airport photos instead',
            state.cfg.ytThumbs ? 'Each video now shows its own picture.'
                               : 'Nothing is requested from YouTube until you press play.',
            null, '\uD83C\uDFAC');
    });

    $('#set-export').addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'lax-mission-control-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      toast('Progress saved to a file', 'Keep it somewhere safe. You can load it back any time.', null, '\uD83D\uDCBE');
    });
    $('#set-import').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var d = JSON.parse(fr.result);
          if (!d || typeof d !== 'object' || !d.days) throw new Error('bad file');
          state = Object.assign(clone(DEFAULTS), d);
          state.cfg = Object.assign(clone(DEFAULTS.cfg), d.cfg || {});
          save(); applyTheme(); boot(true);
          toast('Progress restored', 'Welcome back, Chief.', null, '\u2705');
        } catch (err) {
          toast('That file would not open', 'It needs to be a progress file exported from this site.', 'mag', '\u26A0\uFE0F');
        }
        e.target.value = '';
      };
      fr.readAsText(f);
    });
    $('#set-reset').addEventListener('click', function () {
      if (!confirm('This erases every logged day, every point and every route. There is no undo. Continue?')) return;
      if (!confirm('Really start the season over from 1 September 2026?')) return;
      var theme = state.cfg.theme, sound = state.cfg.sound, motion = state.cfg.motion;
      state = clone(DEFAULTS);
      state.cfg.theme = theme; state.cfg.sound = sound; state.cfg.motion = motion;
      Store.set(KEY, JSON.stringify(state));
      selectedDay = SEASON[0]; calMonth = 0;
      boot(true);
      toast('Season reset', 'Clean board, day one, 1 September 2026.', null, '\u21BB');
    });
    $('#set-replay').addEventListener('click', function () {
      if (state.routes > 0) showUnlock(state.routes - 1);
      else toast('Nothing to replay yet', 'Log a day first and your opening route will appear here.', null, '\u2139\uFE0F');
    });

    // hash routing
    window.addEventListener('hashchange', function () { go(location.hash.slice(1)); });
  }

  /* ==========================================================
     11. Boot
     ========================================================== */
  function boot(rerender) {
    applyTheme();
    $('#ceo-name').textContent = state.ceo ? state.ceo : 'Chief Executive';
    if (!selectedDay) {
      var t0 = todayKey();
      selectedDay = (t0 in SEASON_INDEX) ? t0 : SEASON[0];
      var p = parseKey(selectedDay);
      var mi = MONTH_LIST.findIndex(function (m) { return m.y === p.y && m.m === p.m; });
      calMonth = mi >= 0 ? mi : 0;
    }
    // seasonal totals are the source of truth for routes
    var t = totals();
    if (t.logged > state.routes) state.routes = t.logged;

    VIEWS.forEach(function (v) { if (RENDER[v] && !rerender) {} });
    RENDER.tower();
    RENDER.schedule();
    RENDER.network();
    if (rerender) {
      var host = $('#map-pan');
      if (host.dataset.built) showTerminal(activeTerm || 'TBIT');
      RENDER.settings();
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    load().then(function () {
      bind();
      boot(false);
      go(location.hash.slice(1) || 'tower');
      $('#boot-veil').classList.add('gone');
      setTimeout(function () { var v = $('#boot-veil'); if (v) v.remove(); }, 700);
    });
  });
})();
