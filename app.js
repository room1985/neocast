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
const ROW_H   = 78;
const COLS    = 24;
const GAP     = 10;
const IDB_DB  = 'neocast';
const IDB_VER = 1;
const IDB_ST  = 'blobs';
const VID_KEY = 'bg_video';
const LS_KEY  = 'neocast_v2';

/* ─────────────────────────────────────
   OPENCC — 簡體→繁體轉換
───────────────────────────────────── */
let _ccConverter = null;
async function toTW(text) {
  if (!text) return text;
  try {
    if (!_ccConverter) {
      _ccConverter = OpenCC.Converter({ from: 'cn', to: 'twp' });
    }
    return await _ccConverter(text);
  } catch(_) {
    return text; // fallback if OpenCC not loaded
  }
}
const NEWS_CACHE_MS = 25 * 60 * 1000;  // 25 min
const RSS2JSON = 'https://api.rss2json.com/v1/api.json?rss_url=';

/* ─────────────────────────────────────
   STATE
───────────────────────────────────── */
let S = {
  shortcuts:  [],
  groups:     [],
  stickies:   [],
  widgets: {
    clock:     { col:0, row:0, w:6, h:2, visible:true },
    shortcuts: { col:6, row:2, w:6, h:5, visible:true },
    news:      { col:0, row:2, w:6, h:5, visible:true }
  },
  news: {
    items:      [],
    fetchedAt:  0,
    keywords:   ['AI人工智慧','台灣科技','國際新聞'],
    lang:       'zh-TW',
    title:      '即時新聞',
    perKeyword: 2,
    cacheMin:   25,
    activeKw:   'all'
  },
  cfg: {
    token:       '',
    gistId:      '',
    nickname:    '',
    weatherCity: '',
    weatherLat:  null,
    weatherLon:  null
  },
  editMode:       false,
  activeGroup:    'all',
  privateUnlocked: false,
  ctxTarget:      null,
  animeState:     { offset: 0, genre: '全部', tracked: [], customNames: {} },
  scEditing:      null,
  dragSc:         null,
  mobilePages:    [{ id: 'shortcuts', widget: 'shortcuts' }],
  mobilePageIdx:  0
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
      shortcuts:  S.shortcuts,
      groups:     S.groups,
      stickies:   S.stickies,
      widgets:    S.widgets,
      news:       { items: S.news.items, fetchedAt: S.news.fetchedAt, keywords: S.news.keywords, lang: S.news.lang, title: S.news.title, perKeyword: S.news.perKeyword, cacheMin: S.news.cacheMin },
      cfg:        S.cfg,
      mobilePages: S.mobilePages,
      animeState: { genre: S.animeState.genre, tracked: S.animeState.tracked, trackedData: S.animeState.trackedData, customNames: S.animeState.customNames }
    }));
  } catch(_) {}

  if (S.cfg.token && S.cfg.gistId) {
    clearTimeout(_autoSyncTimer);
    _autoSyncTimer = setTimeout(() => {
      gistPush(true);
    }, 10000);
  }
}

function lsLoad() {
  try {
    const d = JSON.parse(localStorage.getItem(LS_KEY)||'{}');
    if (d.shortcuts)   S.shortcuts = d.shortcuts;
    if (d.groups)      S.groups    = d.groups;
    if (d.stickies)    S.stickies  = d.stickies;
    if (d.widgets)     Object.assign(S.widgets, d.widgets);
    if (d.news)        Object.assign(S.news, d.news);
    if (d.cfg)         Object.assign(S.cfg, d.cfg);
    if (d.mobilePages) S.mobilePages = d.mobilePages;
    if (d.animeState)  Object.assign(S.animeState, { ...d.animeState, offset: 0 }); // always start at current season
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
  shortcuts:  S.shortcuts,
  groups:     S.groups,
  stickies:   S.stickies,
  widgets:    S.widgets,
  newsKeywords: S.news.keywords,
  newsLang:   S.news.lang,
  animeState: { tracked: S.animeState.tracked, trackedData: S.animeState.trackedData, customNames: S.animeState.customNames }
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
    if (!res.ok) {
      if (res.status === 403) {
        const errData = await res.json().catch(() => ({}));
        throw new Error('HTTP 403: ' + (errData.message || 'Token 權限不足'));
      }
      if (res.status === 404) throw new Error('HTTP 404 Gist ID 不存在');
      throw new Error('HTTP ' + res.status);
    }
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
    if (d.stickies)     S.stickies  = d.stickies;
    if (d.widgets)      Object.assign(S.widgets, d.widgets);
    if (d.newsKeywords) S.news.keywords = d.newsKeywords;
    if (d.newsLang)     S.news.lang     = d.newsLang;
    if (d.animeState)   Object.assign(S.animeState, d.animeState);
    lsSave();
    renderAll();
    toast('已從 Gist 拉取最新設定 ✓');
  } catch(_) {}
}

/* ─────────────────────────────────────
   TOAST
───────────────────────────────────── */
const MAX_TOASTS = 4;

function toast(msg, type = 'ok') {
  const container = $('toast-container');
  if (!container) return;

  // Remove oldest if over limit
  const existing = container.querySelectorAll('.toast-item');
  if (existing.length >= MAX_TOASTS) {
    dismissToast(existing[existing.length - 1]);
  }

  const t = el('div', `toast-item toast-${type}`);
  t.textContent = msg;
  container.insertBefore(t, container.firstChild);

  // Auto dismiss after 3s
  const timer = setTimeout(() => dismissToast(t), 3000);
  t._timer = timer;
}

function dismissToast(t) {
  if (!t || t._dismissed) return;
  t._dismissed = true;
  clearTimeout(t._timer);
  t.classList.add('toast-out');
  setTimeout(() => t.remove(), 280);
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
  $('grid-overlay').classList.toggle('hidden', !on);

  // Toggle edit-btn between grid icon and ✓ 完成
  const editBtn = $('edit-btn');
  if (on) {
    editBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><polyline points="20 6 9 17 4 12"/></svg>`;
    editBtn.classList.add('edit-done-mode');
    editBtn.title = '完成編輯';
  } else {
    editBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`;
    editBtn.classList.remove('edit-done-mode');
    editBtn.title = '編輯佈局';
  }

  document.querySelectorAll('.widget').forEach(w => w.classList.toggle('editable', on));
  document.querySelectorAll('.w-delete-btn').forEach(b => b.classList.toggle('hidden', !on));
  const addPanel = $('add-widget-panel');
  if (addPanel) addPanel.classList.toggle('hidden', !on);
  if (on) renderAddWidgetPanel();

  // Mobile: show/hide replace buttons and add-page button
  document.querySelectorAll('.mobile-page-replace-btn').forEach(b => b.classList.toggle('hidden', !on));
  const addPageBtn = document.querySelector('.mobile-add-page-btn');
  if (addPageBtn) addPageBtn.classList.toggle('hidden', !on);
}

/* Widget meta registry */
const WIDGET_META = {
  clock:     { label: '時鐘',    icon: '🕐' },
  shortcuts: { label: '捷徑',    icon: '⭐' },
  news:      { label: 'AI新聞',  icon: '📰' },
  stickies:  { label: '便利貼',  icon: '📝' },
  anime:     { label: '動畫追蹤', icon: '🎌' }
};

/* Default positions for when a widget is re-added */
const WIDGET_DEFAULT = {
  clock:     { col:0,  row:0, w:6,  h:2, visible:true },
  shortcuts: { col:6,  row:2, w:6,  h:5, visible:true },
  news:      { col:0,  row:2, w:6,  h:5, visible:true },
  stickies:  { col:12, row:0, w:6,  h:6, visible:true },
  anime:     { col:18, row:0, w:6,  h:8, visible:true }
};

function renderAddWidgetPanel() {
  const panel = $('add-widget-panel');
  if (!panel) return;
  panel.innerHTML = '<div class="awp-title">＋ 新增小工具</div>';

  const hidden = Object.keys(WIDGET_META).filter(wid => {
    // stickies and any widget not in S.widgets yet = available to add
    if (!S.widgets[wid]) return true;
    return S.widgets[wid]?.visible === false;
  });
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
  document.querySelector(`.widget[data-wid="${wid}"]`)?.remove();
  if (wid === 'clock')     buildClockWidget();
  if (wid === 'shortcuts') buildShortcutsWidget();
  if (wid === 'news')      buildNewsWidget();
  if (wid === 'stickies')  buildStickiesWidget();
  if (wid === 'anime')     buildAnimeWidget();
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

    this.timeEl = el('div', 'simple-clock-time');

    // Info row: date on first line, greeting+weather on second line
    this.infoRow   = el('div', 'simple-clock-info-row');
    this.dateEl    = el('span', 'simple-clock-date');
    this.greetWrap = el('div', 'simple-clock-greet-weather');
    this.greetEl   = el('span', 'simple-clock-greeting');
    this.weatherEl = el('span', 'simple-clock-weather');
    this.greetWrap.appendChild(this.greetEl);
    this.greetWrap.appendChild(this.weatherEl);
    this.infoRow.appendChild(this.dateEl);
    this.infoRow.appendChild(this.greetWrap);

    wrap.appendChild(this.timeEl);
    wrap.appendChild(this.infoRow);
    container.appendChild(wrap);

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
    const now  = new Date();
    const h    = String(now.getHours()).padStart(2,'0');
    const m    = String(now.getMinutes()).padStart(2,'0');
    const s    = String(now.getSeconds()).padStart(2,'0');
    this.timeEl.textContent = `${h}:${m}:${s}`;

    const W = ['日','一','二','三','四','五','六'];
    this.dateEl.textContent = `${now.getMonth()+1}月${now.getDate()}日 週${W[now.getDay()]}`;

    const hr   = now.getHours();
    const name = S.cfg.nickname ? `，${S.cfg.nickname}` : '';
    let greet;
    if      (hr < 5)  greet = `該睡囉${name} 🥱`;
    else if (hr < 12) greet = `早上好${name} 🤗`;
    else if (hr < 18) greet = `中午好${name} 😘`;
    else              greet = `晚上好${name} 😍`;
    this.greetEl.textContent = greet;
  }

  updateWeather(text) {
    this.weatherEl.textContent = text || '';
  }
}

