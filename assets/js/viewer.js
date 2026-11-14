/* =============================================================
   LAX MISSION CONTROL — full-screen image viewer
   Fit-to-screen so the whole picture is always visible first,
   then zoom from 100% up to 800%:
     • mouse wheel / trackpad pinch   • two-finger pinch on touch
     • double-click or double-tap      • + / − / 0 keys and buttons
     • drag to pan when zoomed in      • ← → to move between images
   ============================================================= */
(function (root) {
  'use strict';

  var el, img, stage, cap, count, thumbs, pct;
  var items = [], idx = 0;
  var z = 1, x = 0, y = 0, MAXZ = 8;
  var pointers = {}, pinch = null, pan = null, lastTap = 0;
  var lastFocus = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function build() {
    el = document.createElement('div');
    el.className = 'vw';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Image viewer');
    el.innerHTML =
      '<div class="vw__top">' +
        '<div class="vw__count"></div>' +
        '<div class="vw__tools">' +
          '<button type="button" data-a="out" aria-label="Zoom out">−</button>' +
          '<span class="vw__pct">100%</span>' +
          '<button type="button" data-a="in" aria-label="Zoom in">+</button>' +
          '<button type="button" data-a="fit" aria-label="Fit to screen">Fit</button>' +
          '<button type="button" data-a="one" aria-label="Zoom to 200%">2×</button>' +
          '<a class="vw__dl" data-a="open" target="_blank" rel="noopener" aria-label="Open the original file">↗</a>' +
          '<button type="button" data-a="close" class="vw__x" aria-label="Close viewer">✕</button>' +
        '</div>' +
      '</div>' +
      '<div class="vw__stage"><img class="vw__img" alt="" draggable="false"></div>' +
      '<button type="button" class="vw__nav vw__nav--prev" data-a="prev" aria-label="Previous image">‹</button>' +
      '<button type="button" class="vw__nav vw__nav--next" data-a="next" aria-label="Next image">›</button>' +
      '<div class="vw__foot"><div class="vw__cap"></div><div class="vw__thumbs"></div>' +
      '<div class="vw__help">Scroll or pinch to zoom · drag to pan · double-click to zoom · Esc to close</div></div>';
    document.body.appendChild(el);
    stage = el.querySelector('.vw__stage');
    img = el.querySelector('.vw__img');
    cap = el.querySelector('.vw__cap');
    count = el.querySelector('.vw__count');
    thumbs = el.querySelector('.vw__thumbs');
    pct = el.querySelector('.vw__pct');

    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]');
      if (!b) { if (e.target === stage && z === 1) close(); return; }
      var a = b.dataset.a;
      if (a === 'close') close();
      if (a === 'in') zoomAt(z * 1.5);
      if (a === 'out') zoomAt(z / 1.5);
      if (a === 'fit') reset(true);
      if (a === 'one') zoomAt(2);
      if (a === 'prev') go(idx - 1);
      if (a === 'next') go(idx + 1);
      var t = e.target.closest('[data-t]');
      if (t) go(+t.dataset.t);
    });
    thumbs.addEventListener('click', function (e) {
      var t = e.target.closest('[data-t]');
      if (t) go(+t.dataset.t);
    });

    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      var f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0022));
      zoomAt(z * f, e.clientX, e.clientY);
    }, { passive: false });

    stage.addEventListener('pointerdown', function (e) {
      stage.setPointerCapture(e.pointerId);
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: z, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        pan = null;
      } else if (ids.length === 1) {
        pan = { sx: e.clientX, sy: e.clientY, x: x, y: y, moved: false };
      }
    });
    stage.addEventListener('pointermove', function (e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);
      if (pinch && ids.length >= 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        zoomAt(pinch.z * d / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
      } else if (pan) {
        var dx = e.clientX - pan.sx, dy = e.clientY - pan.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true;
        if (z > 1) { x = pan.x + dx; y = pan.y + dy; clampPan(); apply(); }
        else if (Math.abs(dx) > 60 && Math.abs(dy) < 50 && items.length > 1) {
          pan = null; go(idx + (dx < 0 ? 1 : -1));
        }
      }
    });
    function up(e) {
      var wasPan = pan;
      delete pointers[e.pointerId];
      if (Object.keys(pointers).length < 2) pinch = null;
      if (!Object.keys(pointers).length) {
        pan = null;
        if (wasPan && !wasPan.moved && e.type === 'pointerup') {
          var now = Date.now();
          if (now - lastTap < 300) { zoomAt(z > 1.05 ? 1 : 2.5, e.clientX, e.clientY); lastTap = 0; }
          else lastTap = now;
        }
      }
    }
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);

    document.addEventListener('keydown', function (e) {
      if (el.hidden) return;
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else if (e.key === '+' || e.key === '=') zoomAt(z * 1.4);
      else if (e.key === '-' || e.key === '_') zoomAt(z / 1.4);
      else if (e.key === '0') reset(true);
      else if (e.key === 'ArrowRight') go(idx + 1);
      else if (e.key === 'ArrowLeft') go(idx - 1);
    }, true);
    window.addEventListener('resize', function () { if (!el.hidden) { clampPan(); apply(); } });
  }

  function base() {
    // size of the image at "fit"
    var sw = stage.clientWidth, sh = stage.clientHeight;
    var iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
    var s = Math.min(sw / iw, sh / ih, 1.6);
    return { w: iw * s, h: ih * s, sw: sw, sh: sh };
  }
  function clampPan() {
    var b = base();
    var mx = Math.max(0, (b.w * z - b.sw) / 2), my = Math.max(0, (b.h * z - b.sh) / 2);
    x = Math.max(-mx, Math.min(mx, x));
    y = Math.max(-my, Math.min(my, y));
  }
  function apply(anim) {
    var b = base();
    img.style.width = b.w + 'px';
    img.style.height = b.h + 'px';
    img.style.transition = anim ? 'transform .28s cubic-bezier(.2,.8,.3,1)' : 'none';
    img.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + z + ')';
    pct.textContent = Math.round(z * 100) + '%';
    stage.classList.toggle('is-zoomed', z > 1.01);
  }
  function zoomAt(nz, cx, cy) {
    nz = Math.max(1, Math.min(MAXZ, nz));
    var r = stage.getBoundingClientRect();
    if (cx == null) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
    // keep the point under the cursor fixed
    var px = cx - (r.left + r.width / 2), py = cy - (r.top + r.height / 2);
    x = px - (px - x) * nz / z;
    y = py - (py - y) * nz / z;
    z = nz;
    if (z === 1) { x = 0; y = 0; }
    clampPan(); apply(!pinch);
  }
  function reset(anim) { z = 1; x = 0; y = 0; apply(anim); }

  function go(i) {
    if (!items.length) return;
    idx = (i + items.length) % items.length;
    var it = items[idx];
    el.classList.add('is-loading');
    img.onload = function () { el.classList.remove('is-loading'); reset(false); };
    img.onerror = function () { el.classList.remove('is-loading'); };
    img.src = it.src;
    img.alt = it.title || '';
    img.className = 'vw__img' + (it.light ? ' is-light' : '');
    el.querySelector('[data-a="open"]').href = it.src;
    cap.innerHTML = (it.title ? '<b>' + esc(it.title) + '</b>' : '') + (it.caption ? '<span>' + esc(it.caption) + '</span>' : '');
    count.textContent = items.length > 1 ? (idx + 1) + ' / ' + items.length : '';
    el.querySelectorAll('.vw__nav').forEach(function (n) { n.hidden = items.length < 2; });
    thumbs.querySelectorAll('[data-t]').forEach(function (t) { t.classList.toggle('is-on', +t.dataset.t === idx); });
    var on = thumbs.querySelector('.is-on');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function open(list, i) {
    if (!el) build();
    items = list || [];
    lastFocus = document.activeElement;
    thumbs.innerHTML = items.length > 1 ? items.map(function (it, k) {
      return '<button type="button" data-t="' + k + '" class="' + (it.light ? 'is-light' : '') + '" aria-label="' + esc(it.title || ('Image ' + (k + 1))) + '"><img src="' + esc(it.thumb || it.src) + '" alt="" loading="lazy"></button>';
    }).join('') : '';
    el.hidden = false;
    document.body.classList.add('vw-open');
    go(i || 0);
    el.querySelector('.vw__x').focus();
  }
  function close() {
    if (!el || el.hidden) return;
    el.hidden = true;
    img.src = '';
    document.body.classList.remove('vw-open');
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
  }

  root.LAX_VIEWER = { open: open, close: close, isOpen: function () { return el && !el.hidden; } };
})(window);
