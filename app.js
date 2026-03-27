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
const NEWS_CACHE_MS = 4 * 60 * 60 * 1000; // 4 小時
const NEWSDATA_PROXY = 'https://autumn-sunset-863b.heineken6may.workers.dev/';
const RSS2JSON = 'https://api.rss2json.com/v1/api.json?rss_url='; // fallback
const NEWS_DEFAULT_IMG = 'https://cnews.com.tw/wp-content/uploads/2023/08/2023-08-30_18-34-44_686542.jpg';

/* ─────────────────────────────────────
   STATE
───────────────────────────────────── */
let S = {
  shortcuts:  [],
  groups:     [],
  stickies:   [],
  stickyTags: [],          // 所有標籤 string[]
  activeStickyTag: 'all',  // 'all' 或 tag 字串
  stickyLocked:   false,   // 禁用編輯/拖曳（不寫 Gist，純 UI 狀態）
  stickySearch:   '',      // 目前搜尋關鍵字
  widgets: {
    clock:     { col:0, row:0, w:6, h:2, visible:false },
    shortcuts: { col:6, row:2, w:6, h:5, visible:false },
    news:      { col:0, row:2, w:6, h:5, visible:false },
    youtube:   { col:12, row:6, w:6, h:8, visible:false }
  },
  news: {
    items:       [],
    fetchedAt:   0,
    kwFetchedAt: {},
    keywords:    [],
    lang:        'zh-TW',
    title:       '即時新聞',
    perKeyword:  2,
    cacheMin:    25,
    activeKw:    'all'
  },
  cfg: {
    token:       '',
    gistId:      '',
    nickname:    '',
    weatherCity: '',
    weatherLat:  null,
    weatherLon:  null,
    ytApiKey:    '',
    newsdataApiKey: ''
  },
  yt: { channels: [], fetchedAt: 0, items: [], groups: [], watched: [], liked: [], oauthToken: null, oauthExpiry: 0 },
  widgetTitles: {},
  editMode:       false,
  activeGroup:    'all',
  privateUnlocked: false,
  ctxTarget:      null,
  animeState:     { offset: 0, genre: '全部', tracked: [], customNames: {}, viewMode: 'list' },
  scEditing:      null,
  dragSc:         null,
  mobilePages:    [],
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

// 只存 localStorage，不觸發自動推送（供 gistPush/gistAutoSync 內部使用）
function lsSaveLocal() {
  try {
    const MAX_BYTES = 3 * 1024 * 1024;
    let ytItems = [...(S.yt.items || [])].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    const buildPayload = () => ({
      shortcuts:  S.shortcuts,
      groups:     S.groups,
      stickies:   S.stickies,
      stickyTags: S.stickyTags || [],
      activeStickyTag: S.activeStickyTag || 'all',
      widgets:    S.widgets,
      news:       { items: S.news.items, fetchedAt: S.news.fetchedAt, kwFetchedAt: S.news.kwFetchedAt || {}, keywords: S.news.keywords, lang: S.news.lang, title: S.news.title, perKeyword: S.news.perKeyword, cacheMin: S.news.cacheMin },
      cfg:        S.cfg,
      yt:         { channels: S.yt.channels, groups: S.yt.groups, watched: S.yt.watched || [], liked: S.yt.liked || [], oauthToken: S.yt.oauthToken, oauthExpiry: S.yt.oauthExpiry, items: ytItems },
      widgetTitles: S.widgetTitles,
      mobilePages: S.mobilePages,
      animeState: { genre: S.animeState.genre, tracked: S.animeState.tracked, trackedData: S.animeState.trackedData, customNames: S.animeState.customNames, viewMode: S.animeState.viewMode }
    });
    let json = JSON.stringify(buildPayload());
    while (new Blob([json]).size > MAX_BYTES && ytItems.length > 0) {
      ytItems.pop();
      json = JSON.stringify(buildPayload());
    }
    localStorage.setItem(LS_KEY, json);
  } catch(_) {}
}

function lsSave() {
  try {
    // yt.items 按 publishedAt 新→舊排序，超過 3MB 就截掉最舊的
    const MAX_BYTES = 3 * 1024 * 1024;
    let ytItems = [...(S.yt.items || [])].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    const buildPayload = () => ({
      shortcuts:  S.shortcuts,
      groups:     S.groups,
      stickies:   S.stickies,
      stickyTags: S.stickyTags || [],
      activeStickyTag: S.activeStickyTag || 'all',
      widgets:    S.widgets,
      news:       { items: S.news.items, fetchedAt: S.news.fetchedAt, kwFetchedAt: S.news.kwFetchedAt || {}, keywords: S.news.keywords, lang: S.news.lang, title: S.news.title, perKeyword: S.news.perKeyword, cacheMin: S.news.cacheMin },
      cfg:        S.cfg,
      yt:         { channels: S.yt.channels, groups: S.yt.groups, watched: S.yt.watched || [], liked: S.yt.liked || [], oauthToken: S.yt.oauthToken, oauthExpiry: S.yt.oauthExpiry, items: ytItems },
      widgetTitles: S.widgetTitles,
      mobilePages: S.mobilePages,
      animeState: { genre: S.animeState.genre, tracked: S.animeState.tracked, trackedData: S.animeState.trackedData, customNames: S.animeState.customNames, viewMode: S.animeState.viewMode }
    });

    let json = JSON.stringify(buildPayload());
    while (new Blob([json]).size > MAX_BYTES && ytItems.length > 0) {
      ytItems.pop(); // 移除最舊的
      json = JSON.stringify(buildPayload());
    }

    localStorage.setItem(LS_KEY, json);
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
    if (d.stickyTags)  S.stickyTags = d.stickyTags;
    if (d.activeStickyTag) S.activeStickyTag = d.activeStickyTag;
    if (d.widgets)     Object.assign(S.widgets, d.widgets);
    if (d.news)        Object.assign(S.news, d.news);
    if (d.cfg)         Object.assign(S.cfg, d.cfg);
    // 確保 _lastModified 有被還原
    if (d.cfg?._lastModified) S.cfg._lastModified = d.cfg._lastModified;
    if (d.yt)            Object.assign(S.yt, d.yt);
    if (!S.yt.watched) S.yt.watched = [];
    if (!S.yt.liked)   S.yt.liked   = [];
    // Migrate ch.group (string) → ch.groups (array)
    if (S.yt.channels) S.yt.channels.forEach(ch => {
      if (ch.group && !ch.groups) { ch.groups = [ch.group]; delete ch.group; }
      if (!ch.groups) ch.groups = [];
    });
    if (d.widgetTitles)  Object.assign(S.widgetTitles, d.widgetTitles);
    if (d.mobilePages)   S.mobilePages = d.mobilePages;
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
  shortcuts:       S.shortcuts,
  groups:          S.groups,
  stickies:        S.stickies,
  stickyTags:      S.stickyTags || [],
  widgets:         S.widgets,
  newsKeywords:    S.news.keywords,
  newsLang:        S.news.lang,
  newsKwFetchedAt: S.news.kwFetchedAt || {},
  animeState:      { tracked: S.animeState.tracked, trackedData: S.animeState.trackedData, customNames: S.animeState.customNames },
  yt:              { channels: S.yt.channels, groups: S.yt.groups, watched: S.yt.watched || [], liked: S.yt.liked || [], oauthToken: S.yt.oauthToken, oauthExpiry: S.yt.oauthExpiry },
  lastModified:    Date.now()
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
    if (!gistId) { S.cfg.gistId = data.id; lsSaveLocal(); $('cfg-gid').value = data.id; }
    S.cfg._lastModified = Date.now(); lsSaveLocal();
    if (!silent) toast('已同步到 Gist ✓');
    else toast('已自動同步 ✓');
  } catch(e) {
    if (!silent) toast('同步失敗：' + e.message, 'err');
    else toast('自動同步失敗：' + e.message, 'err');
  } finally {
    if (!silent) $('sync-btn').classList.remove('spin');
  }
}


// yt 同步只更新設定欄位，保留本地的 fetchedAt 和 items 快取
function mergeRemoteYt(remoteYt) {
  if (!remoteYt) return;
  if (remoteYt.channels)   S.yt.channels   = remoteYt.channels;
  if (remoteYt.groups)     S.yt.groups     = remoteYt.groups;
  if (remoteYt.watched)    S.yt.watched    = remoteYt.watched;
  if (remoteYt.liked)      S.yt.liked      = remoteYt.liked;
  if (remoteYt.oauthToken !== undefined) S.yt.oauthToken = remoteYt.oauthToken;
  if (remoteYt.oauthExpiry !== undefined) S.yt.oauthExpiry = remoteYt.oauthExpiry;
  // 不覆蓋 fetchedAt 和 items，保護本地快取
}

async function gistPull() {
  const { token, gistId } = S.cfg;
  if (!token) { toast('請先填入 GitHub Token', 'err'); return false; }
  if (!gistId) { toast('請先填入 Gist ID', 'err'); return false; }
  try {
    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.raw+json' }
    });
    if (res.status === 401) { toast('Pull 失敗：Token 無效或已過期', 'err'); return false; }
    if (res.status === 403) { toast('Pull 失敗：Token 權限不足', 'err'); return false; }
    if (res.status === 404) { toast('Pull 失敗：Gist ID 不存在', 'err'); return false; }
    if (!res.ok) { toast(`Pull 失敗：HTTP ${res.status}`, 'err'); return false; }
    const data = await res.json();
    const fileInfo = data.files?.['neocast.json'];
    if (!fileInfo) { toast('Pull 失敗：Gist 裡找不到 neocast.json', 'err'); return false; }
    const raw = fileInfo.content;
    if (!raw) { toast('Pull 失敗：Gist 內容是空的', 'err'); return false; }
    const d = JSON.parse(raw);
    if (d.shortcuts)       S.shortcuts = d.shortcuts;
    if (d.groups)          S.groups    = d.groups;
    if (d.stickies)        S.stickies  = d.stickies;
    if (d.widgets)         Object.assign(S.widgets, d.widgets);
    if (d.newsKeywords)    S.news.keywords    = d.newsKeywords;
    if (d.newsLang)        S.news.lang        = d.newsLang;
    if (d.newsKwFetchedAt) S.news.kwFetchedAt = Object.assign(S.news.kwFetchedAt || {}, d.newsKwFetchedAt);
    if (d.animeState)      Object.assign(S.animeState, d.animeState);
    mergeRemoteYt(d.yt);
    if (d.stickyTags)      S.stickyTags = d.stickyTags;
    if (d.lastModified)    S.cfg._lastModified = d.lastModified;
    lsSaveLocal();
    renderAll();
    return true;
  } catch(e) {
    toast('Pull 失敗：' + e.message, 'err');
    return false;
  }
}

// ── 自動同步：比較 lastModified，雲端較新才拉取 ──
let _autoSyncBusy = false;
let _autoSyncLastRun = 0;
const AUTO_SYNC_COOLDOWN = 2 * 60 * 1000; // 最短間隔 2 分鐘

async function gistAutoSync() {
  const { token, gistId } = S.cfg;
  if (!token || !gistId || _autoSyncBusy) return;
  if (Date.now() - _autoSyncLastRun < AUTO_SYNC_COOLDOWN) return;
  _autoSyncBusy = true;
  _autoSyncLastRun = Date.now();
  try {
    const metaRes = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
    });
    if (!metaRes.ok) return;
    const meta = await metaRes.json();
    const remoteUpdated = new Date(meta.updated_at).getTime();
    const localTs = S.cfg._lastModified || 0;
    if (remoteUpdated <= localTs) return;
    const rawRes = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.raw+json' }
    });
    if (!rawRes.ok) return;
    const data = await rawRes.json();
    const raw = data.files?.['neocast.json']?.content;
    if (!raw) return;
    const remote = JSON.parse(raw);
    const remoteTs = remote.lastModified || remoteUpdated;
    if (remote.shortcuts)       S.shortcuts = remote.shortcuts;
    if (remote.groups)          S.groups    = remote.groups;
    if (remote.stickies)        S.stickies  = remote.stickies;
    if (remote.widgets)         Object.assign(S.widgets, remote.widgets);
    if (remote.newsKeywords)    S.news.keywords    = remote.newsKeywords;
    if (remote.newsLang)        S.news.lang        = remote.newsLang;
    if (remote.newsKwFetchedAt) S.news.kwFetchedAt = Object.assign(S.news.kwFetchedAt || {}, remote.newsKwFetchedAt);
    if (remote.animeState)      Object.assign(S.animeState, remote.animeState);
    mergeRemoteYt(remote.yt);
    if (remote.stickyTags)      S.stickyTags = remote.stickyTags;
    S.cfg._lastModified = remoteTs;
    lsSaveLocal();
    renderAll();
    toast('已自動同步雲端資料 ✓');
  } catch(e) { toast('自動同步失敗：' + e.message, 'err'); }
  finally { _autoSyncBusy = false; }
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
  document.querySelectorAll('.w-pencil-btn').forEach(b => b.classList.toggle('hidden', !on));
  const addPanel = $('add-widget-panel');
  const isMobile = window.innerWidth < 768;
  if (addPanel) addPanel.classList.toggle('hidden', !on || isMobile);
  if (on && !isMobile) renderAddWidgetPanel();

  // Mobile: show/hide replace buttons and add-page button
  document.querySelectorAll('.mobile-panel-btns').forEach(b => b.classList.toggle('hidden', !on));
  document.querySelectorAll('.mobile-page-replace-btn').forEach(b => b.classList.toggle('hidden', !on));
  const addPageBtn = document.querySelector('.mobile-add-page-btn');
  if (addPageBtn) addPageBtn.classList.toggle('hidden', !on);

  // 手機版：發光邊框加在 active panel，+ 編輯模式提示列
  const mobileLayout = document.getElementById('mobile-layout');
  if (mobileLayout) {
    document.querySelectorAll('.mobile-page-panel').forEach(p => {
      p.classList.toggle('mobile-editing', on);
      // 移除舊的 overlay
      p.querySelector('.mobile-edit-overlay')?.remove();
      if (on) {
        const overlay = document.createElement('div');
        overlay.className = 'mobile-edit-overlay';
        p.appendChild(overlay);
      }
    });
    let editBar = document.getElementById('mobile-edit-bar');
    if (on) {
      if (!editBar) {
        editBar = el('div', '');
        editBar.id = 'mobile-edit-bar';
        editBar.className = 'mobile-edit-bar';
        editBar.textContent = '編輯模式';
        mobileLayout.appendChild(editBar);
      }
    } else {
      editBar?.remove();
    }
  }

  // 編輯模式開啟時，更新便利貼垃圾桶按鈕的亮暗狀態
  if (on) {
    document.querySelectorAll('.widget, .mobile-page-panel').forEach(w => {
      if (w._updateDelChecked) w._updateDelChecked();
    });
  }
}

/* Widget meta registry */
const WIDGET_META = {
  clock:     { label: '時鐘',    icon: '🕐' },
  shortcuts: { label: '捷徑',    icon: '⭐' },
  news:      { label: 'AI新聞',  icon: '📰' },
  stickies:  { label: '便利貼',  icon: '📝' },
  anime:     { label: '動畫追蹤', icon: '🎌' },
  youtube:   { label: 'YouTube 訂閱', icon: '▶️' }
};

/* Default positions for when a widget is re-added */
const WIDGET_DEFAULT = {
  clock:     { col:0,  row:0, w:6,  h:2, visible:true },
  shortcuts: { col:6,  row:2, w:6,  h:5, visible:true },
  news:      { col:0,  row:2, w:6,  h:5, visible:true },
  stickies:  { col:12, row:0, w:6,  h:6, visible:true },
  anime:     { col:18, row:0, w:6,  h:8, visible:true },
  youtube:   { col:12, row:6, w:6,  h:8, visible:true }
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
  if (wid === 'youtube')   buildYoutubeWidget();
}

/* ─────────────────────────────────────
   WIDGET FACTORY
───────────────────────────────────── */
// Default titles for each widget
const WIDGET_DEFAULT_TITLES = {
  clock:     '時鐘',
  shortcuts: '捷徑',
  news:      '即時新聞',
  stickies:  '便利貼',
  anime:     '動畫追蹤',
  youtube:   '訂閱更新'
};

function getWidgetTitle(wid, fallback) {
  return S.widgetTitles?.[wid] || fallback || WIDGET_DEFAULT_TITLES[wid] || wid;
}

function makeWidget(wid, defaultTitle, bodyEl, extraClass = '') {
  const w   = el('div', 'widget ' + extraClass);
  w.dataset.wid = wid;

  const head = el('div', 'w-head');

  const ttl = el('div', 'w-title', getWidgetTitle(wid, defaultTitle));
  ttl.dataset.wid = wid;
  head.appendChild(ttl);

  // Pencil edit button — only visible in edit mode
  const pencilBtn = el('button', 'w-pencil-btn hidden');
  pencilBtn.title = '自訂標題';
  pencilBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  pencilBtn.addEventListener('click', e => {
    e.stopPropagation();
    startTitleEdit(ttl, wid, defaultTitle, pencilBtn);
  });
  head.appendChild(pencilBtn);

  // Delete button (hidden unless in edit mode)
  const delBtn = el('button', 'w-delete-btn hidden', '✕');
  delBtn.title = '移除 Widget';
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (confirm(`移除「${getWidgetTitle(wid, defaultTitle)}」Widget？`)) {
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

function startTitleEdit(ttlEl, wid, defaultTitle, pencilBtn) {
  if (ttlEl.querySelector('input')) return; // already editing
  const current = ttlEl.textContent;
  ttlEl.textContent = '';
  const inp = document.createElement('input');
  inp.className = 'w-title-input';
  inp.type = 'search';
  inp.value = current;
  inp.autocomplete = 'off';
  inp.setAttribute('autocomplete', 'off');
  inp.name = 'widget-title';
  inp.setAttribute('inputmode', 'text');
  ttlEl.appendChild(inp);
  if (pencilBtn) pencilBtn.style.display = 'none';
  inp.focus();
  inp.select();

  const save = () => {
    const val = inp.value.trim();
    const def = WIDGET_DEFAULT_TITLES[wid] || defaultTitle;
    if (val && val !== def) {
      if (!S.widgetTitles) S.widgetTitles = {};
      S.widgetTitles[wid] = val;
    } else {
      delete S.widgetTitles?.[wid];
    }
    lsSave();
    ttlEl.textContent = getWidgetTitle(wid, defaultTitle);
    if (pencilBtn) pencilBtn.style.display = '';
    // Update mobile panel title if exists
    document.querySelectorAll(`.mobile-panel-title[data-wid="${wid}"]`).forEach(el => {
      const meta = MOBILE_WIDGET_TYPES[wid];
      el.textContent = (meta?.icon ? meta.icon + ' ' : '') + getWidgetTitle(wid, defaultTitle);
    });
  };
  inp.addEventListener('blur', save);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
    if (e.key === 'Escape') {
      inp.value = current;
      inp.blur();
    }
  });
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
const PRIVATE_GROUP_ID   = '__private__';
const PRIVATE_STICKY_TAG = '__private_sticky__';
const UNCLASSIFIED_ID    = '__unclassified__';

let grpEditMode = false; // 捷徑分類管理模式

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
    // 更新所有便利貼 tagBar
    document.querySelectorAll('.sticky-tag-bar').forEach(bar => {
      const body = bar.closest('.stickies-inner');
      if (body?._renderTagBar) body._renderTagBar();
    });
    // 重新渲染動畫 widget（顯示裏番 tab）
    document.querySelectorAll('.anime-inner').forEach(inner => {
      renderAnimeWidget(inner, inner.closest('[data-widget="anime"]')?.querySelector('.anime-cfg-btn') || null);
    });
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
    // 鎖定時若正在看私人便利貼，切回全部
    if (S.activeStickyTag === PRIVATE_STICKY_TAG) {
      S.activeStickyTag = 'all';
    }
    rerenderSc();
    // 更新所有便利貼 tagBar
    document.querySelectorAll('.sticky-tag-bar').forEach(bar => {
      const body = bar.closest('.stickies-inner');
      if (body?._renderTagBar) body._renderTagBar();
    });
    // 重新渲染便利貼（隱藏私人項目）
    document.querySelectorAll('.stickies-inner').forEach(body => {
      renderStickiesWidget(body);
    });
    // 重新渲染動畫 widget（隱藏裏番 tab）
    document.querySelectorAll('.anime-inner').forEach(inner => {
      renderAnimeWidget(inner, inner.closest('[data-widget="anime"]')?.querySelector('.anime-cfg-btn') || null);
    });
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
  const w = makeWidget('shortcuts', '捷徑', body, 'sc-widget');
  w.querySelector('.w-body')?.remove();
  w.insertBefore(body, w.querySelector('.resize-handle'));

  // ⚙ 管理分類按鈕放在 w-head
  const head  = w.querySelector('.w-head');
  const delBtn = w.querySelector('.w-delete-btn');
  const svgCfg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
  const cfgBtn = el('button', 'w-btn sc-grp-cfg-btn');
  cfgBtn.title = '管理分類';
  cfgBtn.innerHTML = svgCfg;
  cfgBtn.addEventListener('click', e => {
    e.stopPropagation();
    grpEditMode = !grpEditMode;
    cfgBtn.classList.toggle('on', grpEditMode);
    cfgBtn.title = grpEditMode ? '完成管理' : '管理分類';
    // 同步手機版按鈕
    document.querySelectorAll('.sc-grp-cfg-btn').forEach(b => {
      b.classList.toggle('on', grpEditMode);
      b.title = grpEditMode ? '完成管理' : '管理分類';
    });
    rerenderShortcuts();
  });
  if (delBtn) head.insertBefore(cfgBtn, delBtn);
  else head.appendChild(cfgBtn);

  renderShortcutsWidget(body);
}

function renderShortcutsWidget(container) {
  container.innerHTML = '';

  // Groups bar
  const bar = el('div', 'sc-groups');

  // 全部（固定，不可刪/改名）
  bar.appendChild(makeGrpTab('all', '全部', false));

  // 未分類（固定，不可刪/改名）
  bar.appendChild(makeGrpTab(UNCLASSIFIED_ID, '未分類', false));

  // 自訂分類
  S.groups.forEach(g => bar.appendChild(makeGrpTab(g.id, g.name, true)));

  // 私人（解鎖時才顯示，不可刪/改名）
  if (S.privateUnlocked) {
    bar.appendChild(makeGrpTab(PRIVATE_GROUP_ID, '私人', false));
  }

  // 管理模式下才顯示 ＋ 新增按鈕
  if (grpEditMode) {
    const addGrpBtn = el('button', 'grp-tab add');
    addGrpBtn.textContent = '＋ 新增';
    addGrpBtn.addEventListener('click', () => openModal('m-grp'));
    bar.appendChild(addGrpBtn);
  }

  // 管理模式下啟用拖曳排序
  if (grpEditMode) initGrpDrag(bar, container);

  container.appendChild(bar);

  // Grid — filter based on activeGroup
  const grid = el('div', 'sc-grid');
  let visible;
  if (S.activeGroup === 'all') {
    visible = S.shortcuts.filter(s => s.groupId !== PRIVATE_GROUP_ID);
  } else if (S.activeGroup === UNCLASSIFIED_ID) {
    visible = S.shortcuts.filter(s => !s.groupId || s.groupId === '');
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

  initScDrag(grid);
}

function makeGrpTab(id, name, editable = false) {
  const isFixed = !editable; // 全部、未分類、私人
  const isOn = S.activeGroup === id;
  const wrap = el('div', 'grp-tab-wrap' + (grpEditMode && editable ? ' edit-mode' : ''));
  wrap.dataset.gid = id;

  const btn = el('button', 'grp-tab' + (isOn ? ' on' : ''), name);

  if (grpEditMode && editable) {
    // 點文字直接 inline 編輯
    btn.addEventListener('click', e => {
      e.stopPropagation();
      startGrpRename(wrap, btn, id, name);
    });
  } else {
    btn.addEventListener('click', () => {
      if (grpEditMode) return; // 固定分類在管理模式下不切換
      S.activeGroup = id; rerenderShortcuts();
    });
  }

  wrap.appendChild(btn);

  // 管理模式下可編輯分類才顯示 ✕
  if (grpEditMode && editable) {
    const x = el('button', 'grp-tab-x');
    x.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="8" height="8"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    x.title = '刪除分類';
    x.addEventListener('click', e => {
      e.stopPropagation();
      if (!confirm(`刪除群組「${name}」？（捷徑不會被刪除）`)) return;
      S.groups    = S.groups.filter(g => g.id !== id);
      S.shortcuts = S.shortcuts.map(s => s.groupId === id ? {...s, groupId:''} : s);
      if (S.activeGroup === id) S.activeGroup = 'all';
      lsSave(); rerenderShortcuts();
    });
    wrap.appendChild(x);
  }

  return wrap;
}

function startGrpRename(wrap, btn, id, oldName) {
  const inp = el('input', 'grp-rename-input');
  inp.type = 'search';
  inp.value = oldName;
  inp.autocomplete = 'new-password';
  inp.spellcheck = false;
  btn.replaceWith(inp);
  inp.focus(); inp.select();

  const save = () => {
    const val = inp.value.trim();
    if (val && val !== oldName) {
      const g = S.groups.find(g => g.id === id);
      if (g) g.name = val;
      lsSave();
    }
    rerenderShortcuts();
  };
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') rerenderShortcuts();
  });
  inp.addEventListener('blur', save);
}