let clockRefs = [];

function updateAllClocks(weatherText) {
  clockRefs.forEach(c => c.updateWeather(weatherText));
}

function buildClockWidget() {
  const body = el('div', 'clock-body');
  const w    = makeWidget('clock', '', body);
  w.querySelector('.w-body')?.remove();
  w.insertBefore(body, w.querySelector('.resize-handle'));
  const c = new SimpleClock(body);
  clockRefs.push(c);
  c.tick();
  setInterval(() => c.tick(), 1000);
}

/* ─────────────────────────────────────
   WEATHER
───────────────────────────────────── */
const WEATHER_CACHE_MS = 30 * 60 * 1000;
let weatherCache = { text: '', fetchedAt: 0 };

const WMO_ICON = {
  0:'☀️', 1:'🌤', 2:'⛅', 3:'☁️',
  45:'🌫', 48:'🌫',
  51:'🌦', 53:'🌦', 55:'🌧',
  61:'🌧', 63:'🌧', 65:'🌧',
  71:'🌨', 73:'🌨', 75:'🌨',
  80:'🌦', 81:'🌧', 82:'⛈',
  95:'⛈', 96:'⛈', 99:'⛈'
};

async function fetchWeather(lat, lon, cityName) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode&timezone=auto`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return;
    const data = await res.json();
    const temp = Math.round(data.current.temperature_2m);
    const code = data.current.weathercode;
    const icon = WMO_ICON[code] || '🌡';
    const text = `${icon} ${temp}°C ${cityName || ''}`;
    weatherCache = { text, fetchedAt: Date.now() };
    updateAllClocks(text);
  } catch(_) {}
}

async function initWeather() {
  // Use cached if fresh
  if (weatherCache.text && Date.now() - weatherCache.fetchedAt < WEATHER_CACHE_MS) {
    updateAllClocks(weatherCache.text);
    return;
  }

  const city = S.cfg.weatherCity;
  const lat  = S.cfg.weatherLat;
  const lon  = S.cfg.weatherLon;

  if (lat && lon) {
    await fetchWeather(lat, lon, city);
  }

  // Auto-refresh every 30 min
  setTimeout(initWeather, WEATHER_CACHE_MS);
}

async function geoLocate() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) { rej('不支援定位'); return; }
    navigator.geolocation.getCurrentPosition(
      pos => res({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => rej('定位失敗')
    );
  });
}

async function reverseGeocode(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=zh-TW`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const d   = await res.json();
    return d.address?.city || d.address?.town || d.address?.county || '';
  } catch(_) { return ''; }
}

/* ─────────────────────────────────────
   PRIVATE GROUP — Lock / Unlock
───────────────────────────────────── */
const PRIVATE_GROUP_ID = '__private__';

function initLockBtn() {
  const btn  = $('lock-btn');
  const icon = $('lock-icon');
  if (!btn) return;

  let clickCount = 0;
  let clickTimer = null;

  // Unlocked SVG path
  const SVG_UNLOCKED = `<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.4-1.3"/>`;
  const SVG_LOCKED   = `<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>`;

  btn.addEventListener('click', () => {
    // If already unlocked, clicking once locks it
    if (S.privateUnlocked) {
      lockPrivate();
      return;
    }

    // Triple-click within 1.5s
    clickCount++;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => { clickCount = 0; }, 1500);

    if (clickCount >= 3) {
      clickCount = 0;
      clearTimeout(clickTimer);
      unlockPrivate();
    }
  });

  function unlockPrivate() {
    S.privateUnlocked = true;
    btn.classList.add('unlocked');
    icon.innerHTML = SVG_UNLOCKED;
    rerenderSc();
    toast('私人群組已解鎖');
  }

  function lockPrivate() {
    S.privateUnlocked = false;
    btn.classList.remove('unlocked');
    icon.innerHTML = SVG_LOCKED;
    // If currently viewing private, switch to all
    if (S.activeGroup === PRIVATE_GROUP_ID) {
      S.activeGroup = 'all';
    }
    rerenderSc();
  }
}

