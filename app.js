/* ═══════════════════════════════════════════════════════
   NeoCast PWA · app.js
   Flip Clock · Shortcuts · Google News RSS
   Draggable Grid · GitHub Gist Sync · Video Background
   Voice Search · PWA
   ═══════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────
   CONSTANTS
───────────────────────────────────── */
const ROW_H   = 78;   // px, must match CSS --row
const COLS    = 24;
const GAP     = 10;
const IDB_DB  = 'neocast';
const IDB_VER = 1;
const IDB_ST  = 'blobs';
const VID_KEY = 'bg_video';
const LS_KEY  = 'neocast_v2';
const NEWS_CACHE_MS = 25 * 60 * 1000;  // 25 min
const RSS2JSON = 'https://api.rss2json.com/v1/api.json?rss_url=';

/* ─────────────────────────────────────
   STATE
───────────────────────────────────── */
let S = {
  shortcuts:  [],
  groups:     [],
  widgets: {
    clock:     { col:0, row:0, w:6, h:2, visible:true },
    shortcuts: { col:6, row:2, w:6, h:5, visible:true },
    news:      { col:0, row:2, w:6, h:5, visible:true }
  },
  news: {
    items:    [],
    fetchedAt: 0,
    keywords: ['AI人工智慧','台灣科技','國際新聞'],
    lang:     'zh-TW'
  },
  cfg: {
    token:  '',
    gistId: ''
  },
  editMode:    false,
  activeGroup: 'all',
  ctxTarget:   null,
  scEditing:   null,
  dragSc:      null
};

/* ─────────────────────────────────────
   UTILS
───────────────────────────────────── */
const $  = id  => document.getElementById(id);
const el = (tag, cls, html) => { const e=document.createElement(tag); if(cls)e.className=cls; if(html)e.innerHTML=html; return e; };
const uid = () => Math.random().toString(36).slice(2)+Date.now().toString(36);
const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));

/* ─────────────────────────────────────
   PERSISTENCE — localStorage
───────────────────────────────────── */
/* ── Auto-sync debounce timer ── */
let _autoSyncTimer = null;

function lsSave() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      shortcuts: S.shortcuts,
      groups:    S.groups,
      widgets:   S.widgets,
      news:      { items: S.news.items, fetchedAt: S.news.fetchedAt, keywords: S.news.keywords, lang: S.news.lang },
      cfg:       S.cfg
    }));
  } catch(_) {}

  // Auto-push to Gist 2 seconds after last change
  if (S.cfg.token && S.cfg.gistId) {
    clearTimeout(_autoSyncTimer);
    _autoSyncTimer = setTimeout(() => {
      gistPush(true); // silent push
    }, 2000);
  }
}

function lsLoad() {
  try {
    const d = JSON.parse(localStorage.getItem(LS_KEY)||'{}');
    if (d.shortcuts) S.shortcuts = d.shortcuts;
    if (d.groups)    S.groups    = d.groups;
    if (d.widgets)   Object.assign(S.widgets, d.widgets);
    if (d.news)      Object.assign(S.news, d.news);
    if (d.cfg)       Object.assign(S.cfg, d.cfg);
  } catch(_) {}
}

/* ─────────────────────────────────────
   PERSISTENCE — IndexedDB (video)
───────────────────────────────────── */
let idb = null;

function idbOpen() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(IDB_DB, IDB_VER);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_ST);
    req.onsuccess = e => { idb = e.target.result; res(idb); };
    req.onerror   = () => rej();
  });
}

function idbSet(key, val) {
  return new Promise((res, rej) => {
    const tx = idb.transaction(IDB_ST, 'readwrite');
    tx.objectStore(IDB_ST).put(val, key);
    tx.oncomplete = res;
    tx.onerror = rej;
  });
}

function idbGet(key) {
  return new Promise((res, rej) => {
    const tx  = idb.transaction(IDB_ST, 'readonly');
    const req = tx.objectStore(IDB_ST).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror   = rej;
  });
}

function idbDel(key) {
  return new Promise((res, rej) => {
    const tx = idb.transaction(IDB_ST, 'readwrite');
    tx.objectStore(IDB_ST).delete(key);
    tx.oncomplete = res; tx.onerror = rej;
  });
}

/* ─────────────────────────────────────
   GITHUB GIST SYNC
───────────────────────────────────── */
const gistData = () => ({
  shortcuts: S.shortcuts,
  groups:    S.groups,
  widgets:   S.widgets,
  newsKeywords: S.news.keywords,
  newsLang:  S.news.lang
});