function initGrpDrag(bar, container) {
  // 只拖曳可編輯的分類（editable，有 edit-mode class）
  const editWraps = () => [...bar.querySelectorAll('.grp-tab-wrap.edit-mode')];
  let dragSrcId = null;

  editWraps().forEach(wrap => {
    wrap.draggable = true;

    // Desktop
    wrap.addEventListener('dragstart', e => {
      dragSrcId = wrap.dataset.gid;
      setTimeout(() => wrap.classList.add('grp-dragging'), 0);
      e.dataTransfer.effectAllowed = 'move';
    });
    wrap.addEventListener('dragend', () => {
      wrap.classList.remove('grp-dragging');
      bar.querySelectorAll('.grp-drag-over').forEach(c => c.classList.remove('grp-drag-over'));
      dragSrcId = null;
    });
    wrap.addEventListener('dragover', e => {
      e.preventDefault();
      if (wrap.dataset.gid === dragSrcId) return;
      bar.querySelectorAll('.grp-drag-over').forEach(c => c.classList.remove('grp-drag-over'));
      wrap.classList.add('grp-drag-over');
    });
    wrap.addEventListener('drop', e => {
      e.preventDefault();
      if (!dragSrcId || dragSrcId === wrap.dataset.gid) return;
      const si = S.groups.findIndex(g => g.id === dragSrcId);
      const di = S.groups.findIndex(g => g.id === wrap.dataset.gid);
      if (si < 0 || di < 0) return;
      const [moved] = S.groups.splice(si, 1);
      S.groups.splice(di, 0, moved);
      lsSave(); rerenderShortcuts();
    });

    // Mobile touch
    let touchSrcId = null, ghost = null, startY = 0, startX = 0;
    wrap.addEventListener('touchstart', e => {
      const touch = e.touches[0];
      startX = touch.clientX; startY = touch.clientY;
      touchSrcId = wrap.dataset.gid;
    }, { passive: true });

    const onTouchMove = e => {
      if (!touchSrcId) return;
      const touch = e.touches[0];
      if (!ghost) {
        const dx = touch.clientX - startX, dy = touch.clientY - startY;
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        ghost = wrap.cloneNode(true);
        ghost.className = 'grp-tab-wrap edit-mode grp-ghost';
        ghost.style.cssText = `position:fixed;pointer-events:none;z-index:9999;opacity:.8;`;
        document.body.appendChild(ghost);
        wrap.classList.add('grp-dragging');
      }
      ghost.style.left = (touch.clientX - wrap.offsetWidth / 2) + 'px';
      ghost.style.top  = (touch.clientY - wrap.offsetHeight / 2) + 'px';
      // 找目標
      ghost.style.display = 'none';
      const el2 = document.elementFromPoint(touch.clientX, touch.clientY);
      ghost.style.display = '';
      const targetWrap = el2?.closest('.grp-tab-wrap.edit-mode');
      bar.querySelectorAll('.grp-drag-over').forEach(c => c.classList.remove('grp-drag-over'));
      if (targetWrap && targetWrap !== wrap) targetWrap.classList.add('grp-drag-over');
    };
    const onTouchEnd = e => {
      if (!touchSrcId) return;
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      if (ghost) { ghost.remove(); ghost = null; }
      wrap.classList.remove('grp-dragging');
      const overEl = bar.querySelector('.grp-drag-over');
      bar.querySelectorAll('.grp-drag-over').forEach(c => c.classList.remove('grp-drag-over'));
      if (overEl && overEl !== wrap) {
        const si = S.groups.findIndex(g => g.id === touchSrcId);
        const di = S.groups.findIndex(g => g.id === overEl.dataset.gid);
        if (si >= 0 && di >= 0) {
          const [moved] = S.groups.splice(si, 1);
          S.groups.splice(di, 0, moved);
          lsSave(); rerenderShortcuts();
        }
      }
      touchSrcId = null;
    };
    wrap.addEventListener('touchstart', () => {
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd, { passive: true });
    }, { passive: true });
  });
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

// Shared news edit-tags state (true = delete buttons visible)
let newsEditingTags = false;

function buildNewsWidget() {
  const outer = el('div', 'news-inner');
  outer.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;min-height:0;';
  const w = makeWidget('news', S.news.title || '即時新聞', outer, '');
  w.querySelector('.w-body')?.remove();
  w.insertBefore(outer, w.querySelector('.resize-handle'));
  w.querySelector('.w-title').id = 'news-widget-title';

  // 把 ⚙ 中 ↺ 加到 w-head（標題列），在鉛筆按鈕前
  const wHead = w.querySelector('.w-head');
  const pencilBtn = wHead?.querySelector('.w-pencil-btn');

  const settingsBtn = el('button', 'yt-icon-btn news-settings-btn');
  settingsBtn.title = '新聞設定';
  settingsBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

  const langBtn = el('button', 'yt-icon-btn news-lang-btn');
  langBtn.id = 'news-lang-pill';
  langBtn.title = '切換語言';
  langBtn.textContent = S.news.lang === 'zh-TW' ? '中' : 'EN';
  langBtn.style.fontWeight = '700';
  langBtn.style.fontSize = '12px';
  langBtn.addEventListener('click', () => {
    S.news.lang = S.news.lang === 'zh-TW' ? 'en' : 'zh-TW';
    langBtn.textContent = S.news.lang === 'zh-TW' ? '中' : 'EN';
    lsSave(); fetchNews(true);
  });

  const refBtn = el('button', 'yt-icon-btn');
  refBtn.id = 'news-ref-btn';
  refBtn.title = '重新整理';
  refBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="13" height="13"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
  refBtn.addEventListener('click', () => {
    refBtn.classList.add('spin');
    fetchNews(true).finally(() => refBtn.classList.remove('spin'));
  });

  if (wHead && pencilBtn) {
    wHead.insertBefore(refBtn, pencilBtn);
    wHead.insertBefore(langBtn, refBtn);
    wHead.insertBefore(settingsBtn, langBtn);
  }

  // ── toolbar 保留但隱藏（settings panel 需要 settingsBtn 的 click 事件）──
  const toolbar = el('div', 'news-toolbar');
  toolbar.style.display = 'none';
  outer.appendChild(toolbar);

  // ── Settings panel (hidden by default) ──
  const settingsPanel = el('div', 'news-settings-panel');
  settingsPanel.style.display = 'none';
  settingsPanel.innerHTML = `
    <label class="news-cfg-row">
      <span>每個關鍵字顯示幾則</span>
      <input id="news-cfg-per-kw" type="number" class="news-cfg-input" min="1" max="20" value="${S.news.perKeyword || 2}" autocomplete="off">
    </label>
    <label class="news-cfg-row">
      <span>快取更新頻率</span>
      <select id="news-cfg-cache" class="news-cfg-select">
        <option value="5" ${S.news.cacheMin==5?'selected':''}>5 分鐘</option>
        <option value="15" ${S.news.cacheMin==15?'selected':''}>15 分鐘</option>
        <option value="25" ${S.news.cacheMin==25||!S.news.cacheMin?'selected':''}>25 分鐘</option>
        <option value="60" ${S.news.cacheMin==60?'selected':''}>1 小時</option>
      </select>
    </label>
  `;
  settingsPanel.querySelector('#news-cfg-per-kw').addEventListener('change', e => {
    const v = parseInt(e.target.value) || 2;
    S.news.perKeyword = v; S.news.fetchedAt = 0; lsSave(); fetchNews(true);
  });
  settingsPanel.querySelector('#news-cfg-cache').addEventListener('change', e => {
    S.news.cacheMin = parseInt(e.target.value); lsSave();
  });
  outer.appendChild(settingsPanel);

  settingsBtn.addEventListener('click', () => {
    const open = settingsPanel.style.display !== 'none';
    settingsPanel.style.display = open ? 'none' : '';
    settingsBtn.classList.toggle('active', !open);
    // 開啟設定 = 進入編輯模式；關閉設定 = 退出編輯模式
    newsEditingTags = !open;
    renderNewsKws();
    if (!open) {
      settingsPanel.querySelector('#news-cfg-per-kw').value = S.news.perKeyword || 2;
      settingsPanel.querySelector('#news-cfg-cache').value = S.news.cacheMin || 25;
    }
  });

  // Keywords
  const kws = el('div', 'news-kws');
  kws.id = 'news-kws';
  outer.appendChild(kws);
  renderNewsKws();

  // List
  newsListEl = el('div', 'news-list');
  outer.appendChild(newsListEl);

  renderNewsItems(); // 抓取由 DOMContentLoaded 等 Gist 同步後統一觸發
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
    const wrap = el('span', 'kw-tag-wrap' + (S.news.activeKw === kw ? ' on' : '') + (newsEditingTags ? ' editing' : ''));
    const label = el('span', 'kw-label', esc(kw));
    label.addEventListener('click', () => {
      if (newsEditingTags) return; // don't switch tab while editing
      S.news.activeKw = kw; renderNewsKws(); renderNewsItems();
    });
    const del = el('button', 'kw-del', '✕');
    del.title = '刪除關鍵字';
    del.addEventListener('click', e => {
      e.stopPropagation();
      S.news.keywords = S.news.keywords.filter(k => k !== kw);
      if (S.news.activeKw === kw) S.news.activeKw = 'all';
      lsSave(); S.news.fetchedAt = 0;
      renderNewsKws(); renderNewsItems(); fetchNews(true);
    });
    wrap.appendChild(label);
    wrap.appendChild(del);
    kws.appendChild(wrap);
  });

  // Add keyword button
  const addWrap = el('span', 'kw-add-wrap');
  const addBtn = el('button', 'kw-add-btn', '＋');
  addBtn.title = '新增關鍵字';
  addBtn.addEventListener('click', () => {
    addWrap.innerHTML = '';
    const inp = document.createElement('input');
    inp.className = 'kw-add-input'; inp.type = 'search'; inp.placeholder = '關鍵字'; inp.autocomplete = 'off'; inp.name = 'neocast-kw'; inp.spellcheck = false;
    inp.setAttribute('autocomplete', 'off'); inp.name = 'news-keyword'; inp.setAttribute('inputmode', 'text');
    addWrap.appendChild(inp); inp.focus();
    const doConfirm = () => {
      const val = inp.value.trim();
      if (val && !S.news.keywords.includes(val)) {
        S.news.keywords.push(val); lsSave(); S.news.fetchedAt = 0;
        renderNewsKws(); fetchNews(true);
      } else { renderNewsKws(); }
    };
    inp.addEventListener('blur', doConfirm);
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
      if (e.key === 'Escape') { inp.value = ''; inp.blur(); }
    });
  });
  addWrap.appendChild(addBtn);
  kws.appendChild(addWrap);
}

function renderNewsItems() {
  if (!newsListEl) return;
  const filtered = S.news.activeKw === 'all'
    ? [...S.news.items].sort((a, b) => new Date(b.rawDate || 0) - new Date(a.rawDate || 0))
    : S.news.items.filter(i => i.kw === S.news.activeKw);

  if (!filtered.length) {
    newsListEl.innerHTML = '<div class="news-empty"><p>尚無新聞<br>點擊 ↻ 按鈕載入</p></div>';
    return;
  }
  newsListEl.innerHTML = '';
  filtered.forEach(item => {
    const card = el('div', 'news-card');
    const hasImg = !!item.image;
    card.classList.toggle('nc-has-img', hasImg);
    const metaStr = `${esc(item.source||'')}${item.rawDate?' · '+parseDate(item.rawDate):item.date?' · '+item.date:''}`;
    if (hasImg) {
      card.innerHTML = `
        <div class="nc-body">
          <div class="nc-kw">${esc(item.kw||'')}</div>
          <div class="nc-title">${esc(item.title||'')}</div>
          <div class="nc-foot"><span class="nc-meta">${metaStr}</span></div>
        </div>
        <div class="nc-thumb-wrap">
          <img class="nc-thumb" src="${esc(item.image)}" alt="${esc(item.title||'')}" loading="lazy">
        </div>
      `;
      const thumb = card.querySelector('.nc-thumb');
      const thumbWrap = card.querySelector('.nc-thumb-wrap');
      thumbWrap.style.cursor = 'zoom-in';
      thumbWrap.addEventListener('click', e => {
        e.stopPropagation();
        showImageViewer(item.image, item.title || '');
      });
      thumb.onerror = function() {
        thumbWrap.remove();
        card.classList.remove('nc-has-img');
      };
      if (item.link) {
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => window.open(item.link, '_blank', 'noopener'));
      }
    } else {
      card.innerHTML = `
        <div class="nc-kw">${esc(item.kw||'')}</div>
        <div class="nc-title">${esc(item.title||'')}</div>
        <div class="nc-foot"><span class="nc-meta">${metaStr}</span></div>
      `;
      if (item.link) {
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => window.open(item.link, '_blank', 'noopener'));
      }
    }
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
  try {
    const d = new Date(raw);
    const datePart = d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
    const timePart = d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
    return datePart + '．發布時間 ' + timePart;
  } catch(_) { return ''; }
}

// 記錄各關鍵字上次更新時間
function isNewsSilentHour() {
  // 台灣時間 00:00-06:00 靜默
  const tw = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const hour = tw.getUTCHours();
  return hour >= 0 && hour < 6;
}

async function fetchNews(force = false) {
  const CACHE_MS = 4 * 60 * 60 * 1000; // 4 小時

  // 靜默時段（非強制不更新）
  if (!force && isNewsSilentHour()) {
    if (S.news.items.length) { renderNewsItems(); return; }
  }

  const apiKey = S.cfg.newsdataApiKey?.trim();
  const keywords = S.news.keywords || [];
  if (!keywords.length) { renderNewsItems(); return; }

  // 每個關鍵字各自判斷快取，找出需要更新的
  const now = Date.now();
  if (!S.news.kwFetchedAt) S.news.kwFetchedAt = {};
  const kwsToFetch = force
    ? keywords
    : keywords.filter(kw => !S.news.kwFetchedAt[kw] || (now - S.news.kwFetchedAt[kw]) >= CACHE_MS);

  // 全部都還新鮮，直接渲染
  if (!kwsToFetch.length) { renderNewsItems(); return; }

  const refBtn = $('news-ref-btn');
  const mobileRefBtn = $('mobile-news-ref-btn');
  renderNewsLoading();

  const isZh = S.news.lang === 'zh-TW';
  const lang = isZh ? 'zh' : 'en';
  const country = isZh ? 'tw' : 'us';
  const maxPerKw = 10;

  const allItems = [...(S.news.items || [])];
  // 這次抓取過程中已收錄的 link（跨關鍵字去重用）
  const seenLinks = new Set();  // 已收錄的 link
  const seenTitles = new Set(); // 已收錄的標題前20字（防轉載重複）

  for (let i = 0; i < kwsToFetch.length; i++) {
    const kw = kwsToFetch[i];
    try {
      let articles = [];

      if (apiKey) {
        // Newsdata.io API via Cloudflare Worker
        const url = `${NEWSDATA_PROXY}?q=${encodeURIComponent(kw)}&language=${lang}&country=${country}&apikey=${apiKey}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (res.status === 429) {
          console.warn('[NeoCast] Newsdata 429 rate limit:', kw);
          continue;
        }
        if (!res.ok) continue;
        const data = await res.json();
        if (data.status !== 'success' || !Array.isArray(data.results)) continue;

        // 去掉重複文章：duplicate:true、已收錄 link、標題前20字相同
        const newsdataArticles = [];
        for (const a of data.results) {
          if (newsdataArticles.length >= maxPerKw) break;
          if (!a.link || a.duplicate === true) continue;
          if (seenLinks.has(a.link)) continue;
          const titleKey = (a.title || '').slice(0, 20);
          if (titleKey && seenTitles.has(titleKey)) continue;
          const article = {
            kw,
            title:   a.title || '',
            source:  a.source_name || '',
            link:    a.link || '',
            image:   a.image_url || a.source_icon || NEWS_DEFAULT_IMG,
            rawDate: a.pubDate ? a.pubDate.replace(' ', 'T') + 'Z' : '',
            date:    a.pubDate ? parseDate(a.pubDate.replace(' ', 'T') + 'Z') : '',
          };
          newsdataArticles.push(article);
          seenLinks.add(a.link);
          if (titleKey) seenTitles.add(titleKey);
        }
        articles.push(...newsdataArticles);
        S.news.kwFetchedAt[kw] = Date.now();

        // 不足 10 篇，用 RSS 補足
        if (articles.length < maxPerKw) {
          try {
            const isZhR = S.news.lang === 'zh-TW';
            const hlR   = isZhR ? 'zh-TW' : 'en-US';
            const glR   = isZhR ? 'TW' : 'US';
            const ceidR = isZhR ? 'TW:zh-Hant' : 'US:en';
            const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(kw)}&hl=${hlR}&gl=${glR}&ceid=${ceidR}`;
            const rssRes = await fetch(RSS2JSON + encodeURIComponent(rssUrl), { signal: AbortSignal.timeout(12000) });
            if (rssRes.ok) {
              const rssData = await rssRes.json();
              if (rssData.status === 'ok' && Array.isArray(rssData.items)) {
                const need = maxPerKw - articles.length;
                const rssArticles = [];
                for (const item of rssData.items) {
                  if (rssArticles.length >= need) break;
                  if (!item.link || seenLinks.has(item.link)) continue;
                  const raw = item.title || '';
                  const dashIdx = raw.lastIndexOf(' - ');
                  const title = dashIdx > 0 ? raw.slice(0, dashIdx) : raw;
                  const titleKey = title.slice(0, 20);
                  if (titleKey && seenTitles.has(titleKey)) continue;
                  const article = {
                    kw,
                    title,
                    source:  dashIdx > 0 ? raw.slice(dashIdx + 3) : (item.author || ''),
                    link:    item.link || item.guid || '',
                    image:   NEWS_DEFAULT_IMG,
                    rawDate: item.pubDate || '',
                    date:    item.pubDate ? parseDate(item.pubDate) : '',
                  };
                  rssArticles.push(article);
                  seenLinks.add(item.link);
                  if (titleKey) seenTitles.add(titleKey);
                }
                articles.push(...rssArticles);
              }
            }
          } catch(_) {}
        }
      } else {
        // 無 API Key：全用 RSS
        const isZh = S.news.lang === 'zh-TW';
        const hl   = isZh ? 'zh-TW' : 'en-US';
        const gl   = isZh ? 'TW' : 'US';
        const ceid = isZh ? 'TW:zh-Hant' : 'US:en';
        const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(kw)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
        const apiUrl = RSS2JSON + encodeURIComponent(rssUrl);
        const res = await fetch(apiUrl, { signal: AbortSignal.timeout(12000) });
        if (!res.ok) continue;
        const data = await res.json();
        if (data.status !== 'ok' || !Array.isArray(data.items)) continue;

        for (const item of data.items) {
          if (articles.length >= maxPerKw) break;
          if (!item.link || seenLinks.has(item.link)) continue;
          const raw = item.title || '';
          const dashIdx = raw.lastIndexOf(' - ');
          const title = dashIdx > 0 ? raw.slice(0, dashIdx) : raw;
          const titleKey = title.slice(0, 20);
          if (titleKey && seenTitles.has(titleKey)) continue;
          const article = {
            kw,
            title,
            source:  dashIdx > 0 ? raw.slice(dashIdx + 3) : (item.author || ''),
            link:    item.link || item.guid || '',
            image:   NEWS_DEFAULT_IMG,
            rawDate: item.pubDate || '',
            date:    item.pubDate ? parseDate(item.pubDate) : '',
          };
          articles.push(article);
          seenLinks.add(item.link);
          if (titleKey) seenTitles.add(titleKey);
        }
        S.news.kwFetchedAt[kw] = Date.now();
      }

      // 替換該關鍵字的舊文章
      const filtered = allItems.filter(i => i.kw !== kw);
      filtered.push(...articles);
      allItems.length = 0;
      allItems.push(...filtered);

    } catch(_) {}
  }

  // 排序：全部按發布時間新→舊
  allItems.sort((a, b) => new Date(b.rawDate || 0) - new Date(a.rawDate || 0));

  S.news.items     = allItems;
  S.news.fetchedAt = Date.now();
  lsSave();

  renderNewsItems();

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

function mountStickyTagBar(tagBar, bodyEl) {
  let tagEditMode = false;

  function renderStickyTagBar() {
    tagBar.innerHTML = '';

    // 全部（固定，不可刪/改名/拖曳）
    const allBtn = el('span', 'sticky-tag-chip' + (S.activeStickyTag === 'all' ? ' on' : ''), '全部');
    allBtn.addEventListener('click', () => {
      if (tagEditMode) return;
      S.activeStickyTag = 'all'; S.stickySearch = ''; clearStickySearchUI();
      lsSave(); renderStickyTagBar(); renderStickiesWidget(bodyEl);
    });
    tagBar.appendChild(allBtn);

    // 各分類
    (S.stickyTags || []).forEach(tag => {
      const chip = el('span', 'sticky-tag-chip' + (S.activeStickyTag === tag ? ' on' : '') + (tagEditMode ? ' edit-mode' : ''));
      chip.dataset.tag = tag;

      if (tagEditMode) {
        // 管理模式：點 label 直接 inline 編輯
        const label = el('span', 'sticky-tag-label', tag);
        label.addEventListener('click', e => {
          e.stopPropagation();
          startStickyTagRename(chip, label, tag);
        });
        chip.appendChild(label);

        // ✕ 刪除
        const x = el('span', 'sticky-tag-x', '✕');
        x.addEventListener('click', e => {
          e.stopPropagation();
          if (!confirm('刪除分類「' + tag + '」？（便利貼不會刪除，但會移除分類）')) return;
          S.stickyTags = S.stickyTags.filter(t => t !== tag);
          S.stickies.forEach(s => { if (s.tag === tag) s.tag = ''; });
          if (S.activeStickyTag === tag) S.activeStickyTag = 'all';
          lsSave(); renderStickyTagBar(); renderStickiesWidget(bodyEl);
        });
        chip.appendChild(x);
      } else {
        chip.textContent = tag;
        chip.addEventListener('click', () => {
          S.activeStickyTag = tag; S.stickySearch = ''; clearStickySearchUI();
          lsSave(); renderStickyTagBar(); renderStickiesWidget(bodyEl);
        });
      }

      tagBar.appendChild(chip);
    });

    // 私人分類（解鎖時才顯示，不可改名/拖曳）
    if (S.privateUnlocked) {
      const privChip = el('span', 'sticky-tag-chip sticky-tag-private' + (S.activeStickyTag === PRIVATE_STICKY_TAG ? ' on' : ''), '私人');
      privChip.addEventListener('click', () => {
        if (tagEditMode) return;
        S.activeStickyTag = PRIVATE_STICKY_TAG; S.stickySearch = ''; clearStickySearchUI();
        lsSave(); renderStickyTagBar(); renderStickiesWidget(bodyEl);
      });
      tagBar.appendChild(privChip);
    }

    // ＋ 新增分類
    if (tagEditMode) {
      const addChip = el('span', 'sticky-tag-chip sticky-tag-add', '＋');
      addChip.addEventListener('click', () => {
        const inp = el('input', 'sticky-tag-input');
        inp.type = 'search'; inp.placeholder = '分類名稱…';
        inp.autocomplete = 'new-password'; inp.spellcheck = false;
        addChip.replaceWith(inp);
        inp.focus();
        const doConfirm = () => {
          const name = inp.value.trim();
          if (name && !S.stickyTags.includes(name)) S.stickyTags.push(name);
          if (name) S.activeStickyTag = name;
          lsSave(); renderStickyTagBar(); renderStickiesWidget(bodyEl);
        };
        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); doConfirm(); }
          if (e.key === 'Escape') renderStickyTagBar();
        });
        inp.addEventListener('blur', doConfirm);
      });
      tagBar.appendChild(addChip);
    }

    // ⚙ 設定按鈕
    const cfgBtn = el('button', 'sticky-tag-cfg-btn' + (tagEditMode ? ' on' : ''));
    cfgBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
    cfgBtn.title = tagEditMode ? '完成編輯' : '管理分類';
    cfgBtn.addEventListener('click', () => { tagEditMode = !tagEditMode; renderStickyTagBar(); });
    tagBar.appendChild(cfgBtn);

    // 管理模式下啟用拖曳排序
    if (tagEditMode) initStickyTagDrag(tagBar, bodyEl, renderStickyTagBar);
  }

  bodyEl._renderTagBar = renderStickyTagBar;
  renderStickyTagBar();
}