/* ─────────────────────────────────────
   SEARCH + VOICE
───────────────────────────────────── */
function initSearch() {
  const inp  = $('search-input');
  const vBtn = $('voice-btn');

  // Shorter placeholder on mobile
  if (window.innerWidth <= 640) {
    inp.placeholder = '搜尋';
  }

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

  if (S.privateUnlocked) {
    bar.appendChild(makeGrpTab(PRIVATE_GROUP_ID, '私人', false));
  }

  const addGrpBtn = el('button', 'grp-tab add', '＋ 群組');
  addGrpBtn.addEventListener('click', () => openModal('m-grp'));
  bar.appendChild(addGrpBtn);
  container.appendChild(bar);

  // Grid — filter out private shortcuts from 'all'
  const grid = el('div', 'sc-grid');
  let visible;
  if (S.activeGroup === 'all') {
    visible = S.shortcuts.filter(s => s.groupId !== PRIVATE_GROUP_ID);
  } else {
    visible = S.shortcuts.filter(s => s.groupId === S.activeGroup);
  }
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

  // Use custom icon > Google Favicon > fallback
  const iconUrl = sc.icon || getFav(sc.url);
  if (iconUrl) {
    const img    = el('img', 'sc-fav');
    img.src      = iconUrl;
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

  // Touch drag for mobile
  initTouchDrag(grid);
}

function initTouchDrag(grid) {
  let touchSrcId  = null;
  let ghost       = null;
  let longPressTimer = null;
  let isDragging  = false;
  let offsetX = 0, offsetY = 0;

  grid.querySelectorAll('.sc-item').forEach(item => {
    item.addEventListener('touchstart', e => {
      const touch = e.touches[0];
      touchSrcId = item.dataset.id;

      longPressTimer = setTimeout(() => {
        isDragging = true;

        // Create ghost clone
        const rect = item.getBoundingClientRect();
        ghost = item.cloneNode(true);
        ghost.classList.add('touch-drag-ghost');
        ghost.style.width  = rect.width + 'px';
        ghost.style.height = rect.height + 'px';
        ghost.style.left   = rect.left + 'px';
        ghost.style.top    = rect.top  + 'px';
        document.body.appendChild(ghost);

        offsetX = touch.clientX - rect.left;
        offsetY = touch.clientY - rect.top;

        item.classList.add('touch-dragging');
      }, 500);
    }, { passive: true });

    item.addEventListener('touchmove', e => {
      if (!isDragging) { clearTimeout(longPressTimer); return; }
      e.preventDefault();

      const touch = e.touches[0];

      // Move ghost
      if (ghost) {
        ghost.style.left = (touch.clientX - offsetX) + 'px';
        ghost.style.top  = (touch.clientY - offsetY) + 'px';
      }

      // Find which item we're over
      ghost.style.display = 'none';
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      ghost.style.display = '';

      grid.querySelectorAll('.touch-drag-over').forEach(i => i.classList.remove('touch-drag-over'));

      const target = el?.closest('.sc-item');
      if (target && target.dataset.id !== touchSrcId) {
        target.classList.add('touch-drag-over');
      }
    }, { passive: false });

    item.addEventListener('touchend', e => {
      clearTimeout(longPressTimer);
      if (!isDragging) { touchSrcId = null; return; }

      const touch = e.changedTouches[0];

      // Find drop target
      if (ghost) ghost.style.display = 'none';
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      if (ghost) { ghost.style.display = ''; ghost.remove(); ghost = null; }

      const target = el?.closest('.sc-item');
      if (target && target.dataset.id && target.dataset.id !== touchSrcId) {
        const si = S.shortcuts.findIndex(s => s.id === touchSrcId);
        const di = S.shortcuts.findIndex(s => s.id === target.dataset.id);
        if (si >= 0 && di >= 0) {
          const [m] = S.shortcuts.splice(si, 1);
          S.shortcuts.splice(di, 0, m);
          lsSave(); rerenderShortcuts();
        }
      }

      grid.querySelectorAll('.touch-dragging, .touch-drag-over').forEach(i => {
        i.classList.remove('touch-dragging', 'touch-drag-over');
      });

      isDragging  = false;
      touchSrcId  = null;
    }, { passive: true });

    item.addEventListener('touchcancel', () => {
      clearTimeout(longPressTimer);
      if (ghost) { ghost.remove(); ghost = null; }
      grid.querySelectorAll('.touch-dragging, .touch-drag-over').forEach(i => {
        i.classList.remove('touch-dragging', 'touch-drag-over');
      });
      isDragging = false;
      touchSrcId = null;
    }, { passive: true });
  });
}

function rerenderShortcuts() {
  const body = document.querySelector('.widget[data-wid="shortcuts"] .sc-inner');
  if (body) renderShortcutsWidget(body);
  const mobileBody = document.querySelector('#mobile-layout .sc-inner');
  if (mobileBody) renderShortcutsWidget(mobileBody);
}

function findScBody() {
  return document.querySelector('.widget[data-wid="shortcuts"] .sc-inner')
      || document.querySelector('#mobile-layout .sc-inner');
}

function rerenderSc() {
  const body = document.querySelector('.widget[data-wid="shortcuts"] .sc-inner');
  if (body) renderShortcutsWidget(body);
  const mobileBody = document.querySelector('#mobile-layout .sc-inner');
  if (mobileBody) renderShortcutsWidget(mobileBody);
  const mobileNews = document.querySelector('#mobile-layout .mobile-news-inner');
  if (mobileNews) renderMobileNews(mobileNews);
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
  const ttl  = el('div', 'w-title', S.news.title || '即時新聞');
  ttl.id = 'news-widget-title';
  const acts = el('div', 'w-actions');

  const langPill = el('button', 'pill', S.news.lang === 'zh-TW' ? '中文' : 'EN');
  langPill.id = 'news-lang-pill';
  langPill.addEventListener('click', () => {
    S.news.lang = S.news.lang === 'zh-TW' ? 'en' : 'zh-TW';
    langPill.textContent = S.news.lang === 'zh-TW' ? '中文' : 'EN';
    lsSave();
    fetchNews(true);
  });

  const refBtn = el('button', 'w-btn');
  refBtn.id = 'news-ref-btn';
  refBtn.title = '重新整理';
  refBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
  refBtn.addEventListener('click', () => {
    refBtn.classList.add('spin');
    fetchNews(true).finally(() => refBtn.classList.remove('spin'));
  });

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

  // 全部 tab
  const allTab = el('span', 'kw-tag' + (S.news.activeKw === 'all' ? ' on' : ''), '全部');
  allTab.addEventListener('click', () => { S.news.activeKw = 'all'; renderNewsKws(); renderNewsItems(); });
  kws.appendChild(allTab);

  // Keyword tabs
  S.news.keywords.forEach(kw => {
    const t = el('span', 'kw-tag' + (S.news.activeKw === kw ? ' on' : ''), esc(kw));
    t.addEventListener('click', () => { S.news.activeKw = kw; renderNewsKws(); renderNewsItems(); });
    kws.appendChild(t);
  });
}

function renderNewsItems() {
  if (!newsListEl) return;
  const filtered = S.news.activeKw === 'all'
    ? S.news.items
    : S.news.items.filter(i => i.kw === S.news.activeKw);

  if (!filtered.length) {
    newsListEl.innerHTML = '<div class="news-empty"><p>尚無新聞<br>點擊 ↻ 按鈕載入</p></div>';
    return;
  }
  newsListEl.innerHTML = '';
  filtered.forEach(item => {
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

async function fetchNews(force = false) {
  const cacheMs = (S.news.cacheMin || 25) * 60 * 1000;
  if (!force && Date.now() - S.news.fetchedAt < cacheMs && S.news.items.length) {
    renderNewsItems(); return;
  }

  const refBtn = $('news-ref-btn');
  const mobileRefBtn = $('mobile-news-ref-btn');
  renderNewsLoading();

  const isZh = S.news.lang === 'zh-TW';
  const hl   = isZh ? 'zh-TW' : 'en-US';
  const gl   = isZh ? 'TW'    : 'US';
  const ceid = isZh ? 'TW:zh-Hant' : 'US:en';
  const perKw = S.news.perKeyword || 2;

  const allItems = [];

  for (const kw of S.news.keywords) {
    try {
      const rssUrl  = `https://news.google.com/rss/search?q=${encodeURIComponent(kw)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
      const apiUrl  = RSS2JSON + encodeURIComponent(rssUrl);
      const res     = await fetch(apiUrl, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) continue;
      const data    = await res.json();
      if (data.status !== 'ok' || !Array.isArray(data.items)) continue;

      data.items.slice(0, perKw).forEach(item => {
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

  renderNewsItems();

  // Re-query DOM fresh after async to avoid stale references
  const mobileNews = document.querySelector('#mobile-layout .mobile-news-inner');
  if (mobileNews) renderMobileNews(mobileNews);
}

/* ─────────────────────────────────────
   STICKIES WIDGET — 便利貼
───────────────────────────────────── */
const STICKY_COLORS = {
  none:   { bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.12)', label: '預設' },
  blue:   { bg: 'rgba(56,189,248,0.12)',  border: 'rgba(56,189,248,0.3)',   label: '藍' },
  green:  { bg: 'rgba(74,222,128,0.12)',  border: 'rgba(74,222,128,0.3)',   label: '綠' },
  red:    { bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.3)',  label: '紅' },
  yellow: { bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.3)',   label: '黃' }
};

function buildStickiesWidget() {
  const body = el('div', 'stickies-inner');
  body.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;min-height:0;';
  const w = makeWidget('stickies', '便利貼', body, '');
  w.querySelector('.w-body')?.remove();
  w.insertBefore(body, w.querySelector('.resize-handle'));
  renderStickiesWidget(body);
  // Re-calculate list height on widget resize
  new ResizeObserver(() => {
    const list = body.querySelector('.sticky-list');
    const bar  = body.querySelector('.sticky-input-bar');
    if (list && bar) {
      list.style.height = (body.offsetHeight - bar.offsetHeight) + 'px';
    }
  }).observe(body);
}

function renderStickiesWidget(container) {
  container.innerHTML = '';

  const list = el('div', 'sticky-list');
  container.appendChild(list);

  if (!S.stickies.length) {
    list.innerHTML = '<div class="sticky-empty">輸入新增待辦事項…</div>';
  } else {
    const sorted = [
      ...S.stickies.filter(s => s.pinned),
      ...S.stickies.filter(s => !s.pinned)
    ];
    sorted.forEach(s => list.appendChild(makeStickyCard(s, container)));
    initStickyListDrag(list, container);
  }

  // Input bar
  const bar = el('div', 'sticky-input-bar');

  // 2×2 color grid
  let selectedColor = 'none';
  const colorGrid = el('div', 'sticky-color-grid');
  ['blue','green','red','yellow'].forEach(key => {
    const sq = el('button', 'sticky-color-sq sticky-sq-' + key);
    sq.title = STICKY_COLORS[key].label;
    sq.addEventListener('click', () => {
      selectedColor = selectedColor === key ? 'none' : key;
      colorGrid.querySelectorAll('.sticky-color-sq').forEach(s => s.classList.remove('on'));
      if (selectedColor !== 'none') sq.classList.add('on');
    });
    colorGrid.appendChild(sq);
  });

  const inp = el('input', 'sticky-input');
  inp.type = 'text';
  inp.placeholder = '新增待辦…';
  inp.autocomplete = 'off';

  const addBtn = el('button', 'sticky-add-btn');
  addBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M2 12l20-8-8 20-4-8-8-4z"/></svg>`;
  addBtn.title = '新增';

  function doAdd() {
    const text = inp.value.trim();
    if (!text) return;
    S.stickies.unshift({ id: uid(), text, color: selectedColor, pinned: false });
    inp.value = '';
    lsSave();
    renderStickiesWidget(container);
  }

  addBtn.addEventListener('click', doAdd);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });

  bar.appendChild(colorGrid);
  bar.appendChild(inp);
  bar.appendChild(addBtn);
  container.appendChild(bar);

  // JS height — most reliable, bypasses all flex overflow quirks
  requestAnimationFrame(() => {
    const barH = bar.offsetHeight || 53;
    const containerH = container.offsetHeight;
    if (containerH > barH) {
      list.style.height = (containerH - barH) + 'px';
      list.style.overflowY = 'auto';
    }
  });
}

function makeStickyCard(sticky, container) {
  const c    = STICKY_COLORS[sticky.color] || STICKY_COLORS.none;
  const card = el('div', 'sticky-card' + (sticky.pinned ? ' pinned' : '') + (sticky.done ? ' done' : ''));
  card.dataset.id = sticky.id;
  card.style.background  = c.bg;
  card.style.borderColor = c.border;

  // Drag handle
  const drag = el('div', 'sticky-handle' + (sticky.pinned ? ' disabled' : ''));
  drag.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" opacity=".4"><circle cx="9" cy="5" r="1.5" fill="currentColor"/><circle cx="9" cy="12" r="1.5" fill="currentColor"/><circle cx="9" cy="19" r="1.5" fill="currentColor"/><circle cx="15" cy="5" r="1.5" fill="currentColor"/><circle cx="15" cy="12" r="1.5" fill="currentColor"/><circle cx="15" cy="19" r="1.5" fill="currentColor"/></svg>`;

  // Square checkbox — toggle done state
  const chk = el('button', 'sticky-chk' + (sticky.done ? ' checked' : ''));
  chk.title = sticky.done ? '取消完成' : '標記完成';
  if (sticky.done) {
    chk.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="11" height="11"><polyline points="20 6 9 17 4 12"/></svg>`;
  }
  chk.addEventListener('click', e => {
    e.stopPropagation();
    const st = S.stickies.find(s => s.id === sticky.id);
    if (st) st.done = !st.done;
    lsSave();
    renderStickiesWidget(container);
  });

  // Text area
  const textEl = el('div', 'sticky-text' + (sticky.done ? ' strikethrough' : ''), esc(sticky.text));
  let longPressTimer = null;

  // Pin button
  const pinBtn = el('button', 'sticky-pin' + (sticky.pinned ? ' on' : ''));
  pinBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="${sticky.pinned?'currentColor':'none'}" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
  pinBtn.title = sticky.pinned ? '取消置頂' : '置頂';
  pinBtn.addEventListener('click', e => {
    e.stopPropagation();
    const st = S.stickies.find(s => s.id === sticky.id);
    if (st) st.pinned = !st.pinned;
    lsSave();
    renderStickiesWidget(container);
  });

  card.appendChild(drag);
  card.appendChild(chk);
  card.appendChild(textEl);
  card.appendChild(pinBtn);

  const onLongPress = () => {
    startEdit(sticky, textEl, card, container);
  };

  textEl.addEventListener('mousedown', () => { longPressTimer = setTimeout(onLongPress, 500); });
  textEl.addEventListener('mouseup', () => clearTimeout(longPressTimer));
  textEl.addEventListener('mouseleave', () => clearTimeout(longPressTimer));
  textEl.addEventListener('touchstart', () => { longPressTimer = setTimeout(onLongPress, 500); }, { passive: true });
  textEl.addEventListener('touchend', () => clearTimeout(longPressTimer), { passive: true });
  card.addEventListener('contextmenu', e => { e.preventDefault(); onLongPress(); });

  return card;
}

function startEdit(sticky, textEl, card, container) {
  const inp = el('input', 'sticky-edit-input');
  inp.value = sticky.text;
  inp.autocomplete = 'off';
  textEl.replaceWith(inp);
  inp.focus();
  inp.select();

  // Hide pin button during edit
  const pinBtn = card.querySelector('.sticky-pin');
  if (pinBtn) pinBtn.style.display = 'none';

  // Show color picker + del button inline during edit
  const colorRow = el('div', 'sticky-edit-colors');

  // Del button inside colorRow (leftmost)
  const delBtn = el('button', 'sticky-inline-del');
  delBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>`;
  delBtn.title = '刪除';
  delBtn.addEventListener('mousedown', e => {
    e.preventDefault(); // prevent blur
    if (!confirm('確認刪除？')) return;
    card.style.transition = 'transform .32s ease, opacity .32s ease';
    card.style.transform  = 'translateX(110%)';
    card.style.opacity    = '0';
    setTimeout(() => {
      S.stickies = S.stickies.filter(s => s.id !== sticky.id);
      lsSave();
      renderStickiesWidget(container);
    }, 340);
  });
  colorRow.appendChild(delBtn);
  ['blue','green','red','yellow'].forEach(key => {
    const sq = el('button', 'sticky-color-sq sticky-sq-' + key + (sticky.color === key ? ' on' : ''));
    sq.addEventListener('mousedown', e => {
      e.preventDefault();
      const st = S.stickies.find(s => s.id === sticky.id);
      if (st) {
        st.color = st.color === key ? 'none' : key;
        const newC = STICKY_COLORS[st.color] || STICKY_COLORS.none;
        card.style.background  = newC.bg;
        card.style.borderColor = newC.border;
      }
      colorRow.querySelectorAll('.sticky-color-sq').forEach(s => s.classList.remove('on'));
      if (sticky.color === key) sq.classList.add('on');
      lsSave();
    });
    colorRow.appendChild(sq);
  });
  inp.after(colorRow);

  const save = () => {
    const val = inp.value.trim();
    if (val) { const st = S.stickies.find(s => s.id === sticky.id); if (st) st.text = val; }
    lsSave();
    renderStickiesWidget(container);
  };
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') renderStickiesWidget(container);
  });
  inp.addEventListener('blur', save);
}

function initStickyListDrag(list, container) {
  let dragSrcId = null;
  let ghost     = null;
  let startX    = 0;
  let startY    = 0;

  list.querySelectorAll('.sticky-card:not(.pinned)').forEach(card => {
    const handle = card.querySelector('.sticky-handle');
    if (!handle) return;

    // Desktop drag on entire card
    card.draggable = true;
    card.addEventListener('dragstart', e => {
      dragSrcId = card.dataset.id;
      setTimeout(() => card.classList.add('sticky-dragging'), 0);
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('sticky-dragging');
      list.querySelectorAll('.sticky-drag-over').forEach(c => c.classList.remove('sticky-drag-over'));
      dragSrcId = null;
    });
    card.addEventListener('dragover', e => {
      e.preventDefault();
      if (card.dataset.id === dragSrcId) return;
      list.querySelectorAll('.sticky-drag-over').forEach(c => c.classList.remove('sticky-drag-over'));
      card.classList.add('sticky-drag-over');
    });
    card.addEventListener('drop', e => {
      e.preventDefault();
      if (!dragSrcId || dragSrcId === card.dataset.id) return;
      const si = S.stickies.findIndex(s => s.id === dragSrcId);
      const di = S.stickies.findIndex(s => s.id === card.dataset.id);
      if (si < 0 || di < 0) return;
      const [m] = S.stickies.splice(si, 1);
      S.stickies.splice(di, 0, m);
      lsSave();
      renderStickiesWidget(container);
    });

    // Mobile touch drag via handle
    handle.addEventListener('touchstart', e => {
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      dragSrcId = card.dataset.id;

      setTimeout(() => {
        if (!dragSrcId) return;
        card.classList.add('sticky-dragging');
        const rect = card.getBoundingClientRect();
        ghost = card.cloneNode(true);
        ghost.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;opacity:.85;z-index:9999;pointer-events:none;`;
        document.body.appendChild(ghost);
      }, 150);
    }, { passive: true });

    handle.addEventListener('touchmove', e => {
      if (!dragSrcId || !ghost) return;
      const touch = e.touches[0];
      const dy = touch.clientY - startY;
      const dx = touch.clientX - startX;
      if (Math.abs(dx) > Math.abs(dy) + 10) { // horizontal = ignore (page swipe)
        dragSrcId = null;
        if (ghost) { ghost.remove(); ghost = null; }
        card.classList.remove('sticky-dragging');
        return;
      }
      e.preventDefault();
      ghost.style.top = (parseFloat(ghost.style.top) + (touch.clientY - startY)) + 'px';
      startY = touch.clientY;

      ghost.style.display = 'none';
      const el2 = document.elementFromPoint(touch.clientX, touch.clientY);
      ghost.style.display = '';
      const target = el2?.closest('.sticky-card:not(.pinned)');
      list.querySelectorAll('.sticky-drag-over').forEach(c => c.classList.remove('sticky-drag-over'));
      if (target && target.dataset.id !== dragSrcId) target.classList.add('sticky-drag-over');
    }, { passive: false });

    handle.addEventListener('touchend', () => {
      if (!dragSrcId) return;
      const over = list.querySelector('.sticky-drag-over');
      if (over && over.dataset.id !== dragSrcId) {
        const si = S.stickies.findIndex(s => s.id === dragSrcId);
        const di = S.stickies.findIndex(s => s.id === over.dataset.id);
        if (si >= 0 && di >= 0) {
          const [m] = S.stickies.splice(si, 1);
          S.stickies.splice(di, 0, m);
          lsSave();
        }
      }
      if (ghost) { ghost.remove(); ghost = null; }
      card.classList.remove('sticky-dragging');
      list.querySelectorAll('.sticky-drag-over').forEach(c => c.classList.remove('sticky-drag-over'));
      dragSrcId = null;
      renderStickiesWidget(container);
    }, { passive: true });

    handle.addEventListener('touchcancel', () => {
      if (ghost) { ghost.remove(); ghost = null; }
      card.classList.remove('sticky-dragging');
      dragSrcId = null;
    }, { passive: true });
  });
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
    if (sc) {
      $('sc-name').value = sc.name;
      $('sc-url').value  = sc.url;
      $('sc-icon').value = sc.icon || '';
      grpSel.value       = sc.groupId || '';
    }
  } else {
    $('sc-name').value = '';
    $('sc-url').value  = '';
    $('sc-icon').value = '';
    grpSel.value = S.activeGroup !== 'all' ? S.activeGroup : '';
  }
  openModal('m-sc');
  $('sc-name').focus();
}

function saveScModal() {
  let name = $('sc-name').value.trim();
  let url  = $('sc-url').value.trim();
  const gid  = $('sc-grp').value;
  const icon = $('sc-icon').value.trim();
  if (!name || !url) { toast('請填寫名稱和網址','warn'); return; }
  if (!/^https?:\/\//.test(url)) url = 'https://' + url;

  if (S.scEditing) {
    const sc = S.shortcuts.find(s => s.id === S.scEditing);
    if (sc) { sc.name = name; sc.url = url; sc.groupId = gid; sc.icon = icon || ''; }
  } else {
    S.shortcuts.push({ id: uid(), name, url, groupId: gid, icon: icon || '' });
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
  // Show private group option only when unlocked
  if (S.privateUnlocked) {
    const priv = el('div', 'mv-item', '🔓 私人');
    priv.style.color = 'var(--ac)';
    priv.addEventListener('click', () => { doMove(scId, PRIVATE_GROUP_ID); closeModal('m-mv'); });
    list.appendChild(priv);
  }
  openModal('m-mv');
}

function doMove(scId, gid) {
  const sc = S.shortcuts.find(s => s.id === scId);
  if (sc) sc.groupId = gid;
  lsSave(); rerenderSc();
}

function openSettingsModal() {
  $('cfg-tok').value        = S.cfg.token;
  $('cfg-gid').value        = S.cfg.gistId;
  $('cfg-kw').value         = S.news.keywords.join(', ');
  $('cfg-lang').value       = S.news.lang;
  $('cfg-news-title').value = S.news.title || '即時新聞';
  $('cfg-per-kw').value     = String(S.news.perKeyword || 2);
  $('cfg-cache-min').value  = String(S.news.cacheMin || 25);
  $('cfg-nickname').value   = S.cfg.nickname || '';
  $('cfg-city').value       = S.cfg.weatherCity || '';
  $('cfg-locate-status').textContent = '';
  openModal('m-cfg');
}

async function saveSettings() {
  const token      = $('cfg-tok').value.trim();
  const gistId     = $('cfg-gid').value.trim();
  const kwRaw      = $('cfg-kw').value;
  const lang       = $('cfg-lang').value;
  const kws        = kwRaw.split(',').map(k=>k.trim()).filter(Boolean);
  const newsTitle  = $('cfg-news-title').value.trim() || '即時新聞';
  const perKeyword = parseInt($('cfg-per-kw').value) || 2;
  const cacheMin   = parseInt($('cfg-cache-min').value) || 25;
  const nickname   = $('cfg-nickname').value.trim();
  const city       = $('cfg-city').value.trim();

  S.cfg.token        = token;
  S.cfg.gistId       = gistId;
  S.cfg.nickname     = nickname;
  S.cfg.weatherCity  = city;
  S.news.lang        = lang;
  S.news.keywords    = kws.length ? kws : ['最新新聞'];
  S.news.title       = newsTitle;
  S.news.perKeyword  = perKeyword;
  S.news.cacheMin    = cacheMin;

  // Update news widget title live
  const titleEl = $('news-widget-title');
  if (titleEl) titleEl.textContent = newsTitle;

  // Handle video file
  const vidFile = $('cfg-vid').files[0];
  if (vidFile) await saveVideo(vidFile);

  S.news.fetchedAt = 0;
  lsSave();
  closeModal('m-cfg');
  renderNewsKws();
  fetchNews(true);
  if (city && S.cfg.weatherLat) initWeather();
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
   ANIME WIDGET
───────────────────────────────────── */
/* ─────────────────────────────────────
   ANIME WIDGET — Bangumi.tv API
───────────────────────────────────── */
const BGM_WEEKDAY = ['週日','週一','週二','週三','週四','週五','週六'];

async function fetchBangumiCalendar() {
  const res = await fetch('https://api.bgm.tv/calendar', {
    headers: { 'User-Agent': 'NeoCast/1.0 (https://github.com/room1985/neocast)' }
  });
  if (!res.ok) throw new Error('API error');
  return await res.json();
}

function buildAnimeWidget() {
  const body = el('div', 'anime-inner');
  body.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;min-height:0;';
  const w = makeWidget('anime', '', body, '');
  w.querySelector('.w-body')?.remove();
  w.insertBefore(body, w.querySelector('.resize-handle'));
  renderAnimeWidget(body);
}

function renderAnimeWidget(container) {
  container.innerHTML = '';
  if (!S.animeState) S.animeState = { weekday: -1, tracked: [], trackedData: {}, customNames: {} };
  if (!S.animeState.trackedData) S.animeState.trackedData = {};
  if (!S.animeState.customNames) S.animeState.customNames = {};

  const todayWd = new Date().getDay();
  let curWd  = S.animeState.weekday >= 0 ? S.animeState.weekday : todayWd;
  let curTab = 'week';

  // Header: title + [本季新番][收藏][搜尋] + [今日]
  const head = el('div', 'anime-head');
  const title = el('div', 'w-title', '動畫追蹤');

  const mainTabs = el('div', 'anime-main-tabs');
  const tabDefs = [['本季新番','week'],['收藏','fav'],['搜尋','search']];
  tabDefs.forEach(([name, key]) => {
    const t = el('button', 'anime-main-tab' + (curTab === key ? ' on' : ''), name);
    t.addEventListener('click', () => {
      curTab = key;
      mainTabs.querySelectorAll('.anime-main-tab').forEach(tb => tb.classList.remove('on'));
      t.classList.add('on');
      const isSearch = curTab === 'search';
      weekTabsWrap.style.display = isSearch ? 'none' : 'flex';
      todayBtn.style.display     = isSearch ? 'none' : '';
      searchBar.style.display    = isSearch ? 'flex' : 'none';
      loadTab();
    });
    mainTabs.appendChild(t);
  });

  const todayBtn = el('button', 'anime-today-btn', '今日');
  todayBtn.addEventListener('click', () => {
    curWd = todayWd;
    S.animeState.weekday = curWd;
    updateWeekTabs();
    loadTab();
  });

  head.appendChild(title);
  head.appendChild(mainTabs);
  head.appendChild(todayBtn);
  container.appendChild(head);

  // Shared weekday tabs (week + fav) — 全部 + 週日~週六
  const weekTabsWrap = el('div', 'anime-tabs');
  // Use -2 as sentinel for "全部"
  const ALL_WD = -2;
  if (curWd === undefined || curWd === -1) curWd = todayWd;

  const updateWeekTabs = () => {
    weekTabsWrap.querySelectorAll('.anime-tab').forEach(t => {
      const wd = parseInt(t.dataset.wd);
      t.classList.toggle('on', wd === curWd);
    });
  };

  // 全部 tab
  const allTab = el('button', 'anime-tab' + (curWd === ALL_WD ? ' on' : ''), '全部');
  allTab.dataset.wd = ALL_WD;
  allTab.addEventListener('click', () => {
    curWd = ALL_WD; S.animeState.weekday = ALL_WD;
    updateWeekTabs();
    loadTab();
  });
  weekTabsWrap.appendChild(allTab);

  BGM_WEEKDAY.forEach((name, i) => {
    const t = el('button', 'anime-tab' + (curWd === i ? ' on' : ''), name);
    t.dataset.wd = i;
    if (i === todayWd) t.style.fontWeight = '900';
    t.addEventListener('click', () => {
      curWd = i; S.animeState.weekday = i;
      updateWeekTabs();
      loadTab();
    });
    weekTabsWrap.appendChild(t);
  });
  container.appendChild(weekTabsWrap);

  // Search bar (hidden by default)
  const searchBar = el('div', 'anime-search-bar');
  searchBar.style.display = 'none';
  const searchInp = el('input', 'anime-search-inp');
  searchInp.type = 'text';
  searchInp.placeholder = '輸入番名搜尋…';
  searchInp.autocomplete = 'off';
  const searchBtn = el('button', 'anime-search-btn');
  searchBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
  searchBar.appendChild(searchInp);
  searchBar.appendChild(searchBtn);
  container.appendChild(searchBar);

  const grid = el('div', 'anime-grid');
  container.appendChild(grid);

  let calendarCache = null;

  function makeAnimeCard(anime, bgmWd) {
    const isTracked = (S.animeState.tracked || []).includes(anime.id);
    const card = el('div', 'anime-card' + (isTracked ? ' pinned' : ''));
    card.dataset.id = anime.id;

    const img = el('img', 'anime-cover');
    img.src = anime.images?.large || anime.images?.common || '';
    img.alt = anime.name_cn || anime.name;
    img.loading = 'lazy';

    const info = el('div', 'anime-info');
    const displayTitle = S.animeState.customNames?.[anime.id] || anime.name_cn || anime.name;
    const titleEl = el('div', 'anime-title', displayTitle);
    toTW(displayTitle).then(tw => { if (tw !== displayTitle) titleEl.textContent = tw; });
    const meta = el('div', 'anime-meta');
    if (anime.rating?.score) {
      const sb = el('span', 'anime-card-badge badge-score', `★ ${anime.rating.score.toFixed(1)}`);
      meta.appendChild(sb);
    }
    const epsNum = anime.eps_count || anime.eps;
    if (epsNum) {
      const eb = el('span', 'anime-card-badge badge-eps', `共 ${epsNum} 集`);
      meta.appendChild(eb);
    }

    const star = el('button', 'anime-star' + (isTracked ? ' on' : ''));
    star.innerHTML = `<svg viewBox="0 0 24 24" fill="${isTracked?'currentColor':'none'}" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;

    star.addEventListener('click', async e => {
      e.stopPropagation();
      if (!S.animeState.tracked) S.animeState.tracked = [];
      const idx = S.animeState.tracked.indexOf(anime.id);
      if (idx >= 0) {
        S.animeState.tracked.splice(idx, 1);
        delete S.animeState.trackedData[anime.id];
        star.classList.remove('on');
        star.querySelector('svg').setAttribute('fill', 'none');
        card.classList.remove('pinned');
      } else {
        S.animeState.tracked.unshift(anime.id);
        // Try to get air_weekday from bgmWd param first, else fetch full subject
        let wd = bgmWd !== undefined ? bgmWd : -1;
        if (wd === -1 && anime.air_weekday) {
          wd = anime.air_weekday === 7 ? 0 : anime.air_weekday;
        }
        // If still unknown, fetch full subject detail for air_weekday / date
        if (wd === -1) {
          try {
            // Try legacy API first (has air_weekday field)
            const r = await fetch(`https://api.bgm.tv/subject/${anime.id}`, {
              headers: { 'User-Agent': 'NeoCast/1.0 (https://github.com/room1985/neocast)' }
            });
            const d = await r.json();
            if (d.air_weekday) {
              // Legacy API: 1=Mon,2=Tue,...,7=Sun → JS: 1=Mon,...,6=Sat,0=Sun
              wd = d.air_weekday === 7 ? 0 : d.air_weekday;
            } else if (d.date) {
              // Fallback: calculate weekday from air date string
              wd = new Date(d.date).getDay();
            }
          } catch(_) {}
        }
        S.animeState.trackedData[anime.id] = {
          id: anime.id, name: anime.name, name_cn: anime.name_cn,
          images: anime.images, rating: anime.rating, eps: anime.eps,
          air_weekday: wd
        };
        star.classList.add('on');
        star.querySelector('svg').setAttribute('fill', 'currentColor');
        card.classList.add('pinned');
      }
      lsSave();
      if (curTab !== 'search') loadTab();
    });

    img.style.cursor = 'zoom-in';
    img.addEventListener('click', e => {
      e.stopPropagation();
      showImageViewer(img.src, img.alt);
    });

    info.appendChild(titleEl);
    info.appendChild(meta);
    card.appendChild(img);
    card.appendChild(info);
    card.appendChild(star);
    card.addEventListener('click', e => {
      if (e.target.closest('.anime-star') || e.target.closest('img')) return;
      showAnimeSheet(anime);
    });
    return card;
  }

  function renderItems(items, bgmWd) {
    grid.innerHTML = '';
    if (!items.length) { grid.innerHTML = '<div class="anime-empty">沒有找到動畫</div>'; return; }
    const tracked = S.animeState.tracked || [];
    const sorted = [...items].sort((a, b) => {
      const aPin = tracked.includes(a.id) ? 1 : 0;
      const bPin = tracked.includes(b.id) ? 1 : 0;
      if (bPin !== aPin) return bPin - aPin;
      return (b.rating?.score || 0) - (a.rating?.score || 0);
    });
    sorted.forEach(anime => grid.appendChild(makeAnimeCard(anime, bgmWd)));
  }

  function renderFav() {
    grid.innerHTML = '';
    const tracked = S.animeState.tracked || [];
    if (!tracked.length) { grid.innerHTML = '<div class="anime-empty">還沒有收藏的番組</div>'; return; }

    if (curWd === ALL_WD) {
      // Show all tracked items
      const items = tracked.map(id => S.animeState.trackedData?.[id]).filter(Boolean);
      if (!items.length) { grid.innerHTML = '<div class="anime-empty">還沒有收藏的番組</div>'; return; }
      items.forEach(anime => grid.appendChild(makeAnimeCard(anime, anime.air_weekday)));
    } else {
      const items = tracked
        .map(id => S.animeState.trackedData?.[id])
        .filter(a => a && a.air_weekday === curWd);
      if (!items.length) { grid.innerHTML = '<div class="anime-empty">這天沒有收藏的番組</div>'; return; }
      items.forEach(anime => grid.appendChild(makeAnimeCard(anime, anime.air_weekday)));
    }
  }

  const doSearch = async () => {
    const q = searchInp.value.trim();
    if (!q) return;
    grid.innerHTML = '<div class="anime-loading">搜尋中…</div>';
    try {
      const res = await fetch('https://api.bgm.tv/v0/search/subjects?limit=20', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'NeoCast/1.0 (https://github.com/room1985/neocast)'
        },
        body: JSON.stringify({ keyword: q, filter: { type: [2] } })
      });
      const data = await res.json();
      renderItems(data.data || []);
    } catch(e) {
      grid.innerHTML = '<div class="anime-empty">搜尋失敗，請稍後再試</div>';
    }
  };
  searchBtn.addEventListener('click', doSearch);
  searchInp.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

  async function loadTab() {
    if (curTab === 'week') {
      if (!calendarCache) {
        grid.innerHTML = '<div class="anime-loading">載入中…</div>';
        try { calendarCache = await fetchBangumiCalendar(); }
        catch(e) { grid.innerHTML = '<div class="anime-empty">載入失敗</div>'; return; }
      }
      if (curWd === ALL_WD) {
        // Merge all days
        const all = calendarCache.flatMap(d => d.items || []);
        renderItems(all, undefined);
      } else {
        const bgmId = curWd === 0 ? 7 : curWd;
        const dayData = calendarCache.find(d => d.weekday?.id === bgmId);
        renderItems(dayData?.items || [], curWd);
      }
    } else if (curTab === 'fav') {
      renderFav();
      // Batch fetch eps for tracked items missing it (max 3 concurrent)
      const missing = (S.animeState.tracked || [])
        .map(id => S.animeState.trackedData?.[id])
        .filter(a => a && !(a.eps_count || a.eps));
      if (missing.length) {
        const fetchOne = async (anime) => {
          try {
            const r = await fetch(`https://api.bgm.tv/subject/${anime.id}`, {
              headers: { 'User-Agent': 'NeoCast/1.0 (https://github.com/room1985/neocast)' }
            });
            const d = await r.json();
            const epsCount = d.eps_count || d.eps || 0;
            if (epsCount) {
              S.animeState.trackedData[anime.id].eps_count = epsCount;
              lsSave();
              // Update card in fav grid
              document.querySelectorAll(`.anime-card[data-id="${anime.id}"] .anime-meta`).forEach(metaEl => {
                let eb = metaEl.querySelector('.badge-eps');
                if (!eb) {
                  eb = el('span', 'anime-card-badge badge-eps', `共 ${epsCount} 集`);
                  metaEl.appendChild(eb);
                } else {
                  eb.textContent = `共 ${epsCount} 集`;
                }
              });
            }
          } catch(_) {}
        };
        // Process in batches of 3
        for (let i = 0; i < missing.length; i += 3) {
          await Promise.all(missing.slice(i, i + 3).map(fetchOne));
        }
      }
    } else if (curTab === 'search') {
      grid.innerHTML = '<div class="anime-empty">輸入番名開始搜尋</div>';
    }
  }

  loadTab();
}

/* ─────────────────────────────────────
   ANIME BOTTOM SHEET
───────────────────────────────────── */
function showImageViewer(src, alt) {
  document.querySelector('.anime-img-viewer')?.remove();
  const viewer = el('div', 'anime-img-viewer');
  const img = el('img', 'anime-img-viewer-img');
  img.src = src; img.alt = alt;
  viewer.appendChild(img);
  viewer.addEventListener('click', () => viewer.remove());
  document.body.appendChild(viewer);
  requestAnimationFrame(() => viewer.classList.add('open'));
}

async function showAnimeSheet(anime) {
  document.querySelector('.anime-sheet-overlay')?.remove();

  const overlay = el('div', 'anime-sheet-overlay');
  const sheet   = el('div', 'anime-sheet');

  const closeSheet = () => {
    sheet.classList.remove('open');
    setTimeout(() => overlay.remove(), 300);
  };

  // Large centered cover
  const coverWrap = el('div', 'anime-sheet-cover-wrap');
  const cover = el('img', 'anime-sheet-cover');
  cover.src = anime.images?.large || anime.images?.common || '';
  cover.alt = anime.name_cn || anime.name;
  cover.addEventListener('click', e => {
    e.stopPropagation();
    showImageViewer(cover.src, cover.alt);
  });
  coverWrap.appendChild(cover);
  sheet.appendChild(coverWrap);

  // Info: title (max 2 lines) + meta+buttons row
  const infoWrap = el('div', 'anime-sheet-info');

  const sheetTitle = el('div', 'anime-sheet-title',
    S.animeState.customNames?.[anime.id] || anime.name_cn || anime.name);

  // Meta + buttons row
  const metaRow = el('div', 'anime-sheet-meta-row');

  // Badges (left side)
  const metaWrap = el('div', 'anime-sheet-meta-wrap');
  if (anime.rating?.score) {
    const scoreBadge = el('span', 'anime-sheet-badge badge-score', `★ ${anime.rating.score.toFixed(1)}`);
    metaWrap.appendChild(scoreBadge);
  }
  // eps badge — will be updated after API fetch
  const epsBadge = el('span', 'anime-sheet-badge badge-eps');
  epsBadge.style.display = 'none';
  metaWrap.appendChild(epsBadge);

  // Button group (right side) — [編輯][複製][收藏][關閉]
  const btnGroup = el('div', 'anime-sheet-btn-group');

  // Edit / rename button
  const editBtn = el('button', 'anime-sheet-icon-btn');
  editBtn.title = '自訂名稱';
  editBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  editBtn.addEventListener('click', e => {
    e.stopPropagation();
    const inp = document.createElement('input');
    inp.className = 'anime-sheet-title-input';
    inp.value = sheetTitle.textContent;
    inp.autocomplete = 'off';
    sheetTitle.replaceWith(inp);
    inp.focus();
    inp.select();

    let saved = false;
    const saveEdit = () => {
      if (saved) return;
      saved = true;
      const val = inp.value.trim();
      if (val && val !== (anime.name_cn || anime.name)) {
        S.animeState.customNames[anime.id] = val;
      } else {
        delete S.animeState.customNames[anime.id];
      }
      lsSave();
      const newName = S.animeState.customNames?.[anime.id] || anime.name_cn || anime.name;
      sheetTitle.textContent = newName;
      inp.replaceWith(sheetTitle);
      // Update link URLs
      const q = encodeURIComponent(newName);
      linkWrap.querySelectorAll('.anime-sheet-link-btn').forEach(a => {
        switch(a.dataset.label) {
          case '動畫瘋': a.href = `https://ani.gamer.com.tw/search.php?keyword=${q}`; break;
          case 'YouTube': a.href = `https://www.youtube.com/results?search_query=${q}`; break;
          case '劇迷':   a.href = `https://gimyai.tw/find/-------------.html?wd=${q}`; break;
        }
      });
      // Update all list cards with this anime id
      document.querySelectorAll(`.anime-card[data-id="${anime.id}"] .anime-title`).forEach(el => {
        el.textContent = newName;
      });
    };
    inp.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); }
      if (ev.key === 'Escape') { saved = true; inp.replaceWith(sheetTitle); }
    });
    inp.addEventListener('blur', saveEdit);
  });

  // Copy button
  const copyBtn = el('button', 'anime-sheet-icon-btn');
  copyBtn.title = '複製名稱';
  copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  copyBtn.addEventListener('click', async e => {
    e.stopPropagation();
    await navigator.clipboard.writeText(sheetTitle.textContent).catch(() => {});
    copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>`;
    setTimeout(() => {
      copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    }, 1500);
  });

  // Favorite button
  const isTracked = (S.animeState.tracked || []).includes(anime.id);
  const favBtn = el('button', 'anime-sheet-icon-btn' + (isTracked ? ' on' : ''));
  favBtn.title = '收藏';
  favBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="${isTracked?'currentColor':'none'}" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
  favBtn.addEventListener('click', async e => {
    e.stopPropagation();
    if (!S.animeState.tracked) S.animeState.tracked = [];
    const idx = S.animeState.tracked.indexOf(anime.id);
    if (idx >= 0) {
      S.animeState.tracked.splice(idx, 1);
      delete S.animeState.trackedData[anime.id];
      favBtn.classList.remove('on');
      favBtn.querySelector('svg').setAttribute('fill', 'none');
      // Sync list card star
      document.querySelectorAll(`.anime-card[data-id="${anime.id}"] .anime-star`).forEach(s => {
        s.classList.remove('on');
        s.querySelector('svg')?.setAttribute('fill', 'none');
      });
    } else {
      S.animeState.tracked.unshift(anime.id);
      let wd = -1;
      try {
        const r = await fetch(`https://api.bgm.tv/subject/${anime.id}`, {
          headers: { 'User-Agent': 'NeoCast/1.0 (https://github.com/room1985/neocast)' }
        });
        const d = await r.json();
        if (d.air_weekday) wd = d.air_weekday === 7 ? 0 : d.air_weekday;
        else if (d.date) wd = new Date(d.date).getDay();
      } catch(_) {}
      S.animeState.trackedData[anime.id] = {
        id: anime.id, name: anime.name, name_cn: anime.name_cn,
        images: anime.images, rating: anime.rating, eps: anime.eps,
        air_weekday: wd
      };
      favBtn.classList.add('on');
      favBtn.querySelector('svg').setAttribute('fill', 'currentColor');
      // Sync list card star
      document.querySelectorAll(`.anime-card[data-id="${anime.id}"] .anime-star`).forEach(s => {
        s.classList.add('on');
        s.querySelector('svg')?.setAttribute('fill', 'currentColor');
      });
    }
    lsSave();
  });

  // Close button
  const closeBtn = el('button', 'anime-sheet-icon-btn');
  closeBtn.title = '關閉';
  closeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  closeBtn.addEventListener('click', closeSheet);

  btnGroup.appendChild(editBtn);
  btnGroup.appendChild(copyBtn);
  btnGroup.appendChild(favBtn);
  btnGroup.appendChild(closeBtn);

  metaRow.appendChild(metaWrap);
  metaRow.appendChild(btnGroup);

  infoWrap.appendChild(sheetTitle);
  infoWrap.appendChild(metaRow);
  sheet.appendChild(infoWrap);

  // 4 link buttons (placed BEFORE summary so visible immediately)
  const linkWrap = el('div', 'anime-sheet-btns');
  const linkDefs = [
    { label: 'Bangumi', url: `https://bgm.tv/subject/${anime.id}` },
    { label: '動畫瘋', url: '' },
    { label: 'YouTube', url: '' },
    { label: '劇迷',   url: '' },
  ];
  linkDefs.forEach(({ label, url }) => {
    const a = el('a', 'anime-sheet-link-btn', label);
    a.href = url || '#';
    a.target = '_blank'; a.rel = 'noopener';
    a.dataset.label = label;
    linkWrap.appendChild(a);
  });
  sheet.appendChild(linkWrap);

  // Summary — 5 lines collapsed, More to expand
  const summaryWrap = el('div', 'anime-sheet-summary-wrap');
  const summaryEl = el('div', 'anime-sheet-summary collapsed', '載入中…');
  const moreBtn = el('button', 'anime-sheet-more-btn', 'More ▾');
  let expanded = false;
  moreBtn.addEventListener('click', () => {
    expanded = !expanded;
    summaryEl.classList.toggle('collapsed', !expanded);
    moreBtn.textContent = expanded ? 'Less ▴' : 'More ▾';
  });
  summaryWrap.appendChild(summaryEl);
  summaryWrap.appendChild(moreBtn);
  sheet.appendChild(summaryWrap);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => { overlay.classList.add('open'); sheet.classList.add('open'); });
  overlay.addEventListener('click', e => { if (e.target === overlay) closeSheet(); });

  // Fetch full data
  try {
    const res = await fetch(`https://api.bgm.tv/subject/${anime.id}`, {
      headers: { 'User-Agent': 'NeoCast/1.0 (https://github.com/room1985/neocast)' }
    });
    const data = await res.json();
    const rawSummary = data.summary || '（暫無故事大綱）';
    const twSummary  = await toTW(rawSummary);
    const rawTitle   = data.name_cn || anime.name_cn || anime.name;
    const twTitle    = await toTW(rawTitle);
    summaryEl.textContent = twSummary;

    // Only update title if no custom name set
    if (!S.animeState.customNames?.[anime.id]) {
      sheetTitle.textContent = twTitle;
    }

    // Update eps badge from API (eps_count is more accurate)
    const epsCount = data.eps_count || data.eps || 0;
    if (epsCount) {
      epsBadge.textContent = `共 ${epsCount} 集`;
      epsBadge.style.display = '';
    }
    // Also update list card eps badge if it was missing
    if (epsCount) {
      document.querySelectorAll(`.anime-card[data-id="${anime.id}"] .anime-meta`).forEach(metaEl => {
        let epsBadgeCard = metaEl.querySelector('.badge-eps');
        if (!epsBadgeCard) {
          epsBadgeCard = el('span', 'anime-card-badge badge-eps', `共 ${epsCount} 集`);
          metaEl.appendChild(epsBadgeCard);
        } else {
          epsBadgeCard.textContent = `共 ${epsCount} 集`;
        }
      });
    }

    // Update link URLs
    const displayName = S.animeState.customNames?.[anime.id] || twTitle;
    const q = encodeURIComponent(displayName);
    linkWrap.querySelectorAll('.anime-sheet-link-btn').forEach(a => {
      switch(a.dataset.label) {
        case '動畫瘋': a.href = `https://ani.gamer.com.tw/search.php?keyword=${q}`; break;
        case 'YouTube': a.href = `https://www.youtube.com/results?search_query=${q}`; break;
        case '劇迷':   a.href = `https://gimyai.tw/find/-------------.html?wd=${q}`; break;
      }
    });
  } catch(_) {
    summaryEl.textContent = '無法載入故事大綱';
  }
}

