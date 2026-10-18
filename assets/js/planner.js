/* =============================================================
   LAX MISSION CONTROL — 24-hour day planner
   A Google-Calendar-style day column from 00:00 to 24:00.
     • drag a block to move it (5-minute snap)
     • drag its top or bottom edge to change start / end
     • click-drag on empty space to draw a new block
     • tap empty space to drop a 1-hour block there
     • drag an unscheduled task from the tray onto the grid
   On touch screens, press and hold a block for a moment to drag.
   The planner never edits data itself: every change is handed to
   the app through callbacks, which may refuse it (plan revisions
   cost points, so the player is asked first).
   ============================================================= */
(function (root) {
  'use strict';

  var DAY = 1440, SNAP = 5, MIN_LEN = 5;
  var ZOOMS = [30, 40, 52, 68, 90, 120];

  function pad(n) { return String(n).padStart(2, '0'); }
  function hm(m) { return pad(Math.floor(m / 60)) + '.' + pad(m % 60); }
  function dur(m) { var h = Math.floor(m / 60), n = m % 60; return !h ? n + 'm' : !n ? h + 'h' : h + 'h ' + n + 'm'; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function timed(t) { return t.s !== null && t.s !== undefined && t.e !== null && t.e !== undefined; }
  function snap(m, step) { step = step || SNAP; return Math.round(m / step) * step; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  /* side-by-side columns for overlapping blocks */
  function layout(items) {
    var sorted = items.slice().sort(function (a, b) { return a.s - b.s || b.e - a.e; });
    var clusters = [], cur = null, curEnd = -1;
    sorted.forEach(function (it) {
      if (!cur || it.s >= curEnd) { cur = []; clusters.push(cur); curEnd = it.e; }
      cur.push(it); curEnd = Math.max(curEnd, it.e);
    });
    clusters.forEach(function (cl) {
      var cols = [];
      cl.forEach(function (it) {
        var c = 0;
        while (cols[c] !== undefined && cols[c] > it.s) c++;
        cols[c] = it.e; it.col = c;
      });
      cl.forEach(function (it) { it.cols = cols.length; it.clash = cl.length > 1; });
    });
    return sorted;
  }

  function create(host, opt) {
    var zoomIdx = opt.zoom != null ? opt.zoom : 2;
    var H = ZOOMS[zoomIdx];
    var drag = null, nowTimer = null, autoRaf = null, lastScrollKey = null;

    host.classList.add('pl');
    host.innerHTML =
      '<div class="pl__bar">' +
        '<div class="pl__title"><span class="pl__dot"></span>24-hour plan <b class="pl__sum"></b></div>' +
        '<div class="pl__tools">' +
          '<button type="button" class="pl__btn" data-act="early" title="Jump to 06.00">06h</button>' +
          '<button type="button" class="pl__btn" data-act="now" title="Jump to now">Now</button>' +
          '<button type="button" class="pl__btn" data-act="out" aria-label="Zoom out the hours">−</button>' +
          '<button type="button" class="pl__btn" data-act="in" aria-label="Zoom in the hours">+</button>' +
        '</div>' +
      '</div>' +
      '<div class="pl__scroll" tabindex="-1">' +
        '<div class="pl__grid">' +
          '<div class="pl__gutter"></div>' +
          '<div class="pl__lane" aria-label="Day plan from 00.00 to 24.00. Click or drag on empty space to add a block."></div>' +
        '</div>' +
      '</div>' +
      '<div class="pl__hint">Drag to move · pull an edge to resize · drag on empty space to draw a block' +
        '<span class="pl__hint-touch"> · on touch, press and hold a block to move it</span></div>';

    var scroller = host.querySelector('.pl__scroll');
    var grid = host.querySelector('.pl__grid');
    var gutter = host.querySelector('.pl__gutter');
    var lane = host.querySelector('.pl__lane');

    function y2m(clientY) {
      var r = lane.getBoundingClientRect();
      return clamp((clientY - r.top) / H * 60, 0, DAY);
    }

    function drawGrid() {
      grid.style.height = (24 * H + 16) + 'px';
      var g = '', l = '';
      for (var h = 0; h <= 24; h++) {
        g += '<div class="pl__hr" style="top:' + (h * H) + 'px"><span>' + pad(h) + '.00</span></div>';
        if (h < 24) {
          l += '<div class="pl__line" style="top:' + (h * H) + 'px"></div>';
          l += '<div class="pl__line pl__line--half" style="top:' + (h * H + H / 2) + 'px"></div>';
          if (H >= 68) {
            l += '<div class="pl__line pl__line--q" style="top:' + (h * H + H / 4) + 'px"></div>';
            l += '<div class="pl__line pl__line--q" style="top:' + (h * H + 3 * H / 4) + 'px"></div>';
          }
        }
      }
      l += '<div class="pl__line pl__line--end" style="top:' + (24 * H) + 'px"></div>';
      // day-part shading: night / morning / afternoon / evening
      l += '<div class="pl__part pl__part--night" style="top:0;height:' + (6 * H) + 'px"></div>' +
           '<div class="pl__part pl__part--night" style="top:' + (22 * H) + 'px;height:' + (2 * H) + 'px"></div>';
      gutter.innerHTML = g;
      lane.innerHTML = l + '<div class="pl__blocks"></div><div class="pl__now" hidden><i></i></div>';
    }

    function render() {
      var tasks = opt.getTasks() || [];
      var blocksHost = lane.querySelector('.pl__blocks');
      var items = [];
      tasks.forEach(function (t, i) { if (timed(t)) items.push({ t: t, i: i, s: t.s, e: Math.max(t.e, t.s + MIN_LEN) }); });
      layout(items);
      var html = '';
      var total = 0;
      items.forEach(function (it) {
        var t = it.t;
        total += it.e - it.s;
        var top = it.s / 60 * H, ht = Math.max(14, (it.e - it.s) / 60 * H - 2);
        var w = 100 / it.cols, left = it.col * w;
        var small = ht < 34;
        html += '<div class="pb' + (t.d ? ' is-done' : '') + (it.clash ? ' is-clash' : '') + (small ? ' is-small' : '') +
          ' pb--c' + (it.i % 6) + '" data-i="' + it.i + '" tabindex="0" role="button" ' +
          'aria-label="' + esc(t.x) + ', ' + hm(it.s) + ' to ' + hm(t.e) + '. Press Enter to edit."' +
          ' style="top:' + top.toFixed(1) + 'px;height:' + ht.toFixed(1) + 'px;left:calc(' + left + '% + 2px);width:calc(' + w + '% - 4px)">' +
          '<span class="pb__h pb__h--top" data-h="top"></span>' +
          '<span class="pb__chk" data-h="chk" role="checkbox" aria-checked="' + (t.d ? 'true' : 'false') + '" aria-label="Done"></span>' +
          '<span class="pb__body">' +
            '<span class="pb__time">' + hm(t.s) + ' – ' + hm(t.e) + ' <i>' + dur(t.e - t.s) + '</i></span>' +
            '<span class="pb__txt">' + esc(t.x) + '</span>' +
          '</span>' +
          '<span class="pb__h pb__h--bot" data-h="bot"></span>' +
        '</div>';
      });
      blocksHost.innerHTML = html;
      host.querySelector('.pl__sum').textContent = items.length
        ? items.length + ' block' + (items.length === 1 ? '' : 's') + ' · ' + dur(total) + ' planned · ' + dur(Math.max(0, DAY - total)) + ' free'
        : 'nothing blocked yet';
      updateNow();
      var key = opt.dayKey ? opt.dayKey() : '';
      if (key !== lastScrollKey) {
        lastScrollKey = key;
        var first = items.length ? Math.min.apply(null, items.map(function (x) { return x.s; })) : null;
        var target = opt.isToday && opt.isToday() ? nowMin() - 90 : (first !== null ? first - 45 : 7 * 60);
        scroller.scrollTop = Math.max(0, target / 60 * H);
      }
    }

    function nowMin() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
    function updateNow() {
      var n = lane.querySelector('.pl__now');
      if (!n) return;
      if (!(opt.isToday && opt.isToday())) { n.hidden = true; return; }
      n.hidden = false;
      n.style.top = (nowMin() / 60 * H) + 'px';
    }
    nowTimer = setInterval(updateNow, 30000);

    function setZoom(i, anchorMin) {
      zoomIdx = clamp(i, 0, ZOOMS.length - 1);
      var mid = anchorMin != null ? anchorMin : (scroller.scrollTop + scroller.clientHeight / 2) / H * 60;
      H = ZOOMS[zoomIdx];
      drawGrid(); render();
      scroller.scrollTop = Math.max(0, mid / 60 * H - scroller.clientHeight / 2);
      if (opt.onZoom) opt.onZoom(zoomIdx);
    }

    host.querySelector('.pl__tools').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var a = b.dataset.act;
      if (a === 'in') setZoom(zoomIdx + 1);
      if (a === 'out') setZoom(zoomIdx - 1);
      if (a === 'now') scroller.scrollTo({ top: Math.max(0, (nowMin() - 60) / 60 * H), behavior: 'smooth' });
      if (a === 'early') scroller.scrollTo({ top: 6 * H, behavior: 'smooth' });
    });

    /* ---------- gestures ---------- */
    function blockEl(i) { return lane.querySelector('.pb[data-i="' + i + '"]'); }

    function startAuto() {
      if (autoRaf) return;
      (function loop() {
        if (!drag || !drag.active) { autoRaf = null; return; }
        var r = scroller.getBoundingClientRect(), y = drag.lastY, sp = 0;
        if (y < r.top + 40) sp = -Math.ceil((r.top + 40 - y) / 4);
        else if (y > r.bottom - 40) sp = Math.ceil((y - (r.bottom - 40)) / 4);
        if (sp) { scroller.scrollTop += sp; moveTo(drag.lastY); }
        autoRaf = requestAnimationFrame(loop);
      })();
    }

    function paint(el, s, e) {
      el.style.top = (s / 60 * H) + 'px';
      el.style.height = Math.max(14, (e - s) / 60 * H - 2) + 'px';
      var tl = el.querySelector('.pb__time');
      if (tl) tl.innerHTML = hm(s) + ' – ' + hm(e) + ' <i>' + dur(e - s) + '</i>';
    }

    function moveTo(clientY) {
      if (!drag) return;
      var m = y2m(clientY);
      var d = drag;
      if (d.kind === 'move') {
        var len = d.e0 - d.s0;
        var s = clamp(snap(d.s0 + (m - d.m0)), 0, DAY - len);
        d.s = s; d.e = s + len;
      } else if (d.kind === 'top') {
        d.s = clamp(snap(d.s0 + (m - d.m0)), 0, d.e0 - MIN_LEN); d.e = d.e0;
      } else if (d.kind === 'bot') {
        d.e = clamp(snap(d.e0 + (m - d.m0)), d.s0 + MIN_LEN, DAY); d.s = d.s0;
      } else if (d.kind === 'new') {
        var a = snap(d.m0, 15), b = snap(m, 15);
        if (b === a) b = a + 15;
        d.s = clamp(Math.min(a, b), 0, DAY - 15); d.e = clamp(Math.max(a, b), d.s + 15, DAY);
      } else if (d.kind === 'tray') {
        var s2 = clamp(snap(m - 30, 15), 0, DAY - 60);
        d.s = s2; d.e = s2 + 60;
      }
      if (d.el) paint(d.el, d.s, d.e);
    }

    function ghost(s, e, label) {
      var g = document.createElement('div');
      g.className = 'pb pb--ghost';
      g.innerHTML = '<span class="pb__body"><span class="pb__time"></span><span class="pb__txt">' + esc(label) + '</span></span>';
      g.style.left = '2px'; g.style.width = 'calc(100% - 4px)';
      lane.querySelector('.pl__blocks').appendChild(g);
      paint(g, s, e);
      return g;
    }

    function activate() {
      if (!drag || drag.active) return;
      drag.active = true;
      host.classList.add('is-dragging');
      if (drag.el) drag.el.classList.add('is-drag');
      if (drag.kind === 'new') drag.el = ghost(drag.s, drag.e, 'New block');
      if (navigator.vibrate && drag.touch) { try { navigator.vibrate(12); } catch (e) {} }
      startAuto();
    }

    lane.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      var b = e.target.closest('.pb');
      var touch = e.pointerType === 'touch';
      if (b && !b.classList.contains('pb--ghost')) {
        var i = +b.dataset.i, t = opt.getTasks()[i];
        if (!t) return;
        var h = e.target.closest('[data-h]');
        var kind = h ? h.dataset.h : 'move';
        if (kind === 'chk') { drag = { kind: 'chk', i: i }; return; }
        drag = { kind: kind, i: i, el: b, s0: t.s, e0: Math.max(t.e, t.s + MIN_LEN), s: t.s, e: t.e,
                 m0: y2m(e.clientY), y0: e.clientY, lastY: e.clientY, touch: touch, id: e.pointerId, active: false };
        if (touch) {
          drag.timer = setTimeout(function () { if (drag) activate(); }, 330);
        } else {
          e.preventDefault();
        }
        try { b.setPointerCapture(e.pointerId); } catch (err) {}
        return;
      }
      if (e.target.closest('.pl__now')) return;
      var m0 = y2m(e.clientY);
      drag = { kind: 'new', m0: m0, s: snap(m0, 15), e: snap(m0, 15) + 15, y0: e.clientY, lastY: e.clientY,
               touch: touch, id: e.pointerId, active: false };
      if (!touch) { e.preventDefault(); try { lane.setPointerCapture(e.pointerId); } catch (err) {} }
    });

    lane.addEventListener('pointermove', function (e) {
      if (!drag || drag.kind === 'chk' || (drag.id !== undefined && e.pointerId !== drag.id)) return;
      drag.lastY = e.clientY;
      if (!drag.active) {
        if (drag.touch) {
          // a moving finger before the hold completes means "scroll", not "drag"
          if (Math.abs(e.clientY - drag.y0) > 8) { clearTimeout(drag.timer); drag = null; }
          return;
        }
        if (Math.abs(e.clientY - drag.y0) < 4) return;
        activate();
      }
      moveTo(e.clientY);
    });

    // while a drag is live on touch, stop the page from scrolling
    lane.addEventListener('touchmove', function (e) { if (drag && drag.active) e.preventDefault(); }, { passive: false });

    function finish(e, cancelled) {
      if (!drag) return;
      var d = drag; drag = null;
      clearTimeout(d.timer);
      host.classList.remove('is-dragging');
      if (d.el) d.el.classList.remove('is-drag');
      var tasks = opt.getTasks();
      if (d.kind === 'chk') {
        if (!cancelled && e.target.closest('[data-h="chk"]')) opt.onToggle(tasks[d.i], d.i);
        return;
      }
      if (cancelled) { render(); return; }
      if (!d.active) {
        if (d.kind === 'new') {
          if (d.touch && Math.abs(e.clientY - d.y0) > 8) return;
          var s = clamp(snap(d.m0 - 30, 15), 0, DAY - 60);
          opt.onCreate(s, s + 60);
        } else {
          opt.onOpen(tasks[d.i], d.i);
        }
        return;
      }
      if (d.kind === 'new') { opt.onCreate(d.s, d.e); return; }
      var t = tasks[d.i];
      if (!t || (d.s === t.s && d.e === t.e)) { render(); return; }
      opt.onResize(t, d.i, d.s, d.e, d.kind);
    }
    lane.addEventListener('pointerup', function (e) { finish(e, false); });
    lane.addEventListener('pointercancel', function (e) {
      if (drag && drag.touch && !drag.active) { clearTimeout(drag.timer); drag = null; return; }
      finish(e, true);
    });

    lane.addEventListener('keydown', function (e) {
      var b = e.target.closest('.pb');
      if (!b) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        var i = +b.dataset.i;
        opt.onOpen(opt.getTasks()[i], i);
      }
    });

    /* ---------- dragging an unscheduled task in from the tray ---------- */
    function trayDrag(task, idx, e, chip) {
      var touch = e.pointerType === 'touch';
      var started = false, timer = null, x0 = e.clientX, y0 = e.clientY;
      var floatEl = null;
      function begin() {
        started = true;
        floatEl = document.createElement('div');
        floatEl.className = 'pl-float';
        floatEl.textContent = task.x;
        document.body.appendChild(floatEl);
        chip.classList.add('is-lifted');
        drag = { kind: 'tray', i: idx, active: true, s: 540, e: 600, lastY: y0, el: null, touch: touch };
        host.classList.add('is-dragging');
        startAuto();
        position(x0, y0);
      }
      function overLane(x, y) {
        var r = scroller.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      }
      function position(x, y) {
        floatEl.style.transform = 'translate(' + (x + 12) + 'px,' + (y + 8) + 'px)';
        drag.lastY = y;
        if (overLane(x, y)) {
          if (!drag.el) drag.el = ghost(540, 600, task.x);
          moveTo(y);
        } else if (drag.el) { drag.el.remove(); drag.el = null; }
      }
      function mv(ev) {
        if (!started) {
          if (touch) { if (Math.abs(ev.clientY - y0) > 8 || Math.abs(ev.clientX - x0) > 8) { cleanup(); } return; }
          if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 5) return;
          begin();
        }
        ev.preventDefault();
        position(ev.clientX, ev.clientY);
      }
      function tm(ev) { if (started) ev.preventDefault(); }
      function up(ev) {
        var wasOver = started && drag && drag.el;
        var s = drag && drag.s, en = drag && drag.e;
        cleanup();
        if (!started) { opt.onOpen(task, idx); return; }
        if (wasOver) opt.onPlace(task, idx, s, en);
      }
      function cleanup() {
        clearTimeout(timer);
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cleanup);
        window.removeEventListener('touchmove', tm);
        if (floatEl) floatEl.remove();
        chip.classList.remove('is-lifted');
        if (drag && drag.el) drag.el.remove();
        if (drag && drag.kind === 'tray') drag = null;
        host.classList.remove('is-dragging');
      }
      if (touch) timer = setTimeout(begin, 330);
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cleanup);
      window.addEventListener('touchmove', tm, { passive: false });
    }

    drawGrid();
    render();

    return {
      render: render,
      rescroll: function () { lastScrollKey = null; render(); },
      zoom: function (i) { setZoom(i); },
      trayDrag: trayDrag,
      scrollToMin: function (m) { scroller.scrollTop = Math.max(0, m / 60 * H - 40); },
      destroy: function () { clearInterval(nowTimer); }
    };
  }

  root.LAX_PLANNER = { create: create, hm: hm, dur: dur };
})(window);