function startStickyTagRename(chip, label, oldTag) {
  const inp = el('input', 'sticky-tag-input');
  inp.type = 'search';
  inp.value = oldTag;
  inp.autocomplete = 'new-password';
  inp.spellcheck = false;
  inp.style.maxWidth = '80px';
  label.replaceWith(inp);
  inp.focus(); inp.select();

  const save = () => {
    const val = inp.value.trim();
    if (val && val !== oldTag) {
      const idx = S.stickyTags.indexOf(oldTag);
      if (idx >= 0) S.stickyTags[idx] = val;
      S.stickies.forEach(s => { if (s.tag === oldTag) s.tag = val; });
      if (S.activeStickyTag === oldTag) S.activeStickyTag = val;
      lsSave();
    }
    // 重繪 tagBar
    const tagBarEl = chip.closest('.sticky-tag-bar');
    const bodyEl2 = tagBarEl?.closest('.stickies-inner, .mobile-page-panel');
    bodyEl2?._renderTagBar?.();
  };
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') { const tagBarEl = chip.closest('.sticky-tag-bar'); const bodyEl2 = tagBarEl?.closest('.stickies-inner, .mobile-page-panel'); bodyEl2?._renderTagBar?.(); }
  });
  inp.addEventListener('blur', save);
}

function initStickyTagDrag(tagBar, bodyEl, renderStickyTagBar) {
  const chips = [...tagBar.querySelectorAll('.sticky-tag-chip.edit-mode')];
  let dragTag = null;

  chips.forEach(chip => {
    // Desktop
    chip.draggable = true;
    chip.addEventListener('dragstart', e => {
      dragTag = chip.dataset.tag;
      setTimeout(() => chip.classList.add('sticky-tag-dragging'), 0);
      e.dataTransfer.effectAllowed = 'move';
    });
    chip.addEventListener('dragend', () => {
      chip.classList.remove('sticky-tag-dragging');
      tagBar.querySelectorAll('.sticky-tag-drag-over').forEach(c => c.classList.remove('sticky-tag-drag-over'));
      dragTag = null;
    });
    chip.addEventListener('dragover', e => {
      e.preventDefault();
      if (chip.dataset.tag === dragTag) return;
      tagBar.querySelectorAll('.sticky-tag-drag-over').forEach(c => c.classList.remove('sticky-tag-drag-over'));
      chip.classList.add('sticky-tag-drag-over');
    });
    chip.addEventListener('drop', e => {
      e.preventDefault();
      if (!dragTag || dragTag === chip.dataset.tag) return;
      const si = S.stickyTags.indexOf(dragTag);
      const di = S.stickyTags.indexOf(chip.dataset.tag);
      if (si < 0 || di < 0) return;
      const [moved] = S.stickyTags.splice(si, 1);
      S.stickyTags.splice(di, 0, moved);
      lsSave(); renderStickyTagBar();
    });

    // Mobile touch
    let touchTag = null, ghost = null, startX = 0, startY = 0;
    chip.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      touchTag = chip.dataset.tag;
    }, { passive: true });

    const onTouchMove = e => {
      if (!touchTag) return;
      const touch = e.touches[0];
      if (!ghost) {
        const dx = touch.clientX - startX, dy = touch.clientY - startY;
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        ghost = chip.cloneNode(true);
        ghost.style.cssText = `position:fixed;pointer-events:none;z-index:9999;opacity:.8;`;
        document.body.appendChild(ghost);
        chip.classList.add('sticky-tag-dragging');
      }
      ghost.style.left = (touch.clientX - chip.offsetWidth / 2) + 'px';
      ghost.style.top  = (touch.clientY - chip.offsetHeight / 2) + 'px';
      ghost.style.display = 'none';
      const el2 = document.elementFromPoint(touch.clientX, touch.clientY);
      ghost.style.display = '';
      const target = el2?.closest('.sticky-tag-chip.edit-mode');
      tagBar.querySelectorAll('.sticky-tag-drag-over').forEach(c => c.classList.remove('sticky-tag-drag-over'));
      if (target && target !== chip) target.classList.add('sticky-tag-drag-over');
    };
    const onTouchEnd = () => {
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      if (ghost) { ghost.remove(); ghost = null; }
      chip.classList.remove('sticky-tag-dragging');
      const over = tagBar.querySelector('.sticky-tag-drag-over');
      tagBar.querySelectorAll('.sticky-tag-drag-over').forEach(c => c.classList.remove('sticky-tag-drag-over'));
      if (over && over !== chip) {
        const si = S.stickyTags.indexOf(touchTag);
        const di = S.stickyTags.indexOf(over.dataset.tag);
        if (si >= 0 && di >= 0) {
          const [moved] = S.stickyTags.splice(si, 1);
          S.stickyTags.splice(di, 0, moved);
          lsSave(); renderStickyTagBar();
        }
      }
      touchTag = null;
    };
    chip.addEventListener('touchstart', () => {
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd, { passive: true });
    }, { passive: true });
  });
}

// 清空所有搜尋框 UI（切換分類時呼叫）
function clearStickySearchUI() {
  document.querySelectorAll('.sticky-search-inp').forEach(inp => { inp.value = ''; });
  document.querySelectorAll('.sticky-search-clear').forEach(btn => { btn.style.display = 'none'; });
}

function buildStickiesWidget() {
  const body = el('div', 'stickies-inner');
  body.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;min-height:0;';
  const w = makeWidget('stickies', '便利貼', body, '');
  w.querySelector('.w-body')?.remove();
  w.insertBefore(body, w.querySelector('.resize-handle'));

  // Add delete-checked button to w-head (only in edit mode)
  const head = w.querySelector('.w-head');
  const delBtn = w.querySelector('.w-delete-btn');
  const delCheckedBtn = el('button', 'w-pencil-btn hidden sticky-del-checked-btn');
  delCheckedBtn.title = '刪除已勾選';
  delCheckedBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
  delCheckedBtn.addEventListener('click', e => {
    e.stopPropagation();
    const checked = S.stickies.filter(s => s.done);
    if (!checked.length) return;
    if (!confirm(`確認刪除 ${checked.length} 項已勾選？`)) return;
    S.stickies = S.stickies.filter(s => !s.done);
    lsSave();
    renderStickiesWidget(body);
  });
  // Insert before delBtn
  if (delBtn) head.insertBefore(delCheckedBtn, delBtn);
  else head.appendChild(delCheckedBtn);

  // ── 搜尋框（置中，插在 w-title 後） ──
  const searchWrap = el('div', 'sticky-search-wrap');
  const searchInp = el('input', 'sticky-search-inp');
  searchInp.type = 'search';
  searchInp.placeholder = '搜尋便利貼…';
  searchInp.autocomplete = 'search'; searchInp.name = 'neocast-sticky-search'; searchInp.spellcheck = false;
  searchInp.setAttribute('autocomplete', 'off');
  searchInp.name = 'sticky-search';
  searchInp.setAttribute('inputmode', 'search');
  searchInp.value = S.stickySearch || '';
  const searchClear = el('button', 'sticky-search-clear');
  searchClear.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="10" height="10"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  searchClear.title = '清除搜尋';
  searchClear.style.display = S.stickySearch ? '' : 'none';
  searchInp.addEventListener('input', () => {
    S.stickySearch = searchInp.value;
    searchClear.style.display = S.stickySearch ? '' : 'none';
    renderStickiesWidget(body);
  });
  searchClear.addEventListener('mousedown', e => {
    e.preventDefault();
    S.stickySearch = '';
    searchInp.value = '';
    searchClear.style.display = 'none';
    renderStickiesWidget(body);
    searchInp.focus();
  });
  searchWrap.appendChild(searchInp);
  searchWrap.appendChild(searchClear);
  // 插在 w-title 後面（置中效果由 flex 控制）
  const wTitle = head.querySelector('.w-title');
  if (wTitle) wTitle.after(searchWrap);
  else head.insertBefore(searchWrap, head.firstChild);

  // ── 鎖頭按鈕（禁用編輯/拖曳） ──
  const lockBtn = el('button', 'w-btn sticky-lock-btn' + (S.stickyLocked ? ' on' : ''));
  lockBtn.title = S.stickyLocked ? '解除鎖定' : '鎖定（禁止編輯）';
  const svgLocked  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="13" height="13"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
  const svgUnlocked = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="13" height="13"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`;
  lockBtn.innerHTML = S.stickyLocked ? svgLocked : svgUnlocked;
  lockBtn.addEventListener('click', e => {
    e.stopPropagation();
    S.stickyLocked = !S.stickyLocked;
    lockBtn.classList.toggle('on', S.stickyLocked);
    lockBtn.title = S.stickyLocked ? '解除鎖定' : '鎖定（禁止編輯）';
    lockBtn.innerHTML = S.stickyLocked ? svgLocked : svgUnlocked;
    // 同步所有便利貼 lock 按鈕（桌面+手機共用 S.stickyLocked）
    document.querySelectorAll('.sticky-lock-btn').forEach(b => {
      b.classList.toggle('on', S.stickyLocked);
      b.title = S.stickyLocked ? '解除鎖定' : '鎖定（禁止編輯）';
      b.innerHTML = S.stickyLocked ? svgLocked : svgUnlocked;
    });
    renderStickiesWidget(body);
  });
  // 插在 delCheckedBtn 前（視覺上在 del-checked 左邊）
  head.insertBefore(lockBtn, delCheckedBtn);

  // Update button state when checked count changes
  w._updateDelChecked = () => {
    const count = (S.stickies || []).filter(s => s.done).length;
    delCheckedBtn.style.opacity = count > 0 ? '1' : '0.35';
    delCheckedBtn.style.pointerEvents = count > 0 ? 'all' : 'none';
  };

  // 標籤過濾列
  const tagBar = el('div', 'sticky-tag-bar');
  body.insertBefore(tagBar, body.firstChild);
  mountStickyTagBar(tagBar, body);

  renderStickiesWidget(body);
  w._updateDelChecked?.();

  new ResizeObserver(() => {
    const list   = body.querySelector('.sticky-list');
    const bar    = body.querySelector('.sticky-input-bar');
    const tagBar = body.querySelector('.sticky-tag-bar');
    if (list) {
      const tagBarH = tagBar ? tagBar.offsetHeight : 0;
      const barH = (bar && bar.style.display !== 'none') ? bar.offsetHeight : 0;
      list.style.height = (body.offsetHeight - barH - tagBarH) + 'px';
    }
  }).observe(body);
}

function renderStickiesWidget(container) {
  // 保留 tagBar，只清掉 list 和 input-bar
  // 記住目前捲動位置，重建後還原（避免勾選/編輯時跳回頂端）
  const prevScrollTop = container.querySelector('.sticky-list')?.scrollTop ?? 0;
  container.querySelectorAll('.sticky-list, .sticky-input-bar').forEach(e => e.remove());
  // 若還沒有 tagBar（首次建立），補渲染一次
  if (!container.querySelector('.sticky-tag-bar')) container._renderTagBar?.();

  const list = el('div', 'sticky-list');
  container.appendChild(list);

  const activeTag = S.activeStickyTag || 'all';
  // 鎖定時強制排除私人便利貼
  const baseStickies = S.privateUnlocked
    ? S.stickies
    : S.stickies.filter(s => s.tag !== PRIVATE_STICKY_TAG);
  const visibleStickies = activeTag === 'all'
    ? baseStickies
    : baseStickies.filter(s => s.tag === activeTag);

  // 搜尋過濾
  const searchQ = (S.stickySearch || '').trim().toLowerCase();
  const filteredStickies = searchQ
    ? visibleStickies.filter(s => s.text.toLowerCase().includes(searchQ))
    : visibleStickies;

  if (!filteredStickies.length) {
    list.innerHTML = '<div class="sticky-empty">' + (searchQ ? '找不到符合的便利貼' : activeTag === 'all' ? '輸入新增待辦事項…' : '此分類還沒有便利貼') + '</div>';
  } else {
    const sorted = [
      ...filteredStickies.filter(s => s.pinned),
      ...filteredStickies.filter(s => !s.pinned)
    ];
    sorted.forEach(s => list.appendChild(makeStickyCard(s, container)));
    if (!S.stickyLocked) initStickyListDrag(list, container);
  }

  // 搜尋中或鎖定時不顯示新增列
  const bar = el('div', 'sticky-input-bar');
  if (searchQ || S.stickyLocked) {
    bar.style.display = 'none';
  }

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
  inp.type = 'search';
  inp.placeholder = '新增待辦…';
  inp.autocomplete = 'off'; inp.name = 'neocast-sticky'; inp.spellcheck = false;
  inp.setAttribute('autocomplete', 'off');
  inp.name = 'sticky-new';
  inp.setAttribute('inputmode', 'text');

  const addBtn = el('button', 'sticky-add-btn');
  addBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M2 12l20-8-8 20-4-8-8-4z"/></svg>`;
  addBtn.title = '新增';

  function doAdd() {
    const text = inp.value.trim();
    if (!text) return;
    const newTag = (S.activeStickyTag && S.activeStickyTag !== 'all') ? S.activeStickyTag : '';
    S.stickies.unshift({ id: uid(), text, color: selectedColor, pinned: false, tag: newTag });
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
    const barH    = (bar.style.display !== 'none') ? (bar.offsetHeight || 53) : 0;
    const tagBarEl = container.querySelector('.sticky-tag-bar');
    const tagBarH = tagBarEl ? tagBarEl.offsetHeight : 0;
    const containerH = container.offsetHeight;
    if (containerH > 0) {
      list.style.height = (containerH - barH - tagBarH) + 'px';
      list.style.overflowY = 'auto';
    }
    // 還原捲動位置（勾選/編輯完後不跳回頂端）
    if (prevScrollTop > 0) list.scrollTop = prevScrollTop;
  });
}

function makeStickyCard(sticky, container) {
  const c    = STICKY_COLORS[sticky.color] || STICKY_COLORS.none;
  const card = el('div', 'sticky-card' + (sticky.pinned ? ' pinned' : '') + (sticky.done ? ' done' : ''));
  card.dataset.id = sticky.id;
  card.style.background  = c.bg;
  card.style.borderColor = c.border;

  // Drag handle — 鎖定時隱藏
  const drag = el('div', 'sticky-handle' + (sticky.pinned ? ' disabled' : ''));
  drag.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" opacity=".4"><circle cx="8" cy="5" r="1.8"/><circle cx="8" cy="12" r="1.8"/><circle cx="8" cy="19" r="1.8"/><circle cx="14" cy="5" r="1.8"/><circle cx="14" cy="12" r="1.8"/><circle cx="14" cy="19" r="1.8"/><circle cx="20" cy="5" r="1.8"/><circle cx="20" cy="12" r="1.8"/><circle cx="20" cy="19" r="1.8"/></svg>`;
  if (S.stickyLocked) drag.style.display = 'none';

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
    // Update del-checked button state（桌面版 widget 或手機版 panel）
    const w = container.closest('.widget') || container.closest('.mobile-page-panel');
    if (w?._updateDelChecked) w._updateDelChecked();
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

  // Copy button
  const copyBtn = el('button', 'sticky-copy');
  copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  copyBtn.title = '複製內容';
  copyBtn.addEventListener('click', async e => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(sticky.text);
      copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>`;
      setTimeout(() => {
        copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
      }, 1200);
    } catch(_) {}
  });

  card.appendChild(drag);
  card.appendChild(chk);
  card.appendChild(textEl);
  card.appendChild(copyBtn);
  card.appendChild(pinBtn);

  // 顯示分類
  if (sticky.tag) {
    const tagWrap = el('div', 'sticky-card-tags');
    const tagLabel = sticky.tag === PRIVATE_STICKY_TAG ? '私人' : sticky.tag;
    tagWrap.appendChild(el('span', 'sticky-tag-chip on', tagLabel));
    card.appendChild(tagWrap);
  }

  const onLongPress = () => {
    startEdit(sticky, textEl, card, container);
  };

  if (!S.stickyLocked) {
    textEl.addEventListener('mousedown', () => { longPressTimer = setTimeout(onLongPress, 500); });
    textEl.addEventListener('mouseup', () => clearTimeout(longPressTimer));
    textEl.addEventListener('mouseleave', () => clearTimeout(longPressTimer));
    card.addEventListener('contextmenu', e => { e.preventDefault(); onLongPress(); });

    // 手機：點一下文字直接編輯（拖曳中不觸發）
    textEl.addEventListener('touchend', e => {
      if (isDragging) return;
      e.preventDefault();
      onLongPress();
    }, { passive: false });
  }

  return card;
}

function startEdit(sticky, textEl, card, container) {
  const inp = el('input', 'sticky-edit-input');
  inp.type = 'search';
  inp.value = sticky.text;
  inp.autocomplete = 'off'; inp.name = 'neocast-sticky-edit'; inp.spellcheck = false;
  inp.setAttribute('autocomplete', 'off');
  inp.name = 'sticky-edit';
  inp.setAttribute('inputmode', 'text');
  textEl.replaceWith(inp);
  inp.focus();
  inp.select();

  // 停用 draggable，讓文字可以正常選取
  card.draggable = false;
  // 隱藏 card-tags（避免編輯模式重複顯示）
  card.querySelector('.sticky-card-tags')?.style.setProperty('display', 'none');
  // 其他卡片變灰，凸顯正在編輯的卡片
  container.querySelectorAll('.sticky-card').forEach(c => { if (c !== card) c.classList.add('sticky-dimmed'); });
  card.classList.add('sticky-editing');

  // Hide pin and copy buttons during edit
  const pinBtn = card.querySelector('.sticky-pin');
  if (pinBtn) pinBtn.style.display = 'none';
  const copyBtnEl = card.querySelector('.sticky-copy');
  if (copyBtnEl) copyBtnEl.style.display = 'none';

  // Show color picker + del button inline during edit
  const colorRow = el('div', 'sticky-edit-colors');

  // Del button inside colorRow (leftmost)
  const delBtn = el('button', 'sticky-inline-del');
  delBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>`;
  delBtn.title = '刪除';
  delBtn.addEventListener('mousedown', e => {
    e.preventDefault(); // prevent blur
    const isChecked = sticky.done;
    if (!isChecked && !confirm('確認刪除？')) return;
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

  // 原色按鈕（無色）
  const noneSq = el('button', 'sticky-color-sq sticky-sq-none' + (!sticky.color || sticky.color === 'none' ? ' on' : ''));
  noneSq.title = '原色';
  noneSq.addEventListener('mousedown', e => {
    e.preventDefault();
    const st = S.stickies.find(s => s.id === sticky.id);
    if (st) {
      st.color = 'none';
      const newC = STICKY_COLORS.none;
      card.style.background  = newC.bg;
      card.style.borderColor = newC.border;
    }
    colorRow.querySelectorAll('.sticky-color-sq').forEach(s => s.classList.remove('on'));
    noneSq.classList.add('on');
    lsSave();
  });
  colorRow.appendChild(noneSq);

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
      if (st && st.color === key) sq.classList.add('on');
      else noneSq.classList.add('on');
      lsSave();
    });
    colorRow.appendChild(sq);
  });
  inp.after(colorRow);

  // 分類選擇器（chip 點選，避免觸發 inp blur）
  const st0 = S.stickies.find(s => s.id === sticky.id);
  if (S.stickyTags.length) {
    const catRow = el('div', 'sticky-edit-tag-row');
    const catLabel = el('span', '', '分類：');
    catLabel.style.cssText = 'font-size:.72rem;color:rgba(255,255,255,.45);flex-shrink:0;margin-right:2px;';
    catRow.appendChild(catLabel);

    // 「無」chip
    const renderCatChips = () => {
      catRow.querySelectorAll('.sticky-cat-chip').forEach(c => c.remove());
      const noneChip = el('span', 'sticky-tag-chip sticky-cat-chip' + (!st0.tag ? ' on' : ''), '無');
      noneChip.addEventListener('mousedown', e => { e.preventDefault(); st0.tag = ''; lsSave(); container._renderTagBar?.(); renderCatChips(); });
      noneChip.addEventListener('touchend', e => { e.preventDefault(); st0.tag = ''; lsSave(); container._renderTagBar?.(); renderCatChips(); });
      catRow.appendChild(noneChip);
      S.stickyTags.forEach(tag => {
        const chip = el('span', 'sticky-tag-chip sticky-cat-chip' + (st0.tag === tag ? ' on' : ''), tag);
        chip.addEventListener('mousedown', e => { e.preventDefault(); st0.tag = tag; lsSave(); container._renderTagBar?.(); renderCatChips(); });
        chip.addEventListener('touchend', e => { e.preventDefault(); st0.tag = tag; lsSave(); container._renderTagBar?.(); renderCatChips(); });
        catRow.appendChild(chip);
      });
      // 私人分類（解鎖時才顯示）
      if (S.privateUnlocked) {
        const privChip = el('span', 'sticky-tag-chip sticky-cat-chip sticky-tag-private' + (st0.tag === PRIVATE_STICKY_TAG ? ' on' : ''), '私人');
        privChip.addEventListener('mousedown', e => { e.preventDefault(); st0.tag = PRIVATE_STICKY_TAG; lsSave(); container._renderTagBar?.(); renderCatChips(); });
        privChip.addEventListener('touchend', e => { e.preventDefault(); st0.tag = PRIVATE_STICKY_TAG; lsSave(); container._renderTagBar?.(); renderCatChips(); });
        catRow.appendChild(privChip);
      }
    };
    renderCatChips();
    colorRow.after(catRow);
  }

  const save = () => {
    const val = inp.value.trim();
    if (val) { const st = S.stickies.find(s => s.id === sticky.id); if (st) st.text = val; }
    lsSave();
    renderStickiesWidget(container);
    container._renderTagBar?.();
  };
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') renderStickiesWidget(container);
  });
  inp.addEventListener('blur', e => {
    // blur 到 catRow 內部不 save
    if (e.relatedTarget && e.relatedTarget.closest?.('.sticky-edit-tag-row')) return;
    save();
  });
}