async function gistPush(silent = false) {
  const { token, gistId } = S.cfg;
  if (!token) {
    if (!silent) toast('請先在設定中填入 GitHub Token','warn');
    return;
  }

  if (!silent) $('sync-btn').classList.add('spin');

  const body = JSON.stringify({
    description: 'NeoCast Settings',
    public: false,
    files: { 'neocast.json': { content: JSON.stringify(gistData(), null, 2) } }
  });

  try {
    const url    = gistId ? `https://api.github.com/gists/${gistId}` : 'https://api.github.com/gists';
    const method = gistId ? 'PATCH' : 'POST';
    const res    = await fetch(url, {
      method,
      headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json' },
      body
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!gistId) { S.cfg.gistId = data.id; lsSave(); $('cfg-gid').value = data.id; }
    if (!silent) toast('已同步到 Gist ✓');
    else toast('已自動同步 ✓');
  } catch(e) {
    if (!silent) toast('同步失敗：' + e.message, 'err');
    else toast('自動同步失敗：' + e.message, 'err');
  } finally {
    if (!silent) $('sync-btn').classList.remove('spin');
  }
}

async function gistPull() {
  const { token, gistId } = S.cfg;
  if (!token || !gistId) return;
  try {
    const res  = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: { Authorization: `token ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    const raw  = data.files?.['neocast.json']?.content;
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.shortcuts)    S.shortcuts = d.shortcuts;
    if (d.groups)       S.groups    = d.groups;
    if (d.widgets)      Object.assign(S.widgets, d.widgets);
    if (d.newsKeywords) S.news.keywords = d.newsKeywords;
    if (d.newsLang)     S.news.lang     = d.newsLang;
    lsSave();
    renderAll();
    toast('已從 Gist 拉取最新設定 ✓');
  } catch(_) {}
}

/* ─────────────────────────────────────
   TOAST
───────────────────────────────────── */
function toast(msg, type = 'ok') {
  const t = el('div');
  t.style.cssText = `
    position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
    background:${type==='err'?'#3d0f0f':type==='warn'?'#2a2200':'#0a2340'};
    border:1px solid ${type==='err'?'#f87171':type==='warn'?'#f59e0b':'#38bdf8'};
    color:${type==='err'?'#f87171':type==='warn'?'#fcd34d':'#7dd3fc'};
    padding:9px 20px; border-radius:50px; font-size:.82rem; font-weight:700;
    z-index:9999; white-space:nowrap; pointer-events:none;
    animation: toastin .25s ease forwards;
  `;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

/* ─────────────────────────────────────
   VIDEO BACKGROUND
───────────────────────────────────── */
let videoBlobUrl = null;

async function loadVideo() {
  try {
    const blob = await idbGet(VID_KEY);
    if (!blob) return;
    if (videoBlobUrl) URL.revokeObjectURL(videoBlobUrl);
    videoBlobUrl = URL.createObjectURL(blob);
    const v = $('bg-video');
    v.src = videoBlobUrl;
    $('bg-orbs').style.display = 'none';
  } catch(_) {}
}

async function saveVideo(file) {
  try {
    await idbSet(VID_KEY, file);
    await loadVideo();
    toast('背景影片已設定 ✓');
  } catch(_) { toast('影片儲存失敗','err'); }
}

async function removeVideo() {
  try {
    await idbDel(VID_KEY);
    const v = $('bg-video'); v.src = '';
    if (videoBlobUrl) { URL.revokeObjectURL(videoBlobUrl); videoBlobUrl = null; }
    $('bg-orbs').style.display = '';
    toast('已移除背景影片');
  } catch(_) {}
}

/* ─────────────────────────────────────
   GRID SYSTEM
───────────────────────────────────── */
const WC = () => $('wc');

function gridColW() {
  return WC().clientWidth / COLS;
}

function posToStyle(pos) {
  const cw = gridColW();
  return {
    left:   pos.col * cw + GAP / 2,
    top:    pos.row * ROW_H + GAP / 2,
    width:  pos.w   * cw - GAP,
    height: pos.h   * ROW_H - GAP
  };
}

function applyPos(widgetEl, pos) {
  const s = posToStyle(pos);
  widgetEl.style.left   = s.left   + 'px';
  widgetEl.style.top    = s.top    + 'px';
  widgetEl.style.width  = s.width  + 'px';
  widgetEl.style.height = s.height + 'px';
}

function snapCol(px) { return clamp(Math.round(px / gridColW()), 0, COLS - 1); }
function snapRow(px) { return clamp(Math.round(px / ROW_H), 0, 40); }

function initWidgetDrag(wid, widgetEl) {
  let startX, startY, startLeft, startTop, dragging = false;

  const onMove = e => {
    if (!dragging) return;
    const dx  = e.clientX - startX;
    const dy  = e.clientY - startY;
    const nl  = startLeft + dx;
    const nt  = startTop  + dy;
    const col = snapCol(nl);
    const row = snapRow(nt);
    const cw  = gridColW();
    widgetEl.style.left = col * cw + GAP / 2 + 'px';
    widgetEl.style.top  = row * ROW_H + GAP / 2 + 'px';
  };

  const onUp = e => {
    if (!dragging) return;
    dragging = false;
    widgetEl.classList.remove('dragging-widget');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    // Save new position
    const nl = parseFloat(widgetEl.style.left);
    const nt = parseFloat(widgetEl.style.top);
    S.widgets[wid].col = snapCol(nl);
    S.widgets[wid].row = snapRow(nt);
    lsSave();
  };

  widgetEl.addEventListener('mousedown', e => {
    if (!S.editMode) return;
    if (e.target.closest('.resize-handle, button, a, input, select')) return;
    e.preventDefault();
    dragging  = true;
    startX    = e.clientX;
    startY    = e.clientY;
    startLeft = parseFloat(widgetEl.style.left);
    startTop  = parseFloat(widgetEl.style.top);
    widgetEl.classList.add('dragging-widget');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Resize handle
  const rh = widgetEl.querySelector('.resize-handle');
  if (!rh) return;

  let rStartX, rStartY, rStartW, rStartH;

  rh.addEventListener('mousedown', e => {
    if (!S.editMode) return;
    e.preventDefault();
    e.stopPropagation();
    rStartX = e.clientX;
    rStartY = e.clientY;
    rStartW = S.widgets[wid].w;
    rStartH = S.widgets[wid].h;

    const rMove = e => {
      const dCols = Math.round((e.clientX - rStartX) / gridColW());
      const dRows = Math.round((e.clientY - rStartY) / ROW_H);
      const nw    = clamp(rStartW + dCols, 2, COLS - S.widgets[wid].col);
      const nh    = clamp(rStartH + dRows, 2, 20);
      S.widgets[wid].w = nw;
      S.widgets[wid].h = nh;
      applyPos(widgetEl, S.widgets[wid]);
    };

    const rUp = () => {
      lsSave();
      document.removeEventListener('mousemove', rMove);
      document.removeEventListener('mouseup', rUp);
    };

    document.addEventListener('mousemove', rMove);
    document.addEventListener('mouseup', rUp);
  });
}

function setEditMode(on) {
  S.editMode = on;
  $('edit-done').classList.toggle('hidden', !on);
  $('grid-overlay').classList.toggle('hidden', !on);
  $('edit-btn').classList.toggle('active', on);
  document.querySelectorAll('.widget').forEach(w => w.classList.toggle('editable', on));

  // Show/hide delete buttons on each widget
  document.querySelectorAll('.w-delete-btn').forEach(b => {
    b.classList.toggle('hidden', !on);
  });

  // Show/hide add widget panel
  const addPanel = $('add-widget-panel');
  if (addPanel) addPanel.classList.toggle('hidden', !on);
  if (on) renderAddWidgetPanel();
}

/* Widget meta registry */
const WIDGET_META = {
  clock:     { label: '時鐘',    icon: '🕐' },
  shortcuts: { label: '捷徑',    icon: '⭐' },
  news:      { label: 'AI新聞',  icon: '📰' }
};

/* Default positions for when a widget is re-added */
const WIDGET_DEFAULT = {
  clock:     { col:0, row:0, w:6, h:2, visible:true },
  shortcuts: { col:6, row:2, w:6, h:5, visible:true },
  news:      { col:0, row:2, w:6, h:5, visible:true }
};

function renderAddWidgetPanel() {
  const panel = $('add-widget-panel');
  if (!panel) return;
  panel.innerHTML = '<div class="awp-title">＋ 新增小工具</div>';

  const hidden = Object.keys(WIDGET_META).filter(wid => S.widgets[wid]?.visible === false);
  if (hidden.length === 0) {
    panel.innerHTML += '<div class="awp-empty">所有小工具已顯示</div>';
    return;
  }

  hidden.forEach(wid => {
    const m    = WIDGET_META[wid];
    const item = el('button', 'awp-item');
    item.innerHTML = `<span class="awp-icon">${m.icon}</span><span>${m.label}</span>`;
    item.addEventListener('click', () => addWidget(wid));
    panel.appendChild(item);
  });
}

function addWidget(wid) {
  S.widgets[wid] = { ...WIDGET_DEFAULT[wid] };
  lsSave();
  buildWidgetById(wid);
  renderAddWidgetPanel();
  setEditMode(true);
}

function removeWidget(wid) {
  S.widgets[wid].visible = false;
  lsSave();
  const w = document.querySelector(`.widget[data-wid="${wid}"]`);
  if (w) w.remove();
  renderAddWidgetPanel();
}

function buildWidgetById(wid) {
  // Remove existing first
  document.querySelector(`.widget[data-wid="${wid}"]`)?.remove();
  if (wid === 'clock')     buildClockWidget();
  if (wid === 'shortcuts') buildShortcutsWidget();
  if (wid === 'news')      buildNewsWidget();
}

/* ─────────────────────────────────────
   WIDGET FACTORY
───────────────────────────────────── */
function makeWidget(wid, titleText, bodyEl, extraClass = '') {
  const w   = el('div', 'widget ' + extraClass);
  w.dataset.wid = wid;

  const head = el('div', 'w-head');
  const ttl  = el('div', 'w-title', titleText);
  head.appendChild(ttl);

  // Delete button (hidden unless in edit mode)
  const delBtn = el('button', 'w-delete-btn hidden', '✕');
  delBtn.title = '移除 Widget';
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (confirm(`移除「${WIDGET_META[wid]?.label || wid}」Widget？`)) {
      removeWidget(wid);
    }
  });
  head.appendChild(delBtn);

  w.appendChild(head);
  w.appendChild(bodyEl);

  // Resize handle
  const rh = el('div', 'resize-handle');
  rh.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
  w.appendChild(rh);

  applyPos(w, S.widgets[wid]);
  WC().appendChild(w);
  initWidgetDrag(wid, w);
  return w;
}

/* ─────────────────────────────────────
   FLIP CLOCK
───────────────────────────────────── */
class SimpleClock {
  constructor(container) {
    this.container = container;

    const wrap = el('div', 'simple-clock-wrap');

    this.timeEl  = el('div', 'simple-clock-time');
    this.dateEl  = el('div', 'simple-clock-date');
    this.greetEl = el('div', 'simple-clock-greeting');

    wrap.appendChild(this.timeEl);
    wrap.appendChild(this.dateEl);
    wrap.appendChild(this.greetEl);
    container.appendChild(wrap);

    // Adaptive font size
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(container);
    this._resize();
  }

  _resize() {
    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    const fs = Math.max(24, Math.min(Math.floor(cw / 5.2), Math.floor(ch / 2.2)));
    this.timeEl.style.fontSize = fs + 'px';
  }

  tick() {
    const now = new Date();
    const h   = String(now.getHours()).padStart(2,'0');
    const m   = String(now.getMinutes()).padStart(2,'0');
    const s   = String(now.getSeconds()).padStart(2,'0');
    this.timeEl.textContent = `${h}:${m}:${s}`;

    const W = ['日','一','二','三','四','五','六'];
    this.dateEl.textContent = `${now.getMonth()+1}月${now.getDate()}日 週${W[now.getDay()]}`;

    const hr = now.getHours();
    this.greetEl.textContent = hr < 5 ? '深夜好' : hr < 12 ? '早安 ☀' : hr < 18 ? '午安 🌤' : '晚安 🌙';
  }
}

let clockRef = null;

function buildClockWidget() {
  const body = el('div', 'clock-body');
  const w    = makeWidget('clock', '', body);
  // Keep w-head (has delete button) but remove the extra w-body
  w.querySelector('.w-body')?.remove();
  // Move body before resize handle
  w.insertBefore(body, w.querySelector('.resize-handle'));
  clockRef = new SimpleClock(body);
  clockRef.tick();
  setInterval(() => clockRef.tick(), 1000);
}

/* ─────────────────────────────────────
   SEARCH + VOICE
───────────────────────────────────── */
function initSearch() {
  const inp  = $('search-input');
  const vBtn = $('voice-btn');

  inp.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const q = inp.value.trim();
    if (!q) return;
    const url = /^https?:\/\//.test(q) ? q : /^[\w-]+\.\w+/.test(q) ? 'https://'+q : `https://www.google.com/search?q=${encodeURIComponent(q)}`;
    window.open(url, '_blank');
    inp.value = '';
  });

  document.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement !== inp && !isModalOpen()) {
      e.preventDefault(); inp.focus(); inp.select();
    }
    if (e.key === 'Escape') { inp.blur(); closeAllModals(); hideCtx(); }
  });

  // Voice
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { vBtn.style.display = 'none'; return; }

  const sr = new SR();
  sr.continuous    = false;
  sr.interimResults= false;
  sr.lang          = 'zh-TW';

  sr.onresult  = e => { inp.value = e.results[0][0].transcript; inp.focus(); };
  sr.onend     = () => vBtn.classList.remove('listening');
  sr.onerror   = () => vBtn.classList.remove('listening');

  vBtn.addEventListener('click', () => {
    if (vBtn.classList.contains('listening')) { sr.stop(); return; }
    vBtn.classList.add('listening');
    sr.lang = S.news.lang === 'zh-TW' ? 'zh-TW' : 'en-US';
    sr.start();
  });
}