/* ─────────────────────────────────────
   MOBILE LAYOUT — Paged System
───────────────────────────────────── */

// Available widget types for mobile pages
const MOBILE_WIDGET_TYPES = {
  shortcuts: { label: '捷徑',   icon: '⭐' },
  news:      { label: '即時新聞', icon: '📰' },
  clock:     { label: '時鐘',   icon: '🕐' },
  stickies:  { label: '便利貼', icon: '📝' },
  anime:     { label: '動畫追蹤', icon: '🎌' }
};

function buildMobileWidgetContent(widgetType, container) {
  if (widgetType === 'shortcuts') {
    const inner = el('div', 'sc-inner');
    inner.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;';
    container.appendChild(inner);
    renderShortcutsWidget(inner);
  } else if (widgetType === 'news') {
    const inner = el('div', 'mobile-news-inner');
    container.appendChild(inner);
    renderMobileNews(inner);
  } else if (widgetType === 'clock') {
    const body = el('div', 'clock-body');
    body.style.cssText = 'height:180px;flex-shrink:0;';
    container.appendChild(body);
    const c = new SimpleClock(body);
    clockRefs.push(c);
    c.tick();
    setInterval(() => c.tick(), 1000);
    if (weatherCache.text) c.updateWeather(weatherCache.text);
  } else if (widgetType === 'stickies') {
    const inner = el('div', 'stickies-inner');
    inner.style.cssText = 'position:relative;flex:1;min-height:0;overflow:hidden;';
    container.appendChild(inner);
    renderStickiesWidget(inner);
  } else if (widgetType === 'anime') {
    const inner = el('div', 'anime-inner');
    inner.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;min-height:0;';
    container.appendChild(inner);
    renderAnimeWidget(inner);
  }
}