function initStickyListDrag(list, container) {
  let dragSrcId = null;
  let ghost     = null;
  let startX    = 0;
  let startY    = 0;
  let isDragging = false; // 追蹤是否正在拖曳，避免拖曳結束觸發編輯

  list.querySelectorAll('.sticky-card:not(.pinned)').forEach(card => {
    const handle = card.querySelector('.sticky-handle');
    if (!handle) return;

    // Desktop drag — handle 設 draggable，只能從 handle 啟動
    handle.draggable = true;
    handle.addEventListener('dragstart', e => {
      dragSrcId = card.dataset.id;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => card.classList.add('sticky-dragging'), 0);
    });
    handle.addEventListener('dragend', () => {
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

    // Mobile touch drag via handle — 長按 500ms 啟動，8px 移動取消，邊緣自動捲動
    let tTimer = null, tDragging = false, tRafId = null;
    let tClientY = 0, tScrollDir = 0;
    let tStartX = 0, tStartY = 0;

    const tCleanup = () => {
      clearTimeout(tTimer);
      if (tRafId) { cancelAnimationFrame(tRafId); tRafId = null; }
      if (ghost) { ghost.remove(); ghost = null; }
      card.classList.remove('sticky-dragging');
      list.querySelectorAll('.sticky-drag-over').forEach(c => c.classList.remove('sticky-drag-over'));
      tDragging = false;
      isDragging = false;
      dragSrcId = null;
      tScrollDir = 0;
    };

    const tScroll = () => {
      if (!tDragging || tScrollDir === 0) { tRafId = null; return; }
      const listRect = list.getBoundingClientRect();
      const EDGE = 60;
      const ratio = tScrollDir > 0
        ? (tClientY - (listRect.bottom - EDGE)) / EDGE
        : (listRect.top + EDGE - tClientY) / EDGE;
      list.scrollTop += tScrollDir * 10 * Math.min(1, Math.max(0, ratio));
      tRafId = requestAnimationFrame(tScroll);
    };

    const onTouchMove = e => {
      if (!tDragging) return;
      e.preventDefault();
      const touch = e.touches[0];
      tClientY = touch.clientY;

      // 更新 ghost 位置（只動 Y）
      if (ghost) {
        ghost.style.top = (tClientY - ghost.offsetHeight / 2) + 'px';
      }

      // 邊緣自動捲動
      const listRect = list.getBoundingClientRect();
      const EDGE = 60;
      const newDir = tClientY < listRect.top + EDGE ? -1
                   : tClientY > listRect.bottom - EDGE ? 1 : 0;
      if (newDir !== tScrollDir) {
        tScrollDir = newDir;
        if (tScrollDir !== 0 && !tRafId) {
          tRafId = requestAnimationFrame(tScroll);
        }
      }

      // 偵測目標卡片
      ghost.style.display = 'none';
      const el2 = document.elementFromPoint(touch.clientX, tClientY);
      ghost.style.display = '';
      const target = el2?.closest('.sticky-card:not(.pinned)');
      list.querySelectorAll('.sticky-drag-over').forEach(c => c.classList.remove('sticky-drag-over'));
      if (target && target.dataset.id !== dragSrcId) target.classList.add('sticky-drag-over');
    };

    const onTouchEnd = () => {
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      if (!tDragging) { clearTimeout(tTimer); return; }
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
      tCleanup();
      renderStickiesWidget(container);
    };

    handle.addEventListener('touchstart', e => {
      tStartX = e.touches[0].clientX;
      tStartY = e.touches[0].clientY;
      tClientY = tStartY;
      tTimer = setTimeout(() => {
        tDragging = true;
        isDragging = true;
        dragSrcId = card.dataset.id;
        const rect = card.getBoundingClientRect();
        ghost = card.cloneNode(true);
        ghost.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;opacity:.85;z-index:9999;pointer-events:none;`;
        document.body.appendChild(ghost);
        card.classList.add('sticky-dragging');
        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', onTouchEnd, { passive: true });
      }, 500);
    }, { passive: true });

    // 移動超過 8px 取消長按
    handle.addEventListener('touchmove', e => {
      if (tDragging) return;
      const dx = e.touches[0].clientX - tStartX;
      const dy = e.touches[0].clientY - tStartY;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearTimeout(tTimer);
    }, { passive: true });

    handle.addEventListener('touchend', () => {
      if (!tDragging) clearTimeout(tTimer);
    }, { passive: true });

    handle.addEventListener('touchcancel', () => {
      tCleanup();
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
  $('cfg-nickname').value   = S.cfg.nickname || '';
  $('cfg-city').value       = S.cfg.weatherCity || '';
  $('cfg-gnewskey').value   = S.cfg.newsdataApiKey || '';
  $('cfg-ytkey').value      = S.cfg.ytApiKey || '';
  // OAuth status
  const loginStatus = $('cfg-yt-login-status');
  const loginBtn    = $('cfg-yt-login');
  if (ytIsLoggedIn()) {
    loginStatus.textContent = '✓ 已連結 Google 帳號';
    loginStatus.style.color = '#4ade80';
    loginBtn.textContent = '重新連結';
  } else {
    loginStatus.textContent = '';
    loginBtn.textContent = '連結 Google 帳號（按讚功能）';
  }
  loginBtn.onclick = () => {
    ytGoogleLogin(() => {
      loginStatus.textContent = '✓ 已連結 Google 帳號';
      loginStatus.style.color = '#4ade80';
      loginBtn.textContent = '重新連結';
    });
  };
  $('cfg-locate-status').textContent = '';
  openModal('m-cfg');
}

async function saveSettings() {
  const token      = $('cfg-tok').value.trim();
  const gistId     = $('cfg-gid').value.trim();
  const nickname   = $('cfg-nickname').value.trim();
  const city       = $('cfg-city').value.trim();

  S.cfg.token        = token;
  S.cfg.gistId       = gistId;
  S.cfg.nickname     = nickname;
  S.cfg.weatherCity  = city;
  S.cfg.newsdataApiKey  = $('cfg-gnewskey').value.trim();
  S.cfg.ytApiKey     = $('cfg-ytkey').value.trim();

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

async function fetchGuomanData() {
  try {
    const res = await fetch('./guoman.json');
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch(e) { return []; }
}

function mergeGuomanIntoCalendar(calendar, guoman) {
  guoman.forEach(guDay => {
    const wdId = guDay.weekday?.id;
    (guDay.items || []).forEach(item => {
      if (item.is_nsfw) {
        if (!S.animeState.nsfwCalendar[wdId]) S.animeState.nsfwCalendar[wdId] = [];
        const arr = S.animeState.nsfwCalendar[wdId];
        if (!arr.some(i => i.id === item.id)) arr.push(item);
      } else {
        const target = calendar.find(d => d.weekday?.id === wdId);
        if (!target) return;
        const existing = new Set((target.items || []).map(i => i.id));
        if (!existing.has(item.id)) target.items.push(item);
      }
    });
  });
}

function applyAnimeFontSize() {
  const listSize = (S.cfg.animeFontSizeList || 100) / 100;
  const sheetSize = (S.cfg.animeFontSizeSheet || 100) / 100;
  const root = document.documentElement;
  root.style.setProperty('--anime-list-fs', listSize);
  root.style.setProperty('--anime-sheet-fs', sheetSize);
}

const _isGallery = () => (S.animeState.viewMode || 'list') === 'gallery';
const _updateViewBtnIcon = btn => {
  btn.innerHTML = _isGallery()
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`;
};

function buildAnimeWidget() {
  const body = el('div', 'anime-inner');
  body.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;min-height:0;';
  const w = makeWidget('anime', '動畫追蹤', body, '');
  w.querySelector('.w-body')?.remove();
  w.insertBefore(body, w.querySelector('.resize-handle'));

  // 把設定按鈕加到 w-head
  const wHead = w.querySelector('.w-head');
  const pencilBtn = wHead?.querySelector('.w-pencil-btn');
  const animeCfgBtn = el('button', 'yt-icon-btn anime-cfg-btn');
  animeCfgBtn.title = '動畫設定';
  animeCfgBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
  const animeViewBtn = el('button', 'yt-icon-btn anime-view-btn');
  animeViewBtn.title = '切換顯示模式';
  _updateViewBtnIcon(animeViewBtn);
  animeViewBtn.addEventListener('click', e => {
    e.stopPropagation();
    S.animeState.viewMode = _isGallery() ? 'list' : 'gallery';
    lsSave();
    // 更新所有 view btn 圖示
    document.querySelectorAll('.anime-view-btn').forEach(_updateViewBtnIcon);
    // 重繪
    document.querySelectorAll('.anime-inner').forEach(inner => renderAnimeWidget(inner, inner.closest('[data-widget="anime"]')?.querySelector('.anime-cfg-btn') || null));
  });
  if (wHead && pencilBtn) {
    wHead.insertBefore(animeCfgBtn, pencilBtn);
    wHead.insertBefore(animeViewBtn, animeCfgBtn);
  }

  renderAnimeWidget(body, animeCfgBtn);
}

function renderAnimeWidget(container, cfgBtn) {
  // 保留設定面板（若已存在），只清空其他內容
  const existingPanel = container.querySelector('.anime-settings-panel');
  container.innerHTML = '';
  if (!S.animeState) S.animeState = { weekday: -1, tracked: [], trackedData: {}, customNames: {} };
  if (!S.animeState.trackedData) S.animeState.trackedData = {};
  if (!S.animeState.customNames) S.animeState.customNames = {};

  // ── 設定面板（只建立一次）──
  let animeSettingsPanel = existingPanel;
  if (!animeSettingsPanel) {
    animeSettingsPanel = el('div', 'anime-settings-panel');
    animeSettingsPanel.style.display = 'none';

    const makeFontRow = (label, cfgKey) => {
      if (!S.cfg[cfgKey]) S.cfg[cfgKey] = 100;
      const row = el('div', 'yt-font-row');
      row.appendChild(el('span', 'yt-font-label', label));
      const slider = document.createElement('input');
      slider.type = 'range'; slider.min = 100; slider.max = 200; slider.step = 5;
      slider.value = S.cfg[cfgKey];
      slider.className = 'yt-font-slider';
      const val = el('span', 'yt-font-val', S.cfg[cfgKey] + '%');
      slider.addEventListener('input', () => {
        S.cfg[cfgKey] = parseInt(slider.value);
        val.textContent = slider.value + '%';
        applyAnimeFontSize();
        lsSave();
      });
      row.appendChild(slider);
      row.appendChild(val);
      animeSettingsPanel.appendChild(row);
    };
    makeFontRow('列表文字', 'animeFontSizeList');
    makeFontRow('卡片文字', 'animeFontSizeSheet');
  }
  container.appendChild(animeSettingsPanel);

  if (cfgBtn && !cfgBtn._animeListenerAdded) {
    cfgBtn._animeListenerAdded = true;
    cfgBtn.addEventListener('click', e => {
      e.stopPropagation();
      const open = animeSettingsPanel.style.display === 'none';
      animeSettingsPanel.style.display = open ? '' : 'none';
      cfgBtn.classList.toggle('active', open);
    });
  }

  const todayWd = new Date().getDay();
  let curWd  = S.animeState.weekday >= 0 ? S.animeState.weekday : todayWd;
  let curTab = 'week';

  // Header: [本季新番][收藏][搜尋] + [今日]
  const head = el('div', 'anime-head');

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

  // 裏番 tab — 只在 privateUnlocked 時顯示
  if (S.privateUnlocked) {
    const nsfwTab = el('button', 'anime-main-tab', '裏番');
    nsfwTab.addEventListener('click', () => {
      curTab = 'nsfw';
      mainTabs.querySelectorAll('.anime-main-tab').forEach(tb => tb.classList.remove('on'));
      nsfwTab.classList.add('on');
      weekTabsWrap.style.display = 'none';
      todayBtn.style.display = 'none';
      searchBar.style.display = 'none';
      loadTab();
    });
    mainTabs.appendChild(nsfwTab);
  }

  const todayBtn = el('button', 'anime-today-btn', '今日');
  todayBtn.addEventListener('click', () => {
    curWd = todayWd;
    S.animeState.weekday = curWd;
    updateWeekTabs();
    loadTab();
  });

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

  const isMobile = !!container.closest('#mobile-layout');
  const curViewMode = () => S.animeState.viewMode || 'list';
  const grid = el('div', 'anime-grid');
  const applyGridMode = () => {
    if (curViewMode() === 'gallery') {
      grid.classList.add('gallery-mode');
      if (isMobile) grid.classList.add('gallery-mobile');
    } else {
      grid.classList.remove('gallery-mode', 'gallery-mobile');
    }
  };
  applyGridMode();
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

    // 觀看進度（只有追蹤中才顯示）
    if (isTracked) {
      const progressWrap = el('span', 'anime-watch-progress');
      progressWrap.dataset.id = anime.id;

      const updateProgressText = () => {
        const ep = S.animeState.trackedData?.[anime.id]?.watchedEp ?? 0;
        progressWrap.innerHTML = '';
        progressWrap.appendChild(document.createTextNode('觀看至 '));
        const numSpan = el('span', 'anime-watch-ep', String(ep));
        progressWrap.appendChild(numSpan);
        progressWrap.appendChild(document.createTextNode(' 集'));

        numSpan.addEventListener('click', e => {
          e.stopPropagation();
          const cur = S.animeState.trackedData?.[anime.id]?.watchedEp ?? 0;
          const inp = document.createElement('input');
          inp.type = 'text'; inp.inputMode = 'numeric'; inp.pattern = '[0-9]*';
          inp.autocomplete = 'new-password'; inp.spellcheck = false;
          inp.className = 'anime-watch-ep-input';
          inp.value = cur;
          numSpan.replaceWith(inp);
          inp.focus(); inp.select();
          let saved = false;
          const save = () => {
            if (saved) return; saved = true;
            const newVal = Math.max(0, parseInt(inp.value) || 0);
            if (S.animeState.trackedData?.[anime.id]) {
              S.animeState.trackedData[anime.id].watchedEp = newVal;
              lsSave();
            }
            // 同步所有相同 id 的進度元素
            document.querySelectorAll(`.anime-watch-progress[data-id="${anime.id}"] .anime-watch-ep`).forEach(sp => {
              sp.textContent = String(newVal);
            });
            updateProgressText();
          };
          inp.addEventListener('blur', save);
          inp.addEventListener('keydown', ev => {
            if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); }
            if (ev.key === 'Escape') { saved = true; updateProgressText(); }
          });
        });
      };
      updateProgressText();
      meta.appendChild(progressWrap);
    }

    const star = el('button', 'anime-star' + (isTracked ? ' on' : ''));
    star.innerHTML = `<svg viewBox="0 0 24 24" fill="${isTracked?'currentColor':'none'}" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;

    star.addEventListener('click', async e => {
      e.stopPropagation();
      if (!S.animeState.tracked) S.animeState.tracked = [];
      const idx = S.animeState.tracked.indexOf(anime.id);
      if (idx >= 0) {
        S.animeState.tracked.splice(idx, 1);
        // ⚠️ 不刪 trackedData，保留 watchedEp 等資料，重新收藏時進度還在
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
          air_weekday: wd, is_nsfw: !!anime.is_nsfw,
          watchedEp: S.animeState.trackedData?.[anime.id]?.watchedEp ?? 0
        };
        star.classList.add('on');
        star.querySelector('svg').setAttribute('fill', 'currentColor');
        card.classList.add('pinned');
      }
      lsSave();
      if (curTab !== 'search') loadTab();
    });

    card.addEventListener('click', e => {
      if (e.target.closest('.anime-star') || e.target.closest('img') || e.target.closest('.anime-watch-ep') || e.target.closest('.anime-watch-ep-input')) return;
      showAnimeSheet(anime);
    });

    if (curViewMode() === 'gallery') {
      // ── Gallery 模式 ──
      card.classList.add('anime-card--gallery');
      const coverWrap = el('div', 'anime-cover-wrap');
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', e => { e.stopPropagation(); showAnimeSheet(anime); showImageViewer(img.src, img.alt); });
      coverWrap.appendChild(img);
      // 星星疊加右上角
      coverWrap.appendChild(star);
      // 底部漸層遮罩 + badges
      const gradient = el('div', 'anime-cover-gradient');
      const coverBadges = el('div', 'anime-cover-badges');
      if (anime.rating?.score) coverBadges.appendChild(el('span', 'anime-card-badge badge-score', `★ ${anime.rating.score.toFixed(1)}`));
      if (anime.eps_count || anime.eps) coverBadges.appendChild(el('span', 'anime-card-badge badge-eps', `共 ${anime.eps_count || anime.eps} 集`));
      gradient.appendChild(coverBadges);
      coverWrap.appendChild(gradient);
      card.appendChild(coverWrap);
      // 圖片下方：標題 + 進度
      const galleryInfo = el('div', 'anime-gallery-info');
      galleryInfo.appendChild(titleEl);
      if (isTracked) {
        const progressWrap2 = meta.querySelector('.anime-watch-progress');
        if (progressWrap2) galleryInfo.appendChild(progressWrap2);
      }
      card.appendChild(galleryInfo);
    } else {
      // ── List 模式（原本）──
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', e => { e.stopPropagation(); showImageViewer(img.src, img.alt); });
      info.appendChild(titleEl);
      info.appendChild(meta);
      card.appendChild(img);
      card.appendChild(info);
      card.appendChild(star);
    }

    return card;
  }

  function renderItems(items, bgmWd) {
    applyGridMode();
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
    applyGridMode();
    grid.innerHTML = '';
    const tracked = S.animeState.tracked || [];
    if (!tracked.length) { grid.innerHTML = '<div class="anime-empty">還沒有收藏的番組</div>'; return; }

    if (curWd === ALL_WD) {
      const items = tracked.map(id => S.animeState.trackedData?.[id]).filter(a => a && (S.privateUnlocked || !(a.is_nsfw || a.id >= 10_000_000)));
      if (!items.length) { grid.innerHTML = '<div class="anime-empty">還沒有收藏的番組</div>'; return; }

      let dragSrcFavId = null;

      items.forEach(anime => {
        const card = makeAnimeCard(anime, anime.air_weekday);
        card.draggable = true;

        card.addEventListener('dragstart', e => {
          dragSrcFavId = String(anime.id);
          e.dataTransfer.effectAllowed = 'move';
          setTimeout(() => card.classList.add('anime-card-dragging'), 0);
        });
        card.addEventListener('dragend', () => {
          card.classList.remove('anime-card-dragging');
          grid.querySelectorAll('.anime-card-drag-over').forEach(c => c.classList.remove('anime-card-drag-over'));
          dragSrcFavId = null;
        });
        card.addEventListener('dragover', e => {
          e.preventDefault();
          if (String(anime.id) === dragSrcFavId) return;
          grid.querySelectorAll('.anime-card-drag-over').forEach(c => c.classList.remove('anime-card-drag-over'));
          card.classList.add('anime-card-drag-over');
        });
        card.addEventListener('drop', e => {
          e.preventDefault();
          if (!dragSrcFavId || dragSrcFavId === String(anime.id)) return;
          const si = S.animeState.tracked.indexOf(parseInt(dragSrcFavId));
          const di = S.animeState.tracked.indexOf(anime.id);
          if (si < 0 || di < 0) return;
          const [m] = S.animeState.tracked.splice(si, 1);
          S.animeState.tracked.splice(di, 0, m);
          lsSave(); setTimeout(() => renderFav(), 0);
        });

        // Touch drag (long press) — 改用動態掛載 passive:false 避免捲動衝突
        let tTimer = null, tDragging = false, tGhost = null, tRafId = null;
        let tGhostCenterX = 0; // 保留供相容，實際不再使用

        const tCleanup = () => {
          clearTimeout(tTimer);
          if (tRafId) { cancelAnimationFrame(tRafId); tRafId = null; window._dragScrollActive = false; }
          if (tGhost) { tGhost.remove(); tGhost = null; }
          card.classList.remove('anime-card-dragging');
          grid.querySelectorAll('.anime-card-drag-over').forEach(c => c.classList.remove('anime-card-drag-over'));
          tDragging = false;
        };

        let tClientY = 0;
        let tScrollDir = 0; // 1=往下, -1=往上, 0=不捲

        const tScroll = () => {
          if (!tDragging || tScrollDir === 0) {
            tRafId = null;
            window._dragScrollActive = false;
            return;
          }
          const gridRect = grid.getBoundingClientRect();
          const EDGE = 60;
          const ratio = tScrollDir > 0
            ? (tClientY - (gridRect.bottom - EDGE)) / EDGE
            : (gridRect.top + EDGE - tClientY) / EDGE;
          grid.scrollTop += tScrollDir * 12 * Math.min(1, Math.max(0, ratio));
          tRafId = requestAnimationFrame(tScroll);
        };

        const onTouchMove = e => {
          if (!tDragging) { clearTimeout(tTimer); return; }
          e.preventDefault();
          const t = e.touches[0];
          const prevY = tClientY;
          tClientY = t.clientY;

          // 更新 ghost 位置（差值累加，避免每幀 reflow）
          if (tGhost) {
            tGhost.style.top = (parseFloat(tGhost.style.top) + (tClientY - prevY)) + 'px';
          }

          // 判斷是否在邊緣，決定啟動或停止 rAF
          const gridRect = grid.getBoundingClientRect();
          const EDGE = 60;
          const newDir = tClientY < gridRect.top + EDGE ? -1
                       : tClientY > gridRect.bottom - EDGE ? 1 : 0;
          if (newDir !== tScrollDir) {
            tScrollDir = newDir;
            if (tScrollDir !== 0 && !tRafId) {
              window._dragScrollActive = true;
              tRafId = requestAnimationFrame(tScroll);
            }
          }

          // 偵測目標卡片（隱藏 ghost 避免自身干擾，用手指實際 X）
          if (tGhost) tGhost.style.display = 'none';
          const el2 = document.elementFromPoint(t.clientX, tClientY);
          if (tGhost) tGhost.style.display = '';
          const target = el2?.closest('.anime-card');
          grid.querySelectorAll('.anime-card-drag-over').forEach(c => c.classList.remove('anime-card-drag-over'));
          if (target && target !== card) target.classList.add('anime-card-drag-over');
        };

        const onTouchEnd = () => {
          if (tRafId) { cancelAnimationFrame(tRafId); window._dragScrollActive = false; tRafId = null; }
          document.removeEventListener('touchmove', onTouchMove);
          document.removeEventListener('touchend', onTouchEnd);
          document.removeEventListener('touchcancel', onTouchEnd);
          if (!tDragging) { clearTimeout(tTimer); return; }
          // 先找目標，再 cleanup（cleanup 會清掉 drag-over class）
          const over = grid.querySelector('.anime-card-drag-over');
          const wasDragging = tDragging;
          tCleanup();
          if (!wasDragging) return;
          if (over && over !== card) {
            const overId = parseInt(over.dataset.id);
            const si = S.animeState.tracked.indexOf(anime.id);
            const di = S.animeState.tracked.indexOf(overId);
            if (si >= 0 && di >= 0) {
              const [m] = S.animeState.tracked.splice(si, 1);
              S.animeState.tracked.splice(di, 0, m);
              lsSave();
            }
          }
          setTimeout(() => renderFav(), 0);
        };

        let tCardHalfH = 0; // card 高度一半，啟動時存一次避免每幀 reflow

        card.addEventListener('touchstart', e => {
          tClientY = e.touches[0].clientY;
          tTimer = setTimeout(() => {
            tDragging = true;
            tScrollDir = 0;
            const rect = card.getBoundingClientRect();
            tCardHalfH = rect.height / 2;
            tGhostCenterX = rect.left + rect.width / 2;
            tGhost = card.cloneNode(true);
            tGhost.style.cssText = `position:fixed;z-index:9999;opacity:.75;pointer-events:none;width:${card.offsetWidth}px;transform:scale(1.05);left:${rect.left}px;top:${rect.top}px;`;
            document.body.appendChild(tGhost);
            card.classList.add('anime-card-dragging');
            // rAF 由 onTouchMove 根據邊緣位置決定是否啟動
            document.addEventListener('touchmove', onTouchMove, { passive: false });
            document.addEventListener('touchend', onTouchEnd, { passive: true });
            document.addEventListener('touchcancel', onTouchEnd, { passive: true });
          }, 500);
        }, { passive: true });

        // touchstart 後移動超過 8px 才取消長按 timer
        let tStartX = 0, tStartY = 0;
        card.addEventListener('touchstart', e => {
          tStartX = e.touches[0].clientX;
          tStartY = e.touches[0].clientY;
        }, { passive: true });
        card.addEventListener('touchmove', e => {
          if (tDragging) return; // 已進入拖曳，由 onTouchMove 接管
          const dx = e.touches[0].clientX - tStartX;
          const dy = e.touches[0].clientY - tStartY;
          if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearTimeout(tTimer);
        }, { passive: true });
        card.addEventListener('touchend', () => { if (!tDragging) clearTimeout(tTimer); }, { passive: true });
        card.addEventListener('touchcancel', () => { if (!tDragging) clearTimeout(tTimer); }, { passive: true });

        grid.appendChild(card);
      });
    } else {
      const items = tracked
        .map(id => S.animeState.trackedData?.[id])
        .filter(a => a && a.air_weekday === curWd && (S.privateUnlocked || !(a.is_nsfw || a.id >= 10_000_000)));
      if (!items.length) { grid.innerHTML = '<div class="anime-empty">這天沒有收藏的番組</div>'; return; }
      items.forEach(anime => grid.appendChild(makeAnimeCard(anime, anime.air_weekday)));
    }
  }

  const doSearch = async () => {
    const q = searchInp.value.trim();
    if (!q) return;
    applyGridMode();
    grid.innerHTML = '<div class="anime-loading">搜尋中…</div>';
    try {
      if (S.privateUnlocked) {
        // AniList adult search
        const gql = `query($s:String){Page(page:1,perPage:20){media(search:$s,isAdult:true,type:ANIME,sort:POPULARITY_DESC){id title{romaji native}synonyms coverImage{large medium}averageScore episodes nextAiringEpisode{episode airingAt}}}}`;
        const res = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: gql, variables: { s: q } })
        });
        const json = await res.json();
        const media = json.data?.Page?.media || [];
        const items = media.map(m => {
          const t = m.title || {}, synonyms = m.synonyms || [], cover = m.coverImage || {};
          let nameCn = '';
          for (const s of synonyms) {
            if (/[\u4e00-\u9fff]/.test(s) && !/[\u3040-\u30ff]/.test(s)) { nameCn = s; break; }
          }
          return {
            id: 10_000_000 + (m.id || 0),
            name: t.native || t.romaji || '',
            name_cn: nameCn || t.native || t.romaji || '',
            images: { large: cover.large || cover.medium || '', common: cover.medium || cover.large || '' },
            rating: { score: m.averageScore ? Math.round(m.averageScore / 10 * 10) / 10 : 0 },
            eps: m.episodes || 0,
            source: 'anilist',
            is_nsfw: true,
            pub_index: m.nextAiringEpisode?.episode ? `第${m.nextAiringEpisode.episode}話` : '',
          };
        });
        renderItems(items);
      } else {
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
      }
    } catch(e) {
      grid.innerHTML = '<div class="anime-empty">搜尋失敗，請稍後再試</div>';
    }
  };
  searchBtn.addEventListener('click', doSearch);
  searchInp.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

  async function loadTab() {
    if (curTab === 'week' || curTab === 'nsfw') {
      if (!calendarCache) {
        grid.innerHTML = '<div class="anime-loading">載入中…</div>';
        try {
          const [bgmData, guomanData] = await Promise.all([
            fetchBangumiCalendar(),
            fetchGuomanData()
          ]);
          calendarCache = bgmData;
          S.animeState.nsfwCalendar = {};
          if (guomanData.length) mergeGuomanIntoCalendar(calendarCache, guomanData);
        }
        catch(e) { grid.innerHTML = '<div class="anime-empty">載入失敗</div>'; return; }
      }
      if (curTab === 'nsfw') {
        const nsfw = S.animeState.nsfwCalendar || {};
        renderItems(Object.values(nsfw).flat(), undefined);
        return;
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
                  // 插在 progressWrap 前面，確保順序：星數 → 集數 → 觀看至
                  const pw = metaEl.querySelector('.anime-watch-progress');
                  if (pw) metaEl.insertBefore(eb, pw);
                  else metaEl.appendChild(eb);
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
    inp.type = 'search'; inp.value = sheetTitle.textContent;
    inp.autocomplete = 'off'; inp.name = 'neocast-anime-title'; inp.spellcheck = false;
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
          case '劇迷':    a.href = `https://gimyai.tw/find/-------------.html?wd=${q}`; break;
          case 'Hanime1': a.href = `https://hanime1.me/search?query=${q}&type=&genre=&sort=&date=&duration=`; break;
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
      // ⚠️ 不刪 trackedData，保留 watchedEp，重新收藏時進度還在
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
        air_weekday: wd, is_nsfw: !!anime.is_nsfw,
        watchedEp: S.animeState.trackedData?.[anime.id]?.watchedEp ?? 0
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

  // 觀看進度（只有追蹤中才顯示，放在連結按鈕之前）
  if ((S.animeState.tracked || []).includes(anime.id)) {
    const progressRow = el('div', 'anime-sheet-progress-row');
    const minusBtn = el('button', 'anime-sheet-ep-btn', '－');
    const numDisplay = el('span', 'anime-sheet-ep-num');
    const plusBtn  = el('button', 'anime-sheet-ep-btn', '＋');

    const getEp = () => S.animeState.trackedData?.[anime.id]?.watchedEp ?? 0;
    const setEp = val => {
      if (!S.animeState.trackedData?.[anime.id]) return;
      S.animeState.trackedData[anime.id].watchedEp = Math.max(0, val);
      lsSave();
      numDisplay.textContent = String(S.animeState.trackedData[anime.id].watchedEp);
      // 同步卡片上的進度
      document.querySelectorAll(`.anime-watch-progress[data-id="${anime.id}"] .anime-watch-ep`).forEach(sp => {
        sp.textContent = String(S.animeState.trackedData[anime.id].watchedEp);
      });
    };

    numDisplay.textContent = String(getEp());
    numDisplay.title = '點擊輸入集數';

    numDisplay.addEventListener('click', e => {
      e.stopPropagation();
      const inp = document.createElement('input');
      inp.type = 'text'; inp.inputMode = 'numeric'; inp.pattern = '[0-9]*';
      inp.autocomplete = 'new-password'; inp.spellcheck = false;
      inp.className = 'anime-sheet-ep-input';
      inp.value = getEp();
      numDisplay.replaceWith(inp);
      inp.focus(); inp.select();
      let saved = false;
      const save = () => {
        if (saved) return; saved = true;
        const val = parseInt(inp.value);
        inp.replaceWith(numDisplay);
        if (!isNaN(val)) setEp(val);
        else numDisplay.textContent = String(getEp());
      };
      inp.addEventListener('blur', save);
      inp.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); }
        if (ev.key === 'Escape') { saved = true; inp.replaceWith(numDisplay); }
      });
    });

    minusBtn.addEventListener('click', e => { e.stopPropagation(); setEp(getEp() - 1); });
    plusBtn.addEventListener('click',  e => { e.stopPropagation(); setEp(getEp() + 1); });

    const labelPre = el('span', 'anime-sheet-ep-label', '觀看至');
    const labelSuf = el('span', 'anime-sheet-ep-label', '集');
    progressRow.appendChild(labelPre);
    progressRow.appendChild(minusBtn);
    progressRow.appendChild(numDisplay);
    progressRow.appendChild(plusBtn);
    progressRow.appendChild(labelSuf);
    sheet.appendChild(progressRow);
  }

  // 4 link buttons (placed BEFORE summary so visible immediately)
  const linkWrap = el('div', 'anime-sheet-btns');
  const isNsfwAnime = !!anime.is_nsfw;
  const linkDefs = isNsfwAnime ? [
    { label: 'AniList', url: `https://anilist.co/anime/${anime.id - 10_000_000}` },
    { label: '動畫瘋', url: '' },
    { label: 'YouTube', url: '' },
    { label: 'Hanime1', url: '' },
  ] : [
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
  if (isNsfwAnime) {
    summaryEl.textContent = '（暫無故事大綱）';
    const displayName = S.animeState.customNames?.[anime.id] || anime.name_cn || anime.name;
    const q = encodeURIComponent(displayName);
    linkWrap.querySelectorAll('.anime-sheet-link-btn').forEach(a => {
      switch(a.dataset.label) {
        case '動畫瘋': a.href = `https://ani.gamer.com.tw/search.php?keyword=${q}`; break;
        case 'YouTube': a.href = `https://www.youtube.com/results?search_query=${q}`; break;
        case 'Hanime1': a.href = `https://hanime1.me/search?query=${q}&type=&genre=&sort=&date=&duration=`; break;
      }
    });
  } else {
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
}

/* ─────────────────────────────────────
   YOUTUBE SUBSCRIPTION FEED WIDGET
───────────────────────────────────── */

function parseDuration(iso) {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1]||0)*3600) + (parseInt(m[2]||0)*60) + parseInt(m[3]||0);
}