/* ─────────────────────────────────────
   SHORTCUTS
───────────────────────────────────── */
function buildShortcutsWidget() {
  const body = el('div', 'sc-inner');
  body.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;min-height:0;';
  const w = makeWidget('shortcuts', '', body, 'sc-widget');
  w.querySelector('.w-body')?.remove();
  w.insertBefore(body, w.querySelector('.resize-handle'));
  renderShortcutsWidget(body);
}

function renderShortcutsWidget(container) {
  container.innerHTML = '';

  // Groups bar
  const bar = el('div', 'sc-groups');
  bar.appendChild(makeGrpTab('all', '全部'));
  S.groups.forEach(g => bar.appendChild(makeGrpTab(g.id, g.name, true)));
  const addGrpBtn = el('button', 'grp-tab add', '＋ 群組');
  addGrpBtn.addEventListener('click', () => openModal('m-grp'));
  bar.appendChild(addGrpBtn);
  container.appendChild(bar);

  // Grid
  const grid = el('div', 'sc-grid');
  const visible = S.activeGroup === 'all'
    ? S.shortcuts
    : S.shortcuts.filter(s => s.groupId === S.activeGroup);
  visible.forEach(sc => grid.appendChild(makeScItem(sc)));
  container.appendChild(grid);

  // Add button
  const add = el('button', 'sc-add-btn');
  add.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> 新增捷徑';
  add.addEventListener('click', () => openScModal());
  container.appendChild(add);

  // Re-init drag for shortcuts
  initScDrag(grid);
}