function renderMobileNews(container) {
  container.innerHTML = '';
  container.className = 'mobile-news-inner';

  // News header: [title] [中文] [↻] ............. [replace stays in panel corner]
  const head = el('div', 'news-head');
  head.style.cssText = 'justify-content:flex-start;gap:6px;padding-right:36px;';

  const ttl = el('div', 'w-title', S.news.title || '即時新聞');

  const langPill = el('button', 'pill', S.news.lang === 'zh-TW' ? '中文' : 'EN');
  langPill.style.cssText = 'font-size:.65rem;padding:2px 7px;flex-shrink:0;';
  langPill.addEventListener('click', () => {
    S.news.lang = S.news.lang === 'zh-TW' ? 'en' : 'zh-TW';
    langPill.textContent = S.news.lang === 'zh-TW' ? '中文' : 'EN';
    lsSave();
    fetchNews(true);
  });

  const refBtn = el('button', 'w-btn');
  refBtn.id = 'mobile-news-ref-btn';
  refBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="14" height="14"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
  refBtn.addEventListener('click', () => {
    refBtn.classList.add('spin');
    fetchNews(true).finally(() => refBtn.classList.remove('spin'));
  });

  head.appendChild(ttl);
  head.appendChild(langPill);
  head.appendChild(refBtn);
  container.appendChild(head);

  // Keywords with filter tabs
  const kws = el('div', 'news-kws');

  const allTab = el('span', 'kw-tag' + (S.news.activeKw === 'all' ? ' on' : ''), '全部');
  allTab.addEventListener('click', () => {
    S.news.activeKw = 'all';
    renderMobileNews(container);
  });
  kws.appendChild(allTab);

  S.news.keywords.forEach(kw => {
    const t = el('span', 'kw-tag' + (S.news.activeKw === kw ? ' on' : ''), esc(kw));
    t.addEventListener('click', () => {
      S.news.activeKw = kw;
      renderMobileNews(container);
    });
    kws.appendChild(t);
  });
  container.appendChild(kws);

  // News list filtered
  const filtered = S.news.activeKw === 'all'
    ? S.news.items
    : S.news.items.filter(i => i.kw === S.news.activeKw);

  const list = el('div', 'news-list');
  list.style.cssText = 'overflow-y:auto;flex:1;padding:0 14px 12px;';
  container.appendChild(list);

  if (!filtered.length) {
    list.innerHTML = '<div class="news-empty"><p>尚無新聞<br>點擊 ↻ 載入</p></div>';
  } else {
    filtered.forEach(item => {
      const card = el('div', 'news-card');
      card.innerHTML = `
        <div class="nc-kw">${esc(item.kw||'')}</div>
        <div class="nc-title">${esc(item.title||'')}</div>
        <div class="nc-foot">
          <span class="nc-meta">${esc(item.source||'')}${item.date?' · '+item.date:''}</span>
          ${item.link?`<a class="nc-link" href="${esc(item.link)}" target="_blank" rel="noopener">閱讀 →</a>`:''}
        </div>`;
      list.appendChild(card);
    });
  }
}

