/* ==========================================================================
   KALAN OS 5.1  --  window manager + shell
   Depends on games.js (window.GAMES, window.PALETTE)
   ========================================================================== */
(function () {
  'use strict';

  var GAMES = window.GAMES;
  var PALETTE = window.PALETTE;

  if (!GAMES || !GAMES.length) {
    document.body.innerHTML =
      '<pre style="padding:24px;color:#ef4444;font:16px monospace">' +
      'FATAL: games.js failed to load, or window.GAMES is empty.</pre>';
    return;
  }

  /* ---------------------------------------------------------------- utils */

  var $ = function (sel, root) { return (root || document).querySelector(sel); };

  /* matchMedia exists in every browser but not in every test harness, and both
     the confetti and the arcade portal hinge on it. One guarded reader, so a
     missing implementation degrades instead of throwing mid-animation. */
  function reducedMotion() {
    try {
      return !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  function esc(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Merge each horizontal run of equal pixels into one <rect>. Keeps the DOM
     small enough that 11 icons stay cheap to render. */
  function spriteSVG(sprite) {
    var out = '';
    for (var y = 0; y < sprite.length; y++) {
      var row = sprite[y];
      var x = 0;
      while (x < row.length) {
        var c = row[x];
        var w = 1;
        while (x + w < row.length && row[x + w] === c) w++;
        if (c !== '.' && PALETTE[c]) {
          out += '<rect x="' + x + '" y="' + y + '" width="' + w +
            '" height="1" fill="' + PALETTE[c] + '"/>';
        }
        x += w;
      }
    }
    return '<svg viewBox="0 0 16 16" class="pix" shape-rendering="crispEdges" ' +
      'aria-hidden="true" focusable="false">' + out + '</svg>';
  }

  var ICONS = {};
  GAMES.forEach(function (g) { ICONS[g.id] = spriteSVG(g.sprite); });
  function icon(id) { return ICONS[id] || ''; }

  var STORE_PLAYS = 'kalanos.plays';
  var STORE_POS = 'kalanos.positions';
  var STORE_WINS = 'kalanos.windows';

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      var val = raw ? JSON.parse(raw) : null;
      return val && typeof val === 'object' ? val : fallback;
    } catch (e) { return fallback; }
  }
  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode */ }
  }

  function recordPlay(id) {
    var plays = readJSON(STORE_PLAYS, {});
    plays[id] = (plays[id] || 0) + 1;
    writeJSON(STORE_PLAYS, plays);
    renderBadges();
  }

  /* ------------------------------------------------------------- boot ---- */

  var bootEl = $('#boot');
  var bootLog = $('#boot-log');
  var bootFill = $('#boot-fill');
  var bootPct = $('#boot-pct');
  var bootSkipped = false;

  var BOOT_LINES = [
    ['KALAN BIOS v5.1   (C) 2026 KALAN SYSTEMS', ''],
    ['CPU: PIXEL-1  @ 640 MHz  ............ ', 'OK'],
    ['GPU: CHROMA-64  16 COLOURS  .......... ', 'OK'],
    ['MEM: 640 KB   (BLOCKSIZE 64K)  ....... ', 'OK'],
    ['DETECTING IDE .... VERCEL.CLOUD  ..... ', 'OK'],
    ['MOUSE ............ PS/2 PORT 1  ....... ', 'OK'],
    ['SOUND ............ NONE (PER DESIGN) .. ', 'OK'],
    ['LOADING KERNEL KALANOS 5.1 ............ ', '']
  ];

  function wait(ms) {
    return new Promise(function (res) {
      if (bootSkipped) return res();
      setTimeout(res, ms);
    });
  }

  async function runBoot() {
    var skip = /[?&]noboot=1/.test(location.search);
    if (skip) { bootSkipped = true; return finishBoot(); }

    for (var i = 0; i < BOOT_LINES.length; i++) {
      var line = BOOT_LINES[i];
      var text = line[0] + (line[1] ? line[1] : '');
      for (var c = 0; c < text.length; c++) {
        bootLog.textContent = bootLog.textContent + text[c];
        if (c % 3 === 0) await wait(9);
      }
      bootLog.textContent += '\n';
      await wait(40);
    }

    for (var p = 0; p <= 100; p += 4) {
      bootFill.style.width = p + '%';
      bootPct.textContent = p + '%';
      await wait(22);
    }

    await wait(180);
    finishBoot();
  }

  function finishBoot() {
    bootEl.classList.add('done');
    var desk = $('#desktop');
    desk.hidden = false;
    setTimeout(function () { bootEl.remove(); }, 300);
    log('desktop ready');
    renderIcons();
    startClock();
    wireShell();
  }

  function log(msg) { if (window.console) console.log('[KALAN OS] ' + msg); }

  bootEl.addEventListener('click', skipBoot);
  document.addEventListener('keydown', function once(e) {
    if (bootEl.isConnected) { skipBoot(); document.removeEventListener('keydown', once); }
  });

  function skipBoot() {
    if (bootSkipped) return;
    bootSkipped = true;
    finishBoot();
  }

  /* ---------------------------------------------------------- desktop ---- */

  var iconsEl = $('#icons');
  var iconBtns = [];

  function renderIcons() {
    iconsEl.innerHTML = '';
    iconBtns = [];

    GAMES.forEach(function (game, idx) {
      var b = document.createElement('button');
      b.className = 'dicon';
      b.type = 'button';
      b.dataset.id = game.id;
      b.dataset.idx = idx;
      b.title = game.title + ' - ' + game.blurb +
        '\nclick to select, double-click for a new tab, right-click for the menu';
      b.setAttribute('aria-label', game.title + '. Double-click to open in a new tab, ' +
        'right-click to open windowed.');
      b.innerHTML =
        '<span class="art">' + icon(game.id) + '</span>' +
        '<span class="lbl">' + esc(game.title) + '</span>' +
        '<span class="playcount" hidden></span>';
      iconsEl.appendChild(b);
      iconBtns.push(b);
      wireIconDrag(b);
    });

    iconsEl.addEventListener('click', onIconClick);
    iconsEl.addEventListener('dblclick', onIconDblClick);
    iconsEl.addEventListener('contextmenu', onIconContext);
    renderBadges();
    applySavedLayout();
  }

  /* ----------------------------------------------------- icon dragging ---- */
  /* Icons start in the CSS grid. The first drag freezes the whole grid into
     absolute positions (see freezeLayout), after which every icon is positioned
     by stored coordinates. Final coordinates are kept per game id in
     localStorage and re-applied on the next load. */

  var GRID = 2;          /* everything in this design sits on a 2px grid */
  var DRAG_SLOP = 4;     /* px of movement before a press counts as a drag */
  /* A drag ends with a click on the same icon. Swallow exactly that click, and
     only while it is still plausible -- matching on the element matters, since
     a blanket timeout also ate the next click on any other icon. */
  var swallow = { el: null, until: 0 };

  function armSwallow(el, ms) {
    swallow.el = el;
    swallow.until = Date.now() + (ms || 400);
  }

  /* iconsEl counts as a match too: the rubber band is released over whatever
     is under the cursor, and that click would otherwise collapse the band
     selection to a single icon. */
  function wasSwallowed(el) {
    if (Date.now() >= swallow.until) return false;
    if (swallow.el !== el && swallow.el !== iconsEl) return false;
    swallow.el = null;
    return true;
  }

  function loadLayout() { return readJSON(STORE_POS, {}); }

  function saveLayout(map) { writeJSON(STORE_POS, map); }

  function snap(v) { return Math.round(v / GRID) * GRID; }

  function clampToHost(el, x, y) {
    var host = iconsEl.getBoundingClientRect();
    var maxX = Math.max(0, host.width - el.offsetWidth);
    var maxY = Math.max(0, host.height - el.offsetHeight);
    return {
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(0, y), maxY)
    };
  }

  function parkIcon(el, x, y) {
    var p = clampToHost(el, x, y);
    el.classList.add('placed');
    el.style.left = snap(p.x) + 'px';
    el.style.top = snap(p.y) + 'px';
    return { x: snap(p.x), y: snap(p.y) };
  }

  function rememberIcon(el) {
    var map = loadLayout();
    map[el.dataset.id] = { x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0 };
    saveLayout(map);
  }

  function applySavedLayout() {
    var map = loadLayout();
    var any = false;
    iconBtns.forEach(function (el) {
      var p = map[el.dataset.id];
      if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return;
      parkIcon(el, p.x, p.y);
      any = true;
    });
    return any;
  }

  /* The first time an icon is dragged the whole grid is pinned in place.
     Without this, pulling one icon out of the flow would let the remaining
     ones reflow into the gap and land underneath it -- and that shuffle would
     repeat on every reload. */
  function freezeLayout() {
    var host = iconsEl.getBoundingClientRect();
    var map = loadLayout();
    var pending = [];
    /* Measure everything up front. Parking an icon takes it out of the grid,
       so reading the next rect after a park would report a reflowed position. */
    iconBtns.forEach(function (el) {
      if (el.classList.contains('placed')) return;
      var r = el.getBoundingClientRect();
      pending.push([el, r.left - host.left, r.top - host.top]);
    });
    pending.forEach(function (p) {
      map[p[0].dataset.id] = parkIcon(p[0], p[1], p[2]);
    });
    saveLayout(map);
  }

  function resetIconLayout() {
    saveLayout({});
    iconBtns.forEach(function (el) {
      el.classList.remove('placed');
      el.style.left = '';
      el.style.top = '';
    });
  }

  function wireIconDrag(el) {
    el.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      var host = iconsEl.getBoundingClientRect();
      var rect = el.getBoundingClientRect();
      /* where inside the icon the pointer grabbed it, so it does not jump */
      var grabX = e.clientX - rect.left;
      var grabY = e.clientY - rect.top;
      var startX = e.clientX, startY = e.clientY;
      var dragging = false;

      try { el.setPointerCapture(e.pointerId); } catch (err) { /* not supported */ }

      function onMove(ev) {
        var dx = ev.clientX - startX;
        var dy = ev.clientY - startY;
        if (!dragging) {
          if (Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
          dragging = true;
          el.classList.add('dragging');
          /* Pin the untouched grid, then keep hold of this icon. freezeLayout
             has already parked this element exactly where it sits, so there is
             nothing to re-park here: re-parking from the pointerdown rect would
             snap and clamp an already-correct spot and nudge the icon out from
             under the cursor on pickup. */
          freezeLayout();
        }
        ev.preventDefault();
        parkIcon(el, ev.clientX - host.left - grabX, ev.clientY - host.top - grabY);
      }

      function onUp() {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
        if (!dragging) return;
        el.classList.remove('dragging');
        armSwallow(el);
        /* if no click follows (pointer released off the icon) do not stay armed */
        setTimeout(function () { if (swallow.el === el) swallow.el = null; }, 0);
        rememberIcon(el);
      }

      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    });
  }

  /* ------------------------------------------------------- selection ---- */
  /* A single click never launches anything, it only selects. Launching has to
     be a deliberate act: double click for a real browser tab, right click for
     the menu. Selection is read back out of the .sel class so the DOM stays
     the single source of truth and nothing can drift from it. */

  function selectedIds() {
    return iconBtns
      .filter(function (b) { return b.classList.contains('sel'); })
      .map(function (b) { return b.dataset.id; });
  }

  function paintSelection(ids) {
    iconBtns.forEach(function (b) {
      b.classList.toggle('sel', ids.indexOf(b.dataset.id) > -1);
    });
  }

  function selectOnly(id) { paintSelection([id]); }

  function addToSelection(id) {
    var ids = selectedIds();
    var at = ids.indexOf(id);
    if (at > -1) ids.splice(at, 1); else ids.push(id);
    paintSelection(ids);
  }

  function selectAll() { paintSelection(GAMES.map(function (g) { return g.id; })); }

  function clearSelection() { paintSelection([]); }

  /* -------------------------------------------------------- launching ---- */
  /* Only ever one tab per gesture. Browsers treat a burst of window.open
     calls as a single gesture and block every one after the first, so there is
     no way to open a selection as tabs from here -- hence no "open in new
     tabs" entry anywhere. Many apps means many windows in this tab instead. */

  function openInTab(id) {
    var g = byId(id);
    if (!g) return;
    window.open(g.url, '_blank', 'noopener');
    recordPlay(id);
  }

  function openManyWindowed(ids) { ids.forEach(openGame); }

  function onIconClick(e) {
    var b = e.target.closest('.dicon');
    if (!b) return;
    /* a drag, or the end of a rubber band, lands a real click on the icon */
    if (wasSwallowed(b)) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) addToSelection(b.dataset.id);
    else selectOnly(b.dataset.id);
  }

  function onIconDblClick(e) {
    var b = e.target.closest('.dicon');
    if (!b) return;
    openInTab(b.dataset.id);
  }

  function onIconContext(e) {
    var b = e.target.closest('.dicon');
    if (!b) return;
    e.preventDefault();
    var id = b.dataset.id;
    var ids = selectedIds();
    /* right clicking outside the current selection retargets it, the way every
       file manager behaves */
    if (ids.indexOf(id) === -1) { selectOnly(id); ids = [id]; }

    var one = ids.length === 1;
    var label = one ? byId(id).title : ids.length + ' APPS';

    var items = [];
    if (one) {
      /* a single app can go to a tab, but several cannot, so the entry only
         appears when exactly one icon is selected */
      items.push({
        label: 'Open ' + label + ' in new tab',
        glyph: icon(id),
        act: function () { openInTab(id); }
      });
    }
    items.push({
      label: 'Open ' + label + ' windowed',
      act: function () { openManyWindowed(ids); }
    });
    items.push({ sep: true });
    items.push({ label: 'Reset placements', act: resetIconLayout });

    showCtx(e.clientX, e.clientY, items);
  }

  /* ----------------------------------------------------- rubber band ---- */
  /* Dragging the wallpaper sweeps a selection box, the same idea as dragging
     across files in a file manager. The band is appended to the desktop rather
     than the icon layer because .icons clips its overflow, which would chop
     the band off at the icon area once icons have been dragged free of the
     grid. */

  var MARQUEE_BLOCKERS = '.dicon, .win, .taskbar, .menu, .start-btn, .marquee';
  var marquee = null;

  function rubberBox(m, host) {
    var x = Math.min(m.x0, m.x1);
    var y = Math.min(m.y0, m.y1);
    var r = Math.max(m.x0, m.x1);
    var b = Math.max(m.y0, m.y1);
    /* clipped to the icon area so the band can never be drawn over the
       taskbar, even when the pointer strays down there */
    var left = Math.max(host.left, x);
    var top = Math.max(host.top, y);
    var right = Math.min(host.right, r);
    var bottom = Math.min(host.bottom, b);
    return {
      x: left, y: top,
      w: Math.max(0, right - left),
      h: Math.max(0, bottom - top)
    };
  }

  function overlaps(r, box) {
    return r.left < box.x + box.w && r.right > box.x &&
      r.top < box.y + box.h && r.bottom > box.y;
  }

  function startMarquee(e) {
    var desk = $('#desktop');
    var host = iconsEl.getBoundingClientRect();
    var m = {
      x0: e.clientX, y0: e.clientY,
      x1: e.clientX, y1: e.clientY,
      add: e.shiftKey || e.ctrlKey || e.metaKey,
      base: selectedIds(),
      moved: false,
      el: document.createElement('div')
    };
    m.el.className = 'marquee';
    m.el.setAttribute('aria-hidden', 'true');
    desk.appendChild(m.el);
    desk.classList.add('banding');
    marquee = m;

    function paint() {
      var box = rubberBox(m, host);
      m.el.style.left = box.x + 'px';
      m.el.style.top = box.y + 'px';
      m.el.style.width = box.w + 'px';
      m.el.style.height = box.h + 'px';
      var ids = m.add ? m.base.slice() : [];
      iconBtns.forEach(function (b) {
        if (ids.indexOf(b.dataset.id) > -1) return;
        if (overlaps(b.getBoundingClientRect(), box)) ids.push(b.dataset.id);
      });
      paintSelection(ids);
    }

    function onMove(ev) {
      m.x1 = ev.clientX; m.y1 = ev.clientY;
      if (!m.moved) {
        if (Math.abs(m.x1 - m.x0) < DRAG_SLOP && Math.abs(m.y1 - m.y0) < DRAG_SLOP) return;
        m.moved = true;
      }
      ev.preventDefault();
      paint();
    }

    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onBlur);
      desk.classList.remove('banding');
      if (marquee === m) marquee = null;
      m.el.remove();
      if (m.moved) {
        /* the release fires a click on whatever sits under the cursor */
        armSwallow(iconsEl, 250);
      } else if (!m.add) {
        /* a plain click on the wallpaper is the "click the floor to deselect"
           gesture */
        clearSelection();
      }
    }

    /* A pointerup outside the browser window is never delivered, so the band
       would stay on screen with its listeners still armed. Tear down without
       committing the selection the way a real release would. */
    function onBlur() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onBlur);
      desk.classList.remove('banding');
      if (marquee === m) marquee = null;
      m.el.remove();
    }

    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onBlur);
  }

  function renderBadges() {
    var plays = readJSON(STORE_PLAYS, {});
    iconBtns.forEach(function (b) {
      var n = plays[b.dataset.id] || 0;
      var badge = b.querySelector('.playcount');
      if (n > 0) {
        badge.hidden = false;
        badge.textContent = n + 'x';
      } else {
        badge.hidden = true;
      }
    });
  }

  function byId(id) {
    for (var i = 0; i < GAMES.length; i++) if (GAMES[i].id === id) return GAMES[i];
    return null;
  }

  /* ---------------------------------------------------------- windows ---- */

  var layer = $('#windows');
  var taskItems = $('#task-items');
  var zTop = 10;
  var windows = [];
  var cascade = 0;

  function layerBox() {
    return { w: layer.clientWidth, h: layer.clientHeight };
  }

  function openGame(id) {
    var g = byId(id);
    if (!g) return;

    var existing = windows.filter(function (w) { return w.id === id; })[0];
    if (existing) {
      if (existing.min) restore(existing); else focus(existing);
      return;
    }

    var box = layerBox();
    /* Never open wider or taller than the desktop, or on a phone the window
       is born partly off-screen with no room to drag it back. */
    var small = box.w < 560;
    var pad = small ? 8 : 60;
    var w = Math.min(box.w - 8, Math.max(small ? 240 : 320, box.w - pad));
    var h = Math.min(box.h - 8, Math.max(small ? 220 : 260, box.h - pad));
    var step = 26;
    var off = (cascade % 6) * step;
    cascade++;

    var x = Math.max(4, Math.round((box.w - w) / 2) - 90 + off);
    var y = Math.max(4, Math.round((box.h - h) / 2) - 60 + off);
    x = Math.min(x, Math.max(4, box.w - w - 4));
    y = Math.min(y, Math.max(4, box.h - h - 4));

    var saved = readJSON(STORE_WINS, {})[id];
    if (saved && saved.w > 0 && saved.h > 0) {
      w = Math.min(saved.w, box.w);
      h = Math.min(saved.h, box.h);
      x = Math.min(Math.max(saved.x, -w + 90), Math.max(0, box.w - 60));
      y = Math.min(Math.max(saved.y, 0), Math.max(0, box.h - 26));
    }

    var el = document.createElement('section');
    el.className = 'win';
    el.dataset.id = id;
    el.style.setProperty('--accent', g.accent);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.width = w + 'px';
    el.style.height = h + 'px';

    el.innerHTML =
      '<header class="win-title">' +
      '<span class="wt-icon">' + icon(id) + '</span>' +
      '<span class="win-name">' + esc(g.title) + '</span>' +
      '<span class="win-btns">' +
      '<button class="wb min" title="Minimise" aria-label="Minimise"></button>' +
      '<button class="wb max" title="Maximise" aria-label="Maximise"></button>' +
      '<button class="wb close" title="Close" aria-label="Close"></button>' +
      '</span>' +
      '</header>' +
      '<div class="win-body">' +
      '<div class="win-strip">' +
      '<span class="cat">' + esc(g.category) + '</span>' +
      '<span class="msg">' + esc(g.blurb) + '</span>' +
      '<button class="px-btn mini popout" type="button" title="Open in a real tab">POP OUT</button>' +
      '</div>' +
      '<div class="load"><i></i></div>' +
      '<div class="win-frame loading">' +
      '<iframe title="' + esc(g.title) + '" src="' + esc(g.url) + '" ' +
      'allow="fullscreen; gamepad; pointer-lock; autoplay; clipboard-write; cross-origin-isolated" ' +
      'referrerpolicy="strict-origin-when-cross-origin" loading="eager"></iframe>' +
      '</div>' +
      '</div>' +
      gripsHtml();

    layer.appendChild(el);

    var win = { id: id, game: g, el: el, min: false, max: false, restore: null };
    windows.push(win);

    var frame = $('.win-frame', el);
    var bar = $('.load i', el);
    var msg = $('.msg', el);
    var iframe = $('iframe', el);
    var pct = 0;
    var ticker = setInterval(function () {
      pct = Math.min(92, pct + 7 + Math.random() * 11);
      bar.style.width = pct + '%';
    }, 110);

    var slowTimer = setTimeout(function () {
      if (frame.classList.contains('loading')) msg.textContent = 'Slow connection - use POP OUT';
    }, 8000);

    iframe.addEventListener('load', function () {
      clearInterval(ticker);
      clearTimeout(slowTimer);
      pct = 100;
      bar.style.width = '100%';
      frame.classList.remove('loading');
      msg.textContent = 'running - ' + g.title;
      recordPlay(id);
      confetti(el, g.accent);
    });

    iframe.addEventListener('error', function () {
      clearInterval(ticker);
      clearTimeout(slowTimer);
      showFrameError(frame, g);
    });

    $('.wb.min', el).addEventListener('click', function (e) { e.stopPropagation(); minimise(win); });
    $('.wb.max', el).addEventListener('click', function (e) { e.stopPropagation(); toggleMax(win); });
    $('.wb.close', el).addEventListener('click', function (e) { e.stopPropagation(); closeWin(win); });
    $('.popout', el).addEventListener('click', function (e) {
      e.stopPropagation();
      window.open(g.url, '_blank', 'noopener');
      recordPlay(id);
    });

    el.addEventListener('pointerdown', function () { focus(win); }, true);
    $('.win-title', el).addEventListener('dblclick', function (e) {
      if (e.target.closest('.wb')) return;
      toggleMax(win);
    });

    makeDraggable(win);
    makeResizable(win);

    focus(win);
    syncTaskbar();
    return win;
  }

  function showFrameError(frame, g) {
    frame.classList.remove('loading');
    frame.innerHTML =
      '<div class="win-error">' +
      '<h3>COULD NOT<br>LOAD</h3>' +
      '<p>' + esc(g.title) + ' did not respond. It may be offline, or the ' +
      'browser may be blocking the frame.</p>' +
      '<button class="px-btn" type="button">OPEN IN NEW TAB</button>' +
      '</div>';
    frame.querySelector('button').addEventListener('click', function () {
      window.open(g.url, '_blank', 'noopener');
      recordPlay(g.id);
    });
  }

  /* ------------------------------------------------------------ focus ---- */

  function focus(win) {
    zTop++;
    win.el.style.zIndex = zTop;
    windows.forEach(function (w) { w.el.classList.toggle('active', w === win); });
    syncTaskbar();
  }

  function minimise(win) {
    win.min = true;
    win.el.classList.add('min');
    var next = windows.filter(function (w) { return !w.min; })
      .sort(function (a, b) { return (+b.el.style.zIndex || 0) - (+a.el.style.zIndex || 0); })[0];
    if (next) focus(next); else syncTaskbar();
  }

  function restore(win) {
    win.min = false;
    win.el.classList.remove('min');
    focus(win);
  }

  function closeWin(win) {
    win.el.remove();
    windows = windows.filter(function (w) { return w !== win; });
    var next = windows.filter(function (w) { return !w.min; })
      .sort(function (a, b) { return (+b.el.style.zIndex || 0) - (+a.el.style.zIndex || 0); })[0];
    if (next) focus(next); else syncTaskbar();
  }

  function closeAll() {
    windows.slice().forEach(closeWin);
  }

  function toggleMax(win) {
    var el = win.el;
    if (win.max) {
      var r = win.restore;
      el.classList.remove('max');
      win.max = false;
      applyGeom(el, {
        x: parseFloat(r.left) || 0,
        y: parseFloat(r.top) || 0,
        w: parseFloat(r.width) || 0,
        h: parseFloat(r.height) || 0
      });
      /* the desktop may have been resized while maximised */
      fitWinToLayer(win);
    } else {
      win.restore = {
        left: el.style.left, top: el.style.top,
        width: el.style.width, height: el.style.height
      };
      var box = layerBox();
      el.style.left = '0px';
      el.style.top = '0px';
      el.style.width = box.w + 'px';
      el.style.height = box.h + 'px';
      el.classList.add('max');
      win.max = true;
    }
    focus(win);
  }

  /* ------------------------------------------------------ drag/resize ---- */

  var GRIP_DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
  var GRIP_CURSOR = {
    n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
    ne: 'nesw-resize', nw: 'nesw-resize', se: 'nwse-resize', sw: 'nesw-resize'
  };

  function gripsHtml() {
    return GRIP_DIRS.map(function (d) {
      return '<div class="win-grip" data-dir="' + d + '" title="Resize"></div>';
    }).join('');
  }

  function applyGeom(el, g) {
    el.style.left = g.x + 'px';
    el.style.top = g.y + 'px';
    el.style.width = g.w + 'px';
    el.style.height = g.h + 'px';
  }

  function saveWinGeom(win) {
    /* Maximised is a transient state, and the notice windows have synthetic
       ids, so neither is worth remembering. */
    if (win.max || win.id.charAt(0) === '_') return;
    var map = readJSON(STORE_WINS, {});
    map[win.id] = {
      x: parseFloat(win.el.style.left) || 0,
      y: parseFloat(win.el.style.top) || 0,
      w: win.el.offsetWidth,
      h: win.el.offsetHeight
    };
    writeJSON(STORE_WINS, map);
  }

  /* A window wider than the desktop, or parked past its edge, cannot be
     dragged back into view once the browser shrinks. Pull it inside and keep
     the title bar reachable. */
  function fitWinToLayer(win) {
    var box = layerBox();
    var el = win.el;
    if (win.max) {
      el.style.width = box.w + 'px';
      el.style.height = box.h + 'px';
      return;
    }
    var cs = getComputedStyle(el);
    var minW = parseFloat(cs.minWidth);
    var minH = parseFloat(cs.minHeight);
    minW = minW > 0 ? minW : 160;
    minH = minH > 0 ? minH : 120;

    var w = Math.min(el.offsetWidth, box.w);
    var h = Math.min(el.offsetHeight, box.h);
    w = Math.max(w, Math.min(minW, box.w));
    h = Math.max(h, Math.min(minH, box.h));
    var x = parseFloat(el.style.left) || 0;
    var y = parseFloat(el.style.top) || 0;
    x = Math.min(Math.max(x, -w + 90), Math.max(0, box.w - 60));
    y = Math.min(Math.max(y, 0), Math.max(0, box.h - 26));
    w = snap(w); h = snap(h);
    /* Snap can round up past the desktop, so re-check afterwards. */
    if (w > box.w) w = box.w;
    if (h > box.h) h = box.h;
    applyGeom(el, { x: snap(x), y: snap(y), w: w, h: h });
  }

  function makeDraggable(win) {
    var bar = $('.win-title', win.el);
    var startX = 0, startY = 0, origX = 0, origY = 0, active = false;

    bar.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.target.closest('.wb')) return;
      if (win.max) return;
      active = true;
      startX = e.clientX; startY = e.clientY;
      origX = win.el.offsetLeft; origY = win.el.offsetTop;
      win.el.classList.add('dragging');
      bar.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    bar.addEventListener('pointermove', function (e) {
      if (!active) return;
      var box = layerBox();
      var nx = origX + (e.clientX - startX);
      var ny = origY + (e.clientY - startY);
      nx = Math.min(Math.max(nx, -win.el.offsetWidth + 90), box.w - 60);
      ny = Math.min(Math.max(ny, 0), box.h - 26);
      win.el.style.left = snap(nx) + 'px';
      win.el.style.top = snap(ny) + 'px';
    });

    function end(e) {
      if (!active) return;
      active = false;
      win.el.classList.remove('dragging');
      try { bar.releasePointerCapture(e.pointerId); } catch (err) { /* already gone */ }
      saveWinGeom(win);
    }
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
  }

  function makeResizable(win) {
    var el = win.el;
    var grips = [].slice.call(el.querySelectorAll('.win-grip'));
    var st = null, dir = '', handle = null;

    /* Read the floor from CSS so the small-screen media query is honoured
       instead of being duplicated as a second number that can drift. */
    function mins() {
      var cs = getComputedStyle(el);
      var mw = parseFloat(cs.minWidth);
      var mh = parseFloat(cs.minHeight);
      return { w: mw > 0 ? mw : 160, h: mh > 0 ? mh : 120 };
    }

    /* Dragging an edge of a maximised window drops back to a usable size with
       the grabbed edge pinned, which is the only way off maximised without a
       pointer precise enough to hit the restore button. */
    function unmaxFor(d) {
      var box = layerBox();
      var m = mins();
      var w = Math.max(m.w, Math.min(880, box.w - 60));
      var h = Math.max(m.h, Math.min(600, box.h - 60));
      var x = d.indexOf('w') > -1 ? 0 : box.w - w;
      var y = d.indexOf('n') > -1 ? 0 : box.h - h;
      el.classList.remove('max');
      win.max = false;
      applyGeom(el, { x: snap(x), y: snap(y), w: snap(w), h: snap(h) });
      return { l: parseFloat(el.style.left), t: parseFloat(el.style.top), w: w, h: h };
    }

    grips.forEach(function (grip) {
      var d = grip.dataset.dir || 'se';

      grip.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        focus(win);
        dir = d;
        handle = grip;
        var base = win.max ? unmaxFor(d) : {
          l: el.offsetLeft, t: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight
        };
        st = { x: e.clientX, y: e.clientY, l: base.l, t: base.t, w: base.w, h: base.h };
        el.classList.add('resizing');
        el.style.cursor = GRIP_CURSOR[d] || 'nwse-resize';
        try { grip.setPointerCapture(e.pointerId); } catch (err) { /* not supported */ }
      });

      grip.addEventListener('pointermove', function (e) {
        if (!st) return;
        e.preventDefault();
        var box = layerBox();
        var m = mins();
        var dx = e.clientX - st.x;
        var dy = e.clientY - st.y;
        var east = dir.indexOf('e') > -1;
        var west = dir.indexOf('w') > -1;
        var south = dir.indexOf('s') > -1;
        var north = dir.indexOf('n') > -1;

        var w = east ? st.w + dx : west ? st.w - dx : st.w;
        var h = south ? st.h + dy : north ? st.h - dy : st.h;

        /* Clamp the size before working out the position. Doing it the other
           way round lets the desktop ceiling drag the anchored edge sideways
           when a window is already as wide as the desktop. */
        w = Math.min(Math.max(w, m.w), box.w);
        h = Math.min(Math.max(h, m.h), box.h);

        /* The edges opposite the grip stay put, and the window stops dead at
           the minimum rather than squashing. */
        var x = west ? st.l + st.w - w : st.l;
        var y = north ? st.t + st.h - h : st.t;

        x = snap(x); y = snap(y); w = snap(w); h = snap(h);
        /* Snap first, then re-check: rounding up can otherwise leave the
           window a pixel wider than the desktop. */
        if (w > box.w) w = box.w;
        if (h > box.h) h = box.h;
        x = Math.min(Math.max(x, -w + 90), Math.max(0, box.w - 60));
        y = Math.min(Math.max(y, 0), Math.max(0, box.h - 26));
        applyGeom(el, { x: x, y: y, w: w, h: h });
      });

      function end(e) {
        if (!st) return;
        st = null;
        el.classList.remove('resizing');
        el.style.cursor = '';
        try { handle.releasePointerCapture(e.pointerId); } catch (err) { /* already gone */ }
        handle = null;
        saveWinGeom(win);
      }
      grip.addEventListener('pointerup', end);
      grip.addEventListener('pointercancel', end);
    });
  }

  /* --------------------------------------------------------- taskbar ---- */

  function syncTaskbar() {
    taskItems.innerHTML = '';
    windows.forEach(function (win) {
      var b = document.createElement('button');
      b.className = 'task-btn' + (!win.min && win.el.classList.contains('active') ? ' active' : '');
      b.type = 'button';
      b.title = win.game.title;
      b.innerHTML = icon(win.id) + '<span>' + esc(win.game.title) + '</span>';
      b.addEventListener('click', function () {
        if (win.min) restore(win);
        else if (win.el.classList.contains('active')) minimise(win);
        else focus(win);
      });
      b.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        showCtx(e.clientX, e.clientY, [{ label: 'Close ' + win.game.title, act: function () { closeWin(win); } }]);
      });
      taskItems.appendChild(b);
    });
    $('#tray-count').textContent = GAMES.length + ' GAMES';
  }

  function startClock() {
    var el = $('#tray-clock');
    function tick() {
      var d = new Date();
      el.textContent = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    }
    tick();
    setInterval(tick, 15000);
  }

  /* --------------------------------------------------- menus & shell ---- */

  var ctxEl = $('#ctx');
  var startEl = $('#start-menu');
  var startBtn = $('#start-btn');
  var portalEl = $('#portal');
  var portalCoin = $('#portal-coin');
  var shellWired = false;
  function closeMenus() {
    ctxEl.hidden = true;
    startEl.hidden = true;
    startBtn.setAttribute('aria-expanded', 'false');
  }

  function showCtx(x, y, items) {
    ctxEl.innerHTML = items.map(function (it, i) {
      if (it.sep) return '<div class="mi-sep" role="separator"></div>';
      return '<button class="menu-item" type="button" data-i="' + i + '">' +
        (it.glyph ? '<span class="mi-icon">' + it.glyph + '</span>' : '<span class="mi-glyph" style="background:transparent"></span>') +
        '<span>' + esc(it.label) + '</span></button>';
    }).join('');
    ctxEl.hidden = false;
    startEl.hidden = true;
    startBtn.setAttribute('aria-expanded', 'false');

    ctxEl.querySelectorAll('.menu-item').forEach(function (b) {
      b.addEventListener('click', function () {
        var it = items[+b.dataset.i];
        closeMenus();
        if (it && it.act) it.act();
      });
    });

    var r = ctxEl.getBoundingClientRect();
    ctxEl.style.left = Math.min(x, innerWidth - r.width - 4) + 'px';
    ctxEl.style.top = Math.min(y, innerHeight - r.height - 4) + 'px';
  }

  function openAbout() {
    var plays = readJSON(STORE_PLAYS, {});
    var total = Object.keys(plays).reduce(function (a, k) { return a + plays[k]; }, 0);
    var tried = Object.keys(plays).length;

    var catList = (function () {
      var seen = {}, out = [];
      GAMES.forEach(function (g) { if (!seen[g.category]) { seen[g.category] = 1; out.push(g.category); } });
      return out.sort().join(', ');
    })();

    var body =
      '<h4>WELCOME TO KALAN OS</h4>' +
      '<p>This is a fake desktop that launches real games.</p>' +
      '<h4>MOUSE</h4>' +
      '<ul>' +
      '<li><b>Click</b> an icon to select it.</li>' +
      '<li><b>Double-click</b> to open a game in a real browser tab.</li>' +
      '<li><b>Right-click</b> for the menu: new tab, or windowed in this tab.</li>' +
      '<li><b>Drag the wallpaper</b> to sweep a box over several icons at once.</li>' +
      '<li><b>Shift-click</b> adds or removes an icon from the selection.</li>' +
      '<li><b>Drag an icon</b> to move it around -- the layout is saved.</li>' +
      '</ul>' +
      '<h4>MULTIPLE APPS</h4>' +
      '<p>With more than one icon selected, right-click opens the whole ' +
      'selection as windows stacked inside this tab. Browsers block opening ' +
      'several tabs from one click, so a group of apps only goes in as ' +
      'windows -- for tabs, open them one at a time.</p>' +
      '<div class="stat-row">' +
      '<div class="stat"><b>' + GAMES.length + '</b><i>installed</i></div>' +
      '<div class="stat"><b>' + tried + '</b><i>opened</i></div>' +
      '<div class="stat"><b>' + total + '</b><i>launches</i></div>' +
      '</div>' +
      '<h4>WINDOWS</h4>' +
      '<p>Windows drag by their title bar, resize from any edge or corner, and ' +
      'double-click the title bar to maximise. Window sizes are remembered too.</p>' +
      '<h4>GENRES</h4><p>' + esc(catList) + '</p>' +
      '<h4>ADDING A GAME</h4>' +
      '<p>Open <code>games.js</code> and add one object to the <code>GAMES</code> ' +
      'array. The icon is 16 rows of 16 characters, drawn one character per pixel:</p>' +
      '<ul>' +
      '<li><code>title</code>, <code>blurb</code>, <code>category</code></li>' +
      '<li><code>accent</code> &mdash; the hex colour of its title bar</li>' +
      '<li><code>url</code> &mdash; where the game is hosted</li>' +
      '<li><code>sprite</code> &mdash; the icon, top row first</li>' +
      '</ul>' +
      '<p>That is the whole change. The desktop icon, the Start menu entry and the ' +
      'taskbar all read from the same array.</p>' +
      '<h4>NOTES</h4>' +
      '<ul>' +
      '<li>Games run in an iframe so the hub stays loaded underneath.</li>' +
      '<li>Use <code>POP OUT</code> if a game wants a real tab or full screen.</li>' +
      '<li>Only one tab can be opened per click, so multi-selections open as ' +
      'windows rather than tabs.</li>' +
      '<li>The <b>KALAN</b> plate at the top of the Start menu is not a label.</li>' +
      '<li>Launch counts and layouts are stored in your browser only.</li>' +
      '</ul>';

    openCustom('About KALAN OS', '#1d4ed8', body, 'about-body');
  }

  function openCustom(title, accent, html, bodyClass) {
    var box = layerBox();
    var w = Math.min(520, box.w - 40);
    var h = Math.min(560, box.h - 60);
    var el = document.createElement('section');
    el.className = 'win';
    el.style.setProperty('--accent', accent);
    el.style.left = Math.max(8, Math.round((box.w - w) / 2)) + 'px';
    el.style.top = Math.max(8, Math.round((box.h - h) / 2.4)) + 'px';
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.innerHTML =
      '<header class="win-title">' +
      '<span class="wt-icon"></span>' +
      '<span class="win-name">' + esc(title) + '</span>' +
      '<span class="win-btns">' +
      '<button class="wb max" title="Maximise"></button>' +
      '<button class="wb close" title="Close"></button>' +
      '</span></header>' +
      '<div class="win-body"><div class="' + bodyClass + '">' + html + '</div></div>' +
      gripsHtml();
    layer.appendChild(el);

    var win = { id: '__' + title, game: { title: title, accent: accent }, el: el, min: false, max: false, restore: null };
    windows.push(win);
    $('.wb.close', el).addEventListener('click', function (e) { e.stopPropagation(); closeWin(win); });
    $('.wb.max', el).addEventListener('click', function (e) { e.stopPropagation(); toggleMax(win); });
    el.addEventListener('pointerdown', function () { focus(win); }, true);
    $('.win-title', el).addEventListener('dblclick', function (e) {
      if (e.target.closest('.wb')) return;
      toggleMax(win);
    });
    makeDraggable(win);
    makeResizable(win);
    focus(win);
    syncTaskbar();
  }

  function cascadeWindows() {
    cascade = 0;
    windows.forEach(function (win, i) {
      if (win.max) toggleMax(win);
      if (win.min) restore(win);
      var box = layerBox();
      var w = Math.min(880, Math.max(320, box.w - 60));
      var h = Math.min(600, Math.max(260, box.h - 60));
      var off = i * 26;
      win.el.style.left = Math.min(Math.max(4, 30 + off), Math.max(4, box.w - w - 4)) + 'px';
      win.el.style.top = Math.min(Math.max(4, 20 + off), Math.max(4, box.h - h - 4)) + 'px';
      win.el.style.width = w + 'px';
      win.el.style.height = h + 'px';
    });
  }

  function tileWindows() {
    var open = windows.filter(function (w) { return !w.min; });
    if (!open.length) return;
    var box = layerBox();

    /* Read the floor from CSS rather than hardcoding it, because the mobile
       breakpoint drops min-width/min-height to 0. Ignoring it is what pushes
       tiled windows off the right edge on narrower screens. */
    var probe = getComputedStyle(open[0].el);
    var minW = parseFloat(probe.minWidth) || 0;
    var minH = parseFloat(probe.minHeight) || 0;

    var cols = Math.ceil(Math.sqrt(open.length));
    if (minW > 0) cols = Math.min(cols, Math.max(1, Math.floor(box.w / minW)));
    var rows = Math.ceil(open.length / cols);

    open.forEach(function (win, i) {
      if (win.max) toggleMax(win);
      var cw = Math.floor(box.w / cols);
      var ch = Math.floor(box.h / rows);
      win.el.style.left = ((i % cols) * cw) + 'px';
      win.el.style.top = (Math.floor(i / cols) * ch) + 'px';
      win.el.style.width = Math.max(minW, cw) + 'px';
      win.el.style.height = Math.max(minH, ch) + 'px';
    });
    focus(open[0]);
  }

  function wireShell() {
    if (shellWired) return;
    shellWired = true;

    startBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var opening = startEl.hidden;
      closeMenus();
      if (opening) { startEl.hidden = false; startBtn.setAttribute('aria-expanded', 'true'); }
    });

    startEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cmd]');
      if (!b) return;
      var cmd = b.dataset.cmd;
      /* Close the shell BEFORE dispatching. The arcade hand-off animates on
         top of the desktop, so it needs the menu already out of the way --
         but the old order left the Start menu visible for the first frame. */
      closeMenus();
      if (cmd === 'about') openAbout();
      else if (cmd === 'closeall') closeAll();
      else if (cmd === 'resetlayout') resetIconLayout();
      else if (cmd === 'selectall') selectAll();
      else if (cmd === 'clearsel') clearSelection();
      else if (cmd === 'arcade') openPortal();
      else if (cmd === 'reboot') location.reload();
    });

    document.addEventListener('click', function (e) {
      if (e.target.closest('#start-menu') || e.target.closest('#start-btn') || e.target.closest('#ctx')) return;
      if (!e.target.closest('#ctx')) closeMenus();
    });

    /* The cabinet overlay is full-screen and pointer-events:auto, so once it is
       up it swallows every click on the desktop beneath. A second click skips
       straight to the arcade, which means a broken or missing stylesheet can
       never leave anyone locked out of their own desktop. */
    document.addEventListener('click', function (e) {
      if (!portalBusy || !portalEl || portalEl.hidden) return;
      if (!e.target.closest('#portal')) return;
      leavePortal();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      closeMenus();
      /* Escape inside an icon belongs to that icon, not to the whole desktop */
      if (e.target.closest && e.target.closest('.dicon')) return;
      clearSelection();
    });

    var desk = $('#desktop');
    /* Rubber band selection: any press that lands on bare wallpaper or on the
       icon layer's own gaps. Icons, windows, menus and the taskbar are all
       excluded, so their own gestures keep working untouched. */
    desk.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      if (e.target.closest(MARQUEE_BLOCKERS)) return;
      if (marquee) return;
      startMarquee(e);
    });

    desk.addEventListener('contextmenu', function (e) {
      if (e.target.closest('.win') || e.target.closest('.dicon')) return;
      e.preventDefault();
      showCtx(e.clientX, e.clientY, [
        { label: 'Select all apps', act: selectAll },
        { label: 'Clear selection', act: clearSelection },
        { sep: true },
        { label: 'Cascade windows', act: cascadeWindows },
        { label: 'Tile windows', act: tileWindows },
        { label: 'Minimise all', act: function () { windows.filter(function (w) { return !w.min; }).forEach(minimise); } },
        { label: 'Close all windows', act: closeAll },
        { label: 'Reset icon layout', act: resetIconLayout },
        { label: 'About KALAN OS', act: openAbout },
        { label: 'Reboot', act: function () { location.reload(); } }
      ]);
    });

    /* desktop icon keyboard nav. Arrows carry the selection with them, and
       shift extends it, which is the only way to build a multi selection
       without a pointer. */
    iconsEl.addEventListener('keydown', function (e) {
      var i = iconBtns.indexOf(document.activeElement);
      if (i < 0) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        openInTab(iconBtns[i].dataset.id);
        return;
      }

      var cols = 6;
      var next = null;
      if (e.key === 'ArrowDown') next = i + cols;
      else if (e.key === 'ArrowUp') next = i - cols;
      else if (e.key === 'ArrowRight') next = i + 1;
      else if (e.key === 'ArrowLeft') next = i - 1;
      if (next === null) return;
      if (!iconBtns[next]) return;
      e.preventDefault();
      if (e.shiftKey) addToSelection(iconBtns[next].dataset.id);
      else selectOnly(iconBtns[next].dataset.id);
      iconBtns[next].focus();
    });

    /* Ctrl+A on the desktop means "select every app", not "select the page" */
    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a') return;
      if (!startEl.hidden || !ctxEl.hidden) return;
      e.preventDefault();
      selectAll();
    });

    window.addEventListener('resize', function () {
      /* every window, not just the maximised ones: an ordinary window left
         half off-screen by a shrinking browser is otherwise unreachable */
      windows.forEach(function (win) { fitWinToLayer(win); });
      /* a smaller window can strand a dragged icon outside the icon area */
      iconBtns.forEach(function (el) {
        if (!el.classList.contains('placed')) return;
        parkIcon(el, parseFloat(el.style.left) || 0, parseFloat(el.style.top) || 0);
        rememberIcon(el);
      });
    });
  }

  /* ----------------------------------------------------------- easter egg */
  /* The KALAN plate in the Start menu is a door. Clicking it kills the screen
     the way a cabinet's tube dies, then lights the cabinet's own marquee and
     hands this very tab over to Jojo's arcade -- location.href rather than
     window.open, because leaving is the whole point and a new tab would leave
     the illusion behind. */

  var PORTAL_URL = 'https://jojosarcade.vercel.app';
  var PORTAL_FROM = 'KALAN';
  var PORTAL_TO = 'ARCADE';
  var PORTAL_COIN = 'INSERER UNE PIECE';
  var portalBusy = false;
  var portalTimers = [];
  var portalFailsafe = 0;

  function portalStep(name) {
    if (!portalEl) return;
    portalEl.classList.add(name);
  }

  function portalAfter(ms, fn) {
    portalTimers.push(setTimeout(fn, ms));
  }

  function leavePortal() {
    for (var i = 0; i < portalTimers.length; i++) clearTimeout(portalTimers[i]);
    portalTimers.length = 0;
    clearTimeout(portalFailsafe);
    location.href = PORTAL_URL;
  }

  /* Tear the overlay down and hand the tab over. The arc is pure decoration,
     so if any part of it fails -- a missing node, a stylesheet that never
     loaded -- the worst case is that you simply land on the arcade without
     the ceremony. It must never be possible to strand someone staring at a
     stuck overlay, so every failure path funnels through here. */
  function bailPortal() {
    if (portalEl) portalEl.hidden = true;
    leavePortal();
  }

  function openPortal() {
    if (portalBusy) return;
    portalBusy = true;

    if (reducedMotion()) {
      if (portalEl) portalEl.hidden = false;
      setTimeout(leavePortal, 260);
      return;
    }

    try {
      if (!portalEl) { leavePortal(); return; }
      portalEl.hidden = false;
      portalEl.className = 'portal';
      if (portalCoin) portalCoin.textContent = PORTAL_COIN;

      /* the tube holds the lit picture for a beat, then collapses to a line */
      portalStep('tube-off');
      /* the room thickens to opaque as the picture goes */
      portalAfter(170, function () { portalStep('dark'); });
      /* the line flares and dies */
      portalAfter(380, function () { portalStep('tube-dead'); });
      /* and only now the cabinet's marquee strikes up out of the dark */
      portalAfter(560, function () { portalStep('sign-on'); });
      /* the coin is taken, the sign browns out, and the tab changes hands */
      portalAfter(1180, function () { portalStep('cut'); });
      portalAfter(1440, leavePortal);
    } catch (e) {
      bailPortal();
      return;
    }

    /* Nothing above can be allowed to be the only route off this page. If the
       hand-off is blocked or the tab is restored from bfcache, drop the
       overlay and go again rather than leaving a full-screen panel up. */
    portalFailsafe = setTimeout(bailPortal, 3000);
  }

  /* -------------------------------------------------------- confetti ---- */

  function confetti(el, colour) {
    if (reducedMotion()) return;
    var r = el.getBoundingClientRect();
    var cx = r.left + r.width / 2;
    var cy = r.top + r.height / 2;
    var palette = [colour, '#f2f2f7', '#facc15', '#4ade80', '#22d3ee'];

    for (var i = 0; i < 16; i++) {
      var c = document.createElement('i');
      c.className = 'confetti';
      c.style.left = cx + 'px';
      c.style.top = cy + 'px';
      c.style.background = palette[i % palette.length];
      c.style.setProperty('--dx', (Math.random() * 260 - 130) + 'px');
      c.style.setProperty('--dy', (Math.random() * 220 - 110) + 'px');
      document.body.appendChild(c);
      (function (node) { setTimeout(function () { node.remove(); }, 950); })(c);
    }
  }

  /* ------------------------------------------------------------- go ---- */

  /* Small scripting hook, handy from the console and used by the test harness:
     KALAN.open('neon-fall')  KALAN.openAll()  KALAN.tile()  KALAN.reset()  */
  window.KALAN = {
    games: GAMES,
    open: openGame,
    openAll: function () { GAMES.forEach(function (g) { openGame(g.id); }); },
    openTab: openInTab,
    openSelectedWindowed: function () { openManyWindowed(selectedIds()); },
    selection: selectedIds,
    selectAll: selectAll,
    clearSelection: clearSelection,
    openAbout: openAbout,
    close: closeWin,
    closeAll: closeAll,
    cascade: cascadeWindows,
    tile: tileWindows,
    minAll: function () { windows.filter(function (w) { return !w.min; }).forEach(minimise); },
    focus: function (id) {
      var w = windows.filter(function (x) { return x.id === id; })[0];
      if (w) focus(w);
    },
    snapshot: function () {
      return windows.map(function (w) {
        var f = $('.win-frame', w.el);
        var ifr = f.querySelector('iframe');
        return {
          id: w.id,
          min: w.min,
          max: w.max,
          active: w.el.classList.contains('active'),
          loading: f.classList.contains('loading'),
          src: ifr ? ifr.getAttribute('src') : null,
          taskBtn: !!(taskItems.querySelector('.task-btn')),
        };
      });
    },
    reset: function () {
      try {
        localStorage.removeItem(STORE_PLAYS);
        localStorage.removeItem(STORE_POS);
      } catch (e) { /* ignore */ }
      location.reload();
    },
    resetLayout: resetIconLayout,
  };

  runBoot();
})();