function makeGrpTab(id, name, deletable = false) {
  const btn = el('button', 'grp-tab' + (S.activeGroup === id ? ' on' : ''), name);
  btn.addEventListener('click', () => { S.activeGroup = id; rerenderShortcuts(); });
  if (deletable) {
    btn.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (!confirm(`刪除群組「${name}」？（捷徑不會被刪除）`)) return;
      S.groups    = S.groups.filter(g => g.id !== id);
      S.shortcuts = S.shortcuts.map(s => s.groupId === id ? {...s, groupId:''} : s);
      if (S.activeGroup === id) S.activeGroup = 'all';
      lsSave(); rerenderShortcuts();
    });
  }
  return btn;
}

function getFav(url) {
  try {
    const u = new URL(/^https?/.test(url) ? url : 'https://'+url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=128`;
  } catch(_) { return null; }
}

function makeScItem(sc) {
  const a       = el('a', 'sc-item');
  a.href        = /^https?/.test(sc.url) ? sc.url : 'https://'+sc.url;
  a.target      = '_blank';
  a.rel         = 'noopener noreferrer';
  a.dataset.id  = sc.id;
  a.draggable   = true;

  // iOS-style icon wrapper
  const wrap = el('div', 'sc-icon-wrap');

  const fav = getFav(sc.url);
  if (fav) {
    const img    = el('img', 'sc-fav');
    img.src      = fav;
    img.alt      = '';
    img.loading  = 'lazy';
    img.onerror  = () => { img.remove(); wrap.appendChild(makeFb(sc.name)); };
    wrap.appendChild(img);
  } else {
    wrap.appendChild(makeFb(sc.name));
  }
  a.appendChild(wrap);

  const nm = el('span', 'sc-name', esc(sc.name));
  a.appendChild(nm);

  a.addEventListener('contextmenu', e => {
    e.preventDefault();
    S.ctxTarget = sc.id;
    showCtx(e.clientX, e.clientY);
  });

  return a;
}

function makeFb(name) {
  const d = el('div', 'sc-fb', (name||'?')[0].toUpperCase());
  return d;
}

function initScDrag(grid) {
  let src = null;
  grid.querySelectorAll('.sc-item').forEach(item => {
    item.addEventListener('dragstart', () => {
      src = item.dataset.id;
      setTimeout(() => item.classList.add('sc-dragging'), 0);
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('sc-dragging');
      grid.querySelectorAll('.sc-drag-over').forEach(i => i.classList.remove('sc-drag-over'));
      src = null;
    });
    item.addEventListener('dragover', e => {
      e.preventDefault();
      if (item.dataset.id === src) return;
      grid.querySelectorAll('.sc-drag-over').forEach(i => i.classList.remove('sc-drag-over'));
      item.classList.add('sc-drag-over');
    });
    item.addEventListener('drop', e => {
      e.preventDefault();
      if (!src || src === item.dataset.id) return;
      const si = S.shortcuts.findIndex(s => s.id === src);
      const di = S.shortcuts.findIndex(s => s.id === item.dataset.id);
      if (si<0||di<0) return;
      const [m] = S.shortcuts.splice(si,1);
      S.shortcuts.splice(di,0,m);
      lsSave(); rerenderShortcuts();
    });
  });
}

function rerenderShortcuts() {
  // Desktop
  const body = document.querySelector('.widget[data-wid="shortcuts"] .sc-inner');
  if (body) renderShortcutsWidget(body);
  // Mobile
  const mobileBody = document.querySelector('#mobile-layout .sc-inner');
  if (mobileBody) renderShortcutsWidget(mobileBody);
}

function findScBody() {
  return document.querySelector('.widget[data-wid="shortcuts"] .sc-inner')
      || document.querySelector('#mobile-layout .sc-inner');
}

function rerenderSc() {
  // Desktop
  const body = document.querySelector('.widget[data-wid="shortcuts"] .sc-inner');
  if (body) renderShortcutsWidget(body);
  // Mobile
  const mobileBody = document.querySelector('#mobile-layout .sc-inner');
  if (mobileBody) renderShortcutsWidget(mobileBody);
}

/* ─────────────────────────────────────
   NEWS — Google News RSS
───────────────────────────────────── */
let newsListEl = null;

function buildNewsWidget() {
  const outer = el('div', 'news-inner');
  outer.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;min-height:0;';
  const w = makeWidget('news', '', outer, '');
  w.querySelector('.w-body')?.remove();
  w.insertBefore(outer, w.querySelector('.resize-handle'));

  // Header
  const head = el('div', 'news-head');
  const ttl  = el('div', 'w-title', 'AI 新聞快訊');
  const acts = el('div', 'w-actions');

  const langPill = el('button', 'pill', S.news.lang === 'zh-TW' ? '中文' : 'EN');
  langPill.id = 'news-lang-pill';
  langPill.addEventListener('click', () => {
    S.news.lang = S.news.lang === 'zh-TW' ? 'en' : 'zh-TW';
    langPill.textContent = S.news.lang === 'zh-TW' ? '中文' : 'EN';
    S.news.fetchedAt = 0;
    lsSave();
    fetchNews();
  });

  const refBtn = el('button', 'w-btn', `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`);
  refBtn.id = 'news-ref-btn';
  refBtn.title = '重新整理';
  refBtn.addEventListener('click', () => { S.news.fetchedAt = 0; fetchNews(); });

  acts.appendChild(langPill); acts.appendChild(refBtn);
  head.appendChild(ttl); head.appendChild(acts);
  outer.appendChild(head);

  // Keywords
  const kws = el('div', 'news-kws');
  kws.id = 'news-kws';
  outer.appendChild(kws);
  renderNewsKws();

  // List
  newsListEl = el('div', 'news-list');
  outer.appendChild(newsListEl);

  renderNewsItems();

  // Auto-fetch if stale
  if (Date.now() - S.news.fetchedAt > NEWS_CACHE_MS) fetchNews();
}

function renderNewsKws() {
  const kws = $('news-kws');
  if (!kws) return;
  kws.innerHTML = '';
  S.news.keywords.forEach(kw => {
    const t = el('span', 'kw-tag', esc(kw));
    kws.appendChild(t);
  });
}

function renderNewsItems() {
  if (!newsListEl) return;
  if (!S.news.items.length) {
    newsListEl.innerHTML = '<div class="news-empty"><p>尚無新聞<br>點擊 ↻ 按鈕載入</p></div>';
    return;
  }
  newsListEl.innerHTML = '';
  S.news.items.forEach(item => {
    const card = el('div', 'news-card');
    card.innerHTML = `
      <div class="nc-kw">${esc(item.kw||'')}</div>
      <div class="nc-title">${esc(item.title||'')}</div>
      <div class="nc-foot">
        <span class="nc-meta">${esc(item.source||'')}${item.date?' · '+item.date:''}</span>
        ${item.link?`<a class="nc-link" href="${esc(item.link)}" target="_blank" rel="noopener">閱讀 →</a>`:''}
      </div>
    `;
    newsListEl.appendChild(card);
  });
}

function renderNewsLoading() {
  if (!newsListEl) return;
  newsListEl.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    newsListEl.innerHTML += `<div class="skel">
      <div class="skel-line xs"></div>
      <div class="skel-line lg"></div>
      <div class="skel-line md"></div>
      <div class="skel-line sm"></div>
    </div>`;
  }
}

function parseDate(raw) {
  try { return new Date(raw).toLocaleDateString('zh-TW',{month:'numeric',day:'numeric'}); }
  catch(_) { return ''; }
}

async function fetchNews() {
  if (Date.now() - S.news.fetchedAt < NEWS_CACHE_MS && S.news.items.length) {
    renderNewsItems(); return;
  }

  const refBtn = $('news-ref-btn');
  if (refBtn) refBtn.classList.add('spin');
  renderNewsLoading();

  const isZh = S.news.lang === 'zh-TW';
  const hl   = isZh ? 'zh-TW' : 'en-US';
  const gl   = isZh ? 'TW'    : 'US';
  const ceid = isZh ? 'TW:zh-Hant' : 'US:en';

  const allItems = [];

  for (const kw of S.news.keywords) {
    try {
      const rssUrl  = `https://news.google.com/rss/search?q=${encodeURIComponent(kw)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
      const apiUrl  = RSS2JSON + encodeURIComponent(rssUrl);
      const res     = await fetch(apiUrl, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) continue;
      const data    = await res.json();
      if (data.status !== 'ok' || !Array.isArray(data.items)) continue;

      data.items.slice(0, 2).forEach(item => {
        // Google News title: "Headline - Source"
        const raw     = item.title || '';
        const dashIdx = raw.lastIndexOf(' - ');
        const title   = dashIdx > 0 ? raw.slice(0, dashIdx) : raw;
        const source  = dashIdx > 0 ? raw.slice(dashIdx + 3) : (item.author || '');
        const link    = item.link || item.guid || '';
        const date    = item.pubDate ? parseDate(item.pubDate) : '';
        allItems.push({ kw, title, source, link, date });
      });
    } catch(_) {}
  }

  S.news.items     = allItems;
  S.news.fetchedAt = Date.now();
  lsSave();

  if (refBtn) refBtn.classList.remove('spin');
  renderNewsItems();
}