function initMobileLayout() {
  const container = $('mobile-layout');
  if (!container) return;
  container.innerHTML = '';

  // Ensure first page is always shortcuts
  if (!S.mobilePages.length || S.mobilePages[0].widget !== 'shortcuts') {
    S.mobilePages = [{ id: 'shortcuts', widget: 'shortcuts' }, ...S.mobilePages.filter(p => p.widget !== 'shortcuts')];
  }

  // ── Fixed clock at top ──
  const clockWrap = el('div', 'mobile-clock-wrap');
  const clockBody = el('div', 'clock-body');
  clockWrap.appendChild(clockBody);
  container.appendChild(clockWrap);
  const mClock = new SimpleClock(clockBody);
  clockRefs.push(mClock);
  mClock.tick();
  setInterval(() => mClock.tick(), 1000);
  if (weatherCache.text) mClock.updateWeather(weatherCache.text);

  // ── Swipe area ──
  const swipeArea = el('div', 'mobile-swipe-area');
  container.appendChild(swipeArea);

  // ── Dots + add button ──
  const dotsBar = el('div', 'mobile-dots-bar');
  container.appendChild(dotsBar);

  // Render pages and dots
  function renderPages() {
    swipeArea.innerHTML = '';
    dotsBar.innerHTML   = '';

    S.mobilePages.forEach((page, idx) => {
      // Page panel
      const panel = el('div', 'mobile-page-panel');
      if (idx === S.mobilePageIdx) panel.classList.add('active');

      // Widget content
      buildMobileWidgetContent(page.widget, panel);

      // Replace widget button - only visible in edit mode
      const replaceBtn = el('button', 'mobile-page-replace-btn hidden');
      replaceBtn.title = '更換小工具';
      replaceBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`;
      replaceBtn.addEventListener('click', () => openMobileWidgetPicker(idx));
      panel.appendChild(replaceBtn);

      swipeArea.appendChild(panel);

      // Dot
      const dot = el('div', 'mobile-dot' + (idx === S.mobilePageIdx ? ' active' : ''));
      dot.title = idx === 0 ? '捷徑（不可刪除）' : '長按刪除';

      // Long press to delete (not first page)
      if (idx > 0) {
        let lpTimer = null;
        dot.addEventListener('touchstart', () => {
          lpTimer = setTimeout(() => {
            if (confirm(`刪除第 ${idx+1} 頁？`)) {
              S.mobilePages.splice(idx, 1);
              if (S.mobilePageIdx >= S.mobilePages.length) S.mobilePageIdx = S.mobilePages.length - 1;
              lsSave();
              renderPages();
            }
          }, 600);
        }, { passive: true });
        dot.addEventListener('touchend', () => clearTimeout(lpTimer), { passive: true });
        dot.addEventListener('mousedown', () => {
          lpTimer = setTimeout(() => {
            if (confirm(`刪除第 ${idx+1} 頁？`)) {
              S.mobilePages.splice(idx, 1);
              if (S.mobilePageIdx >= S.mobilePages.length) S.mobilePageIdx = S.mobilePages.length - 1;
              lsSave();
              renderPages();
            }
          }, 600);
        });
        dot.addEventListener('mouseup', () => clearTimeout(lpTimer));
      }

      dot.addEventListener('click', () => {
        S.mobilePageIdx = idx;
        renderPages();
      });

      dotsBar.appendChild(dot);
    });

    // Add page button - hidden by default, shown in edit mode
    const addBtn = el('button', 'mobile-add-page-btn hidden', '＋');
    addBtn.title = '新增頁面';
    addBtn.addEventListener('click', () => {
      const newPage = { id: uid(), widget: null };
      S.mobilePages.push(newPage);
      S.mobilePageIdx = S.mobilePages.length - 1;
      lsSave();
      renderPages();
      openMobileWidgetPicker(S.mobilePageIdx);
    });
    dotsBar.appendChild(addBtn);

    // Sync edit mode state after rebuild
    if (S.editMode) {
      document.querySelectorAll('.mobile-page-replace-btn').forEach(b => b.classList.remove('hidden'));
      addBtn.classList.remove('hidden');
    }

    // Scroll active page into view
    const activePanels = swipeArea.querySelectorAll('.mobile-page-panel');
    if (activePanels[S.mobilePageIdx]) {
      activePanels[S.mobilePageIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
    }
  }

  // Touch swipe — only trigger when horizontal dominates
  let touchStartX = 0;
  let touchStartY = 0;
  swipeArea.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  swipeArea.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    // Only switch page if horizontal movement is dominant and significant
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0 && S.mobilePageIdx < S.mobilePages.length - 1) S.mobilePageIdx++;
    else if (dx > 0 && S.mobilePageIdx > 0) S.mobilePageIdx--;
    renderPages();
  }, { passive: true });

  renderPages();

  // Expose rerenderPages globally for news refresh
  window._mobileRenderPages = renderPages;
}

/* Mobile widget picker modal */
function openMobileWidgetPicker(pageIdx) {
  // All widget types except clock (fixed at top) and shortcuts (fixed page 1)
  const choices = Object.entries(MOBILE_WIDGET_TYPES).filter(([key]) => {
    if (key === 'clock') return false;     // clock fixed at top
    if (key === 'shortcuts' && pageIdx === 0) return false; // shortcuts fixed page 1
    return true;
  });

  const overlay = el('div', 'mobile-picker-overlay');
  overlay.innerHTML = `
    <div class="mobile-picker-box glass">
      <div class="mobile-picker-title">選擇小工具</div>
      <div class="mobile-picker-list"></div>
      <button class="bcx mobile-picker-cancel">取消</button>
    </div>`;

  const list = overlay.querySelector('.mobile-picker-list');
  choices.forEach(([key, meta]) => {
    const item = el('div', 'mobile-picker-item');
    item.innerHTML = `<span class="awp-icon">${meta.icon}</span><span>${meta.label}</span>`;
    item.addEventListener('click', () => {
      S.mobilePages[pageIdx].widget = key;
      lsSave();
      document.body.removeChild(overlay);
      if (window._mobileRenderPages) window._mobileRenderPages();
    });
    list.appendChild(item);
  });

  overlay.querySelector('.mobile-picker-cancel').addEventListener('click', () => {
    if (!S.mobilePages[pageIdx].widget) {
      S.mobilePages.splice(pageIdx, 1);
      if (S.mobilePageIdx >= S.mobilePages.length) S.mobilePageIdx = S.mobilePages.length - 1;
      lsSave();
      if (window._mobileRenderPages) window._mobileRenderPages();
    }
    document.body.removeChild(overlay);
  });

  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.querySelector('.mobile-picker-cancel').click();
  });
  document.body.appendChild(overlay);
}

/* ─────────────────────────────────────
   RENDER ALL
───────────────────────────────────── */
function renderAll() {
  rerenderSc();
  renderNewsKws();
  renderNewsItems();
  const stickyBody = document.querySelector('.widget[data-wid="stickies"] .stickies-inner');
  if (stickyBody) renderStickiesWidget(stickyBody);
  const mobileStickyBody = document.querySelector('#mobile-layout .stickies-inner');
  if (mobileStickyBody) renderStickiesWidget(mobileStickyBody);
  const animeBody = document.querySelector('.widget[data-wid="anime"] .anime-inner');
  if (animeBody) renderAnimeWidget(animeBody);
  const mobileAnimeBody = document.querySelector('#mobile-layout .anime-inner');
  if (mobileAnimeBody) renderAnimeWidget(mobileAnimeBody);
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
  if (S.widgets.clock?.visible     !== false) buildClockWidget();
  if (S.widgets.shortcuts?.visible !== false) buildShortcutsWidget();
  if (S.widgets.news?.visible      !== false) buildNewsWidget();
  if (S.widgets.stickies?.visible  === true)  buildStickiesWidget();
  if (S.widgets.anime?.visible     === true)  buildAnimeWidget();
  initMobileLayout();

  // Search + voice
  initSearch();
  initLockBtn();
  initWeather();

  // Context menu
  initCtx();

  // Buttons
  $('edit-btn').addEventListener('click', () => setEditMode(!S.editMode));
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

  // Reset layout
  $('cfg-reset-layout').addEventListener('click', () => {
    if (!confirm('重置小工具佈局？位置和大小會恢復預設，捷徑和設定不受影響。')) return;
    S.widgets = {
      clock:     { col:0, row:0, w:6, h:2, visible:true },
      shortcuts: { col:6, row:2, w:6, h:5, visible:true },
      news:      { col:0, row:2, w:6, h:5, visible:true }
    };
    S.mobilePages = [{ id: 'shortcuts', widget: 'shortcuts' }];
    S.mobilePageIdx = 0;
    lsSave();
    closeModal('m-cfg');
    toast('佈局已重置，請重新整理頁面 ✓');
  });

  // Auto-locate button
  $('cfg-locate').addEventListener('click', async () => {
    const statusEl = $('cfg-locate-status');
    statusEl.textContent = '定位中…';
    try {
      const { lat, lon } = await geoLocate();
      const city = await reverseGeocode(lat, lon);
      S.cfg.weatherLat = lat;
      S.cfg.weatherLon = lon;
      $('cfg-city').value = city;
      statusEl.textContent = `✓ ${city}`;
      lsSave();
    } catch(e) {
      statusEl.textContent = '定位失敗，請手動輸入';
    }
  });

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