function fmtDuration(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function fmtNum(n) {
  if (n == null) return '—';
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '億';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '萬';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString();
}

function fmtRelTime(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)   return '剛剛';
  if (diff < 3600) return `${Math.floor(diff/60)} 分鐘前`;
  if (diff < 86400) return `${Math.floor(diff/3600)} 小時前`;
  if (diff < 86400*30) return `${Math.floor(diff/86400)} 天前`;
  if (diff < 86400*365) return `${Math.floor(diff/86400/30)} 個月前`;
  return `${Math.floor(diff/86400/365)} 年前`;
}

// Resolve channel ID from URL or handle or raw ID
async function resolveChannelId(input) {
  const key = S.cfg.ytApiKey?.trim();
  if (!key) throw new Error('請先填入 API Key');
  input = input.trim();

  // Extract from URL patterns
  let handle = null, rawId = null;
  const urlMatch = input.match(/youtube\.com\/@([\w.-]+)/);
  const idMatch  = input.match(/youtube\.com\/channel\/(UC[\w-]+)/);
  if (urlMatch)      handle = urlMatch[1];
  else if (idMatch)  rawId  = idMatch[1];
  else if (input.startsWith('@')) handle = input.slice(1);
  else if (input.startsWith('UC')) rawId = input;
  else handle = input; // treat as handle

  if (rawId) {
    // Verify and get name
    const r = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${rawId}&key=${key}`);
    const d = await r.json();
    const ch = d.items?.[0];
    if (!ch) throw new Error('找不到頻道');
    return { id: ch.id, name: ch.snippet.title, thumb: ch.snippet.thumbnails?.default?.url || '' };
  } else {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet&forHandle=${encodeURIComponent(handle)}&key=${key}`);
    const d = await r.json();
    const ch = d.items?.[0];
    if (!ch) throw new Error('找不到頻道，請確認 handle 或網址');
    return { id: ch.id, name: ch.snippet.title, thumb: ch.snippet.thumbnails?.default?.url || '' };
  }
}