/* ─────────────────────────────────────
   CONTEXT MENU
───────────────────────────────────── */
function showCtx(x, y) {
  const m = $('ctx');
  m.classList.remove('hidden');
  const mw = 155, mh = 120;
  m.style.left = Math.min(x, innerWidth  - mw - 8) + 'px';
  m.style.top  = Math.min(y, innerHeight - mh - 8) + 'px';
}
function hideCtx() { $('ctx').classList.add('hidden'); }

function initCtx() {
  const m = $('ctx');
  m.querySelector('[data-a="edit"]').addEventListener('click', () => {
    hideCtx(); if (S.ctxTarget) openScModal(S.ctxTarget);
  });
  m.querySelector('[data-a="move"]').addEventListener('click', () => {
    hideCtx(); if (S.ctxTarget) openMoveModal(S.ctxTarget);
  });
  m.querySelector('[data-a="delete"]').addEventListener('click', () => {
    hideCtx();
    if (!S.ctxTarget) return;
    S.shortcuts = S.shortcuts.filter(s => s.id !== S.ctxTarget);
    lsSave(); rerenderSc();
  });
  document.addEventListener('click', e => { if (!m.contains(e.target)) hideCtx(); });
}

/* ─────────────────────────────────────
   MODALS
───────────────────────────────────── */
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }
function closeAllModals() { document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden')); }
function isModalOpen() { return [...document.querySelectorAll('.modal')].some(m => !m.classList.contains('hidden')); }

function openScModal(editId = null) {
  S.scEditing = editId;
  $('m-sc-title').textContent = editId ? '編輯捷徑' : '新增捷徑';

  const grpSel = $('sc-grp');
  grpSel.innerHTML = '<option value="">無群組</option>';
  S.groups.forEach(g => {
    const o = el('option'); o.value = g.id; o.textContent = g.name;
    grpSel.appendChild(o);
  });

  if (editId) {
    const sc = S.shortcuts.find(s => s.id === editId);
    if (sc) { $('sc-name').value = sc.name; $('sc-url').value = sc.url; grpSel.value = sc.groupId||''; }
  } else {
    $('sc-name').value = ''; $('sc-url').value = '';
    grpSel.value = S.activeGroup !== 'all' ? S.activeGroup : '';
  }
  openModal('m-sc');
  $('sc-name').focus();
}

function saveScModal() {
  let name = $('sc-name').value.trim();
  let url  = $('sc-url').value.trim();
  const gid = $('sc-grp').value;
  if (!name || !url) { toast('請填寫名稱和網址','warn'); return; }
  if (!/^https?:\/\//.test(url)) url = 'https://' + url;

  if (S.scEditing) {
    const sc = S.shortcuts.find(s => s.id === S.scEditing);
    if (sc) { sc.name = name; sc.url = url; sc.groupId = gid; }
  } else {
    S.shortcuts.push({ id: uid(), name, url, groupId: gid });
  }
  lsSave(); closeModal('m-sc'); rerenderSc();
}

function openMoveModal(scId) {
  const list = $('mv-list');
  list.innerHTML = '';
  const none = el('div', 'mv-item', '無群組');
  none.addEventListener('click', () => { doMove(scId,''); closeModal('m-mv'); });
  list.appendChild(none);
  S.groups.forEach(g => {
    const item = el('div', 'mv-item', esc(g.name));
    item.addEventListener('click', () => { doMove(scId, g.id); closeModal('m-mv'); });
    list.appendChild(item);
  });
  openModal('m-mv');
}

function doMove(scId, gid) {
  const sc = S.shortcuts.find(s => s.id === scId);
  if (sc) sc.groupId = gid;
  lsSave(); rerenderSc();
}

function openSettingsModal() {
  $('cfg-tok').value  = S.cfg.token;
  $('cfg-gid').value  = S.cfg.gistId;
  $('cfg-kw').value   = S.news.keywords.join(', ');
  $('cfg-lang').value = S.news.lang;
  openModal('m-cfg');
}

async function saveSettings() {
  const token  = $('cfg-tok').value.trim();
  const gistId = $('cfg-gid').value.trim();
  const kwRaw  = $('cfg-kw').value;
  const lang   = $('cfg-lang').value;
  const kws    = kwRaw.split(',').map(k=>k.trim()).filter(Boolean);

  S.cfg.token    = token;
  S.cfg.gistId   = gistId;
  S.news.lang    = lang;
  S.news.keywords= kws.length ? kws : ['最新新聞'];

  // Handle video file
  const vidFile = $('cfg-vid').files[0];
  if (vidFile) await saveVideo(vidFile);

  S.news.fetchedAt = 0;
  lsSave();
  closeModal('m-cfg');
  renderNewsKws();
  fetchNews();
  toast('設定已儲存 ✓');
}

/* ─────────────────────────────────────
   WINDOW RESIZE
───────────────────────────────────── */
function onResize() {
  document.querySelectorAll('.widget').forEach(w => {
    const wid = w.dataset.wid;
    if (wid && S.widgets[wid]) applyPos(w, S.widgets[wid]);
  });
}

/* ─────────────────────────────────────
   CALENDAR WIDGET
───────────────────────────────────── */
/* ─────────────────────────────────────
   MOBILE LAYOUT
   Only visible on screens ≤ 640px
   Shows: search (in header) + shortcuts
───────────────────────────────────── */
function initMobileLayout() {
  if (window.innerWidth > 640) return;

  const container = $('mobile-layout');
  if (!container) return;

  // Shortcuts panel
  const panel = el('div', 'mobile-sc-panel glass-panel');
  const inner = el('div', 'sc-inner');
  inner.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;';
  panel.appendChild(inner);
  container.appendChild(panel);
  renderShortcutsWidget(inner);
}

/* ─────────────────────────────────────
   RENDER ALL
───────────────────────────────────── */
function renderAll() {
  rerenderSc();
  renderNewsKws();
  renderNewsItems();
}

/* ─────────────────────────────────────
   PWA — Service Worker
───────────────────────────────────── */
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
}

/* ─────────────────────────────────────
   INIT
───────────────────────────────────── */
async function init() {
  lsLoad();

  // IndexedDB + video
  await idbOpen().catch(()=>{});
  await loadVideo().catch(()=>{});

  // Build widgets (only if visible, undefined counts as visible)
  if (S.widgets.clock?.visible    !== false) buildClockWidget();
  if (S.widgets.shortcuts?.visible !== false) buildShortcutsWidget();
  if (S.widgets.news?.visible     !== false) buildNewsWidget();
  initMobileLayout();

  // Search + voice
  initSearch();

  // Context menu
  initCtx();

  // Buttons
  $('edit-btn').addEventListener('click', () => setEditMode(!S.editMode));
  $('edit-done').addEventListener('click', () => setEditMode(false));
  $('sync-btn').addEventListener('click', async () => {
    await gistPush();
  });
  $('settings-btn').addEventListener('click', openSettingsModal);

  // Shortcut modal
  $('sc-ok').addEventListener('click', saveScModal);
  $('sc-name').addEventListener('keydown', e => e.key==='Enter' && $('sc-url').focus());
  $('sc-url').addEventListener('keydown',  e => e.key==='Enter' && saveScModal());

  // Group modal
  $('grp-ok').addEventListener('click', () => {
    const name = $('grp-name').value.trim();
    if (!name) { toast('請輸入群組名稱','warn'); return; }
    S.groups.push({ id: uid(), name });
    lsSave(); closeModal('m-grp'); rerenderSc();
    $('grp-name').value = '';
  });
  $('grp-name').addEventListener('keydown', e => {
    if (e.key==='Enter') $('grp-ok').click();
  });

  // Settings modal
  $('cfg-ok').addEventListener('click', saveSettings);
  $('cfg-sync-now').addEventListener('click', async () => {
    if (confirm('從雲端還原？這會覆蓋你目前的本機設定。')) {
      await gistPull();
      renderAll();
      toast('已從雲端還原設定 ✓');
    }
  });
  $('rm-vid').addEventListener('click', removeVideo);

  // Cancel buttons (data-m attribute)
  document.querySelectorAll('.bcx[data-m]').forEach(b => {
    b.addEventListener('click', () => closeModal(b.dataset.m));
  });

  // Close modal on backdrop
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) m.classList.add('hidden'); });
  });

  // Window resize
  window.addEventListener('resize', onResize);

  // PWA
  registerSW();
}

document.addEventListener('DOMContentLoaded', init);
