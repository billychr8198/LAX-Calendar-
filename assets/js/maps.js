/* =============================================================
   LAX MISSION CONTROL — animated route maps
   World map  : assets/data/world-countries-50m.json  (TopoJSON)
   U.S. map   : assets/data/us-states-albers-10m.json (TopoJSON)
   Airports   : assets/data/airports.json
   Drawn with D3 (assets/vendor). Pages must be served over http(s)
   — GitHub Pages is perfect — because browsers block fetch() on
   files opened straight from disk.
   ============================================================= */
(function (root) {
  'use strict';

  var D3 = root.d3, TOPO = root.topojson;
  var cache = null;
  var PLANE = 'M0,-7 L1.6,-2.2 L7,1 L7,2.4 L1.6,0.9 L1.2,4.6 L3,6 L3,7 L0,6.2 L-3,7 L-3,6 L-1.2,4.6 L-1.6,0.9 L-7,2.4 L-7,1 L-1.6,-2.2 Z';

  function load() {
    if (cache) return cache;
    if (!D3 || !TOPO) return (cache = Promise.reject(new Error('Map library missing')));
    function j(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }); }
    cache = Promise.all([
      j('assets/data/airports.json'),
      j('assets/data/world-countries-50m.json'),
      j('assets/data/us-states-albers-10m.json'),
      j('assets/data/world-countries-110m.json')
    ]).then(function (a) {
      return {
        airports: a[0],
        world: TOPO.feature(a[1], a[1].objects.countries),
        worldBorders: TOPO.mesh(a[1], a[1].objects.countries, function (x, y) { return x !== y; }),
        states: TOPO.feature(a[2], a[2].objects.states),
        stateBorders: TOPO.mesh(a[2], a[2].objects.states, function (x, y) { return x !== y; }),
        nation: TOPO.feature(a[2], a[2].objects.nation),
        worldLite: TOPO.feature(a[3], a[3].objects.countries)
      };
    });
    cache.catch(function () { cache = null; });
    return cache;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtH(min) { var h = Math.floor(min / 60), m = min % 60; return h + 'h ' + String(m).padStart(2, '0') + 'm'; }

  /* ============================================================
     The big map
     ============================================================ */
  function create(opt) {
    var host = opt.host, D = opt.data;
    var W = 960, H = 520;
    var mode = 'world', geo = null, svg = null, view = null, zoom = null, k = 1;
    var arcs = [], planes = [], raf = null, replaying = false, focusIdx = null, built = false, lastOpen = -1;
    var filter = '';

    host.innerHTML =
      '<div class="rm">' +
        '<div class="rm__main">' +
          '<div class="rm__bar">' +
            '<div class="seg" id="rm-mode">' +
              '<button type="button" data-v="world" aria-pressed="true">🌍 World</button>' +
              '<button type="button" data-v="us" aria-pressed="false">🇺🇸 United States</button>' +
            '</div>' +
            '<div class="rm__acts">' +
              '<button type="button" class="btn btn--sm btn--go" id="rm-replay">▶ Replay my season</button>' +
              '<button type="button" class="btn btn--sm" id="rm-fly">✈ Launch flights</button>' +
            '</div>' +
          '</div>' +
          '<div class="rm__stage" id="rm-stage">' +
            '<div class="rm__loading">Loading maps…</div>' +
            '<div class="rm__counter" id="rm-counter" hidden></div>' +
            '<div class="rm__legend"><span><i class="lg lg--dom"></i>Domestic</span><span><i class="lg lg--intl"></i>International</span><span><i class="lg lg--lax"></i>LAX</span></div>' +
            '<div class="map-ctrls">' +
              '<button type="button" id="rm-out" aria-label="Zoom out">−</button>' +
              '<button type="button" id="rm-reset" aria-label="Reset the view">⟲</button>' +
              '<button type="button" id="rm-in" aria-label="Zoom in">+</button>' +
            '</div>' +
          '</div>' +
          '<div class="rm__card" id="rm-card"></div>' +
        '</div>' +
        '<aside class="rm__side">' +
          '<div class="rm__stats" id="rm-stats"></div>' +
          '<input class="field rm__search" id="rm-search" type="search" placeholder="Search open routes…" aria-label="Search open routes">' +
          '<div class="rm__list" id="rm-list"></div>' +
        '</aside>' +
      '</div>';

    var stage = host.querySelector('#rm-stage');

    function open() { return Math.max(0, Math.min(opt.getOpen(), D.ROUTES.length)); }
    function coord(code) { var a = geo.airports[code]; return a ? [a.lon, a.lat] : null; }

    function build() {
      if (svg) svg.remove();
      stopPlanes();
      svg = D3.select(stage).insert('svg', ':first-child')
        .attr('viewBox', '0 0 ' + W + ' ' + H).attr('class', 'rm__svg')
        .attr('role', 'img').attr('aria-label', mode === 'world' ? 'World map of your LAX routes' : 'United States map of your LAX routes');
      var defs = svg.append('defs');
      var gr = defs.append('radialGradient').attr('id', 'rm-ocean').attr('cx', '50%').attr('cy', '45%').attr('r', '75%');
      gr.append('stop').attr('offset', '0%').attr('class', 'oc1');
      gr.append('stop').attr('offset', '100%').attr('class', 'oc2');
      var glow = defs.append('filter').attr('id', 'rm-glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
      glow.append('feGaussianBlur').attr('stdDeviation', 2.2).attr('result', 'b');
      var mg = glow.append('feMerge'); mg.append('feMergeNode').attr('in', 'b'); mg.append('feMergeNode').attr('in', 'SourceGraphic');

      svg.append('rect').attr('width', W).attr('height', H).attr('class', 'rm__bg');
      view = svg.append('g').attr('class', 'rm__view');

      var proj, path;
      if (mode === 'world') {
        proj = D3.geoNaturalEarth1().rotate([118.4, 0]).fitExtent([[8, 8], [W - 8, H - 8]], { type: 'Sphere' });
        path = D3.geoPath(proj);
        view.append('path').datum({ type: 'Sphere' }).attr('class', 'rm__sphere').attr('d', path);
        view.append('path').datum(D3.geoGraticule10()).attr('class', 'rm__grat').attr('d', path);
        view.append('g').selectAll('path').data(geo.world.features).join('path')
          .attr('class', function (f) { return 'rm__land' + (f.id === '840' ? ' is-us' : ''); }).attr('d', path);
        view.append('path').datum(geo.worldBorders).attr('class', 'rm__border').attr('d', path);
      } else {
        proj = D3.geoAlbersUsa().scale(1300).translate([487.5, 305]);
        path = D3.geoPath();
        var ux = 975, uy = 610, sc = Math.min(W / ux, H / uy) * 0.98;
        view = view.append('g').attr('transform', 'translate(' + ((W - ux * sc) / 2) + ',' + ((H - uy * sc) / 2) + ') scale(' + sc + ')');
        view.append('g').selectAll('path').data(geo.states.features).join('path').attr('class', 'rm__land is-us').attr('d', path);
        view.append('path').datum(geo.stateBorders).attr('class', 'rm__border').attr('d', path);
        view.append('path').datum(geo.nation).attr('class', 'rm__nation').attr('d', path);
      }
      var layers = {
        arcs: view.append('g').attr('class', 'rm__arcs'),
        flow: view.append('g').attr('class', 'rm__flow'),
        dots: view.append('g').attr('class', 'rm__dots'),
        labels: view.append('g').attr('class', 'rm__labels'),
        planes: view.append('g').attr('class', 'rm__planes'),
        lax: view.append('g').attr('class', 'rm__lax')
      };
      var lax = coord('LAX'), lp = proj(lax);
      layers.lax.attr('transform', 'translate(' + lp[0] + ',' + lp[1] + ')');
      layers.lax.append('circle').attr('class', 'rm__laxring').attr('r', 9);
      layers.lax.append('circle').attr('class', 'rm__laxdot').attr('r', 4.2);
      layers.lax.append('text').attr('class', 'rm__laxlbl').attr('x', 8).attr('y', -8).text('LAX');

      svg.__proj = proj; svg.__path = path; svg.__layers = layers; svg.__lax = lp;

      zoom = D3.zoom().scaleExtent([1, 14]).translateExtent([[-40, -40], [W + 40, H + 40]])
        .on('zoom', function (ev) {
          k = ev.transform.k;
          svg.select('.rm__view').attr('transform', ev.transform);
          svg.node().style.setProperty('--k', k);
          scaleMarks();
        });
      svg.call(zoom).on('dblclick.zoom', null);
      k = 1;
      built = true;
      lastOpen = -1;
      draw(false);
    }

    function curve(a, b) {
      var dx = b[0] - a[0], dy = b[1] - a[1], d = Math.sqrt(dx * dx + dy * dy) || 1;
      var bend = Math.min(0.32, 0.18 + 40 / d * 0.05);
      var mx = (a[0] + b[0]) / 2 - dy / d * d * bend, my = (a[1] + b[1]) / 2 + dx / d * d * bend;
      if (my > (a[1] + b[1]) / 2) { mx = (a[0] + b[0]) / 2 + dy / d * d * bend; my = (a[1] + b[1]) / 2 - dx / d * d * bend; }
      return 'M' + a[0] + ',' + a[1] + ' Q' + mx + ',' + my + ' ' + b[0] + ',' + b[1];
    }

    function arcFor(i) {
      var r = D.ROUTES[i], c = coord(r.a);
      if (!c) return null;
      var p = svg.__proj(c);
      if (!p) return null;
      var d = mode === 'world'
        ? svg.__path({ type: 'LineString', coordinates: [coord('LAX'), c] })
        : curve(svg.__lax, p);
      if (!d) return null;
      return { i: i, r: r, d: d, p: p };
    }

    function draw(animate) {
      if (!built) return;
      var n = open();
      var L = svg.__layers;
      arcs = [];
      for (var i = 0; i < n; i++) { var a = arcFor(i); if (a) arcs.push(a); }
      var newest = n - 1;

      var sel = L.arcs.selectAll('path').data(arcs, function (a) { return a.i; });
      sel.exit().remove();
      var ent = sel.enter().append('path')
        .attr('class', function (a) { return 'rm__arc ' + (a.r.k === 'I' ? 'is-intl' : 'is-dom'); })
        .attr('d', function (a) { return a.d; })
        .on('click', function (ev, a) { focus(a.i); });
      ent.each(function (a) {
        var len = this.getTotalLength();
        a.len = len;
        if (animate || a.i === newest && lastOpen >= 0 && newest >= lastOpen) {
          D3.select(this).attr('stroke-dasharray', len + ' ' + len).attr('stroke-dashoffset', len)
            .transition().delay(animate ? Math.min(1400, (arcs.indexOf(a)) * 10) : 200).duration(1100).ease(D3.easeCubicOut)
            .attr('stroke-dashoffset', 0)
            .on('end', function () { D3.select(this).attr('stroke-dasharray', null); });
        }
      });
      L.arcs.selectAll('path').each(function (a) { if (!a.len) a.len = this.getTotalLength(); })
        .classed('is-new', function (a) { return a.i === newest; });

      var fl = L.flow.selectAll('path').data(arcs, function (a) { return a.i; });
      fl.exit().remove();
      fl.enter().append('path').attr('class', function (a) { return 'rm__flowline ' + (a.r.k === 'I' ? 'is-intl' : 'is-dom'); })
        .attr('d', function (a) { return a.d; })
        .style('animation-delay', function (a) { return (-(a.i % 9) * 0.37) + 's'; });

      var dots = L.dots.selectAll('g').data(arcs, function (a) { return a.i; });
      dots.exit().remove();
      var dg = dots.enter().append('g').attr('class', function (a) { return 'rm__dot ' + (a.r.k === 'I' ? 'is-intl' : 'is-dom'); })
        .attr('transform', function (a) { return 'translate(' + a.p[0] + ',' + a.p[1] + ')'; })
        .on('click', function (ev, a) { focus(a.i); });
      dg.append('circle').attr('class', 'rm__halo').attr('r', 6);
      dg.append('circle').attr('class', 'rm__pt').attr('r', 2.6);
      dg.append('title').text(function (a) { return 'LAX → ' + a.r.a + ' · ' + a.r.c; });
      L.dots.selectAll('g').classed('is-new', function (a) { return a.i === newest; });

      var lb = L.labels.selectAll('text').data(arcs, function (a) { return a.i; });
      lb.exit().remove();
      lb.enter().append('text').attr('class', 'rm__lbl')
        .attr('x', function (a) { return a.p[0] + 4; }).attr('y', function (a) { return a.p[1] - 4; })
        .text(function (a) { return a.r.a; });

      lastOpen = n;
      scaleMarks();
      side();
      if (!replaying) startPlanes();
    }

    function scaleMarks() {
      if (!svg) return;
      var s = 1 / Math.sqrt(k);
      var base = mode === 'us' ? 1.25 : 1;
      svg.selectAll('.rm__pt').attr('r', 2.6 * s * base);
      svg.selectAll('.rm__halo').attr('r', 6 * s * base);
      svg.selectAll('.rm__lbl').style('font-size', (9 / Math.pow(k, 0.8) * base) + 'px')
        .style('display', k >= 2.2 || (mode === 'us' && k >= 1) ? null : 'none');
      svg.select('.rm__lax').selectAll('circle').attr('transform', 'scale(' + (s * base) + ')');
      svg.select('.rm__laxlbl').attr('transform', 'scale(' + (s * base) + ')');
    }

    /* ---------- planes ---------- */
    function addPlane(a, once, speed) {
      if (!a || !svg) return;
      var node = svg.select('.rm__arcs').selectAll('path').filter(function (d) { return d.i === a.i; }).node();
      if (!node) return;
      var len = a.len || node.getTotalLength();
      var g = svg.__layers.planes.append('g').attr('class', 'rm__plane ' + (a.r.k === 'I' ? 'is-intl' : 'is-dom'));
      g.append('path').attr('d', PLANE);
      var pl = { a: a, node: node, len: len, g: g, t: Math.random() * (once ? 0 : 0.8), once: once,
                 v: (speed || 1) * (mode === 'us' ? 1.25 : 1) * 70 / Math.max(80, len) * (0.75 + Math.random() * 0.5),
                 back: !once && Math.random() < 0.5 };
      if (once) pl.t = 0;
      planes.push(pl);
      return pl;
    }
    function stopPlanes() {
      planes.forEach(function (p) { p.g.remove(); });
      planes = [];
      if (raf) cancelAnimationFrame(raf);
      raf = null;
    }
    function startPlanes() {
      stopPlanes();
      if (!arcs.length || opt.reduced()) return;
      var pool = arcs.slice();
      var count = Math.min(pool.length, mode === 'us' ? 14 : 18);
      for (var i = 0; i < count; i++) {
        var pick = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        addPlane(pick, false);
      }
      loop();
    }
    function loop() {
      var last = performance.now();
      function frame(now) {
        var dt = Math.min(0.05, (now - last) / 1000); last = now;
        for (var i = planes.length - 1; i >= 0; i--) {
          var p = planes[i];
          p.t += p.v * dt;
          if (p.t >= 1) {
            if (p.once) { p.g.remove(); planes.splice(i, 1); continue; }
            p.t = 0; p.back = !p.back;
            var next = arcs[Math.floor(Math.random() * arcs.length)];
            if (next && next !== p.a) {
              var nn = svg.select('.rm__arcs').selectAll('path').filter(function (d) { return d.i === next.i; }).node();
              if (nn) { p.a = next; p.node = nn; p.len = next.len || nn.getTotalLength(); p.g.attr('class', 'rm__plane ' + (next.r.k === 'I' ? 'is-intl' : 'is-dom')); }
            }
          }
          var tt = p.back ? 1 - p.t : p.t;
          var ease = tt;
          var L = p.len * ease;
          var q1 = p.node.getPointAtLength(Math.max(0, Math.min(p.len, L)));
          var q2 = p.node.getPointAtLength(Math.max(0, Math.min(p.len, L + (p.back ? -1 : 1))));
          var ang = Math.atan2(q2.y - q1.y, q2.x - q1.x) * 180 / Math.PI + 90;
          var sc = (mode === 'us' ? 1.1 : 0.9) / Math.sqrt(k);
          var fade = Math.min(1, p.t * 8, (1 - p.t) * 8);
          p.g.attr('transform', 'translate(' + q1.x + ',' + q1.y + ') rotate(' + ang + ') scale(' + sc + ')').style('opacity', fade);
        }
        raf = planes.length ? requestAnimationFrame(frame) : null;
      }
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    }

    /* ---------- replay the season, route by route ---------- */
    function replay() {
      if (!built || replaying) return;
      var n = open();
      if (!n) { opt.toast('No routes yet', 'Log your first day and the map lights up.'); return; }
      replaying = true;
      stopPlanes();
      var L = svg.__layers;
      L.arcs.selectAll('path').style('opacity', 0);
      L.flow.selectAll('path').style('opacity', 0);
      L.dots.selectAll('g').style('opacity', 0);
      L.labels.selectAll('text').style('opacity', 0);
      var counter = host.querySelector('#rm-counter');
      counter.hidden = false;
      var order = arcs.slice();
      var step = Math.max(90, Math.min(420, 9000 / Math.max(1, order.length)));
      var j = 0;
      opt.sound('whoosh');
      (function next() {
        if (!replaying) return;
        if (j >= order.length) {
          setTimeout(function () {
            replaying = false; counter.hidden = true;
            L.selectAll && 0;
            [L.arcs, L.flow, L.dots, L.labels].forEach(function (g) { g.selectAll('*').style('opacity', null); });
            startPlanes();
          }, 900);
          return;
        }
        var a = order[j++];
        counter.innerHTML = '<b>Day ' + (a.i + 1) + '</b><span>LAX → ' + a.r.a + ' · ' + esc(a.r.c) + '</span>';
        var el = L.arcs.selectAll('path').filter(function (d) { return d.i === a.i; });
        var len = a.len || el.node().getTotalLength();
        el.style('opacity', 1).attr('stroke-dasharray', len + ' ' + len).attr('stroke-dashoffset', len)
          .transition().duration(Math.max(300, step * 2)).ease(D3.easeCubicOut).attr('stroke-dashoffset', 0)
          .on('end', function () { D3.select(this).attr('stroke-dasharray', null); });
        L.flow.selectAll('path').filter(function (d) { return d.i === a.i; }).transition().delay(step * 2).style('opacity', 1);
        L.dots.selectAll('g').filter(function (d) { return d.i === a.i; }).transition().delay(step).style('opacity', 1);
        L.labels.selectAll('text').filter(function (d) { return d.i === a.i; }).transition().delay(step).style('opacity', 1);
        var pl = addPlane(a, true, 2.4);
        if (pl && !raf) loop();
        setTimeout(next, step);
      })();
    }

    /* ---------- focus one route ---------- */
    function focus(i, quiet) {
      if (!built) return;
      focusIdx = i;
      var a = arcs.filter(function (x) { return x.i === i; })[0];
      svg.classed('has-focus', true);
      svg.selectAll('.rm__arc').classed('is-focus', function (d) { return d.i === i; });
      svg.selectAll('.rm__dot').classed('is-focus', function (d) { return d.i === i; });
      card(i, !a);
      host.querySelectorAll('.rm__item').forEach(function (b) { b.classList.toggle('is-on', +b.dataset.i === i); });
      if (!a) return;
      var node = svg.select('.rm__arcs').selectAll('path').filter(function (d) { return d.i === i; }).node();
      var bb = node.getBBox();
      var tr = svg.select('.rm__view > g') && mode === 'us' ? svg.select('.rm__view > g').attr('transform') : null;
      var sc = 1, ox = 0, oy = 0;
      if (tr) { var m = /translate\(([-\d.]+),([-\d.]+)\) scale\(([-\d.]+)\)/.exec(tr); if (m) { ox = +m[1]; oy = +m[2]; sc = +m[3]; } }
      var x0 = bb.x * sc + ox, y0 = bb.y * sc + oy, x1 = (bb.x + bb.width) * sc + ox, y1 = (bb.y + bb.height) * sc + oy;
      var kk = Math.max(1, Math.min(8, 0.8 / Math.max((x1 - x0 + 30) / W, (y1 - y0 + 30) / H)));
      var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      svg.transition().duration(quiet ? 0 : 900).call(zoom.transform, D3.zoomIdentity.translate(W / 2, H / 2).scale(kk).translate(-cx, -cy));
      if (!opt.reduced()) {
        var pl = addPlane(a, true, 1.1);
        if (pl && !raf) loop();
      }
    }
    function unfocus() {
      focusIdx = null;
      if (svg) { svg.classed('has-focus', false); svg.selectAll('.is-focus').classed('is-focus', false); }
      host.querySelectorAll('.rm__item').forEach(function (b) { b.classList.remove('is-on'); });
      card(null);
    }

    function card(i, offMap) {
      var box = host.querySelector('#rm-card');
      if (i === null || i === undefined) {
        var n = open();
        box.innerHTML = n
          ? '<p class="rm__tip">Tap a route, a city dot or a name in the list to fly it. Drag to pan, scroll or pinch to zoom.</p>'
          : '<p class="rm__tip">The map is waiting for you. Log your first day on the Schedule and LAX’s first new route lights up here.</p>';
        return;
      }
      var r = D.ROUTES[i], al = D.AIRLINES[r.al], ap = geo && geo.airports[r.a];
      var photos = D.TERMINAL_PHOTOS[r.t] || D.TERMINAL_PHOTOS.TBIT;
      var ph = photos[i % photos.length];
      box.innerHTML =
        '<div class="rmc">' +
          '<button type="button" class="rmc__img" data-photo="' + ph + '" aria-label="View the terminal photo full size"><img src="assets/img/footage/thumb/' + ph + '" alt=""></button>' +
          '<div class="rmc__body">' +
            '<div class="rmc__top"><span class="route__logo" data-logo="' + r.al + '" role="button" tabindex="0" aria-label="View the ' + esc(al.name) + ' logo"><img src="assets/img/airlines/' + r.al + '.webp" alt="' + esc(al.name) + '"></span>' +
            '<span class="tagx ' + (r.k === 'I' ? 'intl' : 'dom') + '">Day ' + (i + 1) + '</span></div>' +
            '<div class="rmc__path">LAX <span>✈</span> ' + r.a + '</div>' +
            '<div class="rmc__city">' + esc(r.c) + (ap ? ' <small>' + esc(ap.name) + '</small>' : '') + '</div>' +
            '<p class="rmc__b">' + esc(r.b) + '</p>' +
            '<div class="rmc__facts">' +
              '<span><b>' + r.mi.toLocaleString() + '</b> miles</span>' +
              '<span><b>' + fmtH(r.block) + '</b> block time</span>' +
              '<span><b>' + r.deps + '</b> daily flights</span>' +
              '<span><b>' + esc(r.fn) + '</b> from ' + r.t + '</span>' +
              '<span class="wide"><b>' + esc(r.gauge) + '</b> · ~' + r.seats + ' seats</span>' +
            '</div>' +
            (offMap ? '<p class="rm__tip">' + esc(r.c) + ' sits outside the U.S. map — switch to World to see this one fly.</p>' : '') +
          '</div>' +
        '</div>';
    }

    function side() {
      var n = open();
      var miles = 0, countries = {}, intl = 0, regions = {};
      for (var i = 0; i < n; i++) {
        var r = D.ROUTES[i];
        miles += r.mi;
        if (r.k === 'I') intl++;
        regions[r.r] = 1;
        var ap = geo && geo.airports[r.a];
        if (ap) countries[ap.country] = 1;
      }
      countries.US = 1;
      host.querySelector('#rm-stats').innerHTML =
        '<div><b>' + n + '</b><span>routes open</span></div>' +
        '<div><b>' + Object.keys(countries).length + '</b><span>countries</span></div>' +
        '<div><b>' + Math.round(miles).toLocaleString() + '</b><span>network miles</span></div>' +
        '<div><b>' + (D.ROUTES.length - n) + '</b><span>still sealed</span></div>';
      var html = '';
      for (var j = n - 1; j >= 0; j--) {
        var rr = D.ROUTES[j];
        var hay = (rr.c + ' ' + rr.a + ' ' + rr.r + ' ' + D.AIRLINES[rr.al].name).toLowerCase();
        if (filter && hay.indexOf(filter) < 0) continue;
        var onMap = mode === 'world' || arcs.some(function (a) { return a.i === j; });
        html += '<button type="button" class="rm__item' + (onMap ? '' : ' is-off') + (focusIdx === j ? ' is-on' : '') + '" data-i="' + j + '">' +
          '<span class="rm__iday">' + String(j + 1).padStart(3, '0') + '</span>' +
          '<span class="rm__icode">' + rr.a + '</span>' +
          '<span class="rm__icity">' + esc(rr.c) + '</span>' +
          '<span class="rm__ikind ' + (rr.k === 'I' ? 'intl' : 'dom') + '"></span>' +
        '</button>';
      }
      if (!html) html = '<p class="rm__tip" style="padding:10px">' + (n ? 'No open route matches that search.' : 'No routes open yet.') + '</p>';
      if (n < D.ROUTES.length && !filter) {
        html += '<div class="rm__sealed">🔒 ' + (D.ROUTES.length - n) + ' sealed routes · next opens on your next logged day</div>';
      }
      host.querySelector('#rm-list').innerHTML = html;
    }

    /* ---------- events ---------- */
    host.querySelector('#rm-mode').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-v]');
      if (!b || b.dataset.v === mode) return;
      replaying = false;
      host.querySelector('#rm-counter').hidden = true;
      mode = b.dataset.v;
      host.querySelectorAll('#rm-mode button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      build();
      if (focusIdx !== null) focus(focusIdx, true); else card(null);
    });
    host.querySelector('#rm-replay').addEventListener('click', function () { unfocus(); svg && svg.transition().duration(500).call(zoom.transform, D3.zoomIdentity); setTimeout(replay, 520); });
    host.querySelector('#rm-fly').addEventListener('click', function () {
      if (!arcs.length) { opt.toast('No routes yet', 'Log a day to open your first route.'); return; }
      opt.sound('whoosh');
      for (var i = 0; i < Math.min(arcs.length, 24); i++) addPlane(arcs[Math.floor(Math.random() * arcs.length)], true, 1.6);
      if (!raf) loop();
    });
    host.querySelector('#rm-in').addEventListener('click', function () { svg && svg.transition().duration(300).call(zoom.scaleBy, 1.6); });
    host.querySelector('#rm-out').addEventListener('click', function () { svg && svg.transition().duration(300).call(zoom.scaleBy, 1 / 1.6); });
    host.querySelector('#rm-reset').addEventListener('click', function () { unfocus(); svg && svg.transition().duration(500).call(zoom.transform, D3.zoomIdentity); });
    host.querySelector('#rm-list').addEventListener('click', function (e) {
      var b = e.target.closest('.rm__item');
      if (b) focus(+b.dataset.i);
    });
    host.querySelector('#rm-search').addEventListener('input', function () { filter = this.value.trim().toLowerCase(); side(); });
    host.querySelector('#rm-card').addEventListener('click', function (e) {
      var p = e.target.closest('[data-photo]');
      if (p) opt.photo(p.dataset.photo);   // airline logos are handled by the page-wide [data-logo] listener
    });

    return {
      show: function () {
        load().then(function (g) {
          geo = g;
          var ld = host.querySelector('.rm__loading');
          if (ld) ld.remove();
          if (!built) { build(); card(null); }
          else if (open() !== lastOpen) draw(false);
          else if (!replaying && !raf) startPlanes();
        }).catch(function (err) {
          var ld = host.querySelector('.rm__loading');
          if (ld) ld.innerHTML = '<b>The maps could not load.</b><br>They need the site to be served over the web — on GitHub Pages they work automatically. ' +
            'If you opened <code>index.html</code> straight from your computer, run a small local server instead (see README).<br><small>' + esc(err.message) + '</small>';
        });
      },
      hide: function () { replaying = false; stopPlanes(); var c = host.querySelector('#rm-counter'); if (c) c.hidden = true; },
      refresh: function () { if (built && open() !== lastOpen) draw(false); },
      focus: function (i) { this.show(); setTimeout(function () { if (built) focus(i); }, 350); }
    };
  }

  /* ============================================================
     Mini map for the route-unlock card
     ============================================================ */
  function mini(el, route, opts) {
    opts = opts || {};
    return load().then(function (g) {
      var W = 420, H = 210;
      var a = g.airports.LAX, b = g.airports[route.a];
      if (!a || !b) return;
      var A = [a.lon, a.lat], B = [b.lon, b.lat];
      var mid = D3.geoInterpolate(A, B)(0.5);
      var dist = D3.geoDistance(A, B) * 180 / Math.PI;
      var proj = D3.geoNaturalEarth1().rotate([-mid[0], 0]);
      proj.fitExtent([[14, 14], [W - 14, H - 14]], D3.geoCircle().center(mid).radius(Math.max(4.5, dist * 0.62))());
      var lands = dist < 30 ? g.world.features : g.worldLite.features;
      var path = D3.geoPath(proj);
      var svg = D3.select(el).html('').append('svg').attr('viewBox', '0 0 ' + W + ' ' + H).attr('class', 'mini');
      svg.append('rect').attr('width', W).attr('height', H).attr('class', 'mini__bg');
      svg.append('path').datum(D3.geoGraticule10()).attr('class', 'mini__grat').attr('d', path);
      svg.append('g').selectAll('path').data(lands).join('path').attr('class', 'mini__land').attr('d', path);
      var line = { type: 'LineString', coordinates: [A, B] };
      var arc = svg.append('path').datum(line).attr('class', 'mini__arc ' + (route.k === 'I' ? 'is-intl' : 'is-dom')).attr('d', path);
      var pa = proj(A), pb = proj(B);
      [[pa, 'LAX', 'lax'], [pb, route.a, 'dst']].forEach(function (p) {
        var gg = svg.append('g').attr('transform', 'translate(' + p[0][0] + ',' + p[0][1] + ')').attr('class', 'mini__pt mini__pt--' + p[2]);
        gg.append('circle').attr('r', 9).attr('class', 'mini__ring');
        gg.append('circle').attr('r', 4);
        gg.append('text').attr('y', -11).text(p[1]);
      });
      var len = arc.node().getTotalLength();
      var plane = svg.append('path').attr('d', PLANE).attr('class', 'mini__plane');
      if (opts.reduced) {
        var e = arc.node().getPointAtLength(len * 0.6);
        plane.attr('transform', 'translate(' + e.x + ',' + e.y + ') scale(1.6)');
        return;
      }
      arc.attr('stroke-dasharray', len + ' ' + len).attr('stroke-dashoffset', len);
      var t0 = performance.now(), D1 = 2600;
      (function frame(now) {
        if (!document.body.contains(el)) return;
        var t = ((now - t0) % (D1 + 1400)) / D1;
        var u = Math.min(1, t);
        var e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        arc.attr('stroke-dashoffset', len * (1 - e));
        var q1 = arc.node().getPointAtLength(len * e), q2 = arc.node().getPointAtLength(Math.min(len, len * e + 1));
        var ang = Math.atan2(q2.y - q1.y, q2.x - q1.x) * 180 / Math.PI + 90;
        if (u >= 1) { q2 = arc.node().getPointAtLength(len - 1); ang = Math.atan2(q1.y - q2.y, q1.x - q2.x) * 180 / Math.PI + 90; }
        plane.attr('transform', 'translate(' + q1.x + ',' + q1.y + ') rotate(' + ang + ') scale(1.6)').style('opacity', u >= 1 ? 1 - Math.min(1, (t - 1) * 3) : 1);
        requestAnimationFrame(frame);
      })(t0);
    }).catch(function () { el.innerHTML = ''; el.hidden = true; });
  }

  root.LAX_MAPS = { create: create, mini: mini, load: load };
})(window);