async function fetchChannelVideos(channelId, key) {
  const ch = S.yt.channels.find(c => c.id === channelId);

  // Step 1: get uploads playlist ID (cached in ch.uploadsId)
  let uploadsId = ch?.uploadsId;
  if (!uploadsId) {
    const cr = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${key}`);
    const cd = await cr.json();
    uploadsId = cd.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsId) return [];
    // Cache it
    if (ch) { ch.uploadsId = uploadsId; lsSave(); }
  }

  // Step 2: get latest videos from uploads playlist
  const pr = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${uploadsId}&key=${key}`);
  if (pr.status === 403) throw new Error('403 YouTube API 配額超限');
  const pd = await pr.json();
  const items = (pd.items || []).map(item => ({
    videoId:     item.snippet.resourceId.videoId,
    title:       item.snippet.title,
    thumb:       item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
    publishedAt: item.snippet.publishedAt,
    channelId:   channelId,
    channelName: item.snippet.channelTitle,
    duration:    0
  }));

  // Step 3: batch fetch duration + statistics
  if (items.length) {
    const ids = items.map(v => v.videoId).join(',');
    const dr = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics&id=${ids}&key=${key}`);
    const dd = await dr.json();
    const dataMap = {};
    (dd.items || []).forEach(v => {
      dataMap[v.id] = {
        duration:  parseDuration(v.contentDetails?.duration),
        viewCount: parseInt(v.statistics?.viewCount || 0),
        likeCount: parseInt(v.statistics?.likeCount || 0)
      };
    });
    items.forEach(v => {
      const d = dataMap[v.videoId] || {};
      v.duration  = d.duration  || 0;
      v.viewCount = d.viewCount || 0;
      v.likeCount = d.likeCount || 0;
    });
  }

  return items;
}

// YouTube 配額超限保護：記錄到明天台灣時間 08:00
function ytQuotaExceededUntil() {
  const val = localStorage.getItem('yt_quota_exceeded_until');
  return val ? parseInt(val) : 0;
}
function setYtQuotaExceeded() {
  // 計算明天台灣時間 08:00（UTC+8）
  const now = new Date();
  const twNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const tomorrow = new Date(Date.UTC(twNow.getUTCFullYear(), twNow.getUTCMonth(), twNow.getUTCDate() + 1, 0, 0, 0)); // UTC 00:00 = 台灣 08:00
  localStorage.setItem('yt_quota_exceeded_until', tomorrow.getTime());
}
function clearYtQuotaExceeded() {
  localStorage.removeItem('yt_quota_exceeded_until');
}

async function fetchYoutubeFeed(force = false) {
  const CACHE_MIN = 30;
  // 配額超限時不再嘗試（直到明天台灣時間 08:00）
  if (!force && Date.now() < ytQuotaExceededUntil()) return S.yt.items || [];
  if (!force && S.yt.fetchedAt && (Date.now() - S.yt.fetchedAt) < CACHE_MIN * 60000) {
    return S.yt.items;
  }
  const key = S.cfg.ytApiKey?.trim();
  if (!key || !S.yt.channels?.length) return [];

  const results = await Promise.allSettled(
    S.yt.channels.map(ch => fetchChannelVideos(ch.id, key))
  );

  // 檢查是否有 403 配額超限
  const has403 = results.some(r => r.status === 'rejected' && r.reason?.message?.includes('403'));
  if (has403) {
    setYtQuotaExceeded();
    console.warn('[NeoCast] YouTube API 配額超限，停止自動重試直到明天 08:00');
    toast('YouTube API 配額已用完，台灣時間 08:00 後重置', 'warn');
    return S.yt.items || [];
  }

  const items = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  clearYtQuotaExceeded();
  S.yt.fetchedAt = Date.now();
  S.yt.items = items;
  lsSave();
  return items;
}

function startYtGrpRename(wrap, tab, oldName) {
  const inp = el('input', 'yt-grp-inline-input');
  inp.type = 'search'; inp.value = oldName;
  inp.autocomplete = 'new-password'; inp.spellcheck = false;
  tab.replaceWith(inp); inp.focus(); inp.select();
  const save = () => {
    const val = inp.value.trim();
    if (val && val !== oldName && !(S.yt.groups || []).includes(val)) {
      const idx = (S.yt.groups || []).indexOf(oldName);
      if (idx >= 0) S.yt.groups[idx] = val;
      S.yt.channels.forEach(ch => { const ti = (ch.groups || []).indexOf(oldName); if (ti >= 0) ch.groups[ti] = val; });
      lsSave();
    }
    // 重繪 groupBar
    const container = wrap.closest('.yt-inner, [data-wid="youtube"]');
    if (container) {
      // 找到 renderGroupBar 的方式：觸發 ⚙ 按鈕重繪
      const bar = wrap.closest('.yt-group-bar');
      bar?._renderGroupBar?.();
    }
  };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } if (e.key === 'Escape') inp.blur(); });
  inp.addEventListener('blur', save);
}

function initYtGrpDrag(groupBar) {
  const wraps = [...groupBar.querySelectorAll('.yt-grp-tag-wrap.edit')];
  let dragG = null;

  wraps.forEach(wrap => {
    const g = wrap.dataset.g;

    // Desktop
    wrap.draggable = true;
    wrap.addEventListener('dragstart', e => {
      dragG = g; e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => wrap.classList.add('yt-grp-tag-dragging'), 0);
    });
    wrap.addEventListener('dragend', () => {
      wrap.classList.remove('yt-grp-tag-dragging');
      groupBar.querySelectorAll('.yt-grp-tag-drag-over').forEach(c => c.classList.remove('yt-grp-tag-drag-over'));
      dragG = null;
    });
    wrap.addEventListener('dragover', e => {
      e.preventDefault(); if (g === dragG) return;
      groupBar.querySelectorAll('.yt-grp-tag-drag-over').forEach(c => c.classList.remove('yt-grp-tag-drag-over'));
      wrap.classList.add('yt-grp-tag-drag-over');
    });
    wrap.addEventListener('drop', e => {
      e.preventDefault(); if (!dragG || dragG === g) return;
      const si = S.yt.groups.indexOf(dragG), di = S.yt.groups.indexOf(g);
      if (si < 0 || di < 0) return;
      const [m] = S.yt.groups.splice(si, 1); S.yt.groups.splice(di, 0, m);
      lsSave(); groupBar._renderGroupBar?.();
    });

    // Mobile — 標準做法
    let tTimer = null, tDragging = false, tGhost = null, tRafId = null;
    let tClientY = 0, tScrollDir = 0, tStartX = 0, tStartY = 0;
    let tGhostFixedLeft = 0;

    const tCleanup = () => {
      clearTimeout(tTimer);
      if (tRafId) { cancelAnimationFrame(tRafId); tRafId = null; }
      if (tGhost) { tGhost.remove(); tGhost = null; }
      wrap.classList.remove('yt-grp-tag-dragging');
      groupBar.querySelectorAll('.yt-grp-tag-drag-over').forEach(c => c.classList.remove('yt-grp-tag-drag-over'));
      tDragging = false; tScrollDir = 0;
    };

    const scrollEl = groupBar.closest('.yt-inner, .yt-widget-body') || groupBar.parentElement;

    const tScroll = () => {
      if (!tDragging || tScrollDir === 0) { tRafId = null; return; }
      const rect = groupBar.getBoundingClientRect();
      const EDGE = 50;
      const ratio = tScrollDir > 0 ? (tClientY - (rect.bottom - EDGE)) / EDGE : (rect.top + EDGE - tClientY) / EDGE;
      groupBar.scrollLeft += tScrollDir * 8 * Math.min(1, Math.max(0, ratio));
      tRafId = requestAnimationFrame(tScroll);
    };

    const onTouchMove = e => {
      if (!tDragging) return;
      e.preventDefault();
      const t = e.touches[0];
      const prevY = tClientY; tClientY = t.clientY;
      // ghost X Y 都跟著手指動（wrap 排列是換行的）
      if (tGhost) {
        tGhost.style.top = (parseFloat(tGhost.style.top) + (tClientY - prevY)) + 'px';
        tGhost.style.left = (t.clientX - tGhost.offsetWidth / 2) + 'px';
      }

      const barRect = groupBar.getBoundingClientRect();
      const EDGE = 50;
      const newDir = t.clientX < barRect.left + EDGE ? -1 : t.clientX > barRect.right - EDGE ? 1 : 0;
      if (newDir !== tScrollDir) {
        tScrollDir = newDir;
        if (tScrollDir !== 0 && !tRafId) tRafId = requestAnimationFrame(tScroll);
      }

      if (tGhost) tGhost.style.display = 'none';
      const el2 = document.elementFromPoint(t.clientX, tClientY);
      if (tGhost) tGhost.style.display = '';
      const target = el2?.closest('.yt-grp-tag-wrap.edit');
      groupBar.querySelectorAll('.yt-grp-tag-drag-over').forEach(c => c.classList.remove('yt-grp-tag-drag-over'));
      if (target && target !== wrap) target.classList.add('yt-grp-tag-drag-over');
    };

    const onTouchEnd = () => {
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      if (!tDragging) { clearTimeout(tTimer); return; }
      const over = groupBar.querySelector('.yt-grp-tag-drag-over');
      tCleanup();
      if (over && over !== wrap) {
        const si = S.yt.groups.indexOf(g), di = S.yt.groups.indexOf(over.dataset.g);
        if (si >= 0 && di >= 0) {
          const [m] = S.yt.groups.splice(si, 1); S.yt.groups.splice(di, 0, m);
          lsSave();
        }
      }
      groupBar._renderGroupBar?.();
    };

    wrap.addEventListener('touchstart', e => {
      tStartX = e.touches[0].clientX; tStartY = e.touches[0].clientY; tClientY = tStartY;
      tTimer = setTimeout(() => {
        tDragging = true;
        const rect = wrap.getBoundingClientRect();
        tGhostFixedLeft = rect.left;
        tGhost = wrap.cloneNode(true);
        tGhost.style.cssText = `position:fixed;z-index:9999;opacity:.8;pointer-events:none;left:${rect.left}px;top:${rect.top}px;`;
        document.body.appendChild(tGhost);
        wrap.classList.add('yt-grp-tag-dragging');
        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', onTouchEnd, { passive: true });
      }, 500);
    }, { passive: true });

    wrap.addEventListener('touchmove', e => {
      if (tDragging) return;
      const dx = e.touches[0].clientX - tStartX, dy = e.touches[0].clientY - tStartY;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearTimeout(tTimer);
    }, { passive: true });
    wrap.addEventListener('touchend', () => { if (!tDragging) clearTimeout(tTimer); }, { passive: true });
    wrap.addEventListener('touchcancel', () => { tCleanup(); }, { passive: true });
  });
}

function buildYoutubeWidget() {
  const body = el('div', 'yt-inner');
  body.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;min-height:0;';
  const w = makeWidget('youtube', '訂閱更新', body, '');
  w.querySelector('.w-body')?.remove();
  w.insertBefore(body, w.querySelector('.resize-handle'));

  // 建立 ⚙ ↺ 並插入 w-head（在鉛筆按鈕前）
  const wHead = w.querySelector('.w-head');
  const pencilBtn = wHead?.querySelector('.w-pencil-btn');

  const addBtn = el('button', 'yt-icon-btn');
  addBtn.title = '管理頻道';
  addBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

  const refBtn = el('button', 'yt-icon-btn');
  refBtn.title = '重新整理';
  refBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;

  if (wHead && pencilBtn) {
    wHead.insertBefore(refBtn, pencilBtn);
    wHead.insertBefore(addBtn, refBtn);
  }

  renderYoutubeWidget(body, addBtn, refBtn);

  // 隱藏 renderYoutubeWidget 建立的 mHead
  const mHead = body.querySelector('.yt-mobile-head');
  if (mHead) mHead.style.display = 'none';
}

function applyYtFontSize() {
  const listSize = (S.cfg.ytFontSizeList || 100) / 100;
  const sheetSize = (S.cfg.ytFontSizeSheet || 100) / 100;
  const root = document.documentElement;
  root.style.setProperty('--yt-list-fs', listSize);
  root.style.setProperty('--yt-sheet-fs', sheetSize);
}

function renderYoutubeWidget(container, addBtnRef, refBtnRef) {
  container.innerHTML = '';

  let activeChannelId = null;
  let activeGroups = new Set(); // empty = show all
  let singlePage = 0;
  const PER_CHANNEL_ALL = 3;
  const PER_CHANNEL_SINGLE = 10;

  // Ensure all channels have groups array
  (S.yt.channels || []).forEach(ch => {
    if (!ch.groups) ch.groups = ch.group ? [ch.group] : [];
    delete ch.group;
  });

  // ── Mobile head ──
  let addBtn = addBtnRef;
  let refBtn = refBtnRef;
  if (!addBtn) {
    const mHead = el('div', 'yt-mobile-head');
    const mTitle = el('span', 'yt-head-title', '訂閱更新');
    const mRight = el('div', 'yt-head-right');
    addBtn = el('button', 'yt-icon-btn');
    addBtn.title = '管理頻道';
    addBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
    refBtn = el('button', 'yt-icon-btn');
    refBtn.title = '重新整理';
    refBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
    mRight.appendChild(addBtn); mRight.appendChild(refBtn);
    mHead.appendChild(mTitle); mHead.appendChild(mRight);
    container.appendChild(mHead);
  } else {
    // Desktop: update addBtn icon to settings gear
    addBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
    addBtn.title = '管理頻道';
  }

  // ── Group filter bar (multi-select) ──
  const groupBar = el('div', 'yt-group-bar');
  container.appendChild(groupBar);
  let grpEditMode = false;

  const renderGroupBar = () => {
    groupBar.innerHTML = '';

    // 全部（固定）
    const allBtn = el('button', 'yt-group-tab' + (activeGroups.size === 0 ? ' on' : ''), '全部');
    allBtn.addEventListener('click', () => { if (grpEditMode) return; activeGroups.clear(); renderGroupBar(); renderFeed(); });
    groupBar.appendChild(allBtn);

    (S.yt.groups || []).forEach(g => {
      const wrap = el('div', 'yt-grp-tag-wrap' + (grpEditMode ? ' edit' : ''));
      wrap.dataset.g = g;

      const tab = el('button', 'yt-group-tab' + (activeGroups.has(g) ? ' on' : ''), g);
      if (grpEditMode) {
        tab.addEventListener('click', e => { e.stopPropagation(); startYtGrpRename(wrap, tab, g); });
      } else {
        tab.addEventListener('click', () => {
          if (activeGroups.has(g)) activeGroups.delete(g); else activeGroups.add(g);
          renderGroupBar(); renderFeed();
        });
      }
      wrap.appendChild(tab);

      // ✕ 刪除按鈕（跟新聞 kw-del 一樣，平時隱藏，編輯模式顯示）
      const x = el('button', 'yt-grp-tag-x');
      x.textContent = '✕';
      x.title = '刪除分組';
      x.addEventListener('click', e => {
        e.stopPropagation();
        if (!confirm(`刪除分組「${g}」？（頻道不會被刪除）`)) return;
        S.yt.groups = (S.yt.groups || []).filter(v => v !== g);
        S.yt.channels.forEach(ch => { ch.groups = (ch.groups || []).filter(v => v !== g); });
        activeGroups.delete(g);
        lsSave(); renderGroupBar(); renderChList(); renderFeed();
      });
      wrap.appendChild(x);

      groupBar.appendChild(wrap);
    });

    // 管理模式下顯示 ＋ 新增
    if (grpEditMode) {
      const addChip = el('button', 'yt-group-tab yt-grp-add-chip', '＋');
      addChip.addEventListener('click', () => {
        const inp = el('input', 'yt-grp-inline-input');
        inp.type = 'search'; inp.placeholder = '分組名稱';
        inp.autocomplete = 'new-password'; inp.spellcheck = false;
        addChip.replaceWith(inp); inp.focus();
        const save = () => {
          const val = inp.value.trim();
          if (val && !(S.yt.groups || []).includes(val)) {
            if (!S.yt.groups) S.yt.groups = [];
            S.yt.groups.push(val);
            lsSave();
          }
          renderGroupBar();
        };
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') renderGroupBar(); });
        inp.addEventListener('blur', save);
      });
      groupBar.appendChild(addChip);
    }

    // 管理模式下啟用拖曳排序
    if (grpEditMode) initYtGrpDrag(groupBar);
    groupBar._renderGroupBar = renderGroupBar;
  };
  renderGroupBar();

  // ── Duration filter bar ──
  const DUR_OPTS = [0, 5, 10, 15, 20, 25, 30]; // 0 = 不限
  let activeDur = 0; // 目前選中的分鐘上限（0 = 不限）

  const durBar = el('div', 'yt-dur-bar');
  container.appendChild(durBar);

  const renderDurBar = () => {
    durBar.innerHTML = '';
    DUR_OPTS.forEach(min => {
      const label = min === 0 ? '不限' : `${min}分`;
      const btn = el('button', 'yt-group-tab' + (activeDur === min ? ' on' : ''), label);
      btn.addEventListener('click', () => { activeDur = min; renderDurBar(); renderFeed(); });
      durBar.appendChild(btn);
    });
  };
  renderDurBar();

  // ── Manager panel ──
  const managerPanel = el('div', 'yt-manager');
  managerPanel.style.display = 'none';

  // Add channel section
  const addSection = el('div', 'yt-mgr-section');
  const inputRow = el('div', 'yt-input-row');
  const inp = el('input', 'yt-ch-input');
  inp.type = 'search'; inp.autocomplete = 'off'; inp.name = 'neocast-yt-ch';
  inp.placeholder = '@頻道名稱 或貼上頻道網址'; inp.spellcheck = false;
  const addConfirmBtn = el('button', 'yt-add-confirm-btn', '新增');
  const addStatus = el('div', 'yt-add-status');
  inputRow.appendChild(inp); inputRow.appendChild(addConfirmBtn);
  addSection.appendChild(inputRow); addSection.appendChild(addStatus);
  managerPanel.appendChild(addSection);

  // Channel list section
  const chListSection = el('div', 'yt-mgr-section');
  const chListTitle = el('div', 'yt-mgr-title', '頻道');
  const chList = el('div', 'yt-ch-list');
  chListSection.appendChild(chListTitle); chListSection.appendChild(chList);
  managerPanel.appendChild(chListSection);

  // ── 字體大小設定 ──
  const fontSection = el('div', 'yt-mgr-section');
  fontSection.appendChild(el('div', 'yt-mgr-title', '字體大小'));

  const makeFontRow = (label, cfgKey) => {
    if (!S.cfg[cfgKey]) S.cfg[cfgKey] = 100;
    const row = el('div', 'yt-font-row');
    row.appendChild(el('span', 'yt-font-label', label));
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = 100; slider.max = 200; slider.step = 5;
    slider.value = S.cfg[cfgKey];
    slider.className = 'yt-font-slider';
    const val = el('span', 'yt-font-val', S.cfg[cfgKey] + '%');
    slider.addEventListener('input', () => {
      S.cfg[cfgKey] = parseInt(slider.value);
      val.textContent = slider.value + '%';
      applyYtFontSize();
      lsSave();
    });
    row.appendChild(slider);
    row.appendChild(val);
    fontSection.appendChild(row);
  };

  makeFontRow('列表文字', 'ytFontSizeList');
  makeFontRow('卡片文字', 'ytFontSizeSheet');
  managerPanel.appendChild(fontSection);

  // Group management section
  let selectedTagId = null; // "chId:tagName" for channel tags

  // Click outside to deselect tag
  document.addEventListener('click', function deselectAll(e) {
    if (!container.isConnected) { document.removeEventListener('click', deselectAll); return; }
    if (!chList.contains(e.target) && selectedTagId) { selectedTagId = null; renderChList(); }
  });

  const renderChList = () => {
    chList.innerHTML = '';
    if (!S.yt.channels?.length) {
      chList.innerHTML = '<div class="yt-ch-empty">尚未新增頻道</div>'; return;
    }
    S.yt.channels.forEach(ch => {
      if (!ch.groups) ch.groups = [];
      const row = el('div', 'yt-ch-row');

      const left = el('div', 'yt-ch-row-left');
      if (ch.thumb) { const av = el('img','yt-ch-avatar'); av.src=ch.thumb; av.alt=ch.name; left.appendChild(av); }
      left.appendChild(el('span', 'yt-ch-name', ch.name));
      row.appendChild(left);

      // Tags area
      const tagsArea = el('div', 'yt-ch-tags');
      ch.groups.forEach(g => {
        const tagKey = ch.id + ':' + g;
        const tag = el('span', 'yt-ch-tag' + (selectedTagId === tagKey ? ' selected' : ''), g);
        tag.addEventListener('click', e => {
          e.stopPropagation();
          selectedTagId = selectedTagId === tagKey ? null : tagKey;
          renderChList();
        });
        const delBtn = el('button', 'yt-tag-del' + (selectedTagId === tagKey ? ' visible' : ''), '✕');
        delBtn.addEventListener('click', e => {
          e.stopPropagation();
          ch.groups = ch.groups.filter(x => x !== g);
          selectedTagId = null;
          lsSave(); renderChList();
        });
        tag.appendChild(delBtn);
        tagsArea.appendChild(tag);
      });

      // Add tag button — opens modal
      const addTagBtn = el('button', 'yt-tag-add', '＋');
      addTagBtn.title = '新增分組標籤';
      addTagBtn.addEventListener('click', e => {
        e.stopPropagation();
        showYtGroupPicker(ch, () => renderChList());
      });
      tagsArea.appendChild(addTagBtn);
      row.appendChild(tagsArea);

      // Delete channel button
      const delBtn = el('button', 'yt-ch-del visible', '✕');
      delBtn.title = '移除頻道';
      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        S.yt.channels = S.yt.channels.filter(c => c.id !== ch.id);
        S.yt.items = (S.yt.items||[]).filter(v => v.channelId !== ch.id);
        S.yt.fetchedAt = 0;
        lsSave(); renderChList(); renderFeed();
      });
      row.appendChild(delBtn);
      chList.appendChild(row);
    });
  };

  // Add channel
  const doAdd = async () => {
    const val = inp.value.trim();
    if (!val) return;
    if (!S.cfg.ytApiKey?.trim()) { addStatus.textContent = '請先填入 API Key'; addStatus.className = 'yt-add-status error'; return; }
    addStatus.textContent = '搜尋中...'; addStatus.className = 'yt-add-status';
    addConfirmBtn.disabled = true;
    try {
      const ch = await resolveChannelId(val);
      if (S.yt.channels.find(c => c.id === ch.id)) { addStatus.textContent = '此頻道已在清單中'; addStatus.className = 'yt-add-status error'; return; }
      ch.groups = [];
      S.yt.channels.unshift(ch); S.yt.fetchedAt = 0; lsSave();
      inp.value = ''; addStatus.textContent = `已新增「${ch.name}」`; addStatus.className = 'yt-add-status ok';
      renderChList(); fetchYoutubeFeed(true).then(() => renderFeed());
    } catch(e) { addStatus.textContent = e.message; addStatus.className = 'yt-add-status error'; }
    finally { addConfirmBtn.disabled = false; }
  };
  addConfirmBtn.addEventListener('click', doAdd);
  inp.addEventListener('keydown', e => e.key === 'Enter' && doAdd());

  let managerOpen = false;
  addBtn.addEventListener('click', e => {
    e.stopPropagation();
    managerOpen = !managerOpen;
    grpEditMode = managerOpen; // 開管理面板時同步開啟標籤編輯模式
    managerPanel.style.display = managerOpen ? '' : 'none';
    addBtn.classList.toggle('active', managerOpen);
    renderGroupBar(); // 重繪標籤列（加/移除編輯模式）
    if (managerOpen) { renderChList(); inp.focus(); }
  });
  container.appendChild(managerPanel);

  // ── Breadcrumb ──
  const breadcrumb = el('div', 'yt-breadcrumb');
  breadcrumb.style.display = 'none';
  container.appendChild(breadcrumb);

  // ── Feed ──
  const feed = el('div', 'yt-feed');
  container.appendChild(feed);

  const renderFeed = () => {
    feed.innerHTML = '';
    breadcrumb.innerHTML = ''; breadcrumb.style.display = 'none';

    if (!S.cfg.ytApiKey?.trim()) { feed.innerHTML = '<div class="yt-empty">請在設定中填入 YouTube API Key</div>'; return; }
    if (!S.yt.channels?.length) { feed.innerHTML = '<div class="yt-empty">點右上角 ⚙ 新增頻道</div>'; return; }

    // Filter channels by active groups (empty = all)
    const visibleChannels = activeGroups.size === 0
      ? S.yt.channels
      : S.yt.channels.filter(c => (c.groups||[]).some(g => activeGroups.has(g)));

    const allItems = (S.yt.items || []).filter(v =>
      visibleChannels.find(c => c.id === v.channelId) &&
      (activeDur === 0 || (v.duration > 0 && v.duration <= activeDur * 60))
    );

  const makeVideoCard = (video) => {
    const watched = (S.yt.watched||[]).includes(video.videoId);
    const card = el('div', 'yt-card' + (watched ? ' yt-watched' : ''));
    const thumbWrap = el('div', 'yt-thumb');
    const img = el('img');
    img.src = video.thumb; img.alt = video.title; img.loading = 'lazy';
    thumbWrap.appendChild(img);

    // Duration badge
    if (video.duration > 0) {
      const dur = el('span', 'yt-dur-badge', fmtDuration(video.duration));
      thumbWrap.appendChild(dur);
    }

    // Watched badge
    if (watched) {
      const wb = el('span', 'yt-watched-badge', '已觀看');
      thumbWrap.appendChild(wb);
    }

    thumbWrap.addEventListener('click', e => {
      e.stopPropagation();
      const vid = video.videoId;
      const maxRes = `https://i.ytimg.com/vi/${vid}/maxresdefault.jpg`;
      const hqRes  = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
      const testImg = new Image();
      testImg.onload = () => showYtImageViewer(testImg.naturalWidth > 120 ? maxRes : hqRes);
      testImg.onerror = () => showYtImageViewer(hqRes);
      testImg.src = maxRes;
    });
    card.appendChild(thumbWrap);
    const info = el('div', 'yt-info');
    info.appendChild(el('div', 'yt-title', video.title));
    const metaParts = [video.channelName];
    if (video.viewCount > 0) metaParts.push(`👁 ${fmtNum(video.viewCount)}`);
    metaParts.push(fmtRelTime(video.publishedAt));
    const meta = el('span', 'yt-meta-text', metaParts.join('．'));
    info.appendChild(meta);
    card.appendChild(info);
    card.addEventListener('click', () => {
      // 輪播排序：各頻道輪流各出最新一部
      // 頻道A第1新, 頻道B第1新, ... 頻道A第2新, 頻道B第2新...
      const channelOrder = [];
      const seen = new Set();
      allItems.forEach(v => { if (!seen.has(v.channelId)) { seen.add(v.channelId); channelOrder.push(v.channelId); } });
      const byChannel = {};
      channelOrder.forEach(id => { byChannel[id] = allItems.filter(v => v.channelId === id); });
      const roundRobin = [];
      const maxLen = Math.max(...channelOrder.map(id => byChannel[id].length));
      for (let i = 0; i < maxLen; i++) {
        channelOrder.forEach(id => { if (byChannel[id][i]) roundRobin.push(byChannel[id][i]); });
      }
      const startIdx = roundRobin.findIndex(v => v.videoId === video.videoId);
      showYtSheet(video, renderFeed, roundRobin, startIdx >= 0 ? startIdx : 0);
    });
    return card;
  };

    if (activeChannelId) {
      const ch = S.yt.channels.find(c => c.id === activeChannelId);
      breadcrumb.style.display = '';
      const backBtn = el('button', 'yt-nav-btn');
      backBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><polyline points="15 18 9 12 15 6"/></svg> 全部`;
      backBtn.addEventListener('click', () => { activeChannelId = null; singlePage = 0; renderFeed(); });
      breadcrumb.appendChild(backBtn);
      breadcrumb.appendChild(el('span', 'yt-breadcrumb-name', ch?.name || ''));

      const chItems = allItems.filter(v => v.channelId === activeChannelId);
      const pageItems = chItems.slice(0, (singlePage + 1) * PER_CHANNEL_SINGLE);
      if (!pageItems.length) { feed.innerHTML = '<div class="yt-empty">此頻道尚無影片</div>'; return; }
      pageItems.forEach(v => feed.appendChild(makeVideoCard(v)));
      if (chItems.length > pageItems.length) {
        const lb = el('button', 'yt-load-more');
        lb.innerHTML = '<span class="yt-load-more-icon">↓</span> 載入更多';
        lb.addEventListener('click', () => { singlePage++; renderFeed(); });
        feed.appendChild(lb);
      } else if (chItems.length >= PER_CHANNEL_SINGLE) {
        feed.appendChild(el('div', 'yt-end-note', '已載入所有快取影片'));
      }
    } else {
      if (!allItems.length) { feed.innerHTML = '<div class="yt-empty yt-loading"><span class="yt-spin">↻</span> 載入中...</div>'; return; }
      const seen = new Set(); const order = [];
      allItems.forEach(v => { if (!seen.has(v.channelId)) { seen.add(v.channelId); order.push(v.channelId); } });
      order.forEach(chId => {
        const ch = S.yt.channels.find(c => c.id === chId);
        const items = allItems.filter(v => v.channelId === chId).slice(0, PER_CHANNEL_ALL);
        const chRow = el('div', 'yt-ch-section-header');
        const chLeft = el('div', 'yt-ch-section-left');
        if (ch?.thumb) { const av = el('img','yt-ch-avatar-sm'); av.src=ch.thumb; av.alt=ch.name; chLeft.appendChild(av); }
        chLeft.appendChild(el('span', 'yt-ch-section-name', ch?.name || chId));
        chRow.appendChild(chLeft);
        const moreBtn = el('button', 'yt-nav-btn');
        moreBtn.innerHTML = `更多 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><polyline points="9 18 15 12 9 6"/></svg>`;
        moreBtn.addEventListener('click', () => { activeChannelId = chId; singlePage = 0; renderFeed(); feed.scrollTop = 0; container.scrollTop = 0; });
        chRow.appendChild(moreBtn);
        feed.appendChild(chRow);
        items.forEach(v => feed.appendChild(makeVideoCard(v)));
      });
    }
  };

  let spinning = false;
  refBtn.addEventListener('click', async () => {
    if (spinning) return; spinning = true; refBtn.classList.add('spin');
    try { await fetchYoutubeFeed(true); renderFeed(); }
    catch(e) { feed.innerHTML = `<div class="yt-empty" style="color:#f66">${e.message}</div>`; }
    finally { spinning = false; refBtn.classList.remove('spin'); }
  });

  renderFeed();
}

function showYtGroupPicker(ch, onDone) {
  document.querySelector('.yt-grp-picker-overlay')?.remove();
  const overlay = el('div', 'yt-grp-picker-overlay');
  const modal = el('div', 'yt-grp-picker-modal');

  const title = el('div', 'yt-grp-picker-title', `分組標籤 — ${ch.name}`);
  modal.appendChild(title);

  const grid = el('div', 'yt-grp-picker-grid');
  (S.yt.groups || []).forEach(g => {
    const on = ch.groups.includes(g);
    const btn = el('button', 'yt-grp-picker-btn' + (on ? ' on' : ''), g);
    btn.addEventListener('click', () => {
      if (ch.groups.includes(g)) {
        ch.groups = ch.groups.filter(x => x !== g);
        btn.classList.remove('on');
      } else {
        ch.groups.push(g);
        btn.classList.add('on');
      }
      lsSave();
    });
    grid.appendChild(btn);
  });
  if (!S.yt.groups?.length) {
    grid.innerHTML = '<div style="color:var(--txd);font-size:.78rem;padding:8px 0">請先在分組管理中新增分組</div>';
  }
  modal.appendChild(grid);

  const closeBtn = el('button', 'yt-grp-picker-close', '完成');
  closeBtn.addEventListener('click', e => {
    e.stopPropagation();
    overlay.remove();
    onDone?.();
  });
  modal.appendChild(closeBtn);

  modal.addEventListener('click', e => e.stopPropagation());
  overlay.addEventListener('click', () => { overlay.remove(); onDone?.(); });
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
}

function showYtImageViewer(url) {
  document.querySelector('.anime-img-viewer')?.remove();
  const viewer = el('div', 'anime-img-viewer');
  const img = el('img', 'anime-img-viewer-img');
  img.src = url;
  viewer.appendChild(img);
  viewer.addEventListener('click', () => viewer.remove());
  document.body.appendChild(viewer);
  requestAnimationFrame(() => viewer.classList.add('open'));
}

/* ── YouTube OAuth (Google Identity Services) ── */
const YT_OAUTH_CLIENT_ID = '300103288937-fmjbmisqcpcu8pft4k3h0aslpiprj38v.apps.googleusercontent.com';
const YT_OAUTH_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

function ytGoogleLogin(onSuccess) {
  if (!window.google?.accounts?.oauth2) {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => ytGoogleLogin(onSuccess);
    document.head.appendChild(s);
    return;
  }
  const client = window.google.accounts.oauth2.initTokenClient({
    client_id: YT_OAUTH_CLIENT_ID,
    scope: YT_OAUTH_SCOPE,
    callback: (resp) => {
      if (resp.access_token) {
        S.yt.oauthToken = resp.access_token;
        S.yt.oauthExpiry = Date.now() + (resp.expires_in - 60) * 1000;
        lsSave();
        onSuccess?.();
        // 在 token 快過期前（55分鐘後）自動靜默刷新
        setTimeout(() => ytSilentRefresh(), (resp.expires_in - 300) * 1000);
      }
    }
  });
  client.requestAccessToken();
}

function ytSilentRefresh() {
  if (!window.google?.accounts?.oauth2) return;
  try {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: YT_OAUTH_CLIENT_ID,
      scope: YT_OAUTH_SCOPE,
      prompt: '',  // 靜默刷新，不顯示登入視窗
      callback: (resp) => {
        if (resp.access_token) {
          S.yt.oauthToken = resp.access_token;
          S.yt.oauthExpiry = Date.now() + (resp.expires_in - 60) * 1000;
          lsSave();
          setTimeout(() => ytSilentRefresh(), (resp.expires_in - 300) * 1000);
        }
      }
    });
    client.requestAccessToken({ prompt: '' });
  } catch(_) {}
}

function ytIsLoggedIn() {
  return S.yt.oauthToken && S.yt.oauthExpiry && Date.now() < S.yt.oauthExpiry;
}

function showYtSheet(video, onUpdate, playlist, startIdx) {
  document.querySelector('.yt-player-backdrop')?.remove(); document.querySelector('.yt-player-modal')?.remove();
  document.querySelector('.anime-sheet-overlay')?.remove();
  const thumb = video.thumb || '';
  const vid = video.videoId;
  const maxRes = vid ? `https://i.ytimg.com/vi/${vid}/maxresdefault.jpg` : thumb;
  const hqRes  = vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : thumb;

  const overlay = el('div', 'anime-sheet-overlay');
  const sheet   = el('div', 'anime-sheet');
  let playerActive = false;
  const closeSheet = () => {
    if (playerActive) return; // don't close while player is open
    sheet.classList.remove('open');
    setTimeout(() => overlay.remove(), 300);
  };

  // ── Player area ──
  const playerWrap = el('div', 'yt-sheet-player');
  const thumbImg = el('img', 'yt-sheet-thumb');
  thumbImg.alt = video.title || '';
  // Try maxres, fallback to hq
  const tryHq = () => { thumbImg.src = hqRes; thumbImg.onerror = () => { thumbImg.src = thumb; }; };
  thumbImg.onerror = tryHq;
  thumbImg.onload = () => { if (thumbImg.naturalWidth <= 120) tryHq(); };
  thumbImg.src = maxRes;
  const playIcon = el('div', 'yt-play-icon', '▶');
  playerWrap.appendChild(thumbImg); playerWrap.appendChild(playIcon);

  const titleEl = el('div', 'yt-sheet-title', video.title || '');

  // 頻道頭像 helper
  const getChThumb = (channelId) => (S.yt.channels || []).find(c => c.id === channelId)?.thumb || '';

  const buildMetaEl = (v) => {
    const wrap = el('div', 'yt-sheet-meta-channel');
    const chThumb = getChThumb(v.channelId);
    if (chThumb) {
      const av = el('img', 'yt-sheet-ch-avatar');
      av.src = chThumb; av.alt = v.channelName || '';
      wrap.appendChild(av);
    }
    const parts = [v.channelName || ''];
    parts.push(fmtRelTime(v.publishedAt));
    if (v.duration > 0) parts.push(`影片時長 ${fmtDuration(v.duration)}`);
    wrap.appendChild(el('span', 'yt-meta-text', parts.join('．')));
    return wrap;
  };

  let metaWrap = buildMetaEl(video);

  // 手動切換影片時同步更新卡片內容
  const updateSheetContent = (v) => {
    titleEl.textContent = v.title || '';
    const newMeta = buildMetaEl(v);
    metaWrap.replaceWith(newMeta);
    metaWrap = newMeta;
    const newMaxRes = `https://i.ytimg.com/vi/${v.videoId}/maxresdefault.jpg`;
    const newHqRes  = `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;
    thumbImg.onerror = () => { thumbImg.src = newHqRes; thumbImg.onerror = null; };
    thumbImg.onload = () => { if (thumbImg.naturalWidth <= 120) thumbImg.src = newHqRes; };
    thumbImg.src = newMaxRes;
    // 更新按讚數
    const likeSpan = likeBadge?.querySelector('span');
    if (likeSpan) likeSpan.textContent = fmtNum(v.likeCount || 0);
    if (likeBadge) likeBadge.style.display = v.likeCount > 0 ? '' : 'none';
    // 更新觀看數
    const viewSpan = viewBadge?.querySelector('span');
    if (viewSpan) viewSpan.textContent = fmtNum(v.viewCount || 0);
    if (viewBadge) viewBadge.style.display = v.viewCount > 0 ? '' : 'none';
    // 更新 YouTube 連結
    openBtn.href = `https://www.youtube.com/watch?v=${v.videoId}`;
    // 更新說明
    descEl.textContent = '';
    moreBtn.style.display = 'none';
    descExpanded = false;
    descEl.style.webkitLineClamp = '1';
    moreBtn.textContent = '更多 ▾';
    // 重新抓說明
    const key = S.cfg.ytApiKey?.trim();
    if (key) {
      fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${v.videoId}&key=${key}`)
        .then(r => r.json()).then(d => {
          const desc = d.items?.[0]?.snippet?.description?.trim() || '';
          if (!desc) return;
          descEl.textContent = desc;
          setTimeout(() => {
            if (descEl.scrollHeight > descEl.clientHeight + 4) moreBtn.style.display = '';
          }, 50);
        }).catch(() => {});
    }
    // 更新按讚按鈕狀態
    updateLikeBtn(v);
  };

  playerWrap.addEventListener('click', e => {
    e.stopPropagation();
    playerActive = true;
    playerWrap.style.display = 'none';
    const playerStartIdx = (startIdx != null && startIdx >= 0) ? startIdx : (playlist ? playlist.findIndex(v => v.videoId === video.videoId) : -1);
    showYtPlayer(video.videoId, () => {
      playerActive = false;
      playerWrap.innerHTML = '';
      playerWrap.appendChild(thumbImg);
      playerWrap.appendChild(playIcon);
      playerWrap.style.display = '';
    }, playlist, playerStartIdx, updateSheetContent);
  });
  sheet.appendChild(playerWrap);

  const infoWrap = el('div', 'yt-sheet-info');
  infoWrap.appendChild(titleEl);
  infoWrap.appendChild(metaWrap);

  // ── Action row ──
  const actionRow = el('div', 'yt-action-row');

  // 用 currentVideo 追蹤當前顯示的影片（切換時更新）
  let currentVideo = video;

  // Like button + count
  const likeBtn = el('button', 'yt-like-btn');
  const likeCount = el('span', 'yt-like-count');
  const isLiked = () => (S.yt.liked||[]).includes(currentVideo.videoId);
  const updateLikeBtn = (v) => {
    if (v) currentVideo = v;
    const liked = isLiked();
    likeBtn.innerHTML = liked
      ? `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg> 已按讚`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg> 按讚`;
    likeBtn.classList.toggle('liked', liked);
    if (currentVideo.likeCount > 0) likeCount.textContent = fmtNum(currentVideo.likeCount);
  };
  updateLikeBtn();
  likeBtn.addEventListener('click', async () => {
    const token = S.yt.oauthToken;
    if (!token) { ytGoogleLogin(() => likeBtn.click()); return; }
    const liked = isLiked();
    try {
      const res = await fetch(`https://www.googleapis.com/youtube/v3/videos/rate?id=${currentVideo.videoId}&rating=${liked?'none':'like'}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }
      });
      if (res.status === 401) { S.yt.oauthToken = null; lsSave(); ytGoogleLogin(() => likeBtn.click()); return; }
      if (liked) S.yt.liked = (S.yt.liked||[]).filter(id => id !== currentVideo.videoId);
      else { if (!S.yt.liked) S.yt.liked = []; S.yt.liked.push(currentVideo.videoId); }
      lsSave(); updateLikeBtn();
    } catch(e) { console.error('Like error', e); }
  });

  const likeWrap = el('div', 'yt-action-group');
  likeWrap.appendChild(likeBtn);
  actionRow.appendChild(likeWrap);

  // Like count badge（永遠建立，無數字時隱藏）
  const likeBadge = el('div', 'yt-stat-badge');
  likeBadge.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" style="color:#f87171"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
  likeBadge.appendChild(el('span', '', fmtNum(video.likeCount)));
  if (!video.likeCount) likeBadge.style.display = 'none';
  actionRow.appendChild(likeBadge);

  // View count badge（永遠建立，無數字時隱藏）
  const viewBadge = el('div', 'yt-stat-badge');
  viewBadge.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  viewBadge.appendChild(el('span', '', fmtNum(video.viewCount)));
  if (!video.viewCount) viewBadge.style.display = 'none';
  actionRow.appendChild(viewBadge);

  const openBtn = el('a', 'yt-open-btn', 'YouTube ↗');
  openBtn.href = `https://www.youtube.com/watch?v=${video.videoId}`;
  openBtn.target = '_blank'; openBtn.rel = 'noopener';
  actionRow.appendChild(openBtn);
  infoWrap.appendChild(actionRow);

  // Description
  const descWrap = el('div', 'yt-desc-wrap');
  const descEl = el('div', 'yt-desc', '');
  descEl.style.webkitLineClamp = '1';
  descWrap.appendChild(descEl);
  const moreBtn = el('button', 'yt-desc-more', '更多 ▾');
  let descExpanded = false;
  moreBtn.addEventListener('click', () => {
    descExpanded = !descExpanded;
    descEl.style.webkitLineClamp = descExpanded ? 'unset' : '1';
    moreBtn.textContent = descExpanded ? '收起 ▴' : '更多 ▾';
  });
  moreBtn.style.display = 'none';
  descWrap.appendChild(moreBtn);
  infoWrap.appendChild(descWrap);
  sheet.appendChild(infoWrap);

  // Mark as watched
  if (!(S.yt.watched||[]).includes(video.videoId)) {
    if (!S.yt.watched) S.yt.watched = [];
    S.yt.watched.push(video.videoId);
    lsSave();
    onUpdate?.();
  }

  overlay.addEventListener('click', e => { if (e.target === overlay && !playerActive) closeSheet(); });
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => sheet.classList.add('open'));

  // Async fetch description
  const key = S.cfg.ytApiKey?.trim();
  if (key) {
    fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${video.videoId}&key=${key}`)
      .then(r => r.json()).then(d => {
        const desc = d.items?.[0]?.snippet?.description?.trim() || '';
        if (!desc) return;
        descEl.textContent = desc;
        setTimeout(() => {
          if (descEl.scrollHeight > descEl.clientHeight + 4) moreBtn.style.display = '';
        }, 50);
      }).catch(() => {});
  }
}

function showYtPlayer(videoId, onClose, playlist, startIdx, onVideoChange) {
  // 清除殘留的舊播放器
  document.querySelector('.yt-player-backdrop')?.remove();
  document.querySelector('.yt-player-modal')?.remove();
  if (window._ytActivePlayer) {
    try { window._ytActivePlayer.destroy(); } catch(_) {}
    window._ytActivePlayer = null;
  }
  const key = S.cfg.ytApiKey?.trim();

  let curIdx = (startIdx != null && startIdx >= 0 && playlist?.length) ? startIdx : 0;
  let countdownTimer = null;
  let countdownInterval = null;
  let keyListener = null;
  let ytPlayer = null;
  let prevBtn = null, nextBtn = null;
  let hadRebuild = false;
  let errorSkipAt = 0;
  let stuckTimer = null;
  let playerInitialized = false;

  const updateNavButtons = () => {
    if (prevBtn) prevBtn.disabled = curIdx <= 0;
    if (nextBtn) nextBtn.disabled = curIdx >= (playlist?.length || 1) - 1;
  };

  const buildPlayer = (portrait) => {
    const backdrop = el('div', 'yt-player-backdrop');
    backdrop.style.pointerEvents = 'none';
    const modal = el('div', 'yt-player-modal' + (portrait ? ' portrait' : ''));

    const closePlayer = () => {
      clearTimeout(countdownTimer);
      clearInterval(countdownInterval);
      if (keyListener) { window.removeEventListener('keydown', keyListener); keyListener = null; }
      try { ytPlayer?.destroy(); } catch(_) {}
      ytPlayer = null;
      window._ytActivePlayer = null;
      // 若曾發生錯誤重建，清除 YT API 全域狀態讓下次重新初始化
      if (hadRebuild) {
        try { delete window.YT; } catch(_) {}
        document.querySelector('script[src*="youtube.com/iframe_api"]')?.remove();
      }
      backdrop.classList.remove('open');
      modal.classList.remove('open');
      setTimeout(() => { backdrop.remove(); modal.remove(); onClose?.(); }, 260);
    };

    const bar = el('div', 'yt-player-drag-bar');
    const closeBtn = el('button', 'yt-player-close', '✕');
    closeBtn.addEventListener('click', e => { e.stopPropagation(); closePlayer(); });

    const playerBox = el('div', 'yt-player-box');
    const nextBar = el('div', 'yt-next-bar');
    nextBar.style.display = 'none';

    // YT.Player 容器（let 以便錯誤時重建）
    let ytContainerEl = el('div', '');
    ytContainerEl.id = 'yt-api-player-' + Date.now();
    ytContainerEl.style.cssText = 'width:100%;height:100%;';
    playerBox.appendChild(ytContainerEl);

    const ids = playlist?.length ? playlist.map(v => v.videoId) : [videoId];

    const showCountdown = () => {
      if (!playlist || curIdx < 0) return;
      const next = playlist[curIdx + 1];
      if (!next) return;
      let secs = 3;
      nextBar.innerHTML = '';
      const msg = el('span', '', `下一則：${next.title || ''}`);
      const cancelBtn = el('button', 'yt-next-cancel', `取消 (${secs})`);
      cancelBtn.addEventListener('click', e => {
        e.stopPropagation();
        nextBar.style.display = 'none';
        clearTimeout(countdownTimer);
        clearInterval(countdownInterval);
      });
      nextBar.appendChild(msg);
      nextBar.appendChild(cancelBtn);
      nextBar.style.display = 'flex';
      countdownInterval = setInterval(() => {
        secs--;
        cancelBtn.textContent = `取消 (${secs})`;
        if (secs <= 0) clearInterval(countdownInterval);
      }, 1000);
      countdownTimer = setTimeout(() => {
        nextBar.style.display = 'none';
        ytPlayer?.nextVideo();
      }, 3000);
    };

    const initYtPlayer = () => {
      ytPlayer = window._ytActivePlayer = new YT.Player(ytContainerEl.id, {
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 1, rel: 0, playsinline: 1 },
        events: {
          onReady: (e) => {
            e.target.loadPlaylist({ playlist: ids, index: curIdx });
            setTimeout(() => {
              try { if (e.target.getPlayerState() !== 1) e.target.playVideo(); } catch(_) {}
              playerInitialized = true;
            }, 800);
          },
          onStateChange: (e) => {
            if (e.data === 1) { // playing
              clearTimeout(stuckTimer); stuckTimer = null;
              const ytIdx = e.target.getPlaylistIndex();
              if (ytIdx >= 0 && ytIdx !== curIdx) {
                curIdx = ytIdx;
                updateNavButtons();
                if (onVideoChange && playlist?.[curIdx]) onVideoChange(playlist[curIdx]);
              }
              nextBar.style.display = 'none';
              clearTimeout(countdownTimer);
              clearInterval(countdownInterval);
            }
            if ((e.data === 3 || e.data === -1) && playerInitialized) {
              clearTimeout(stuckTimer);
              stuckTimer = setTimeout(() => {
                const now = Date.now();
                if (now - errorSkipAt < 1000) return;
                errorSkipAt = now;
                if (!playlist || curIdx >= playlist.length - 1) return;
                const nextIdx = curIdx + 1;
                if (onVideoChange && playlist[nextIdx]) onVideoChange(playlist[nextIdx]);
                try { ytPlayer?.destroy(); } catch(_) {}
                ytPlayer = null; window._ytActivePlayer = null;
                backdrop.remove(); modal.remove();
                setTimeout(() => {
                  showYtPlayer(playlist[nextIdx].videoId, onClose, playlist, nextIdx, onVideoChange);
                }, 100);
              }, 3000);
            }
            if (e.data === 0) showCountdown(); // ended
          },
          onError: () => {
            const now = Date.now();
            if (now - errorSkipAt < 1000) return;
            errorSkipAt = now;
            if (!playlist || curIdx >= playlist.length - 1) return;
            const nextIdx = curIdx + 1;
            if (onVideoChange && playlist[nextIdx]) onVideoChange(playlist[nextIdx]);
            try { ytPlayer?.destroy(); } catch(_) {}
            ytPlayer = null; window._ytActivePlayer = null;
            backdrop.remove(); modal.remove();
            setTimeout(() => {
              showYtPlayer(playlist[nextIdx].videoId, onClose, playlist, nextIdx, onVideoChange);
            }, 100);
          }
        }
      });
    };

    // 載入 YouTube IFrame API — 延到 modal 加入 DOM 後再初始化
    const startYtApi = () => {
      if (window.YT?.Player) {
        initYtPlayer();
      } else {
        const prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => { prev?.(); initYtPlayer(); };
        if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
          const s = document.createElement('script');
          s.src = 'https://www.youtube.com/iframe_api';
          document.head.appendChild(s);
        }
      }
    };

    // 上一部 / 下一部按鈕
    if (playlist?.length > 1) {
      prevBtn = el('button', 'yt-player-nav-btn', '◀');
      prevBtn.title = '上一部（←）';
      prevBtn.disabled = curIdx <= 0;
      prevBtn.addEventListener('click', e => {
        e.stopPropagation();
        nextBar.style.display = 'none';
        clearTimeout(countdownTimer); clearInterval(countdownInterval);
        ytPlayer?.previousVideo();
      });

      nextBtn = el('button', 'yt-player-nav-btn', '▶');
      nextBtn.title = '下一部（→）';
      nextBtn.disabled = curIdx >= playlist.length - 1;
      nextBtn.addEventListener('click', e => {
        e.stopPropagation();
        nextBar.style.display = 'none';
        clearTimeout(countdownTimer); clearInterval(countdownInterval);
        ytPlayer?.nextVideo();
      });

      bar.appendChild(prevBtn);
      bar.appendChild(nextBtn);
    }

    const barSpacer = el('div', '');
    barSpacer.style.flex = '1';
    bar.appendChild(barSpacer);

    const fsBtn = el('button', 'yt-player-fs-btn', '⛶');
    fsBtn.title = '全螢幕';
    fsBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (!document.fullscreenElement) {
        modal.requestFullscreen?.().then(() => {
          screen.orientation?.lock?.('landscape').catch(() => {});
        }).catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    });
    const onFsChange = () => {
      if (!document.fullscreenElement) {
        screen.orientation?.lock?.('portrait').catch(() => {});
        document.removeEventListener('fullscreenchange', onFsChange);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    bar.appendChild(fsBtn);
    bar.appendChild(closeBtn);

    // 鍵盤左右鍵
    if (playlist?.length > 1) {
      keyListener = (e) => {
        if (e.key === 'ArrowLeft')  { e.preventDefault(); nextBar.style.display='none'; clearTimeout(countdownTimer); clearInterval(countdownInterval); ytPlayer?.previousVideo(); }
        if (e.key === 'ArrowRight') { e.preventDefault(); nextBar.style.display='none'; clearTimeout(countdownTimer); clearInterval(countdownInterval); ytPlayer?.nextVideo(); }
      };
      window.addEventListener('keydown', keyListener);
    }

    modal.addEventListener('click', e => e.stopPropagation());
    modal.appendChild(bar);
    modal.appendChild(nextBar);
    modal.appendChild(playerBox);

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);
    requestAnimationFrame(() => {
      backdrop.classList.add('open'); modal.classList.add('open');
      // modal 已在 DOM，才安全初始化 YT.Player
      setTimeout(startYtApi, 0);
    });
  };

  if (key) {
    fetch(`https://www.googleapis.com/youtube/v3/videos?part=player&id=${videoId}&key=${key}`)
      .then(r => r.json()).then(d => {
        const p = d.items?.[0]?.player;
        buildPlayer(!!(p && parseInt(p.embedHeight) > parseInt(p.embedWidth)));
      }).catch(() => buildPlayer(false));
  } else {
    buildPlayer(false);
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
  anime:     { label: '動畫追蹤', icon: '🎌' },
  youtube:   { label: 'YouTube 訂閱', icon: '▶️' }
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
    inner.style.cssText = 'position:relative;flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;';
    container.appendChild(inner);
    const mTagBar = el('div', 'sticky-tag-bar');
    inner.appendChild(mTagBar);
    mountStickyTagBar(mTagBar, inner);
    renderStickiesWidget(inner);

    // 手機版高度動態計算（跟桌面版一樣用 ResizeObserver）
    new ResizeObserver(() => {
      const list   = inner.querySelector('.sticky-list');
      const bar    = inner.querySelector('.sticky-input-bar');
      const tagBar = inner.querySelector('.sticky-tag-bar');
      if (list) {
        const tagBarH = tagBar ? tagBar.offsetHeight : 0;
        const barH = (bar && bar.style.display !== 'none') ? bar.offsetHeight : 0;
        list.style.height = (inner.offsetHeight - barH - tagBarH) + 'px';
        list.style.overflowY = 'auto';
      }
    }).observe(inner);
  } else if (widgetType === 'anime') {
    const inner = el('div', 'anime-inner');
    inner.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;min-height:0;';
    container.appendChild(inner);
    renderAnimeWidget(inner);
  } else if (widgetType === 'youtube') {
    const inner = el('div', 'yt-inner');
    inner.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;min-height:0;';
    container.appendChild(inner);
    renderYoutubeWidget(inner);
  }
}

function renderMobileNews(container, extSettingsBtn, extLangBtn, extRefBtn) {
  container.innerHTML = '';
  container.className = 'mobile-news-inner';

  // ── Toolbar: [⚙] [中/EN] [↻]（若有外部按鈕則不建立 toolbar）──
  const toolbar = el('div', 'news-toolbar');
  let mEditingTags = false;

  const settingsBtn = extSettingsBtn || el('button', 'w-btn news-settings-btn');
  if (!extSettingsBtn) {
    settingsBtn.title = '新聞設定';
    settingsBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
  }

  const langBtn = extLangBtn || el('button', 'w-btn news-lang-btn', S.news.lang === 'zh-TW' ? '中' : 'EN');
  if (!extLangBtn) langBtn.title = '切換語言';
  langBtn.textContent = S.news.lang === 'zh-TW' ? '中' : 'EN';
  langBtn.addEventListener('click', () => {
    S.news.lang = S.news.lang === 'zh-TW' ? 'en' : 'zh-TW';
    langBtn.textContent = S.news.lang === 'zh-TW' ? '中' : 'EN';
    lsSave(); fetchNews(true);
  });

  const refBtn = extRefBtn || el('button', 'w-btn');
  if (!extRefBtn) {
    refBtn.id = 'mobile-news-ref-btn';
    refBtn.title = '重新整理';
    refBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="13" height="13"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
  }
  refBtn.addEventListener('click', () => {
    refBtn.classList.add('spin');
    fetchNews(true).finally(() => refBtn.classList.remove('spin'));
  });

  if (!extSettingsBtn) {
    toolbar.appendChild(settingsBtn);
    toolbar.appendChild(langBtn);
    toolbar.appendChild(refBtn);
    container.appendChild(toolbar);
  }

  // Settings panel
  const settingsPanel = el('div', 'news-settings-panel');
  settingsPanel.style.display = 'none';
  settingsPanel.innerHTML = `
    <label class="news-cfg-row">
      <span>每個關鍵字顯示幾則</span>
      <input id="m-news-cfg-per-kw" type="number" class="news-cfg-input" min="1" max="20" value="${S.news.perKeyword || 2}" autocomplete="off">
    </label>
    <label class="news-cfg-row">
      <span>快取更新頻率</span>
      <select id="m-news-cfg-cache" class="news-cfg-select">
        <option value="5" ${S.news.cacheMin==5?'selected':''}>5 分鐘</option>
        <option value="15" ${S.news.cacheMin==15?'selected':''}>15 分鐘</option>
        <option value="25" ${!S.news.cacheMin||S.news.cacheMin==25?'selected':''}>25 分鐘</option>
        <option value="60" ${S.news.cacheMin==60?'selected':''}>1 小時</option>
      </select>
    </label>
  `;
  settingsPanel.querySelector('#m-news-cfg-per-kw').addEventListener('change', e => {
    S.news.perKeyword = parseInt(e.target.value) || 2; S.news.fetchedAt = 0; lsSave(); fetchNews(true);
  });
  settingsPanel.querySelector('#m-news-cfg-cache').addEventListener('change', e => {
    S.news.cacheMin = parseInt(e.target.value); lsSave();
  });
  container.appendChild(settingsPanel);
  settingsBtn.addEventListener('click', () => {
    const open = settingsPanel.style.display !== 'none';
    settingsPanel.style.display = open ? 'none' : '';
    settingsBtn.classList.toggle('active', !open);
    // 開啟設定 = 進入編輯模式；關閉設定 = 退出編輯模式
    mEditingTags = !open;
    renderKws(mEditingTags);
  });

  // Keywords
  const kws = el('div', 'news-kws');
  container.appendChild(kws);

  const renderKws = (editing) => {
    kws.innerHTML = '';
    const allTab = el('span', 'kw-tag' + (S.news.activeKw === 'all' ? ' on' : ''), '全部');
    allTab.addEventListener('click', () => { S.news.activeKw = 'all'; renderMobileNews(container); });
    kws.appendChild(allTab);
    S.news.keywords.forEach(kw => {
      const wrap = el('span', 'kw-tag-wrap' + (S.news.activeKw === kw ? ' on' : '') + (editing ? ' editing' : ''));
      const label = el('span', 'kw-label', esc(kw));
      label.addEventListener('click', () => { if (!editing) { S.news.activeKw = kw; renderMobileNews(container); } });
      const del = el('button', 'kw-del', '✕');
      del.addEventListener('click', e => {
        e.stopPropagation();
        S.news.keywords = S.news.keywords.filter(k => k !== kw);
        if (S.news.activeKw === kw) S.news.activeKw = 'all';
        lsSave(); S.news.fetchedAt = 0; renderMobileNews(container); fetchNews(true);
      });
      wrap.appendChild(label); wrap.appendChild(del);
      kws.appendChild(wrap);
    });
    const addWrap = el('span', 'kw-add-wrap');
    const addBtn = el('button', 'kw-add-btn', '＋');
    addBtn.addEventListener('click', () => {
      addWrap.innerHTML = '';
      const inp = document.createElement('input');
      inp.className = 'kw-add-input'; inp.type = 'search'; inp.placeholder = '關鍵字'; inp.autocomplete = 'off'; inp.name = 'neocast-kw-m'; inp.spellcheck = false;
      addWrap.appendChild(inp); inp.focus();
      const doConfirm = () => {
        const val = inp.value.trim();
        if (val && !S.news.keywords.includes(val)) { S.news.keywords.push(val); lsSave(); S.news.fetchedAt = 0; renderMobileNews(container); fetchNews(true); }
        else { renderMobileNews(container); }
      };
      inp.addEventListener('blur', doConfirm);
      inp.addEventListener('keydown', e => { if (e.key==='Enter'){e.preventDefault();inp.blur();} if(e.key==='Escape'){inp.value='';inp.blur();} });
    });
    addWrap.appendChild(addBtn);
    kws.appendChild(addWrap);
  };
  renderKws(false);

  // News list
  const filtered = S.news.activeKw === 'all'
    ? [...S.news.items].sort((a, b) => new Date(b.rawDate || 0) - new Date(a.rawDate || 0))
    : S.news.items.filter(i => i.kw === S.news.activeKw);
  const list = el('div', 'news-list');
  list.style.cssText = 'overflow-y:auto;flex:1;padding:0 14px 12px;';
  container.appendChild(list);
  if (!filtered.length) {
    list.innerHTML = '<div class="news-empty"><p>尚無新聞<br>點擊 ↻ 載入</p></div>';
  } else {
    filtered.forEach(item => {
      const card = el('div', 'news-card');
      const hasImg = !!item.image;
      card.classList.toggle('nc-has-img', hasImg);
      const metaStr = `${esc(item.source||'')}${item.rawDate?' · '+parseDate(item.rawDate):item.date?' · '+item.date:''}`;
      if (hasImg) {
        card.innerHTML = `
          <div class="nc-body">
            <div class="nc-kw">${esc(item.kw||'')}</div>
            <div class="nc-title">${esc(item.title||'')}</div>
            <div class="nc-foot"><span class="nc-meta">${metaStr}</span></div>
          </div>
          <div class="nc-thumb-wrap">
            <img class="nc-thumb" src="${esc(item.image)}" alt="${esc(item.title||'')}" loading="lazy">
          </div>
        `;
        const thumb = card.querySelector('.nc-thumb');
        const thumbWrap = card.querySelector('.nc-thumb-wrap');
        thumbWrap.style.cursor = 'zoom-in';
        thumbWrap.addEventListener('click', e => {
          e.stopPropagation();
          showImageViewer(item.image, item.title || '');
        });
        thumb.onerror = function() {
          thumbWrap.remove();
          card.classList.remove('nc-has-img');
        };
        if (item.link) {
          card.style.cursor = 'pointer';
          card.addEventListener('click', () => window.open(item.link, '_blank', 'noopener'));
        }
      } else {
        card.innerHTML = `
          <div class="nc-kw">${esc(item.kw||'')}</div>
          <div class="nc-title">${esc(item.title||'')}</div>
          <div class="nc-foot"><span class="nc-meta">${metaStr}</span></div>
        `;
        if (item.link) {
          card.style.cursor = 'pointer';
          card.addEventListener('click', () => window.open(item.link, '_blank', 'noopener'));
        }
      }
      list.appendChild(card);
    });
  }
}


function startMobileTitleEdit(titleEl, wid, defaultLabel, icon) {
  if (titleEl.querySelector('input')) return;
  const current = titleEl.textContent.replace(icon, '').trim();
  titleEl.textContent = '';
  const inp = document.createElement('input');
  inp.className = 'w-title-input';
  inp.value = current;
  inp.type = 'search'; inp.autocomplete = 'off'; inp.name = 'neocast-panel-title'; inp.spellcheck = false;
  titleEl.appendChild(inp);
  inp.focus();
  inp.select();

  const save = () => {
    const val = inp.value.trim();
    const def = WIDGET_DEFAULT_TITLES[wid] || defaultLabel;
    if (val && val !== def) {
      if (!S.widgetTitles) S.widgetTitles = {};
      S.widgetTitles[wid] = val;
    } else {
      delete S.widgetTitles?.[wid];
    }
    lsSave();
    const newTitle = getWidgetTitle(wid, defaultLabel);
    titleEl.textContent = icon + newTitle;
    // Sync desktop w-title if widget exists
    document.querySelectorAll(`.widget[data-wid="${wid}"] .w-title`).forEach(t => {
      t.textContent = newTitle;
    });
  };
  inp.addEventListener('blur', save);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
    if (e.key === 'Escape') { inp.value = current; inp.blur(); }
  });
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

      // ── Panel header bar (title + edit buttons) ──
      const panelHead = el('div', 'mobile-panel-head');
      const meta = MOBILE_WIDGET_TYPES[page.widget];
      const wid = page.widget;
      const panelTitle = el('span', 'mobile-panel-title');
      panelTitle.dataset.wid = wid;
      const icon = meta?.icon ? meta.icon + ' ' : '';
      panelTitle.textContent = icon + getWidgetTitle(wid, meta?.label || wid);
      panelHead.appendChild(panelTitle);

      // ── Expand/collapse button (always visible) ──
      const expandBtn = el('button', 'mobile-panel-expand-btn');
      expandBtn.title = '展開全屏';
      const iconExpand = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
      const iconCollapse = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/></svg>`;
      expandBtn.innerHTML = iconExpand;
      expandBtn.addEventListener('click', () => {
        const isExpanded = panel.classList.toggle('mobile-panel-fullscreen');
        expandBtn.innerHTML = isExpanded ? iconCollapse : iconExpand;
        expandBtn.title = isExpanded ? '還原' : '展開全屏';
        // Hide/show header
        const hdr = document.getElementById('header');
        if (hdr) hdr.style.display = isExpanded ? 'none' : '';
        // Hide/show mobile clock
        const clk = document.querySelector('.mobile-clock-wrap');
        if (clk) clk.style.display = isExpanded ? 'none' : '';
        // Hide/show dots bar
        const dots = document.querySelector('.mobile-dots-bar');
        if (dots) dots.style.display = isExpanded ? 'none' : '';
      });
      panelHead.appendChild(expandBtn);

      const panelBtns = el('div', 'mobile-panel-btns hidden');

      // Pencil button
      const mPencilBtn = el('button', 'mobile-panel-btn');
      mPencilBtn.title = '自訂標題';
      mPencilBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
      mPencilBtn.addEventListener('click', () => startMobileTitleEdit(panelTitle, wid, meta?.label || wid, icon));
      panelBtns.appendChild(mPencilBtn);

      // Replace button
      const replaceBtn = el('button', 'mobile-panel-btn');
      replaceBtn.title = '更換小工具';
      replaceBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`;
      replaceBtn.addEventListener('click', () => openMobileWidgetPicker(idx));
      panelBtns.appendChild(replaceBtn);

      // Delete button (not first page)
      if (idx > 0) {
        const delPageBtn = el('button', 'mobile-panel-btn mobile-panel-del');
        delPageBtn.title = '刪除此頁';
        delPageBtn.textContent = '✕';
        delPageBtn.addEventListener('click', () => {
          if (confirm(`刪除「${meta?.label || page.widget}」頁？`)) {
            S.mobilePages.splice(idx, 1);
            if (S.mobilePageIdx >= S.mobilePages.length) S.mobilePageIdx = S.mobilePages.length - 1;
            lsSave();
            renderPages();
          }
        });
        panelBtns.appendChild(delPageBtn);
      }

      panelHead.appendChild(panelBtns);

      // 捷徑專用：管理分類按鈕
      if (page.widget === 'shortcuts') {
        const svgCfg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
        const mCfgBtn = el('button', 'w-btn sc-grp-cfg-btn' + (grpEditMode ? ' on' : ''));
        mCfgBtn.title = grpEditMode ? '完成管理' : '管理分類';
        mCfgBtn.innerHTML = svgCfg;
        mCfgBtn.addEventListener('click', e => {
          e.stopPropagation();
          grpEditMode = !grpEditMode;
          document.querySelectorAll('.sc-grp-cfg-btn').forEach(b => {
            b.classList.toggle('on', grpEditMode);
            b.title = grpEditMode ? '完成管理' : '管理分類';
          });
          rerenderShortcuts();
        });
        panelHead.insertBefore(mCfgBtn, expandBtn);
      }

      // 便利貼專用：刪除已勾選按鈕（跟桌面版一樣掛 w-pencil-btn，由 setEditMode 控制顯示）
      if (page.widget === 'stickies') {
        const mDelCheckedBtn = el('button', 'w-pencil-btn hidden sticky-del-checked-btn');
        mDelCheckedBtn.title = '刪除已勾選';
        mDelCheckedBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
        mDelCheckedBtn.addEventListener('click', e => {
          e.stopPropagation();
          const checked = S.stickies.filter(s => s.done);
          if (!checked.length) return;
          if (!confirm('確認刪除 ' + checked.length + ' 項已勾選？')) return;
          S.stickies = S.stickies.filter(s => !s.done);
          lsSave();
          const inner = panel.querySelector('.stickies-inner');
          if (inner) renderStickiesWidget(inner);
        });
        // 有勾選才亮
        const updateMDelChecked = () => {
          const count = (S.stickies || []).filter(s => s.done).length;
          mDelCheckedBtn.style.opacity = count > 0 ? '1' : '0.35';
          mDelCheckedBtn.style.pointerEvents = count > 0 ? 'all' : 'none';
        };
        updateMDelChecked();
        panel._updateDelChecked = updateMDelChecked;
        panelHead.insertBefore(mDelCheckedBtn, expandBtn);

        // ── 手機版搜尋框 ──
        const mSearchWrap = el('div', 'sticky-search-wrap sticky-search-mobile');
        const mSearchInp = el('input', 'sticky-search-inp');
        mSearchInp.type = 'search';
        mSearchInp.placeholder = '搜尋…';
        mSearchInp.autocomplete = 'search'; mSearchInp.name = 'neocast-sticky-search-m'; mSearchInp.spellcheck = false;
        mSearchInp.value = S.stickySearch || '';
        const mSearchClear = el('button', 'sticky-search-clear');
        mSearchClear.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="10" height="10"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
        mSearchClear.style.display = S.stickySearch ? '' : 'none';
        mSearchInp.addEventListener('input', () => {
          S.stickySearch = mSearchInp.value;
          mSearchClear.style.display = S.stickySearch ? '' : 'none';
          // 同步桌面版搜尋框
          document.querySelectorAll('.sticky-search-inp').forEach(inp => { if (inp !== mSearchInp) inp.value = S.stickySearch; });
          document.querySelectorAll('.sticky-search-clear').forEach(btn => { btn.style.display = S.stickySearch ? '' : 'none'; });
          const inner = panel.querySelector('.stickies-inner');
          if (inner) renderStickiesWidget(inner);
        });
        mSearchClear.addEventListener('touchend', e => {
          e.preventDefault();
          S.stickySearch = '';
          mSearchInp.value = '';
          mSearchClear.style.display = 'none';
          document.querySelectorAll('.sticky-search-inp').forEach(inp => { inp.value = ''; });
          document.querySelectorAll('.sticky-search-clear').forEach(btn => { btn.style.display = 'none'; });
          const inner = panel.querySelector('.stickies-inner');
          if (inner) renderStickiesWidget(inner);
        });
        mSearchWrap.appendChild(mSearchInp);
        mSearchWrap.appendChild(mSearchClear);
        panelHead.insertBefore(mSearchWrap, expandBtn);

        // ── 手機版鎖頭按鈕 ──
        const svgLockedM  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="13" height="13"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
        const svgUnlockedM = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="13" height="13"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`;
        const mLockBtn = el('button', 'w-btn sticky-lock-btn' + (S.stickyLocked ? ' on' : ''));
        mLockBtn.title = S.stickyLocked ? '解除鎖定' : '鎖定（禁止編輯）';
        mLockBtn.innerHTML = S.stickyLocked ? svgLockedM : svgUnlockedM;
        mLockBtn.addEventListener('click', e => {
          e.stopPropagation();
          S.stickyLocked = !S.stickyLocked;
          document.querySelectorAll('.sticky-lock-btn').forEach(b => {
            b.classList.toggle('on', S.stickyLocked);
            b.title = S.stickyLocked ? '解除鎖定' : '鎖定（禁止編輯）';
            b.innerHTML = S.stickyLocked ? svgLockedM : svgUnlockedM;
          });
          const inner = panel.querySelector('.stickies-inner');
          if (inner) renderStickiesWidget(inner);
        });
        panelHead.insertBefore(mLockBtn, expandBtn);
      }

      // YouTube 專用：在 panelHead 加 ⚙ ↺，renderYoutubeWidget 時隱藏內部的 mHead
      if (page.widget === 'youtube') {
        const ytAddBtn = el('button', 'yt-icon-btn');
        ytAddBtn.title = '管理頻道';
        ytAddBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
        const ytRefBtn = el('button', 'yt-icon-btn');
        ytRefBtn.title = '重新整理';
        ytRefBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
        panelHead.insertBefore(ytAddBtn, expandBtn);
        panelHead.insertBefore(ytRefBtn, expandBtn);
        // 建立 widget content 後把 mHead 隱藏，並把按鈕 reference 傳給 renderYoutubeWidget
        const inner = el('div', 'yt-inner');
        inner.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;min-height:0;';
        panel.appendChild(panelHead);
        panel.appendChild(inner);
        renderYoutubeWidget(inner, ytAddBtn, ytRefBtn);
        // 隱藏 renderYoutubeWidget 建立的 mHead（因為已整合到 panelHead）
        const mHead = inner.querySelector('.yt-mobile-head');
        if (mHead) mHead.style.display = 'none';
        swipeArea.appendChild(panel);
        const dot = el('div', 'mobile-dot' + (idx === S.mobilePageIdx ? ' active' : ''));
        dot.title = idx === 0 ? '捷徑（不可刪除）' : '長按刪除';
        if (idx > 0) {
          let lpTimer = null;
          dot.addEventListener('touchstart', () => { lpTimer = setTimeout(() => { if (confirm(`刪除「${meta?.label || page.widget}」頁？`)) { S.mobilePages.splice(idx, 1); if (S.mobilePageIdx >= S.mobilePages.length) S.mobilePageIdx = S.mobilePages.length - 1; lsSave(); renderPages(); } }, 600); });
          dot.addEventListener('touchend', () => clearTimeout(lpTimer));
          dot.addEventListener('touchmove', () => clearTimeout(lpTimer));
        }
        dotsBar.appendChild(dot);
        return; // 跳過後面的 panel.appendChild(panelHead) 和 buildMobileWidgetContent
      }

      // 即時新聞專用：在 panelHead 加 ⚙ 中 ↺
      if (page.widget === 'news') {
        const newsSettingsBtn = el('button', 'yt-icon-btn news-settings-btn');
        newsSettingsBtn.title = '新聞設定';
        newsSettingsBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

        const newsLangBtn = el('button', 'yt-icon-btn news-lang-btn');
        newsLangBtn.title = '切換語言';
        newsLangBtn.textContent = S.news.lang === 'zh-TW' ? '中' : 'EN';
        newsLangBtn.style.fontWeight = '700';
        newsLangBtn.style.fontSize = '12px';

        const newsRefBtn = el('button', 'yt-icon-btn');
        newsRefBtn.title = '重新整理';
        newsRefBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;

        panelHead.insertBefore(newsSettingsBtn, expandBtn);
        panelHead.insertBefore(newsLangBtn, expandBtn);
        panelHead.insertBefore(newsRefBtn, expandBtn);

        panel.appendChild(panelHead);
        const inner = el('div', 'mobile-news-inner');
        panel.appendChild(inner);
        renderMobileNews(inner, newsSettingsBtn, newsLangBtn, newsRefBtn);
        swipeArea.appendChild(panel);
        const dot = el('div', 'mobile-dot' + (idx === S.mobilePageIdx ? ' active' : ''));
        dot.title = idx === 0 ? '捷徑（不可刪除）' : '長按刪除';
        if (idx > 0) {
          let lpTimer = null;
          dot.addEventListener('touchstart', () => { lpTimer = setTimeout(() => { if (confirm(`刪除「${meta?.label || page.widget}」頁？`)) { S.mobilePages.splice(idx, 1); if (S.mobilePageIdx >= S.mobilePages.length) S.mobilePageIdx = S.mobilePages.length - 1; lsSave(); renderPages(); } }, 600); });
          dot.addEventListener('touchend', () => clearTimeout(lpTimer));
          dot.addEventListener('touchmove', () => clearTimeout(lpTimer));
        }
        dotsBar.appendChild(dot);
        return;
      }

      // 動畫追蹤專用：在 panelHead 加 ⚙ 和切換按鈕
      if (page.widget === 'anime') {
        const animeCfgBtn = el('button', 'yt-icon-btn anime-cfg-btn');
        animeCfgBtn.title = '動畫設定';
        animeCfgBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
        const animeViewBtnM = el('button', 'yt-icon-btn anime-view-btn');
        animeViewBtnM.title = '切換顯示模式';
        _updateViewBtnIcon(animeViewBtnM);
        animeViewBtnM.addEventListener('click', e => {
          e.stopPropagation();
          S.animeState.viewMode = _isGallery() ? 'list' : 'gallery';
          lsSave();
          document.querySelectorAll('.anime-view-btn').forEach(_updateViewBtnIcon);
          document.querySelectorAll('.anime-inner').forEach(inner => renderAnimeWidget(inner, inner.closest('[data-widget="anime"]')?.querySelector('.anime-cfg-btn') || null));
        });
        panelHead.insertBefore(animeCfgBtn, expandBtn);
        panelHead.insertBefore(animeViewBtnM, animeCfgBtn);

        panel.appendChild(panelHead);
        const inner = el('div', 'anime-inner');
        inner.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;min-height:0;';
        panel.appendChild(inner);
        swipeArea.appendChild(panel);
        renderAnimeWidget(inner, animeCfgBtn);
        const dot = el('div', 'mobile-dot' + (idx === S.mobilePageIdx ? ' active' : ''));
        dot.title = idx === 0 ? '捷徑（不可刪除）' : '長按刪除';
        if (idx > 0) {
          let lpTimer = null;
          dot.addEventListener('touchstart', () => { lpTimer = setTimeout(() => { if (confirm(`刪除「${meta?.label || page.widget}」頁？`)) { S.mobilePages.splice(idx, 1); if (S.mobilePageIdx >= S.mobilePages.length) S.mobilePageIdx = S.mobilePages.length - 1; lsSave(); renderPages(); } }, 600); });
          dot.addEventListener('touchend', () => clearTimeout(lpTimer));
          dot.addEventListener('touchmove', () => clearTimeout(lpTimer));
        }
        dotsBar.appendChild(dot);
        return;
      }

      // Widget content
      panel.appendChild(panelHead);
      buildMobileWidgetContent(page.widget, panel);

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
      if (S.editMode) document.querySelectorAll('.mobile-panel-btns').forEach(b => b.classList.remove('hidden'));
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
    // Disable swipe if any panel is fullscreen
    if (swipeArea.querySelector('.mobile-panel-fullscreen')) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    // Only switch page if horizontal movement is dominant and significant
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    const n = S.mobilePages.length;
    if (dx < 0) S.mobilePageIdx = (S.mobilePageIdx + 1) % n;
    else        S.mobilePageIdx = (S.mobilePageIdx - 1 + n) % n;
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
  // YouTube widget 不在 renderAll 裡重建，由 setInterval 定時控制
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

  // 套用 YT 字體大小設定
  setTimeout(() => { applyYtFontSize(); applyAnimeFontSize(); }, 100);

  // 若已有 YouTube OAuth token 且快過期（剩不到5分鐘），靜默刷新
  if (S.yt.oauthToken && S.yt.oauthExpiry) {
    const remaining = S.yt.oauthExpiry - Date.now();
    if (remaining > 0 && remaining < 5 * 60 * 1000) {
      setTimeout(() => ytSilentRefresh(), 2000);
    } else if (remaining > 5 * 60 * 1000) {
      // 正常時在快過期前自動刷新
      setTimeout(() => ytSilentRefresh(), remaining - 5 * 60 * 1000);
    }
  }

  // IndexedDB + video
  await idbOpen().catch(()=>{});
  await loadVideo().catch(()=>{});

  // Build widgets (only if visible, undefined counts as visible)
  if (S.widgets.clock?.visible     !== false) buildClockWidget();
  if (S.widgets.shortcuts?.visible !== false) buildShortcutsWidget();
  if (S.widgets.news?.visible      !== false) buildNewsWidget();
  if (S.widgets.stickies?.visible  === true)  buildStickiesWidget();
  if (S.widgets.anime?.visible     === true)  buildAnimeWidget();
  if (S.widgets.youtube?.visible   === true)  buildYoutubeWidget();
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
      const ok = await gistPull();
      if (ok) toast('已從雲端還原設定 ✓');
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

// ── 自動同步觸發點 ──
// 1. 開啟時
async function initAutoSync() {
  await gistAutoSync();
  // 2. 每 5 分鐘定時檢查
  setInterval(gistAutoSync, 5 * 60 * 1000);
  // 3. 從後台回到前台
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') gistAutoSync();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await init();
  // Gist 同步（只同步設定，不觸發任何 API 抓取）
  gistAutoSync();
  setInterval(gistAutoSync, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') gistAutoSync();
  });
  // 新聞定時更新：每 4 小時檢查一次
  setInterval(() => {
    const now = Date.now();
    const hasExpired = (S.news.keywords || []).some(kw =>
      !S.news.kwFetchedAt?.[kw] || (now - S.news.kwFetchedAt[kw]) >= NEWS_CACHE_MS
    );
    if (hasExpired) fetchNews();
  }, NEWS_CACHE_MS);
  // YouTube 定時更新：每 30 分鐘檢查一次
  setInterval(() => {
    const YT_CACHE_MS = 30 * 60 * 1000;
    if (S.yt.channels?.length && (!S.yt.fetchedAt || (Date.now() - S.yt.fetchedAt) >= YT_CACHE_MS)) {
      const ytBody = document.querySelector('.widget[data-wid="youtube"] .yt-inner');
      const mobileYtBody = document.querySelector('#mobile-layout .yt-inner');
      fetchYoutubeFeed(false).then(() => {
        if (ytBody) renderYoutubeWidget(ytBody);
        if (mobileYtBody) renderYoutubeWidget(mobileYtBody);
      });
    }
  }, 30 * 60 * 1000);

  // ── 效能監控 ──
  // 隱藏全部 Widget 按鈕
  const hideAllBtn = document.getElementById('hide-all-btn');
  if (hideAllBtn) {
    const HIDE_KEY = 'neocast_widgets_hidden';
    const applyHidden = (hidden) => {
      const wc = document.getElementById('wc');
      if (wc) wc.style.display = hidden ? 'none' : '';
      hideAllBtn.textContent = hidden ? '▼' : '▲';
      hideAllBtn.title = hidden ? '顯示所有 Widget' : '隱藏所有 Widget';
      localStorage.setItem(HIDE_KEY, hidden ? '1' : '');
    };
    hideAllBtn.addEventListener('click', () => {
      const nowHidden = localStorage.getItem(HIDE_KEY) === '1';
      applyHidden(!nowHidden);
    });
    // 還原上次狀態
    if (localStorage.getItem(HIDE_KEY) === '1') applyHidden(true);
  }

  const perfBtn   = document.getElementById('perf-btn');
  const perfPanel = document.getElementById('perf-panel');
  const perfFps   = document.getElementById('perf-fps');
  const perfMem   = document.getElementById('perf-mem');
  const perfRaf   = document.getElementById('perf-raf');

  let perfActive = false;
  let perfRafId  = null;
  let perfFrames = 0;
  let perfLast   = performance.now();

  const perfLoop = ts => {
    if (!perfActive) return;
    perfFrames++;
    const elapsed = ts - perfLast;
    if (elapsed >= 500) { // 每 0.5 秒更新一次
      const fps = Math.round(perfFrames / (elapsed / 1000));
      perfFps.textContent = `FPS: ${fps}`;
      perfFps.style.color = fps >= 55 ? '#4ade80' : fps >= 30 ? '#f59e0b' : '#f87171';

      // Memory（Chrome 限定，其他瀏覽器不支援）
      if (performance.memory) {
        const used = (performance.memory.usedJSHeapSize / 1048576).toFixed(1);
        const total = (performance.memory.totalJSHeapSize / 1048576).toFixed(1);
        perfMem.textContent = `MEM: ${used}/${total}MB`;
        const ratio = performance.memory.usedJSHeapSize / performance.memory.totalJSHeapSize;
        perfMem.style.color = ratio < 0.7 ? '#60a5fa' : ratio < 0.9 ? '#f59e0b' : '#f87171';
      } else {
        perfMem.textContent = 'MEM: N/A';
      }

      // 目前存活的 rAF 數量（偵測是否有未清除的 rAF）
      perfRaf.textContent = `rAF: ${window._dragScrollActive ? 1 : 0}`;

      perfFrames = 0;
      perfLast   = ts;
    }
    perfRafId = requestAnimationFrame(perfLoop);
  };

  perfBtn.addEventListener('click', () => {
    perfActive = !perfActive;
    perfBtn.classList.toggle('on', perfActive);
    perfPanel.classList.toggle('hidden', !perfActive);
    if (perfActive) {
      perfFrames = 0;
      perfLast   = performance.now();
      perfRafId  = requestAnimationFrame(perfLoop);
    } else {
      if (perfRafId) { cancelAnimationFrame(perfRafId); perfRafId = null; }
    }
  });
});
