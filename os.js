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
      b.title = game.title + ' - ' + game.blurb;
      b.setAttribute('aria-label', 'Open ' + game.title);
      b.innerHTML =
        '<span class="art">' + icon(game.id) + '</span>' +
        '<span class="lbl">' + esc(game.title) + '</span>' +
        '<span class="playcount" hidden></span>';
      iconsEl.appendChild(b);
      iconBtns.push(b);
      wireIconDrag(b);
    });

    iconsEl.addEventListener('click', onIconClick);
    iconsEl.addEventListener('dblclick', function (e) {
      var b = e.target.closest('.dicon');
      if (b) openGame(b.dataset.id);
    });
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
          /* pin the untouched grid first, then take hold of this icon */
          freezeLayout();
          parkIcon(el, rect.left - host.left, rect.top - host.top);
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
        swallow.el = el;
        swallow.until = Date.now() + 400;
        /* if no click follows (pointer released off the icon) do not stay armed */
        setTimeout(function () { if (swallow.el === el) swallow.el = null; }, 0);
        rememberIcon(el);
      }

      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    });
  }

  function onIconClick(e) {
    var b = e.target.closest('.dicon');
    if (!b) return;
    /* a drag ends with a click; do not launch the game in that case */
    if (swallow.el === b && Date.now() < swallow.until) { swallow.el = null; return; }
    iconBtns.forEach(function (x) { x.classList.remove('sel'); });
    b.classList.add('sel');
    openGame(b.dataset.id);
  }

  function onIconContext(e) {
    var b = e.target.closest('.dicon');
    if (!b) return;
    e.preventDefault();
    var g = byId(b.dataset.id);
    showCtx(e.clientX, e.clientY, [
      { label: 'Open ' + g.title, glyph: icon(g.id), act: function () { openGame(g.id); } },
      { label: 'Open in new tab', act: function () { window.open(g.url, '_blank', 'noopener'); recordPlay(g.id); } }
    ]);
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
    var w = Math.min(880, Math.max(320, box.w - 60));
    var h = Math.min(600, Math.max(260, box.h - 60));
    var step = 26;
    var off = (cascade % 6) * step;
    cascade++;

    var x = Math.max(4, Math.round((box.w - w) / 2) - 90 + off);
    var y = Math.max(4, Math.round((box.h - h) / 2) - 60 + off);
    x = Math.min(x, Math.max(4, box.w - w - 4));
    y = Math.min(y, Math.max(4, box.h - h - 4));

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
      '<div class="win-grip" title="Resize"></div>';

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
      el.style.left = r.left;
      el.style.top = r.top;
      el.style.width = r.width;
      el.style.height = r.height;
      el.classList.remove('max');
      win.max = false;
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
      win.el.style.left = nx + 'px';
      win.el.style.top = ny + 'px';
    });

    function end(e) {
      if (!active) return;
      active = false;
      win.el.classList.remove('dragging');
      try { bar.releasePointerCapture(e.pointerId); } catch (err) { /* already gone */ }
    }
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
  }

  function makeResizable(win) {
    var grip = $('.win-grip', win.el);
    var sx = 0, sy = 0, ow = 0, oh = 0, active = false;

    grip.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      active = true;
      sx = e.clientX; sy = e.clientY;
      ow = win.el.offsetWidth; oh = win.el.offsetHeight;
      grip.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    });

    grip.addEventListener('pointermove', function (e) {
      if (!active) return;
      win.el.style.width = Math.max(260, ow + (e.clientX - sx)) + 'px';
      win.el.style.height = Math.max(180, oh + (e.clientY - sy)) + 'px';
    });

    function end(e) {
      if (!active) return;
      active = false;
      try { grip.releasePointerCapture(e.pointerId); } catch (err) { /* already gone */ }
    }
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
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
  var shellWired = false;

  function closeMenus() {
    ctxEl.hidden = true;
    startEl.hidden = true;
    startBtn.setAttribute('aria-expanded', 'false');
  }

  function showCtx(x, y, items) {
    ctxEl.innerHTML = items.map(function (it, i) {
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
      '<p>This is a fake desktop that launches real games. Click an icon to ' +
      'open it, or drag an icon anywhere you like -- the layout is saved. ' +
      'Windows drag by ' +
      'their title bar, resize from the bottom-right grip, and double-click the ' +
      'title bar to maximise.</p>' +
      '<div class="stat-row">' +
      '<div class="stat"><b>' + GAMES.length + '</b><i>installed</i></div>' +
      '<div class="stat"><b>' + tried + '</b><i>opened</i></div>' +
      '<div class="stat"><b>' + total + '</b><i>launches</i></div>' +
      '</div>' +
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
      '<li>Launch counts are stored in your browser only, not on a server.</li>' +
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
      '<div class="win-grip"></div>';
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
      closeMenus();
      if (cmd === 'about') openAbout();
      else if (cmd === 'closeall') closeAll();
      else if (cmd === 'reboot') location.reload();
    });

    document.addEventListener('click', function (e) {
      if (e.target.closest('#start-menu') || e.target.closest('#start-btn') || e.target.closest('#ctx')) return;
      if (!e.target.closest('#ctx')) closeMenus();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeMenus();
    });

    var desk = $('#desktop');
    desk.addEventListener('contextmenu', function (e) {
      if (e.target.closest('.win') || e.target.closest('.dicon')) return;
      e.preventDefault();
      showCtx(e.clientX, e.clientY, [
        { label: 'Cascade windows', act: cascadeWindows },
        { label: 'Tile windows', act: tileWindows },
        { label: 'Minimise all', act: function () { windows.filter(function (w) { return !w.min; }).forEach(minimise); } },
        { label: 'Close all windows', act: closeAll },
        { label: 'Reset icon layout', act: resetIconLayout },
        { label: 'About KALAN OS', act: openAbout },
        { label: 'Reboot', act: function () { location.reload(); } }
      ]);
    });

    /* desktop icon keyboard nav */
    iconsEl.addEventListener('keydown', function (e) {
      var i = iconBtns.indexOf(document.activeElement);
      if (i < 0) return;
      var cols = 6;
      var next = null;
      if (e.key === 'ArrowDown') next = i + cols;
      else if (e.key === 'ArrowUp') next = i - cols;
      else if (e.key === 'ArrowRight') next = i + 1;
      else if (e.key === 'ArrowLeft') next = i - 1;
      if (next === null) return;
      e.preventDefault();
      if (iconBtns[next]) iconBtns[next].focus();
    });

    window.addEventListener('resize', function () {
      var box = layerBox();
      windows.forEach(function (win) {
        if (!win.max) return;
        win.el.style.width = box.w + 'px';
        win.el.style.height = box.h + 'px';
      });
      /* a smaller window can strand a dragged icon outside the icon area */
      iconBtns.forEach(function (el) {
        if (!el.classList.contains('placed')) return;
        parkIcon(el, parseFloat(el.style.left) || 0, parseFloat(el.style.top) || 0);
        rememberIcon(el);
      });
    });
  }

  /* -------------------------------------------------------- confetti ---- */

  function confetti(el, colour) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
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
