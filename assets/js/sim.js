/* =============================================================
   LAX MISSION CONTROL — the airport simulation
   -------------------------------------------------------------
   Turns your logged days into five airport indicators:
     1. Passengers            4. Aircraft operations
     2. Service & satisfaction 5. Employees
     3. Economic impact
   Everything is recomputed from your saved days, so the numbers
   are always consistent with your history. The formulas are
   explained in plain words on the "Keep Flying" tab.
   ============================================================= */
(function (root) {
  'use strict';

  var C = {
    R0: 0.20,          // starting reliability: LAX on a skeleton schedule
    ALPHA: 0.05,       // how fast reliability moves toward each day's quality
    REV_Q: 0.04,       // each plan revision takes 4 pp off that day's quality
    BASE_DEPS: 6,      // skeleton schedule before any route is opened (daily departures)
    BASE_SEATS: 76,    // ...flown with regional jets
    LF_MIN: 0.38, LF_SPAN: 0.52,     // load factor 38% -> 90%
    GROWTH: 0.30,                    // airlines add up to +30% frequency/gauge as reputation builds
    CARGO_BASE: 2500, CARGO_SPAN: 42000,
    SPEND_DOM: 1050, SPEND_INTL: 2450, // regional economic output per passenger, USD
    CAPITAL_BASE: 0.12e9, CAPITAL_SPAN: 4.4e9,
    JOBS_PER_M: 4.9,   // regional jobs per $1M of output (LAWA 2019 study ratio)
    LABOR_SHARE: 0.295,
    TAX_SHARE: 0.049
  };

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  /* quality of one day: share of the board done, minus revisions */
  function dayQuality(day) {
    if (!day || !day.t || !day.t.length) return 0;
    var done = 0;
    for (var i = 0; i < day.t.length; i++) if (day.t[i].d) done++;
    return clamp(done / day.t.length - C.REV_Q * (day.rev || 0), 0, 1);
  }

  /* cumulative network built by the first n routes */
  var NET = null;
  function buildNet(routes) {
    NET = [{ seats: 0, deps: 0, intlSeats: 0, miles: 0 }];
    routes.forEach(function (r, i) {
      var p = NET[i];
      var s = r.deps * 2 * 365 * r.seats;
      NET.push({
        seats: p.seats + s,
        deps: p.deps + r.deps,
        intlSeats: p.intlSeats + (r.k === 'I' ? s : 0),
        miles: p.miles + r.mi
      });
    });
  }

  /* the five indicators from the state of the airport */
  function indicators(R, F7, S, rev7, nRoutes, total) {
    var net = NET[Math.min(nRoutes, NET.length - 1)];
    var N = nRoutes / total;
    var baseSeats = C.BASE_DEPS * 2 * 365 * C.BASE_SEATS;
    var seats = baseSeats + net.seats;
    var deps = C.BASE_DEPS + net.deps;
    var intlShare = seats ? net.intlSeats / seats : 0;

    // 1. passengers
    var LF = C.LF_MIN + C.LF_SPAN * R;
    var G = 1 + C.GROWTH * R * R;
    var pax = seats * G * LF;
    var intlPax = pax * intlShare;

    // 2. service & satisfaction
    var sat = 380 + 500 * (0.5 * R + 0.3 * F7 + 0.2 * S) - Math.min(120, 10 * rev7);
    sat = clamp(sat, 200, 1000);
    var asq = clamp(1 + 4 * (sat - 200) / 800, 1, 5);
    var otp = clamp(55 + 33 * (0.6 * R + 0.4 * F7) - 1.5 * rev7, 35, 95);
    var wait = clamp(52 - 40 * (0.7 * R + 0.3 * F7) + 0.8 * rev7, 6, 75);
    var nps = Math.round((sat - 600) / 4);
    var bags = clamp(93.5 + 5.6 * R - 0.3 * rev7, 85, 99.6);

    // 4. aircraft operations
    var completion = 0.90 + 0.095 * R;
    var cargoGA = C.CARGO_BASE + C.CARGO_SPAN * N * (0.5 + 0.5 * R);
    var commercial = deps * 2 * 365 * G * completion;
    var ops = commercial + cargoGA;

    // 3. economic impact
    var satN = clamp((sat - 380) / 500, 0, 1);
    var spend = (C.SPEND_DOM * (1 - intlShare) + C.SPEND_INTL * intlShare) * (0.85 + 0.20 * satN);
    var capital = C.CAPITAL_BASE + C.CAPITAL_SPAN * R * N;
    var econ = pax * spend + capital;

    // 5. employees on the airport
    var paxM = pax / 1e6, intlM = intlPax / 1e6;
    var parts = {
      airline: ops * 0.031,
      concessions: paxM * 120,
      federal: paxM * 55 + intlM * 60,
      contractors: paxM * 45,
      lawa: 300 + 3700 * N * (0.6 + 0.4 * R)
    };
    var emp = parts.airline + parts.concessions + parts.federal + parts.contractors + parts.lawa;

    return {
      R: R, F7: F7, S: S, rev7: rev7, routes: nRoutes, N: N,
      seats: seats, deps: deps, intlShare: intlShare, LF: LF, G: G, miles: net.miles,
      pax: pax, paxDaily: pax / 365, intlPax: intlPax,
      sat: sat, asq: asq, otp: otp, wait: wait, nps: nps, bags: bags,
      ops: ops, opsDaily: ops / 365, commercialOps: commercial, cargoGA: cargoGA, completion: completion,
      econ: econ, spend: spend, capital: capital,
      jobs: econ / 1e6 * C.JOBS_PER_M, labor: econ * C.LABOR_SHARE, taxes: econ * C.TAX_SHARE,
      emp: emp, empParts: parts
    };
  }

  /* world ranking by passengers (2025 ACI table, real LAX removed) */
  var ANCHORS = [[63.4,20],[50,35],[40,55],[30,90],[20,150],[10,300],[5,480],[2,800],[1,1100],[0.5,1450],[0.2,2000],[0.05,3000],[0.001,4000]];
  function worldRank(paxM, table, seasonDone) {
    var r = 1;
    for (var i = 0; i < table.length; i++) if (table[i].p > paxM) r++;
    var est = false;
    if (paxM < table[table.length - 1].p) {
      est = true;
      for (var k = 0; k < ANCHORS.length - 1; k++) {
        var a = ANCHORS[k], b = ANCHORS[k + 1];
        if (paxM <= a[0] && paxM >= b[0]) {
          var t = (Math.log(a[0]) - Math.log(paxM)) / (Math.log(a[0]) - Math.log(b[0]));
          r = Math.round(Math.exp(Math.log(a[1]) + t * (Math.log(b[1]) - Math.log(a[1]))));
          break;
        }
      }
      if (paxM < ANCHORS[ANCHORS.length - 1][0]) r = 4000;
      r = Math.max(21, r);
    }
    var reserved = false;
    if (r === 1 && !seasonDone) { r = 2; reserved = true; }
    return { rank: r, est: est, reserved: reserved, label: (est ? '#~' : '#') + r.toLocaleString() };
  }

  /* walk the season and record a snapshot after every day */
  function run(opts) {
    var days = opts.days || {};
    var season = opts.season;           // array of date keys, in order
    var routes = opts.routes;
    var total = season.length;
    if (!NET || NET.length !== routes.length + 1) buildNet(routes);

    var first = -1, last = -1, loggedTotal = 0;
    for (var i = 0; i < total; i++) {
      var d = days[season[i]];
      if (d && d.logged) { if (first < 0) first = i; last = i; loggedTotal++; }
    }

    var R = C.R0, streak = 0, best = 0, cum = 0;
    var hist = [];                       // [{q, rev, logged}]
    var snaps = [];
    var start = indicators(R, 0, 0, 0, 0, total);
    start.i = -1; start.day = 0;

    function stepDay(q, rev, logged) {
      R = R + C.ALPHA * (q - R);
      if (logged) { streak++; cum++; } else streak = 0;
      if (streak > best) best = streak;
      hist.push({ q: q, rev: rev, logged: logged });
      var w = hist.slice(-7);
      var F7 = w.reduce(function (s, h) { return s + h.q; }, 0) / w.length;
      var rev7 = w.reduce(function (s, h) { return s + h.rev; }, 0);
      var S = Math.min(streak, 30) / 30;
      return indicators(R, F7, S, rev7, cum, total);
    }

    if (first >= 0) {
      for (var j = first; j <= last; j++) {
        var day = days[season[j]];
        var logged = !!(day && day.logged);
        var snap = stepDay(logged ? dayQuality(day) : 0, logged ? (day.rev || 0) : 0, logged);
        snap.i = j; snap.key = season[j]; snap.logged = logged;
        snap.q = hist[hist.length - 1].q;
        snaps.push(snap);
      }
    }

    snaps.forEach(function (s) { s.world = worldRank(s.pax / 1e6, opts.table, false); });
    var cur = Object.assign({}, snaps.length ? snaps[snaps.length - 1] : start);
    // routes never close: if a day was reopened, keep the opened network
    var openRoutes = Math.max(opts.openRoutes || 0, cum);
    if (openRoutes !== cur.routes) {
      var keep = { i: cur.i, key: cur.key, logged: cur.logged, q: cur.q };
      cur = indicators(cur.R, cur.F7, cur.S, cur.rev7, openRoutes, total);
      Object.assign(cur, keep);
    }
    var seasonDone = loggedTotal >= total;
    cur.world = worldRank(cur.pax / 1e6, opts.table, seasonDone);
    start.world = worldRank(start.pax / 1e6, opts.table, false);

    var avgQ = 0, nLogged = 0;
    hist.forEach(function (h) { if (h.logged) { avgQ += h.q; nLogged++; } });
    avgQ = nLogged ? avgQ / nLogged : 0.8;

    /* projection to the end of the season: every remaining day logged
       at quality qf with no revisions */
    function project(qf) {
      var saveR = R, saveS = streak, saveB = best, saveC = cum, saveH = hist.slice();
      var remaining = 0;
      for (var x = 0; x < total; x++) { var dd = days[season[x]]; if (!(dd && dd.logged)) remaining++; }
      var out = cur;
      for (var y = 0; y < remaining; y++) out = stepDay(qf, 0, true);
      if (!remaining) out = cur;
      out = Object.assign({}, out);
      out.world = worldRank(out.pax / 1e6, opts.table, true);
      out.remaining = remaining;
      R = saveR; streak = saveS; best = saveB; cum = saveC; hist = saveH;
      return out;
    }

    return {
      C: C, start: start, snaps: snaps, cur: cur, first: first, last: last,
      logged: loggedTotal, streak: streak, best: best, avgQ: avgQ,
      seasonDone: seasonDone,
      projectSame: project(avgQ),
      projectPerfect: project(1)
    };
  }

  /* days of perfect play needed to lift reliability from r to target */
  function daysToReach(r, target) {
    if (r >= target) return 0;
    return Math.ceil(Math.log((1 - target) / (1 - r)) / Math.log(1 - C.ALPHA));
  }

  root.LAX_SIM = { run: run, dayQuality: dayQuality, worldRank: worldRank, daysToReach: daysToReach, C: C };
})(window);
