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
const VID_KEY     = 'bg_video';
const PAGE_VID_KEY = id => `page_video_${id}`; // per-page background video key
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
const CLOUD_API      = 'https://neocast-api.heineken6may.workers.dev';
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
    newsdataApiKey: '',
    cloudToken:  ''
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
  mobilePageIdx:  0,
  gallery:           [],
  galleryDeletedIds: []   // 刪除墓碑：防止 cloudGalleryPull 把已刪項目重新加回
};

/* ─────────────────────────────────────
   UTILS
───────────────────────────────────── */
const $  = id  => document.getElementById(id);
const el = (tag, cls, html) => { const e=document.createElement(tag); if(cls)e.className=cls; if(html)e.innerHTML=html; return e; };
const uid = () => Math.random().toString(36).slice(2)+Date.now().toString(36);
const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));

/* 將標籤列包入摺疊結構。innerEl 已是其父元素的子節點。
   每次重繪後可呼叫 recheck() 更新展開按鈕可見性。 */
function _initTagsFold(innerEl) {
  if (!innerEl || innerEl.parentElement?.classList.contains('tags-fold-wrapper')) return;
  const parent = innerEl.parentElement;
  const wrapper = el('div', 'tags-fold-wrapper');
  parent.insertBefore(wrapper, innerEl);
  wrapper.appendChild(innerEl);
  innerEl.classList.add('tags-fold-inner');
  const btn = el('button', 'tags-expand-btn');
  btn.setAttribute('aria-label', '展開標籤');
  btn.innerHTML = '▼'; // arrow wrapped in span below for rotation
  const arrow = el('span', 'tags-expand-arrow', '▼');
  btn.textContent = '';
  btn.appendChild(arrow);
  btn.style.display = 'none'; // 預設隱藏，recheck 後決定是否顯示
  wrapper.appendChild(btn);
  btn.addEventListener('click', () => {
    innerEl.classList.toggle('is-expanded');
    btn.classList.toggle('is-expanded');
  });
}

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
      animeState: { genre: S.animeState.genre, tracked: S.animeState.tracked, trackedData: S.animeState.trackedData, customNames: S.animeState.customNames, viewMode: S.animeState.viewMode },
      gallery: S.gallery || [],
      galleryDeletedIds: (S.galleryDeletedIds || []).slice(-200)
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
      animeState: { genre: S.animeState.genre, tracked: S.animeState.tracked, trackedData: S.animeState.trackedData, customNames: S.animeState.customNames, viewMode: S.animeState.viewMode },
      gallery: S.gallery || [],
      galleryDeletedIds: (S.galleryDeletedIds || []).slice(-200)  // 最多保留 200 筆，防止無限增長
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
    }, 5000);
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
    if (d.gallery)            S.gallery = d.gallery;
    if (d.galleryDeletedIds)  S.galleryDeletedIds = d.galleryDeletedIds;
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

function idbGetAll() {
  return new Promise((res, rej) => {
    const tx  = idb.transaction(IDB_ST, 'readonly');
    const req = tx.objectStore(IDB_ST).openCursor();
    const entries = [];
    req.onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) { entries.push({ key: cursor.key, value: cursor.value }); cursor.continue(); }
      else res(entries);
    };
    req.onerror = rej;
  });
}

/* ─────────────────────────────────────
   BACKUP & RESTORE
───────────────────────────────────── */
const BACKUP_LS_KEYS = [
  LS_KEY, '_bgMediaIsImg', 'yt_quota_exceeded_until',
  'fab_size', 'fab_pos', 'neocast_widgets_hide_state'
];

async function exportBackup() {
  toast('📦 正在打包資料，請稍候...');
  try {
    const zip = new JSZip();

    // localStorage
    const settings = {};
    BACKUP_LS_KEYS.forEach(k => {
      const v = localStorage.getItem(k);
      if (v !== null) settings[k] = v;
    });
    zip.file('settings.json', JSON.stringify(settings));

    // IndexedDB blobs + MIME metadata
    const entries = await idbGetAll().catch(() => []);
    const blobMeta = {};
    for (const { key, value } of entries) {
      if (value instanceof Blob) {
        blobMeta[String(key)] = value.type || '';
        zip.file('blobs/' + key, value);
      }
    }
    zip.file('blob_meta.json', JSON.stringify(blobMeta));

    const blob = await zip.generateAsync({ type: 'blob' });
    const ver  = document.getElementById('version-tag')?.textContent?.trim() || 'backup';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `NeoCast_Backup_${ver}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast('✅ 備份完成');
  } catch (e) {
    toast('❌ 備份失敗：' + e.message);
  }
}

async function importBackup(file) {
  toast('📥 正在還原資料，請勿關閉視窗...');
  try {
    const zip = await JSZip.loadAsync(file);

    // localStorage
    const settingsFile = zip.file('settings.json');
    if (settingsFile) {
      const settings = JSON.parse(await settingsFile.async('string'));
      for (const [k, v] of Object.entries(settings)) localStorage.setItem(k, v);
    }

    // 讀取 MIME metadata（還原 blob.type，讓影片/圖片能正確識別）
    const metaFile = zip.file('blob_meta.json');
    const blobMeta = metaFile ? JSON.parse(await metaFile.async('string')) : {};

    // IndexedDB blobs
    const blobFiles = [];
    zip.folder('blobs').forEach((relPath, zipObj) => {
      if (!zipObj.dir) blobFiles.push({ key: relPath, zipObj });
    });
    for (const { key, zipObj } of blobFiles) {
      const raw      = await zipObj.async('blob');
      const mimeType = blobMeta[key] || '';
      const blob     = mimeType ? new Blob([raw], { type: mimeType }) : raw;
      await idbSet(key, blob).catch(() => {});
    }

    toast('✅ 還原成功，即將重新載入');
    setTimeout(() => location.reload(), 1500);
  } catch (e) {
    toast('❌ 還原失敗：' + e.message);
  }
}

function idbDel(key) {
  return new Promise((res, rej) => {
    const tx = idb.transaction(IDB_ST, 'readwrite');
    tx.objectStore(IDB_ST).delete(key);
    tx.oncomplete = res; tx.onerror = rej;
  });
}

/* ─────────────────────────────────────
   CLOUD — Cloudflare Worker API
───────────────────────────────────── */
function _cloudHeaders() {
  return { 'Authorization': 'Bearer ' + (S.cfg.cloudToken || '') };
}

async function compressImage(blob, maxW = 1200, quality = 0.82) {
  return new Promise(res => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const cvs = document.createElement('canvas');
      cvs.width = w; cvs.height = h;
      cvs.getContext('2d').drawImage(img, 0, 0, w, h);
      cvs.toBlob(b => res(b || blob), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); res(blob); };
    img.src = url;
  });
}

/* ── 縮圖生成（gallery 預覽用，320px JPEG） ── */
async function generateThumb(blob, maxW = 320, quality = 0.75) {
  return new Promise(res => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const cvs = document.createElement('canvas');
      cvs.width = w; cvs.height = h;
      cvs.getContext('2d').drawImage(img, 0, 0, w, h);
      cvs.toBlob(b => res(b || blob), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); res(blob); };
    img.src = url;
  });
}

// 回傳 { blob, type } type = 'video'|'image'
// 成功剪輯 → type:'video'（webm）
// 剪輯失敗 → 擷取第一幀 → type:'image'（jpeg）
// 全部失敗 → null
async function processVideoBlob(blob) {
  // Step 1：嘗試剪到 3 秒
  const trimmed = await new Promise(res => {
    const url = URL.createObjectURL(blob);
    const vid = document.createElement('video');
    vid.muted = true; vid.playsInline = true; vid.src = url;
    let settled = false;
    const settle = v => { if (!settled) { settled = true; res(v); } };
    const cleanup = () => { try { URL.revokeObjectURL(url); } catch(_) {} };

    vid.oncanplay = () => {
      let stream, recorder, chunks = [];
      try {
        stream = vid.captureStream?.() || vid.mozCaptureStream?.();
        if (!stream) throw new Error('no captureStream');
      } catch(e) { cleanup(); settle(null); return; }
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
        ? 'video/webm;codecs=vp8' : 'video/webm';
      try { recorder = new MediaRecorder(stream, { mimeType: mime }); }
      catch(e) { cleanup(); settle(null); return; }
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = () => {
        cleanup();
        const b = new Blob(chunks, { type: 'video/webm' });
        settle(b.size > 5000 ? b : null); // 拒絕空白/損壞的 blob
      };
      recorder.start();
      const playP = vid.play();
      if (playP) playP.catch(() => { cleanup(); settle(null); }); // play() 被封鎖時 fallback
      setTimeout(() => {
        try { if (recorder.state === 'recording') { recorder.stop(); vid.pause(); } }
        catch(_) {}
      }, 3100);
    };
    vid.onerror = () => { cleanup(); settle(null); };
    setTimeout(() => { cleanup(); settle(null); }, 12000); // 12s 硬 timeout
  });
  if (trimmed) return { blob: trimmed, type: 'video' };

  // Step 2：擷取第一幀（修正版：metadata 載入後再 seek，確保尺寸不為 0）
  const frame = await new Promise(res => {
    const url = URL.createObjectURL(blob);
    const vid = document.createElement('video');
    vid.muted = true; vid.playsInline = true; vid.preload = 'metadata'; vid.src = url;
    let settled = false;
    const settle = v => { if (!settled) { settled = true; res(v); } };
    const cleanup = () => { try { URL.revokeObjectURL(url); } catch(_) {} };

    const drawFrame = () => {
      if (!vid.videoWidth || !vid.videoHeight) { cleanup(); settle(null); return; }
      try {
        const cvs = document.createElement('canvas');
        const scale = Math.min(1, 1200 / vid.videoWidth);
        cvs.width  = Math.round(vid.videoWidth  * scale);
        cvs.height = Math.round(vid.videoHeight * scale);
        cvs.getContext('2d').drawImage(vid, 0, 0, cvs.width, cvs.height);
        cleanup();
        cvs.toBlob(b => settle(b && b.size > 500 ? b : null), 'image/jpeg', 0.85);
      } catch(e) { cleanup(); settle(null); }
    };

    vid.onloadedmetadata = () => { vid.currentTime = 0.5; };
    vid.onseeked = drawFrame;
    vid.onloadeddata  = () => { if (vid.readyState >= 2 && vid.videoWidth) drawFrame(); };
    vid.onerror = () => { cleanup(); settle(null); };
    setTimeout(() => { cleanup(); settle(null); }, 8000);
  });
  if (frame) return { blob: frame, type: 'image' };

  return null;
}

async function cloudUpload(blob, contentType) {
  const res = await fetch(CLOUD_API + '/upload', {
    method: 'POST',
    headers: { ..._cloudHeaders(), 'Content-Type': contentType },
    body: blob,
  });
  if (!res.ok) throw new Error('Upload failed: ' + res.status);
  return await res.json(); // { url, r2Key }
}

async function cloudGalleryPush() {
  if (!S.cfg.cloudToken) return;
  try {
    await fetch(CLOUD_API + '/gallery', {
      method: 'POST',
      headers: { ..._cloudHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(S.gallery || []),
    });
  } catch(_) {}
}

async function cloudGalleryPull() {
  if (!S.cfg.cloudToken) return;
  try {
    const res = await fetch(CLOUD_API + '/gallery', { headers: _cloudHeaders() });
    if (!res.ok) return;
    const remote = await res.json();
    if (!Array.isArray(remote)) return;

    const remoteIds   = new Set(remote.map(g => g.id));
    const localIds    = new Set((S.gallery || []).map(g => g.id));
    // 墓碑：本機已刪除的 ID，不允許雲端 pull 重新加回
    const tombstoneIds = new Set(S.galleryDeletedIds || []);
    let changed = false;

    // 新增：遠端有、本地沒有、且不在墓碑內 → 才加進來
    remote.forEach(item => {
      if (!localIds.has(item.id) && !tombstoneIds.has(item.id)) {
        S.gallery.push(item); changed = true;
      }
    });

    // 刪除：本地有、遠端沒有，且是雲端項目（有 mediaUrl 或 r2Key）→ 移除
    S.gallery = S.gallery.filter(g => {
      if (!g.mediaUrl && !g.r2Key) return true; // 純本地項目，不動
      if (remoteIds.has(g.id)) return true;      // 雲端存在，保留
      changed = true;
      return false; // 雲端已刪除，本地跟著移除
    });

    if (changed) { lsSaveLocal(); renderGalleryIfVisible(); }
  } catch(_) {}
}

function renderGalleryIfVisible() {
  const container = document.querySelector('.gallery-scroll')?.parentElement;
  if (container) renderGalleryWidget(container);
}

function extractYouTubeId(url) {
  const m = (url || '').match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function fetchLinkMeta(targetUrl) {
  if (!S.cfg.cloudToken) return null;
  try {
    const res = await fetch(
      `${CLOUD_API}/og?url=${encodeURIComponent(targetUrl)}`,
      { headers: _cloudHeaders() }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data.title || data.image || data.description) ? data : null;
  } catch(_) { return null; }
}

function cloudDeleteItem(id, r2Key) {
  if (!S.cfg.cloudToken) return;
  fetch(CLOUD_API + '/gallery/' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: _cloudHeaders(),
  }).catch(() => {});
}

async function migrateGalleryToCloud() {
  if (!S.cfg.cloudToken) { toast('請先填入 Cloud Token', 'warn'); return; }
  const items = (S.gallery || []).filter(g => g.imageId && !g.mediaUrl);
  const statusEl = $('cfg-migrate-status');
  const btn = $('cfg-migrate-btn');

  if (!items.length) {
    if (statusEl) { statusEl.textContent = '沒有需要遷移的書籤'; statusEl.style.color = 'rgba(255,255,255,0.45)'; }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = `遷移中 0/${items.length}…`; }
  if (statusEl) { statusEl.textContent = ''; statusEl.style.color = ''; }

  let done = 0, failed = 0, asThumb = 0;
  for (const item of items) {
    try {
      const blob = await idbGet(item.imageId).catch(() => null);
      if (!blob) { failed++; continue; }

      let uploadBlob = blob, uploadType = 'image/jpeg';
      if (item.type === 'video') {
        const result = await processVideoBlob(blob);
        if (!result) { failed++; continue; }
        if (result.type === 'image') { item.type = 'image'; asThumb++; }
        uploadBlob = result.blob;
        uploadType = result.type === 'video' ? 'video/webm' : 'image/jpeg';
      } else {
        uploadBlob = await compressImage(blob);
      }

      const up = await cloudUpload(uploadBlob, uploadType);
      item.mediaUrl = up.url;
      item.r2Key    = up.r2Key;
      await idbDel(item.imageId).catch(() => {});
      item.imageId  = null;
      done++;
      if (btn) btn.textContent = `遷移中 ${done}/${items.length}…`;
    } catch(e) {
      failed++;
    }
  }

  lsSaveLocal();
  await cloudGalleryPush();

  if (btn) { btn.disabled = false; btn.textContent = '一鍵遷移至雲端'; }

  // 持久狀態顯示
  if (statusEl) {
    if (failed) {
      statusEl.textContent = `✅ ${done} 成功　⚠️ ${failed} 失敗${asThumb ? `　📷 ${asThumb} 部影片改存縮圖` : ''}`;
      statusEl.style.color = '#fbbf24';
    } else {
      statusEl.textContent = `✅ 已遷移 ${done} 個書籤${asThumb ? `（${asThumb} 部影片改存縮圖）` : ''}`;
      statusEl.style.color = '#4ade80';
    }
  }
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
    cloudGalleryPull();
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
let videoBlobUrl    = null;
let pageVideoBlobUrl = null; // per-page bg blob URL（切換時 revoke 釋放記憶體）
let _pvGen           = 0;   // generation counter，防止多個 async load 競爭

/* ── 圖片類型判斷（含 extension fallback） ── */
function _isImgBlob(blob) {
  if (!blob) return false;
  const t = (blob.type || '').toLowerCase();
  if (t) return t.startsWith('image/');
  // type 為空時，嘗試從檔名推斷（File 物件才有 name）
  const n = (blob.name || '').toLowerCase();
  return /\.(jpe?g|jpg|png|webp|gif|avif|bmp|svg|heic|heif)$/.test(n);
}

/* ── 套用全局背景媒體（blob 可為影片或圖片） ── */
function _applyBgBlob(blob, blobUrl) {
  const vid  = $('bg-video');
  const img  = $('bg-img');
  const orbs = $('bg-orbs');

  // 清除 body fallback
  document.body.style.backgroundImage    = '';
  document.body.style.backgroundSize     = '';
  document.body.style.backgroundPosition = '';

  if (!blob) {
    // 清除：顯示預設光球
    if (vid) { vid.pause(); vid.src = ''; vid.style.display = 'block'; }
    if (img) { img.src = ''; img.style.display = 'none'; }
    if (orbs) orbs.style.display = '';
    return;
  }

  // 儲存此次媒體類型到 localStorage，供重啟時快速偵測
  try { localStorage.setItem('_bgMediaIsImg', _isImgBlob(blob) ? '1' : '0'); } catch(_) {}

  const isImg = _isImgBlob(blob);
  if (isImg) {
    if (vid) { vid.pause(); vid.src = ''; vid.style.display = 'none'; }
    if (img) {
      // 主路徑：#bg-img 存在
      img.src = blobUrl;
      img.style.setProperty('display', 'block', 'important');
    } else {
      // Fallback：若 #bg-img 不在 DOM（舊快取 HTML），改用 body background
      document.body.style.backgroundImage    = `url(${blobUrl})`;
      document.body.style.backgroundSize     = 'cover';
      document.body.style.backgroundPosition = 'center';
    }
  } else {
    if (img) { img.src = ''; img.style.display = 'none'; }
    document.body.style.backgroundImage = '';
    if (vid) {
      vid.style.display = 'block';
      // 已是同一支影片時只補播，避免 src 重設 + load() 造成切頁閃爍
      if (vid.src === blobUrl) {
        if (vid.paused) vid.play().catch(() => {});
      } else {
        vid.src = blobUrl;
        vid.load();
      }
    }
  }
  if (orbs) orbs.style.display = 'none';
}

async function loadVideo() {
  try {
    const blob = await idbGet(VID_KEY);
    if (!blob) return;
    // 若 IDB 返回的 blob 沒有 type（部分瀏覽器/PWA 會遺失），
    // 用 localStorage hint 補上，確保 _isImgBlob 正確判斷
    let typedBlob = blob;
    if (!blob.type) {
      const hint = localStorage.getItem('_bgMediaIsImg');
      const guessType = hint === '1' ? 'image/jpeg' : (hint === '0' ? 'video/mp4' : '');
      if (guessType) typedBlob = new Blob([blob], { type: guessType });
    }
    if (videoBlobUrl) URL.revokeObjectURL(videoBlobUrl);
    videoBlobUrl = URL.createObjectURL(typedBlob);
    _applyBgBlob(typedBlob, videoBlobUrl);
  } catch(_) {}
}

async function saveVideo(file) {
  try {
    // 先存媒體類型 hint，確保 loadVideo 能正確偵測圖片 vs 影片
    try { localStorage.setItem('_bgMediaIsImg', _isImgBlob(file) ? '1' : '0'); } catch(_) {}
    await idbSet(VID_KEY, file);
    await loadVideo();
    toast(_isImgBlob(file) ? '背景圖片已設定 ✓' : '背景影片已設定 ✓');
  } catch(_) { toast('背景設定失敗','err'); }
}

async function removeVideo() {
  try {
    await idbDel(VID_KEY);
    try { localStorage.removeItem('_bgMediaIsImg'); } catch(_) {}
    if (videoBlobUrl) { URL.revokeObjectURL(videoBlobUrl); videoBlobUrl = null; }
    _applyBgBlob(null, null);
    toast('已移除背景');
  } catch(_) {}
}

/* ── 讓 IDB 取回的 blob 帶上正確 type（避免部分瀏覽器遺失 MIME） ── */
function _enrichBlob(blob, lsHintKey) {
  if (!blob || blob.type) return blob;
  const hint = localStorage.getItem(lsHintKey);
  if (!hint) return blob;
  const guessType = hint === '1' ? 'image/jpeg' : 'video/mp4';
  return new Blob([blob], { type: guessType });
}

// 切換至指定分頁的背景（優先分頁設定，否則 fallback 全局）
async function switchPageVideo(pageId) {
  const gen = ++_pvGen;
  // 釋放前一個分頁的 blob URL，防止記憶體累積
  if (pageVideoBlobUrl) {
    URL.revokeObjectURL(pageVideoBlobUrl);
    pageVideoBlobUrl = null;
  }
  try {
    const rawBlob = await idbGet(PAGE_VID_KEY(pageId));
    if (gen !== _pvGen) return; // 已被更新的呼叫取代，中止
    if (rawBlob) {
      const blob = _enrichBlob(rawBlob, '_bgPageIsImg_' + pageId);
      pageVideoBlobUrl = URL.createObjectURL(blob);
      _applyBgBlob(blob, pageVideoBlobUrl);
    } else {
      // 此分頁無獨立設定 → 使用全局媒體（需重新讀取 blob type）
      const rawGlobal = await idbGet(VID_KEY).catch(() => null);
      if (gen !== _pvGen) return;
      const globalBlob = rawGlobal ? _enrichBlob(rawGlobal, '_bgMediaIsImg') : null;
      _applyBgBlob(globalBlob || null, videoBlobUrl || null);
    }
  } catch (_) {}
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
  youtube:   { label: 'YouTube 訂閱', icon: '▶️' },
  gallery:   { label: '視覺書籤', icon: '🖼️' }
};

/* Default positions for when a widget is re-added */
const WIDGET_DEFAULT = {
  clock:     { col:0,  row:0, w:6,  h:2,  visible:true },
  shortcuts: { col:6,  row:2, w:6,  h:5,  visible:true },
  news:      { col:0,  row:2, w:6,  h:5,  visible:true },
  stickies:  { col:12, row:0, w:6,  h:6,  visible:true },
  anime:     { col:18, row:0, w:6,  h:8,  visible:true },
  youtube:   { col:12, row:6, w:6,  h:8,  visible:true },
  gallery:   { col:18, row:8, w:6,  h:10, visible:true }
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
  if (wid === 'gallery')   buildGalleryDesktopWidget();
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
  youtube:   '訂閱更新',
  gallery:   '視覺書籤'
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
  if (!navigator.geolocation) throw '瀏覽器不支援定位';

  // 單次嘗試的包裝
  const tryGet = (opts) => new Promise((res, rej) =>
    navigator.geolocation.getCurrentPosition(
      pos => res({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      rej,
      opts
    )
  );

  let lastErr;
  // 第一次：低精度 + 快取（Chrome / Edge 一般秒成功）
  try {
    return await tryGet({ timeout: 15000, maximumAge: 300000, enableHighAccuracy: false });
  } catch(e) { lastErr = e; }

  // 第二次：高精度（Firefox 有時需要走 GPS path 才能通過）
  try {
    return await tryGet({ timeout: 25000, maximumAge: 0, enableHighAccuracy: true });
  } catch(e) { lastErr = e; }

  // 翻譯最終錯誤
  const code = lastErr?.code;
  if (code === 1) throw '定位權限被拒絕，請在瀏覽器設定中允許位置存取';
  if (code === 2) throw '無法取得位置，請確認裝置已開啟定位服務';
  throw '定位逾時，請確認 OS「位置」服務已開啟，或改為手動輸入城市';
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
  // 功能移至 version-tag：三連擊解鎖，解鎖後單擊鎖定，解鎖時發光
  const btn = $('version-tag');
  if (!btn) return;

  let clickCount = 0;
  let clickTimer = null;

  btn.addEventListener('click', () => {
    // 已解鎖 → 單擊鎖定
    if (S.privateUnlocked) {
      lockPrivate();
      return;
    }

    // 三連擊（1.5s 內）解鎖
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
    btn.classList.add('unlocked');          // 發光效果由 CSS 控制
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
    btn.classList.remove('unlocked');       // 關閉發光
    // 若正在看私人群組，切回全部
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
    newsEditingTags = !open;
    renderNewsKws();

    // 設定開啟時隱藏展開鈕；設定關閉時恢復（recheck 決定是否顯示）
    const foldBtn = kws.closest?.('.tags-fold-wrapper')?.querySelector('.tags-expand-btn');
    if (foldBtn) {
      if (!open) {
        // 剛剛從 close → open，設定面板打開
        foldBtn.style.display = 'none';
      } else {
        // 剛剛從 open → close，設定面板關閉，重新偵測
        requestAnimationFrame(() => {
          foldBtn.style.display = kws.scrollHeight > kws.clientHeight + 2 ? '' : 'none';
        });
      }
    }

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
  _initTagsFold(kws);

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

  // 重繪後更新展開按鈕可見性
  requestAnimationFrame(() => {
    const btn = kws?.closest('.tags-fold-wrapper')?.querySelector('.tags-expand-btn');
    if (btn) btn.style.display = kws.scrollHeight > kws.clientHeight + 2 ? '' : 'none';
  });
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

  // 高度交給 CSS Flexbox，不需要 ResizeObserver 計算
}

function renderStickiesWidget(container) {
  // 保留 tagBar，只清掉 list 和 input-bar
  // 記住目前捲動位置，重建後還原（避免勾選/編輯時跳回頂端）
  const prevScrollTop = container.querySelector('.sticky-list')?.scrollTop ?? 0;
  document.getElementById('sticky-kb-floating')?.remove();
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

  // ── 鍵盤處理：底部推擠法（Padding Push）─────────────────────────
  // 不搬移 DOM，不用 position:fixed，相容 Chrome / Firefox（狐猴）
  const isMobile = !!container.closest('#mobile-layout');

  bar.appendChild(colorGrid);
  bar.appendChild(inp);
  bar.appendChild(addBtn);
  container.appendChild(bar);

  if (isMobile) {
    // 手機版：點擊 bar → 彈出全螢幕 Modal（輸入框置中偏上，永遠不被鍵盤遮住）
    // 用 readOnly + click 取代 focus，避免滑動換頁後 focus 不觸發的問題
    inp.readOnly = true;

    const openStickyModal = () => {
      if (searchQ || S.stickyLocked) return;
      document.getElementById('sticky-mobile-modal')?.remove();

      const overlay = document.createElement('div');
      overlay.id = 'sticky-mobile-modal';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.4);display:flex;flex-direction:column;align-items:center;justify-content:center;padding-bottom:25vh;box-sizing:border-box;';

      const box = document.createElement('div');
      box.style.cssText = 'background:#2e3352;border:1.5px solid rgba(255,255,255,0.28);padding:16px 14px;border-radius:14px;display:flex;flex-direction:column;gap:10px;width:90%;max-width:420px;box-sizing:border-box;box-shadow:0 8px 32px rgba(0,0,0,0.4);';

      // 顏色選擇列
      let modalColor = 'none';
      const modalColorGrid = document.createElement('div');
      modalColorGrid.style.cssText = 'display:flex;gap:8px;';
      ['blue','green','red','yellow'].forEach(key => {
        const sq = document.createElement('button');
        sq.style.cssText = `width:28px;height:28px;border-radius:6px;border:2px solid transparent;background:${STICKY_COLORS[key].bg};cursor:pointer;flex-shrink:0;`;
        sq.addEventListener('click', () => {
          modalColor = modalColor === key ? 'none' : key;
          modalColorGrid.querySelectorAll('button').forEach(b => b.style.borderColor = 'transparent');
          if (modalColor !== 'none') sq.style.borderColor = '#fff';
        });
        modalColorGrid.appendChild(sq);
      });

      // 輸入列
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;';

      const modalInp = document.createElement('input');
      modalInp.type = 'text';
      modalInp.placeholder = '新增待辦…';
      modalInp.autocomplete = 'off';
      modalInp.style.cssText = 'flex:1;min-width:0;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:#3d4166;color:#fff;font-size:16px;outline:none;';

      const confirmBtn = document.createElement('button');
      confirmBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M2 12l20-8-8 20-4-8-8-4z"/></svg>`;
      confirmBtn.style.cssText = 'padding:10px 14px;border-radius:8px;border:none;background:#5865f2;color:#fff;cursor:pointer;flex-shrink:0;';

      function doModalAdd() {
        const text = modalInp.value.trim();
        if (!text) return;
        const newTag = (S.activeStickyTag && S.activeStickyTag !== 'all') ? S.activeStickyTag : '';
        S.stickies.unshift({ id: uid(), text, color: modalColor, pinned: false, tag: newTag });
        lsSave();
        renderStickiesWidget(container);
        // 清空輸入框並重新聚焦，允許連續新增
        modalInp.value = '';
        requestAnimationFrame(() => modalInp.focus());
      }

      confirmBtn.addEventListener('click', doModalAdd);
      // 點擊遮罩關閉（不需要取消按鈕）
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
      modalInp.addEventListener('keydown', e => {
        if (e.key === 'Enter') doModalAdd();
        if (e.key === 'Escape') overlay.remove();
      });

      row.appendChild(modalInp);
      row.appendChild(confirmBtn);
      box.appendChild(modalColorGrid);
      box.appendChild(row);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      requestAnimationFrame(() => modalInp.focus());
    };

    bar.addEventListener('click', openStickyModal);
  }

  // 還原捲動位置（勾選/編輯完後不跳回頂端）
  // 高度完全交給 CSS Flexbox（.sticky-list { flex:1; min-height:0; }），不用 JS 計算
  if (prevScrollTop > 0) requestAnimationFrame(() => { list.scrollTop = prevScrollTop; });
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
  $('cfg-cloud-token').value = S.cfg.cloudToken || '';
  $('cfg-migrate-btn').onclick = () => migrateGalleryToCloud();
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

  S.cfg.cloudToken   = $('cfg-cloud-token').value.trim();
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
  if (S.cfg.weatherLat) initWeather();
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
    img.loading = 'lazy'; img.decoding = 'async';

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
          _animeCalendarCache = calendarCache;   // 讓全局搜尋可存取
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
  const _animeCoverUrl = anime.images?.large || anime.images?.common || '';
  cover.src = _animeCoverUrl;
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

async function fetchYoutubeFeed(force = false, onProgress = null) {
  const CACHE_MIN = 30;
  // 配額超限時不再嘗試（直到明天台灣時間 08:00）
  if (!force && Date.now() < ytQuotaExceededUntil()) return S.yt.items || [];
  if (!force && S.yt.fetchedAt && (Date.now() - S.yt.fetchedAt) < CACHE_MIN * 60000) {
    return S.yt.items;
  }
  const key = S.cfg.ytApiKey?.trim();
  if (!key || !S.yt.channels?.length) return [];

  // 分批抓取：每 5 個頻道一組，抓完一批立即更新畫面
  const CHUNK = 5;
  let newItems = [];

  for (let i = 0; i < S.yt.channels.length; i += CHUNK) {
    const chunk = S.yt.channels.slice(i, i + CHUNK);
    const results = await Promise.allSettled(
      chunk.map(ch => fetchChannelVideos(ch.id, key))
    );

    // 403 配額超限：立刻中止整批抓取
    const has403 = results.some(r => r.status === 'rejected' && r.reason?.message?.includes('403'));
    if (has403) {
      setYtQuotaExceeded();
      console.warn('[NeoCast] YouTube API 配額超限，停止自動重試直到明天 08:00');
      toast('YouTube API 配額已用完，台灣時間 08:00 後重置', 'warn');
      return S.yt.items || [];
    }

    const chunkItems = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value);

    // 合併並重新排序，讓時間軸始終正確
    newItems = [...newItems, ...chunkItems]
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    // 每批抓完就立即更新全域狀態，並通知呼叫方重繪
    S.yt.items = newItems;
    if (onProgress) onProgress();
  }

  clearYtQuotaExceeded();
  S.yt.fetchedAt = Date.now();
  lsSave();
  return newItems;
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

function buildGalleryDesktopWidget() {
  const body = el('div', 'gal-desktop-body');
  body.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;min-height:0;position:relative;';
  const w = makeWidget('gallery', '視覺書籤', body, '');

  // 在 w-head 中插入垃圾桶按鈕（多選刪除，平常隱藏）
  const wHead = w.querySelector('.w-head');
  const pencilBtn = wHead?.querySelector('.w-pencil-btn');
  const trashBtn = document.createElement('button');
  trashBtn.className = 'yt-icon-btn gallery-trash-btn';
  trashBtn.title = '刪除選取';
  trashBtn.style.display = 'none';
  trashBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/></svg>`;
  trashBtn.addEventListener('click', async () => {
    if (!_galSelected.size) return;
    const ids = [..._galSelected];
    const toDelete = (S.gallery || []).filter(g => ids.includes(g.id));
    S.gallery = (S.gallery || []).filter(g => !ids.includes(g.id));
    if (!S.galleryDeletedIds) S.galleryDeletedIds = [];
    ids.forEach(id => { if (!S.galleryDeletedIds.includes(id)) S.galleryDeletedIds.push(id); });
    _galSelected.clear();
    _galMultiActive = false;
    lsSave();
    await Promise.all(toDelete.flatMap(g => [
      g.imageId ? idbDel(g.imageId).catch(() => {}) : Promise.resolve(),
      g.thumbId ? idbDel(g.thumbId).catch(() => {}) : Promise.resolve(),
    ]));
    toDelete.forEach(g => cloudDeleteItem(g.id, g.r2Key));
    cloudGalleryPush();
    renderGalleryWidget(body);
  });
  if (wHead && pencilBtn) wHead.insertBefore(trashBtn, pencilBtn);
  else if (wHead) wHead.appendChild(trashBtn);

  renderGalleryWidget(body);
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

    // 重繪後更新展開按鈕可見性
    requestAnimationFrame(() => {
      const btn = groupBar.closest('.tags-fold-wrapper')?.querySelector('.tags-expand-btn');
      if (btn) btn.style.display = groupBar.scrollHeight > groupBar.clientHeight + 2 ? '' : 'none';
    });
  };
  renderGroupBar();
  _initTagsFold(groupBar);

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

    // 重繪後更新展開按鈕可見性
    requestAnimationFrame(() => {
      const btn = durBar.closest('.tags-fold-wrapper')?.querySelector('.tags-expand-btn');
      if (btn) btn.style.display = durBar.scrollHeight > durBar.clientHeight + 2 ? '' : 'none';
    });
  };
  renderDurBar();
  _initTagsFold(durBar);

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
    card.dataset.vid = video.videoId; // omni-search 用來定位卡片
    const thumbWrap = el('div', 'yt-thumb');
    const img = el('img');
    img.src = video.thumb; img.alt = video.title; img.loading = 'lazy'; img.decoding = 'async';
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
    try { await fetchYoutubeFeed(true, () => renderFeed()); }
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
  let stuckTimer = null;
  let playerInitialized = false;
  let errorSkipAt = 0;
  let active = true; // 關閉或跳過後設 false，阻止重複觸發
  let lastPos = -1;
  let lastPosTime = 0;
  let watchdogInterval = null;

  const updateNavButtons = () => {
    if (prevBtn) prevBtn.disabled = curIdx <= 0;
    if (nextBtn) nextBtn.disabled = curIdx >= (playlist?.length || 1) - 1;
  };

  const buildPlayer = (portrait) => {
    const backdrop = el('div', 'yt-player-backdrop');
    backdrop.style.pointerEvents = 'none';
    const modal = el('div', 'yt-player-modal' + (portrait ? ' portrait' : ''));

    const closePlayer = () => {
      active = false;
      active = false;
      clearTimeout(stuckTimer); stuckTimer = null;
      clearInterval(watchdogInterval); watchdogInterval = null;
      clearTimeout(countdownTimer);
      clearInterval(countdownInterval);
      if (keyListener) { window.removeEventListener('keydown', keyListener); keyListener = null; }
      try { ytPlayer?.destroy(); } catch(_) {}
      ytPlayer = null;
      window._ytActivePlayer = null;
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

    const showCountdown = () => {
      if (!playlist || curIdx < 0) return;
      const next = playlist[curIdx + 1];
      if (!next) return;
      // Cancel any previously running countdown before starting a new one
      clearTimeout(countdownTimer); clearInterval(countdownInterval);
      let secs = 2;
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
        skipToNext();
      }, 2000);
    };

    const goToIdx = (idx) => {
      if (!active) return;
      if (!playlist || idx < 0 || idx >= playlist.length) return;
      curIdx = idx;
      updateNavButtons();
      if (onVideoChange && playlist[curIdx]) onVideoChange(playlist[curIdx]);
      lastPos = -1; lastPosTime = Date.now();
      clearTimeout(stuckTimer); stuckTimer = null;
      clearInterval(watchdogInterval); watchdogInterval = null;
      clearTimeout(countdownTimer); clearInterval(countdownInterval);
      nextBar.style.display = 'none';
      playerInitialized = false;

      // 完全銷毀並重建 player，確保字幕、快取、UI 狀態徹底清除
      try { ytPlayer?.destroy(); } catch(_) {}
      ytPlayer = null;
      window._ytActivePlayer = null;

      // 用全新容器取代舊容器（徹底清除 iframe 殘留 DOM）
      const newContainer = document.createElement('div');
      newContainer.id = 'yt-api-player-' + Date.now();
      newContainer.style.cssText = 'width:100%;height:100%;';
      ytContainerEl.replaceWith(newContainer);
      ytContainerEl = newContainer;

      // 初始化全新 player 並直接播放目標影片
      initYtPlayer(playlist[curIdx].videoId);
    };

    const skipToNext = () => {
      const now = Date.now();
      if (now - errorSkipAt < 500) return;
      errorSkipAt = now;
      goToIdx(curIdx + 1);
    };

    const skipToPrev = () => goToIdx(curIdx - 1);

    // vid 預設為首支影片 videoId，切換時傳入新的 id
    const initYtPlayer = (vid = videoId) => {
      ytPlayer = window._ytActivePlayer = new YT.Player(ytContainerEl.id, {
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 1, rel: 0, playsinline: 1 },
        events: {
          onReady: (e) => {
            e.target.loadVideoById(vid);
            setTimeout(() => {
              try { if (e.target.getPlayerState() !== 1) e.target.playVideo(); } catch(_) {}
              playerInitialized = true;
              lastPosTime = Date.now();
              // Watchdog：每 5 秒檢查播放位置是否有前進
              watchdogInterval = setInterval(() => {
                if (!active) { clearInterval(watchdogInterval); return; }
                try {
                  const st = ytPlayer?.getPlayerState?.();
                  if (st === 2) { lastPosTime = Date.now(); return; } // 暫停中，正常
                  const pos = ytPlayer?.getCurrentTime?.() ?? 0;
                  if (pos > lastPos + 0.1) { lastPos = pos; lastPosTime = Date.now(); return; }
                  if (Date.now() - lastPosTime > 20000) {
                    clearInterval(watchdogInterval);
                    skipToNext();
                  }
                } catch(_) {
                  clearInterval(watchdogInterval);
                  skipToNext();
                }
              }, 5000);
            }, 800);
          },
          onStateChange: (e) => {
            if (e.data === 1) { // playing
              clearTimeout(stuckTimer); stuckTimer = null;
              nextBar.style.display = 'none';
              clearTimeout(countdownTimer);
              clearInterval(countdownInterval);
            }
            if (e.data === 3) {
              clearTimeout(stuckTimer); stuckTimer = null;
            }
            if (e.data === -1) {
              if (playerInitialized) {
                clearTimeout(stuckTimer);
                stuckTimer = setTimeout(() => skipToNext(), 5000);
              }
            }
            if (e.data === 0) showCountdown();
          },
          onError: (e) => {
            clearTimeout(stuckTimer); stuckTimer = null;
            skipToNext();
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
        skipToPrev();
      });

      nextBtn = el('button', 'yt-player-nav-btn', '▶');
      nextBtn.title = '下一部（→）';
      nextBtn.disabled = curIdx >= playlist.length - 1;
      nextBtn.addEventListener('click', e => {
        e.stopPropagation();
        skipToNext();
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
        if (e.key === 'ArrowLeft')  { e.preventDefault(); skipToPrev(); }
        if (e.key === 'ArrowRight') { e.preventDefault(); skipToNext(); }
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
  youtube:   { label: 'YouTube 訂閱', icon: '▶️' },
  gallery:   { label: '視覺書籤', icon: '🖼️' }
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

    // 高度交給 CSS Flexbox，不需要 ResizeObserver 計算
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
  } else if (widgetType === 'gallery') {
    const inner = el('div', 'gallery-inner');
    inner.style.cssText = 'position:relative;flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;';
    container.appendChild(inner);
    renderGalleryWidget(inner);
  }
}

/* ─────────────────────────────────────
   GALLERY WIDGET — 視覺書籤
───────────────────────────────────── */
let _galMultiActive  = false;
let _galSelected     = new Set();
let _galSearchQuery  = '';
let _galActiveTag    = '';
let _galAllItems      = [];     // 完整列表（反序），每次 renderGalleryWidget 刷新
let _galFilteredItems = null;  // null = 不篩選，Array = 篩選後結果
let _galRenderedCount = 0;     // 已渲染張數
let _galIObs          = null;  // IntersectionObserver 實例
const GAL_PAGE_SIZE   = 20;    // 每頁載入張數
let _galActiveBlobUrls = [];   // 追蹤所有 createObjectURL 產生的 blob URL，供切換頁面時統一釋放

function injectGalleryCSS() {
  if (document.getElementById('gallery-style')) return;
  const s = document.createElement('style');
  s.id = 'gallery-style';
  s.textContent = `
    .gallery-card {
      transition: transform 0.15s ease, filter 0.15s ease;
      position: relative;
      content-visibility: auto;
      contain-intrinsic-size: auto 250px;
    }
    .gallery-card:active { transform: scale(0.96); filter: brightness(0.82); }
    .gallery-card.gallery-selected { box-shadow: 0 0 0 2px #5865f2 !important; }
    .gallery-detail-overlay { opacity: 0; transition: opacity 0.25s ease; }
    .gallery-detail-overlay.show { opacity: 1; }
    .gallery-detail-card {
      opacity: 0; transform: translateY(44px) scale(0.95);
      transition: opacity 0.4s cubic-bezier(0.175,0.885,0.32,1.275),
                  transform 0.4s cubic-bezier(0.175,0.885,0.32,1.275);
    }
    .gallery-detail-overlay.show .gallery-detail-card { opacity: 1; transform: translateY(0) scale(1); }
  `;
  document.head.appendChild(s);
}

/* ── 釋放所有待回收的 Gallery blob URL（離開頁面或重新渲染時呼叫） ── */
function _galRevokeBlobUrls() {
  _galActiveBlobUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch(_) {} });
  _galActiveBlobUrls = [];
}

function renderGalleryWidget(container) {
  injectGalleryCSS();
  // 清理前先釋放所有未消化的 blob URL，防止重渲染時記憶體累積
  _galRevokeBlobUrls();
  container.querySelectorAll('.gallery-scroll, .gallery-fab, .gallery-search-head').forEach(e => e.remove());

  // ── panelHead trash button（建立一次，保留跨渲染）──
  const panelHead = container.closest?.('.mobile-panel')?.querySelector('.mobile-panel-head')
                 || container.parentElement?.querySelector?.('.mobile-panel-head')
                 || container.closest?.('.widget')?.querySelector('.w-head');
  let trashBtn = panelHead?.querySelector('.gallery-trash-btn');
  if (panelHead && !trashBtn) {
    trashBtn = document.createElement('button');
    trashBtn.className = 'yt-icon-btn gallery-trash-btn';
    trashBtn.title = '刪除選取';
    trashBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/></svg>`;
    const refBtn = panelHead.querySelector('.mobile-panel-expand-btn') || panelHead.querySelector('.w-pencil-btn');
    if (refBtn) panelHead.insertBefore(trashBtn, refBtn);
    else panelHead.appendChild(trashBtn);
    trashBtn.addEventListener('click', async () => {
      if (!_galSelected.size) return;
      const ids = [..._galSelected];
      const toDelete = (S.gallery || []).filter(g => ids.includes(g.id));
      S.gallery = (S.gallery || []).filter(g => !ids.includes(g.id));
      // 墓碑：記錄刪除 ID，防止 cloudGalleryPull 重新加回
      if (!S.galleryDeletedIds) S.galleryDeletedIds = [];
      ids.forEach(id => { if (!S.galleryDeletedIds.includes(id)) S.galleryDeletedIds.push(id); });
      _galSelected.clear();
      _galMultiActive = false;
      lsSave();
      await Promise.all(toDelete.flatMap(g => [
        g.imageId ? idbDel(g.imageId).catch(() => {}) : Promise.resolve(),
        g.thumbId ? idbDel(g.thumbId).catch(() => {}) : Promise.resolve(),
      ]));
      toDelete.forEach(g => cloudDeleteItem(g.id, g.r2Key));
      cloudGalleryPush();
      renderGalleryWidget(container);
    });
  }
  if (trashBtn) trashBtn.style.display = _galMultiActive ? '' : 'none';

  const scroll = el('div', 'gallery-scroll');
  scroll.style.cssText = 'flex:1;min-height:0;overflow-y:auto;padding:8px;-webkit-overflow-scrolling:touch;';

  const items = S.gallery || [];

  // ── 搜索欄 + 標籤篩選（固定在頂部，不隨卡片捲動）──
  const galHead = el('div', 'gallery-search-head');
  galHead.style.cssText = 'flex-shrink:0;padding:6px 8px 0;';

  if (!items.length) {
    const empty = el('div');
    empty.style.cssText = 'text-align:center;padding:60px 16px;color:rgba(255,255,255,0.3);font-size:14px;';
    empty.textContent = '點擊 ＋ 新增視覺書籤';
    scroll.appendChild(empty);
  } else {
    // ── 搜索欄 ──
    const searchWrap = el('div');
    searchWrap.style.cssText = 'display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.06);border-radius:10px;padding:7px 10px;margin-bottom:6px;';
    searchWrap.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2.2" width="14" height="14" style="flex-shrink:0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
    const searchInput = el('input');
    searchInput.type = 'text';
    searchInput.placeholder = '搜索標題、描述或標籤…';
    searchInput.value = _galSearchQuery;
    searchInput.style.cssText = 'flex:1;background:none;border:none;outline:none;color:#fff;font-size:13px;min-width:0;';
    searchWrap.appendChild(searchInput);
    if (_galSearchQuery) {
      const clrBtn = el('button');
      clrBtn.style.cssText = 'background:none;border:none;color:rgba(255,255,255,0.4);cursor:pointer;padding:0;font-size:16px;line-height:1;flex-shrink:0;';
      clrBtn.textContent = '×';
      clrBtn.addEventListener('click', () => { _galSearchQuery = ''; searchInput.value = ''; _galApplyFilter(container); clrBtn.remove(); });
      searchWrap.appendChild(clrBtn);
    }
    searchInput.addEventListener('input', () => { _galSearchQuery = searchInput.value; _galApplyFilter(container); });
    galHead.appendChild(searchWrap);

    // ── 標籤篩選列 ──
    const allTags = [...new Set(items.flatMap(it => it.tags || []))].filter(Boolean);
    if (allTags.length) {
      const tagBar = el('div');
      tagBar.className = 'gal-tag-bar';
      tagBar.style.cssText = 'display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;scrollbar-width:none;-ms-overflow-style:none;';
      allTags.forEach(tag => {
        const btn = el('button');
        btn.className = 'gal-tag-btn';
        btn.dataset.galtag = tag;
        btn.textContent = tag;
        const isA = _galActiveTag === tag;
        btn.style.cssText = `flex-shrink:0;padding:4px 10px;border-radius:99px;border:1px solid ${isA ? '#5865f2' : 'rgba(255,255,255,0.2)'};background:${isA ? '#5865f2' : 'transparent'};color:${isA ? '#fff' : 'rgba(255,255,255,0.65)'};font-size:11px;cursor:pointer;white-space:nowrap;-webkit-tap-highlight-color:transparent;outline:none;`;
        btn.addEventListener('click', () => {
          _galActiveTag = (_galActiveTag === tag) ? '' : tag;
          container.querySelectorAll('.gal-tag-btn').forEach(b => {
            const a = b.dataset.galtag === _galActiveTag;
            b.style.background  = a ? '#5865f2' : 'transparent';
            b.style.borderColor = a ? '#5865f2' : 'rgba(255,255,255,0.2)';
            b.style.color       = a ? '#fff'    : 'rgba(255,255,255,0.65)';
          });
          _galApplyFilter(container);
        });
        tagBar.appendChild(btn);
      });
      galHead.appendChild(tagBar);
    }

    // ── 動態欄數瀑布流（最少 2 欄，依容器寬度自動增加）──
    const colWrap = el('div');
    colWrap.style.cssText = 'display:flex;gap:8px;align-items:flex-start;';
    const colCount = Math.max(2, Math.floor((container.offsetWidth || 300) / 160));
    const cols = Array.from({ length: colCount }, (_, i) => {
      const c = el('div');
      c.className = 'gal-col';
      c.dataset.colidx = i;
      c.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;';
      colWrap.appendChild(c);
      return c;
    });
    // 哨兵節點：滑到底部時觸發下一頁載入
    const sentinel = el('div', 'gal-load-sentinel');
    sentinel.style.cssText = 'height:1px;flex-shrink:0;';
    scroll.appendChild(colWrap);
    scroll.appendChild(sentinel);

    // 初始化分頁狀態
    _galAllItems = [...items].reverse();
    _galRenderedCount = 0;
    if (_galIObs) { _galIObs.disconnect(); _galIObs = null; }

    // ★ 必須先把 scroll 掛進 container，_galRenderNextPage 才能 querySelector 到 .gal-col
    container.appendChild(galHead);
    container.appendChild(scroll);

    // 套用現有篩選條件（重開後保留搜索/標籤狀態）
    if (_galSearchQuery || _galActiveTag) {
      _galApplyFilter(container);
    } else {
      _galFilteredItems = null;
      _galSetupIObs(container, sentinel);
      _galRenderNextPage(container);
    }

    // FAB 必須在有書籤時也補回來（多選模式除外）
    // ★ 原本放在函數末尾，但 else 分支會提前 return 而跑不到，導致每次
    //   重新渲染後 FAB 消失，container 傳不進 openGalleryAddDialog → 新卡片不刷新
    if (!_galMultiActive) {
      const fab = el('button', 'gallery-fab');
      fab.textContent = '+';
      fab.style.cssText = 'position:absolute;right:14px;bottom:14px;width:46px;height:46px;border-radius:50%;background:var(--accent,#7c6af5);color:#fff;font-size:24px;line-height:1;border:none;cursor:pointer;z-index:10;box-shadow:0 4px 14px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;';
      fab.addEventListener('click', () => openGalleryAddDialog(container));
      container.appendChild(fab);
    }
    return; // 已提前 appendChild，跳過函數末尾的重複插入
  }

  container.appendChild(galHead);
  container.appendChild(scroll);

  // FAB（items 為空時的初始狀態，多選模式下隱藏）
  if (!_galMultiActive) {
    const fab = el('button', 'gallery-fab');
    fab.textContent = '+';
    fab.style.cssText = 'position:absolute;right:14px;bottom:14px;width:46px;height:46px;border-radius:50%;background:var(--accent,#7c6af5);color:#fff;font-size:24px;line-height:1;border:none;cursor:pointer;z-index:10;box-shadow:0 4px 14px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;';
    fab.addEventListener('click', () => openGalleryAddDialog(container));
    container.appendChild(fab);
  }
}

/* ── 分頁：建立單張卡片 DOM ── */
function _buildGalleryCard(item, container) {
  const card = el('div', 'gallery-card');
  card.dataset.galid    = item.id;
  card.dataset.galtitle = item.title || '';
  card.dataset.galdesc  = item.description || '';
  card.dataset.galtags  = (item.tags || []).join(',');
  const isSel = _galSelected.has(item.id);
  card.style.cssText = 'border-radius:10px;overflow:hidden;cursor:pointer;background:rgba(255,255,255,0.04);box-shadow:0 0 0 1px rgba(255,255,255,0.08);';
  if (isSel) card.classList.add('gallery-selected');
  if (_galMultiActive) _galAddSelDot(card, isSel);

  // 非同步載入圖片（優先縮圖 thumbId，退而 imageId，再退 mediaUrl）
  (async () => {
    let url = item.mediaUrl || null, needRevoke = false;
    if (!url) {
      if (item.thumbId) {
        const blob = await idbGet(item.thumbId).catch(() => null);
        if (blob) { url = URL.createObjectURL(blob); needRevoke = true; }
      }
      if (!url && item.imageId) {
        const blob = await idbGet(item.imageId).catch(() => null);
        if (blob) { url = URL.createObjectURL(blob); needRevoke = true; }
      }
      // 追蹤 blob URL，供頁面切換時統一 revoke
      if (needRevoke) _galActiveBlobUrls.push(url);
    }
    if (!url) {
      const ph = el('div');
      ph.style.cssText = 'width:100%;height:80px;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.2);font-size:22px;';
      ph.textContent = item.type === 'video' ? '🎬' : '🔗';
      card.insertBefore(ph, card.firstChild);
      return;
    }
    const _trackRevoke = () => {
      _galActiveBlobUrls = _galActiveBlobUrls.filter(u => u !== url);
      URL.revokeObjectURL(url);
    };
    if (item.type === 'video') {
      const vid = el('video');
      vid.style.cssText = 'width:100%;display:block;';
      vid.muted = true; vid.loop = true; vid.playsInline = true; vid.autoplay = true;
      vid.src = url;
      if (needRevoke) vid.oncanplay = _trackRevoke;
      card.insertBefore(vid, card.firstChild);
    } else {
      const img = el('img');
      img.style.cssText = 'width:100%;display:block;';
      img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      img.src = url;
      if (needRevoke) img.onload = _trackRevoke;
      img.onerror = () => {
        // blob URL 失敗：直接釋放並顯示佔位（imgproxy 無法代理 blob URL）
        if (needRevoke) { _trackRevoke(); needRevoke = false; }
        if (S.cfg.cloudToken && !img.dataset.proxied && !url.startsWith('blob:')) {
          img.dataset.proxied = '1';
          img.src = `${CLOUD_API}/imgproxy?url=${encodeURIComponent(url)}`;
        } else {
          const ph = el('div');
          ph.style.cssText = 'width:100%;height:80px;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.2);font-size:22px;';
          ph.textContent = '🖼️';
          img.replaceWith(ph);
        }
      };
      card.insertBefore(img, card.firstChild);
    }
  })();

  // 標籤 chips（卡片底部）
  if (item.tags?.length) {
    const chipRow = el('div');
    chipRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;padding:5px 6px 6px;';
    item.tags.forEach(tag => {
      const chip = el('span');
      const isA = _galActiveTag === tag;
      chip.style.cssText = `display:inline-block;font-size:10px;padding:2px 7px;border-radius:99px;cursor:pointer;${isA ? 'background:#5865f2;color:#fff;' : 'background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.65);'}`;
      chip.textContent = tag;
      chip.addEventListener('click', e => {
        e.stopPropagation();
        _galActiveTag = (_galActiveTag === tag) ? '' : tag;
        container.querySelectorAll('.gal-tag-btn').forEach(b => {
          const a = b.dataset.galtag === _galActiveTag;
          b.style.background  = a ? '#5865f2' : 'transparent';
          b.style.borderColor = a ? '#5865f2' : 'rgba(255,255,255,0.2)';
          b.style.color       = a ? '#fff'    : 'rgba(255,255,255,0.65)';
        });
        _galApplyFilter(container);
      });
      chipRow.appendChild(chip);
    });
    card.appendChild(chipRow);
  }

  // 長按進入多選（震動與 UI 同步，不 re-render）
  let lpTimer = null, lpFired = false, startX = 0, startY = 0;
  card.addEventListener('touchstart', e => {
    lpFired = false;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    if (!_galMultiActive) {
      lpTimer = setTimeout(() => {
        lpFired = true;
        navigator.vibrate?.(50);
        _galEnterMultiSelect(container, item.id);
      }, 500);
    }
  }, { passive: true });
  card.addEventListener('touchmove', e => {
    if (Math.hypot(e.touches[0].clientX - startX, e.touches[0].clientY - startY) > 10)
      clearTimeout(lpTimer);
  }, { passive: true });
  card.addEventListener('touchend', () => clearTimeout(lpTimer), { passive: true });

  // 桌機長按（mousedown 持續 500ms 觸發多選）
  card.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    lpFired = false;
    startX = e.clientX; startY = e.clientY;
    if (!_galMultiActive) {
      lpTimer = setTimeout(() => {
        lpFired = true;
        _galEnterMultiSelect(container, item.id);
      }, 500);
    }
  });
  card.addEventListener('mousemove', e => {
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > 10) clearTimeout(lpTimer);
  });
  card.addEventListener('mouseup', () => clearTimeout(lpTimer));
  card.addEventListener('mouseleave', () => clearTimeout(lpTimer));

  card.addEventListener('click', () => {
    if (lpFired) return;
    if (_galMultiActive) {
      _galToggleCardSelect(card, item.id, container);
    } else {
      openGalleryDetail(item, container);
    }
  });
  card.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); });

  return card;
}

/* ── 分頁：設定 IntersectionObserver ── */
function _galSetupIObs(container, sentinel) {
  if (_galIObs) _galIObs.disconnect();
  _galIObs = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) _galRenderNextPage(container);
  }, { rootMargin: '300px' });
  _galIObs.observe(sentinel);
}

/* ── 分頁：渲染下一批卡片 ── */
function _galRenderNextPage(container) {
  const pool  = _galFilteredItems !== null ? _galFilteredItems : _galAllItems;
  const start = _galRenderedCount;
  const end   = Math.min(start + GAL_PAGE_SIZE, pool.length);
  if (start >= pool.length) return;

  const cols = container.querySelectorAll('.gal-col');
  if (!cols.length) return;

  for (let i = start; i < end; i++) {
    const card = _buildGalleryCard(pool[i], container);
    cols[i % cols.length].appendChild(card);
  }
  _galRenderedCount = end;

  // 全部渲染完畢，移除哨兵
  if (_galRenderedCount >= pool.length) {
    if (_galIObs) { _galIObs.disconnect(); _galIObs = null; }
    container.querySelector('.gal-load-sentinel')?.remove();
  }
}

/* ── 多選輔助：圓點 ── */
function _galAddSelDot(card, selected) {
  card.querySelector('.gal-sel-dot')?.remove();
  const dot = document.createElement('div');
  dot.className = 'gal-sel-dot';
  dot.style.cssText = `position:absolute;top:6px;right:6px;width:20px;height:20px;border-radius:50%;box-sizing:border-box;pointer-events:none;z-index:2;display:flex;align-items:center;justify-content:center;${selected ? 'background:#5865f2;border:2px solid #fff;' : 'background:rgba(0,0,0,0.35);border:2px solid rgba(255,255,255,0.5);'}`;
  if (selected) dot.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" width="11" height="11"><polyline points="20 6 9 17 4 12"/></svg>`;
  card.appendChild(dot);
}

/* ── 多選輔助：進入多選（就地 DOM，不重新渲染） ── */
function _galEnterMultiSelect(container, firstItemId) {
  _galMultiActive = true;
  _galSelected.add(firstItemId);
  // 為所有卡片加上圓點
  container.querySelectorAll('.gallery-card').forEach(card => {
    _galAddSelDot(card, _galSelected.has(card.dataset.galid));
    if (_galSelected.has(card.dataset.galid)) card.classList.add('gallery-selected');
  });
  // 隱藏 FAB
  container.querySelector('.gallery-fab')?.remove();
  // 顯示垃圾桶
  const panelHead = container.closest?.('.mobile-panel')?.querySelector('.mobile-panel-head')
                 || container.parentElement?.querySelector?.('.mobile-panel-head')
                 || container.closest?.('.widget')?.querySelector('.w-head');
  const tb = panelHead?.querySelector('.gallery-trash-btn');
  if (tb) tb.style.display = '';
}

/* ── 多選輔助：退出多選（就地 DOM，不重新渲染） ── */
function _galExitMultiSelect(container) {
  _galMultiActive = false;
  _galSelected.clear();
  container.querySelectorAll('.gal-sel-dot').forEach(d => d.remove());
  container.querySelectorAll('.gallery-card').forEach(c => c.classList.remove('gallery-selected'));
  // 恢復 FAB
  if (!container.querySelector('.gallery-fab')) {
    const fab = el('button', 'gallery-fab');
    fab.textContent = '+';
    fab.style.cssText = 'position:absolute;right:14px;bottom:14px;width:46px;height:46px;border-radius:50%;background:var(--accent,#7c6af5);color:#fff;font-size:24px;line-height:1;border:none;cursor:pointer;z-index:10;box-shadow:0 4px 14px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;';
    fab.addEventListener('click', () => openGalleryAddDialog(container));
    container.appendChild(fab);
  }
  // 隱藏垃圾桶
  const panelHead = container.closest?.('.mobile-panel')?.querySelector('.mobile-panel-head')
                 || container.parentElement?.querySelector?.('.mobile-panel-head')
                 || container.closest?.('.widget')?.querySelector('.w-head');
  const tb = panelHead?.querySelector('.gallery-trash-btn');
  if (tb) tb.style.display = 'none';
}

/* ── 多選輔助：切換單張卡片選取（就地 DOM，不重新渲染） ── */
function _galToggleCardSelect(card, itemId, container) {
  if (_galSelected.has(itemId)) {
    _galSelected.delete(itemId);
    card.classList.remove('gallery-selected');
    if (_galSelected.size === 0) {
      _galExitMultiSelect(container);
    } else {
      _galAddSelDot(card, false);
    }
  } else {
    _galSelected.add(itemId);
    card.classList.add('gallery-selected');
    _galAddSelDot(card, true);
  }
  // 同步垃圾桶可見性
  const panelHead = container.closest?.('.mobile-panel')?.querySelector('.mobile-panel-head')
                 || container.parentElement?.querySelector?.('.mobile-panel-head')
                 || container.closest?.('.widget')?.querySelector('.w-head');
  const tb = panelHead?.querySelector('.gallery-trash-btn');
  if (tb) tb.style.display = _galMultiActive ? '' : 'none';
}

/* ── 搜索 / 標籤篩選（記憶體篩選 + 重新分頁渲染） ── */
function _galApplyFilter(container) {
  const q   = _galSearchQuery.toLowerCase();
  const tag = _galActiveTag;

  // 在記憶體中篩選完整列表
  _galFilteredItems = _galAllItems.filter(item => {
    const title = (item.title || '').toLowerCase();
    const desc  = (item.description || '').toLowerCase();
    const tags  = (item.tags || []).join(',').toLowerCase();
    const matchQ   = !q   || title.includes(q) || desc.includes(q) || tags.includes(q);
    const matchTag = !tag || (item.tags || []).includes(tag);
    return matchQ && matchTag;
  });

  // 清空已渲染的卡片前先釋放 blob URL
  _galRevokeBlobUrls();
  container.querySelectorAll('.gal-col').forEach(col => {
    [...col.querySelectorAll('.gallery-card')].forEach(c => c.remove());
  });
  _galRenderedCount = 0;
  container.querySelector('.gal-no-results')?.remove();

  const scroll = container.querySelector('.gallery-scroll');

  // 無結果提示
  if (!_galFilteredItems.length) {
    if (scroll) {
      const noRes = el('div', 'gal-no-results');
      noRes.style.cssText = 'text-align:center;padding:40px 16px;color:rgba(255,255,255,0.3);font-size:13px;';
      noRes.textContent = '找不到符合條件的書籤';
      scroll.appendChild(noRes);
    }
    return;
  }

  // 確保哨兵存在
  let sentinel = container.querySelector('.gal-load-sentinel');
  if (!sentinel && scroll) {
    sentinel = el('div', 'gal-load-sentinel');
    sentinel.style.cssText = 'height:1px;flex-shrink:0;';
    scroll.appendChild(sentinel);
  }

  _galSetupIObs(container, sentinel);
  _galRenderNextPage(container);
}

/* ── Web Share Target：啟動時讀取 SW 存入的分享資料 ── */
async function checkShareTarget() {
  const pending = await idbGet('_share_pending').catch(() => null);
  if (!pending) return;
  await idbDel('_share_pending').catch(() => {});
  // 清理 URL（?share=1 只是觸發器，清掉避免重整再觸發）
  if (location.search.includes('share')) history.replaceState(null, '', location.pathname);
  // 若有視覺書籤頁，切換過去
  const galIdx = (S.mobilePages || []).findIndex(p => p.widget === 'gallery');
  if (galIdx >= 0 && galIdx !== S.mobilePageIdx) {
    S.mobilePageIdx = galIdx;
    if (typeof renderPages === 'function') renderPages();
  }
  // 稍等一個 tick 讓 DOM 穩定，再開對話框
  setTimeout(() => {
    const container = document.querySelector('.gallery-fab')?.parentElement || null;
    openGalleryAddDialog(container, pending);
  }, 80);
}

/* ── 標籤編輯器（新增 / 編輯對話框共用） ── */
function buildGalleryTagEditor(box, initialTags) {
  // 從所有書籤收集全域標籤；initialTags 中有但全域沒有的也加入
  const globalTags = [...new Set((S.gallery || []).flatMap(it => it.tags || []))].filter(Boolean);
  (initialTags || []).forEach(t => { if (t && !globalTags.includes(t)) globalTags.push(t); });
  const selected = new Set(initialTags || []);

  const wrap = el('div');
  wrap.style.cssText = 'margin-bottom:16px;';

  const lbl = el('div');
  lbl.style.cssText = 'font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:8px;';
  lbl.textContent = '標籤（選填）';
  wrap.appendChild(lbl);

  const pillsArea = el('div');
  pillsArea.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;';
  wrap.appendChild(pillsArea);

  function renderPills() {
    pillsArea.innerHTML = '';
    globalTags.forEach(tag => {
      const pill = el('button');
      pill.type = 'button';
      const on = selected.has(tag);
      pill.style.cssText = `display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:99px;font-size:12px;cursor:pointer;border:1px solid ${on ? '#5865f2' : 'rgba(255,255,255,0.2)'};background:${on ? '#5865f2' : 'rgba(255,255,255,0.05)'};color:${on ? '#fff' : 'rgba(255,255,255,0.65)'};-webkit-tap-highlight-color:transparent;outline:none;transition:background .12s,border-color .12s;`;
      const label = document.createTextNode(tag);
      pill.appendChild(label);
      // 單擊：切換選取／取消選取
      pill.addEventListener('click', () => {
        if (selected.has(tag)) selected.delete(tag); else selected.add(tag);
        renderPills();
      });
      // 長按：重新命名標籤（並同步更新所有書籤）
      let _pt = null;
      pill.addEventListener('touchstart', () => {
        _pt = setTimeout(() => {
          _pt = null;
          const newName = prompt(`重新命名標籤「${tag}」`, tag);
          if (!newName || !newName.trim() || newName.trim() === tag) return;
          const t = newName.trim();
          const gi = globalTags.indexOf(tag);
          if (gi >= 0) globalTags[gi] = t;
          if (selected.has(tag)) { selected.delete(tag); selected.add(t); }
          (S.gallery || []).forEach(it => {
            if (!it.tags) return;
            const ti = it.tags.indexOf(tag);
            if (ti >= 0) it.tags[ti] = t;
          });
          lsSave(); cloudGalleryPush(); renderPills();
        }, 600);
      }, { passive: true });
      pill.addEventListener('touchend',  () => { if (_pt) { clearTimeout(_pt); _pt = null; } }, { passive: true });
      pill.addEventListener('touchmove', () => { if (_pt) { clearTimeout(_pt); _pt = null; } }, { passive: true });
      if (on) {
        const x = el('span');
        x.textContent = ' ×';
        x.style.cssText = 'font-size:13px;opacity:0.75;';
        pill.appendChild(x);
      }
      pillsArea.appendChild(pill);
    });
  }
  renderPills();

  // 新標籤輸入列
  const inpWrap = el('div');
  inpWrap.style.cssText = 'display:flex;gap:8px;';
  const inp = el('input');
  inp.type = 'text';
  inp.placeholder = '輸入新標籤，按 Enter 或 + 新增';
  inp.style.cssText = 'flex:1;padding:8px 12px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:#fff;font-size:13px;outline:none;';

  function commitInput() {
    inp.value.split(',').map(v => v.trim()).filter(Boolean).forEach(t => {
      if (!globalTags.includes(t)) globalTags.push(t);
      selected.add(t);
    });
    inp.value = '';
    renderPills();
  }
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commitInput(); } });

  const addBtn = el('button');
  addBtn.type = 'button';
  addBtn.textContent = '+';
  addBtn.style.cssText = 'width:36px;height:36px;border-radius:8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);color:#fff;font-size:18px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;outline:none;';
  addBtn.addEventListener('click', () => { if (inp.value.trim()) commitInput(); });

  inpWrap.appendChild(inp);
  inpWrap.appendChild(addBtn);
  wrap.appendChild(inpWrap);
  box.appendChild(wrap);

  return { getSelected: () => [...selected] };
}

/* ── 簡易裁切對話框 ── */
function showCropDialog(file) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:#08081a;z-index:99999;display:flex;flex-direction:column;touch-action:none;-webkit-user-select:none;user-select:none;';
    const topBar = document.createElement('div');
    topBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 16px;flex-shrink:0;';
    topBar.innerHTML = `
      <button id="_cc" style="background:rgba(255,255,255,0.1);border:none;color:#fff;font-size:13px;cursor:pointer;padding:7px 14px;border-radius:8px;">取消</button>
      <span style="color:#fff;font-weight:600;font-size:15px;">裁切圖片</span>
      <button id="_co" style="background:#5865f2;border:none;color:#fff;font-size:13px;font-weight:600;cursor:pointer;padding:7px 16px;border-radius:8px;">完成裁切</button>`;
    const stEl = document.createElement('div');
    stEl.style.cssText = 'flex:1;position:relative;overflow:hidden;';
    const cv = document.createElement('canvas');
    cv.style.cssText = 'display:block;width:100%;height:100%;';
    stEl.appendChild(cv);
    ov.appendChild(topBar); ov.appendChild(stEl);
    document.body.appendChild(ov);

    const img = new Image();
    const ou = URL.createObjectURL(file);
    img.src = ou;
    img.onload = () => {
      const W = stEl.offsetWidth, H = stEl.offsetHeight;
      cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      const sc = Math.min(W / img.naturalWidth, H / img.naturalHeight, 1);
      const iw = img.naturalWidth * sc, ih = img.naturalHeight * sc;
      const ix = (W - iw) / 2, iy = (H - ih) / 2;
      let cx = ix, cy = iy, cw = iw, ch = ih;
      const HR = 20, MIN = 40, HS = 24;

      function draw() {
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(img, ix, iy, iw, ih);
        ctx.fillStyle = 'rgba(0,0,0,0.58)';
        ctx.fillRect(0, 0, W, cy);
        ctx.fillRect(0, cy + ch, W, H - cy - ch);
        ctx.fillRect(0, cy, cx, ch);
        ctx.fillRect(cx + cw, cy, W - cx - cw, ch);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
        ctx.strokeRect(cx, cy, cw, ch);
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 0.6;
        for (let i = 1; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(cx + cw*i/3, cy); ctx.lineTo(cx + cw*i/3, cy+ch);
          ctx.moveTo(cx, cy + ch*i/3); ctx.lineTo(cx+cw, cy+ch*i/3);
          ctx.stroke();
        }
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
        [[cx,cy,1,1],[cx+cw,cy,-1,1],[cx,cy+ch,1,-1],[cx+cw,cy+ch,-1,-1]].forEach(([x,y,dx,dy]) => {
          ctx.beginPath(); ctx.moveTo(x+dx*HS,y); ctx.lineTo(x,y); ctx.lineTo(x,y+dy*HS); ctx.stroke();
        });
      }
      draw();

      let drag=-1, sx,sy,scx,scy,scw,sch;
      function hit(px,py) {
        const cs=[[cx,cy],[cx+cw,cy],[cx,cy+ch],[cx+cw,cy+ch]];
        for(let i=0;i<4;i++) if(Math.abs(px-cs[i][0])<HR+6&&Math.abs(py-cs[i][1])<HR+6) return i;
        if(px>=cx&&px<=cx+cw&&py>=cy&&py<=cy+ch) return 4; return -1;
      }
      function gpos(e){ const r=cv.getBoundingClientRect(),t=e.touches?.[0]??e; return [(t.clientX-r.left)*(W/r.width),(t.clientY-r.top)*(H/r.height)]; }
      function clamp(){
        if(cw<MIN)cw=MIN; if(ch<MIN)ch=MIN;
        if(cx<ix){cw-=ix-cx;cx=ix;} if(cy<iy){ch-=iy-cy;cy=iy;}
        if(cx+cw>ix+iw)cw=ix+iw-cx; if(cy+ch>iy+ih)ch=iy+ih-cy;
      }
      function onStart(e){e.preventDefault();[sx,sy]=gpos(e);drag=hit(sx,sy);scx=cx;scy=cy;scw=cw;sch=ch;}
      function onMove(e){
        if(drag<0)return; e.preventDefault();
        const[px,py]=gpos(e),ddx=px-sx,ddy=py-sy;
        if(drag===0){cx=scx+ddx;cy=scy+ddy;cw=scw-ddx;ch=sch-ddy;}
        else if(drag===1){cy=scy+ddy;cw=scw+ddx;ch=sch-ddy;}
        else if(drag===2){cx=scx+ddx;cw=scw-ddx;ch=sch+ddy;}
        else if(drag===3){cw=scw+ddx;ch=sch+ddy;}
        else if(drag===4){cx=scx+ddx;cy=scy+ddy;}
        clamp(); draw();
      }
      function onEnd(){drag=-1;}
      cv.addEventListener('mousedown',onStart);
      window.addEventListener('mousemove',onMove);
      window.addEventListener('mouseup',onEnd);
      cv.addEventListener('touchstart',onStart,{passive:false});
      window.addEventListener('touchmove',onMove,{passive:false});
      window.addEventListener('touchend',onEnd,{passive:true});

      function cleanup(){
        window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onEnd);
        window.removeEventListener('touchmove',onMove); window.removeEventListener('touchend',onEnd);
        URL.revokeObjectURL(ou); ov.remove();
      }
      topBar.querySelector('#_cc').addEventListener('click',()=>{
        cv.width=0; cv.height=0; // 釋放畫布像素緩衝區
        cleanup(); resolve(null);
      });
      topBar.querySelector('#_co').addEventListener('click',()=>{
        const oc=document.createElement('canvas');
        const sw2=(cx-ix)/sc, sh2=(cy-iy)/sc, ssw=cw/sc, ssh=ch/sc;
        const maxW=1200; oc.width=Math.min(ssw,maxW); oc.height=ssh*(oc.width/ssw);
        oc.getContext('2d').drawImage(img,sw2,sh2,ssw,ssh,0,0,oc.width,oc.height);
        oc.toBlob(b=>{
          cv.width=0; cv.height=0; // 釋放主畫布像素緩衝區
          oc.width=0; oc.height=0; // 釋放輸出畫布像素緩衝區
          cleanup(); resolve(b);
        },'image/jpeg',0.88);
      });
    };
    img.onerror=()=>{URL.revokeObjectURL(ou);ov.remove();resolve(null);};
  });
}

function openGalleryAddDialog(container, prefill = null) {
  const overlay = el('div', 'gallery-overlay');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:9900;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;';

  const box = el('div');
  box.style.cssText = 'background:var(--bg-card,#1a1a2e);border-radius:16px;padding:20px;width:100%;max-width:380px;box-sizing:border-box;max-height:85vh;overflow-y:auto;';
  box.innerHTML = `
    <div style="font-size:15px;font-weight:600;color:#fff;margin-bottom:14px;">${prefill ? '儲存分享內容' : '新增視覺書籤'}</div>
    <div id="_gal-preview" style="width:100%;min-height:90px;border:1.5px dashed rgba(255,255,255,0.25);border-radius:10px;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.35);font-size:13px;margin-bottom:12px;cursor:pointer;overflow:hidden;">點擊選擇圖片或影片</div>
    <input type="file" accept="image/*,video/*" id="_gal-file" style="display:none">
    <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:4px;">標題（選填）</div>
    <input type="text" id="_gal-title" placeholder="輸入標題…" style="width:100%;box-sizing:border-box;padding:10px 12px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:#fff;font-size:14px;outline:none;margin-bottom:12px;">
    <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:4px;">描述（選填）</div>
    <textarea id="_gal-desc" placeholder="輸入描述…" rows="2" style="width:100%;box-sizing:border-box;padding:10px 12px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:#fff;font-size:14px;outline:none;resize:vertical;margin-bottom:12px;"></textarea>
    <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:4px;">點擊連結（選填）</div>
    <input type="text" inputmode="url" id="_gal-url" placeholder="https://..." style="width:100%;box-sizing:border-box;padding:10px 12px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:#fff;font-size:14px;outline:none;margin-bottom:16px;">`;

  // 標籤編輯器
  const tagEditor = buildGalleryTagEditor(box, []);

  // 按鈕列
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:10px;';
  btnRow.innerHTML = `
    <button id="_gal-cancel" style="flex:1;padding:11px;border-radius:8px;background:rgba(255,255,255,0.08);color:#fff;border:none;font-size:14px;cursor:pointer;">取消</button>
    <button id="_gal-save" style="flex:1;padding:11px;border-radius:8px;background:var(--accent,#7c6af5);color:#fff;border:none;font-size:14px;font-weight:600;cursor:pointer;">儲存</button>`;
  box.appendChild(btnRow);

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  let blob = null, _ogMeta = null;
  const preview = box.querySelector('#_gal-preview');
  const fileInp = box.querySelector('#_gal-file');

  // 若是從分享進來，預先填入資料
  if (prefill) {
    // 部分 app（如 YouTube）把連結夾在 text 裡，嘗試從 text 取出 URL
    let fillTitle = prefill.title || '';
    let fillDesc  = '';
    let fillUrl   = prefill.url   || '';
    // 從 text 欄取出 URL（YouTube 等 app 把連結夾在 text 裡）
    if (!fillUrl) {
      const urlMatch = (prefill.text || '').match(/https?:\/\/\S+/);
      if (urlMatch) fillUrl = urlMatch[0];
    }
    // 取 text 欄非 URL 部分（蝦皮等 app 把商品名稱放在 text 裡）
    const textSnippet = (prefill.text || '').replace(/https?:\/\/\S+/g, '').trim();
    if (textSnippet) {
      if (!fillTitle) fillTitle = textSnippet.slice(0, 100);
      else            fillDesc  = textSnippet.slice(0, 150);
    }
    if (fillTitle) box.querySelector('#_gal-title').value = fillTitle;
    if (fillDesc)  box.querySelector('#_gal-desc').value  = fillDesc;
    if (fillUrl)   box.querySelector('#_gal-url').value   = fillUrl;

    if (prefill.blob) {
      blob = prefill.blob;
      const u = URL.createObjectURL(blob);
      if (prefill.fileType?.startsWith('video/')) {
        preview.innerHTML = `<video src="${u}" style="width:100%;display:block;" muted playsinline></video>`;
        const v = preview.querySelector('video');
        v.oncanplay = () => URL.revokeObjectURL(u);
      } else {
        preview.innerHTML = `<img src="${u}" style="width:100%;display:block;" onload="URL.revokeObjectURL(this.src)">`;
      }
    } else if (fillUrl) {
      // 統一走 autoFetchOg（在 prefill 填完後呼叫）
      setTimeout(() => autoFetchOg(fillUrl), 0);
    } else {
      preview.textContent = '（無附件）點擊可選擇圖片或影片';
    }
  }

  preview.addEventListener('click', () => fileInp.click());
  fileInp.addEventListener('change', async () => {
    const f = fileInp.files[0];
    if (!f) return;
    if (f.type.startsWith('image/')) {
      const cropped = await showCropDialog(f);
      fileInp.value = '';
      if (!cropped) return;
      blob = cropped;
      const u = URL.createObjectURL(cropped);
      preview.innerHTML = `<img src="${u}" style="width:100%;display:block;" onload="URL.revokeObjectURL(this.src)">`;
    } else {
      blob = f;
      const u = URL.createObjectURL(f);
      preview.innerHTML = `<video src="${u}" style="width:100%;display:block;" muted playsinline></video>`;
      preview.querySelector('video').oncanplay = () => URL.revokeObjectURL(u);
    }
  });

  // URL 欄貼上或輸入完畢 → 自動讀取 OG metadata
  const urlInp = box.querySelector('#_gal-url');

  async function autoFetchOg(inputUrl) {
    const trimmed = inputUrl.trim();
    if (!trimmed || blob) return; // 已有附件時不觸發
    if (!/^https?:\/\//i.test(trimmed)) return;

    // YouTube 直接用縮圖，不需打 Worker
    const ytId = extractYouTubeId(trimmed);
    if (ytId) {
      const thumbUrl = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
      _ogMeta = { image: thumbUrl, title: '', description: '' };
      preview.innerHTML = `
        <div style="position:relative;width:100%;">
          <img src="${thumbUrl}" style="width:100%;display:block;border-radius:6px;">
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">
            <svg viewBox="0 0 68 48" width="56" height="40" style="opacity:0.9"><rect rx="10" ry="10" width="68" height="48" fill="#f00"/><polygon points="28,14 28,34 48,24" fill="#fff"/></svg>
          </div>
        </div>`;
      // 抓頻道名填入描述
      const apiKey = S.cfg.ytApiKey?.trim();
      const descEl = box.querySelector('#_gal-desc');
      const fillChannel = name => { if (name && !descEl.value) descEl.value = name; };
      if (apiKey) {
        fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ytId}&key=${apiKey}`)
          .then(r => r.json()).then(d => fillChannel(d.items?.[0]?.snippet?.channelTitle))
          .catch(() => fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(trimmed)}&format=json`).then(r=>r.json()).then(d=>fillChannel(d.author_name)).catch(()=>{}));
      } else {
        fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(trimmed)}&format=json`)
          .then(r => r.json()).then(d => fillChannel(d.author_name)).catch(() => {});
      }
      return;
    }

    // 其他網址 → Worker OG
    preview.innerHTML = `<div style="padding:20px;text-align:center;color:rgba(255,255,255,0.3);font-size:13px;">讀取中…</div>`;
    const meta = await fetchLinkMeta(trimmed);
    if (!meta) {
      _showUploadFallback();
      return;
    }
    _ogMeta = meta;
    const titleEl = box.querySelector('#_gal-title');
    const descEl  = box.querySelector('#_gal-desc');
    if (meta.title && !titleEl.value) titleEl.value = meta.title;
    if (meta.description && !descEl.value) descEl.value = meta.description.slice(0, 150);
    if (meta.image) {
      const proxied = `${CLOUD_API}/imgproxy?url=${encodeURIComponent(meta.image)}`;
      const imgEl = document.createElement('img');
      imgEl.src = meta.image;
      imgEl.style.cssText = 'width:100%;display:block;border-radius:6px;';
      imgEl.onerror = () => {
        if (!imgEl.dataset.proxied) {
          imgEl.dataset.proxied = '1';
          imgEl.src = proxied;
        } else {
          _showUploadFallback();
        }
      };
      preview.innerHTML = '';
      preview.appendChild(imgEl);
    } else {
      _showUploadFallback();
    }
  }

  function _showUploadFallback() {
    preview.innerHTML = `
      <div style="padding:20px;text-align:center;">
        <div style="color:rgba(255,255,255,0.35);font-size:12px;margin-bottom:10px;">無法自動取得圖片</div>
        <button type="button" style="padding:8px 18px;border-radius:8px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:#fff;font-size:13px;cursor:pointer;" id="_gal-upload-fallback-btn">📷 上傳截圖</button>
      </div>`;
    preview.querySelector('#_gal-upload-fallback-btn').addEventListener('click', e => { e.stopPropagation(); fileInp.click(); });
  }

  // 解析複合格式：【APP名】URL TOKEN 商品名稱 → 提取 URL 填入欄位，商品名稱填入標題
  function _parseMixedUrl(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return false;
    const urlM = trimmed.match(/https?:\/\/\S+/);
    if (!urlM || trimmed === urlM[0]) return false; // 純 URL 不需處理
    const extractedUrl = urlM[0];
    const afterUrl = trimmed.slice(trimmed.indexOf(extractedUrl) + extractedUrl.length).trim();
    // 去掉行首短代碼（HU108、a3tL 等純英數 ≤12字）
    const productText = afterUrl.replace(/^[A-Za-z0-9]{2,12}\s+/, '').trim();
    urlInp.value = extractedUrl;
    if (productText) {
      const titleEl = box.querySelector('#_gal-title');
      if (!titleEl.value) titleEl.value = productText.slice(0, 100);
    }
    autoFetchOg(extractedUrl);
    return true;
  }

  // paste：先嘗試從 clipboardData 取（桌面端可靠）；Android type=text 貼上後 input 事件接手
  urlInp.addEventListener('paste', e => {
    const pasted = ((e.clipboardData || window.clipboardData).getData('text') || '').trim();
    if (pasted && _parseMixedUrl(pasted)) { e.preventDefault(); return; }
    setTimeout(() => autoFetchOg(urlInp.value || pasted), 60);
  });
  // input：Android 貼上後 value 已更新，這裡作為可靠的主要路徑
  urlInp.addEventListener('input', () => {
    const val = urlInp.value;
    if (!_parseMixedUrl(val)) {
      // 普通 URL 輸入：清掉舊 OG 資料讓 blur 重抓
      if (val && !/^https?:\/\//i.test(val.trim())) return;
    }
  });
  urlInp.addEventListener('blur', () => { if (!blob && !_ogMeta) autoFetchOg(urlInp.value); });

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  btnRow.querySelector('#_gal-cancel').addEventListener('click', () => overlay.remove());
  btnRow.querySelector('#_gal-save').addEventListener('click', async () => {
    // 有 blob、有 prefill、或有填連結，都允許儲存
    const hasUrl = box.querySelector('#_gal-url').value.trim();
    if (!blob && !prefill && !hasUrl) return;
    const saveBtn = btnRow.querySelector('#_gal-save');
    saveBtn.disabled = true; saveBtn.textContent = '處理中…';
    const id = uid();
    const imageId = 'gallery_img_' + id;
    let mediaUrl = null, r2Key = null;
    let finalType = blob ? (blob.type.startsWith('video/') ? 'video' : 'image') : 'link';
    if (blob) {
      const isVideo = blob.type.startsWith('video/');
      try {
        let uploadBlob = blob, uploadType = blob.type;
        if (isVideo) {
          saveBtn.textContent = '處理影片…';
          const result = await processVideoBlob(blob);
          if (!result) {
            toast('影片無法處理，取消儲存', 'err');
            saveBtn.disabled = false; saveBtn.textContent = '儲存';
            return;
          }
          if (result.type === 'image') {
            toast('影片無法剪輯，已改存縮圖', 'warn');
          }
          uploadBlob = result.blob;
          uploadType = result.type === 'video' ? 'video/webm' : 'image/jpeg';
          finalType  = result.type;
        } else {
          saveBtn.textContent = '壓縮圖片…';
          uploadBlob = await compressImage(blob);
          uploadType = 'image/jpeg';
        }
        if (S.cfg.cloudToken) {
          saveBtn.textContent = '上傳中…';
          const up = await cloudUpload(uploadBlob, uploadType);
          mediaUrl = up.url; r2Key = up.r2Key;
        }
        await idbSet(imageId, uploadBlob);
        // 同步生成縮圖（僅圖片類型）
        if (!isVideo) {
          try {
            const thumbBlob = await generateThumb(uploadBlob);
            await idbSet('gallery_thumb_' + id, thumbBlob);
          } catch(_) {}
        }
      } catch(e) {
        await idbSet(imageId, blob);
      }
    }
    // 連結書籤：設定 mediaUrl（不需上傳）
    if (!blob) {
      const linkUrl = box.querySelector('#_gal-url').value.trim();
      const ytId = extractYouTubeId(linkUrl);
      if (ytId) {
        mediaUrl = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
      } else if (_ogMeta?.image) {
        // 用 imgproxy 確保跨來源圖片都能顯示
        mediaUrl = `${CLOUD_API}/imgproxy?url=${encodeURIComponent(_ogMeta.image)}`;
      }
    }

    if (!S.gallery) S.gallery = [];
    S.gallery.push({
      id, imageId: blob ? imageId : null,
      thumbId: (blob && !blob.type.startsWith('video/')) ? ('gallery_thumb_' + id) : null,
      mediaUrl, r2Key,
      type: finalType,
      title: box.querySelector('#_gal-title').value.trim(),
      description: box.querySelector('#_gal-desc').value.trim(),
      url: box.querySelector('#_gal-url').value.trim(),
      tags: tagEditor.getSelected(),
      addedAt: Date.now()
    });
    lsSave();
    cloudGalleryPush();
    overlay.remove();
    // 清理 URL 參數（避免重新整理再次觸發）
    if (location.search.includes('share')) history.replaceState(null, '', location.pathname);
    const c = container || document.querySelector('.gallery-fab')?.parentElement;
    if (c) renderGalleryWidget(c);
  });
}

function showGalleryCardMenu(item, container) {
  const overlay = el('div', 'gallery-overlay');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9900;display:flex;align-items:flex-end;justify-content:center;';

  const sheet = el('div');
  sheet.style.cssText = 'background:var(--bg-card,#1a1a2e);border-radius:16px 16px 0 0;padding:20px;width:100%;max-width:500px;box-sizing:border-box;';
  sheet.innerHTML = `
    <div style="font-size:13px;color:rgba(255,255,255,0.5);margin-bottom:12px;">編輯書籤</div>
    <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:4px;">點擊連結</div>
    <input type="url" id="_gal-edit-url" value="${esc(item.url||'')}" placeholder="https://..." style="width:100%;box-sizing:border-box;padding:10px 12px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:#fff;font-size:14px;outline:none;margin-bottom:14px;">
    <button id="_gal-edit-save" style="width:100%;padding:12px;border-radius:8px;background:var(--accent,#7c6af5);color:#fff;border:none;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:10px;">更新連結</button>
    <button id="_gal-del" style="width:100%;padding:12px;border-radius:8px;background:rgba(200,50,50,0.2);color:#ff7070;border:1px solid rgba(200,50,50,0.35);font-size:14px;cursor:pointer;">刪除此書籤</button>`;

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  sheet.querySelector('#_gal-edit-save').addEventListener('click', () => {
    item.url = sheet.querySelector('#_gal-edit-url').value.trim();
    lsSave();
    overlay.remove();
  });
  sheet.querySelector('#_gal-del').addEventListener('click', async () => {
    S.gallery = (S.gallery || []).filter(g => g.id !== item.id);
    if (!S.galleryDeletedIds) S.galleryDeletedIds = [];
    if (!S.galleryDeletedIds.includes(item.id)) S.galleryDeletedIds.push(item.id);
    if (item.imageId) await idbDel(item.imageId).catch(() => {});
    if (item.thumbId) await idbDel(item.thumbId).catch(() => {});
    cloudDeleteItem(item.id, item.r2Key);
    cloudGalleryPush();
    lsSave();
    overlay.remove();
    renderGalleryWidget(container);
  });
}

function openGalleryDetail(item, container) {
  injectGalleryCSS();
  const overlay = el('div', 'gallery-detail-overlay');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);z-index:9910;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;';

  const card = el('div', 'gallery-detail-card');
  card.style.cssText = 'background:var(--bg-card,#1a1a2e);border-radius:20px;width:100%;max-width:420px;max-height:88vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.6);';

  // 媒體區
  const mediaWrap = el('div');
  mediaWrap.style.cssText = 'width:100%;overflow:hidden;border-radius:20px 20px 0 0;background:#000;';
  (async () => {
    let url = item.mediaUrl || null, needRevoke = false;
    if (!url && item.imageId) {
      const blob = await idbGet(item.imageId).catch(() => null);
      if (blob) { url = URL.createObjectURL(blob); needRevoke = true; }
    }
    if (!url) return;
    if (item.type === 'video') {
      const vid = el('video');
      vid.style.cssText = 'width:100%;display:block;max-height:58vh;object-fit:contain;';
      vid.muted = true; vid.loop = true; vid.playsInline = true; vid.controls = true;
      vid.src = url;
      if (needRevoke) vid.oncanplay = () => URL.revokeObjectURL(url);
      mediaWrap.appendChild(vid);
    } else {
      const img = el('img');
      img.style.cssText = 'width:100%;display:block;max-height:58vh;object-fit:contain;';
      img.src = url;
      if (needRevoke) img.onload = () => URL.revokeObjectURL(url);
      img.onerror = () => {
        if (S.cfg.cloudToken && !img.dataset.proxied) {
          img.dataset.proxied = '1';
          img.src = `${CLOUD_API}/imgproxy?url=${encodeURIComponent(url)}`;
        } else {
          mediaWrap.innerHTML = '<div style="padding:40px;text-align:center;color:rgba(255,255,255,0.25);font-size:32px;">🖼️</div>';
        }
      };
      mediaWrap.appendChild(img);
    }
  })();
  card.appendChild(mediaWrap);

  // 文字 + 按鈕區
  const info = el('div');
  info.style.cssText = 'padding:16px;';
  if (item.title) {
    const t = el('div');
    t.style.cssText = 'font-size:16px;font-weight:600;color:#fff;margin-bottom:6px;';
    t.textContent = item.title;
    info.appendChild(t);
  }
  if (item.description) {
    const d = el('div');
    d.style.cssText = 'font-size:13px;color:rgba(255,255,255,0.6);line-height:1.5;margin-bottom:10px;';
    d.textContent = item.description;
    info.appendChild(d);
  }

  if (item.tags?.length) {
    const tagRow = el('div');
    tagRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px;';
    item.tags.forEach(tag => {
      const chip = el('span');
      chip.style.cssText = 'font-size:11px;padding:3px 9px;border-radius:99px;background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.7);';
      chip.textContent = tag;
      tagRow.appendChild(chip);
    });
    info.appendChild(tagRow);
  }

  // 單排按鈕：[✏][前往連結 ↗][×]
  const actions = el('div');
  actions.style.cssText = 'display:flex;gap:8px;margin-top:4px;align-items:center;';

  const iconBtnBase = 'flex-shrink:0;width:36px;height:36px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;outline:none;-webkit-tap-highlight-color:transparent;transition:background .15s;';

  const editBtn = el('button');
  editBtn.style.cssText = iconBtnBase + 'background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.85);';
  editBtn.title = '編輯';
  editBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  editBtn.addEventListener('click', () => { doClose(); openGalleryEditDialog(item, container); });

  const linkBtn = el('button');
  linkBtn.style.cssText = `flex:1;padding:9px 12px;border-radius:8px;background:#5865f2;border:none;color:#fff;font-size:13px;font-weight:600;cursor:pointer;outline:none;-webkit-tap-highlight-color:transparent;${item.url ? '' : 'opacity:0.3;pointer-events:none;'}`;
  linkBtn.textContent = '前往連結 ↗';
  if (item.url) linkBtn.addEventListener('click', () => window.open(item.url, '_blank'));

  const delBtn = el('button');
  delBtn.style.cssText = iconBtnBase + 'background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.25);color:#f87171;';
  delBtn.title = '刪除';
  delBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/></svg>`;
  delBtn.addEventListener('click', async () => {
    if (!confirm('確定刪除這個書籤？')) return;
    S.gallery = (S.gallery || []).filter(g => g.id !== item.id);
    if (!S.galleryDeletedIds) S.galleryDeletedIds = [];
    if (!S.galleryDeletedIds.includes(item.id)) S.galleryDeletedIds.push(item.id);
    if (item.imageId) await idbDel(item.imageId).catch(() => {});
    if (item.thumbId) await idbDel(item.thumbId).catch(() => {});
    cloudDeleteItem(item.id, item.r2Key);
    cloudGalleryPush();
    lsSave(); doClose(); renderGalleryWidget(container);
  });

  // 分享媒體按鈕（有 mediaUrl 或本地 imageId 才顯示）
  const hasMedia = !!(item.mediaUrl || item.imageId);
  const shareImgBtn = el('button');
  shareImgBtn.style.cssText = `flex:1;padding:9px 12px;border-radius:8px;background:#EE4D2D;border:none;color:#fff;font-size:12px;font-weight:700;cursor:pointer;outline:none;-webkit-tap-highlight-color:transparent;display:${hasMedia ? 'flex' : 'none'};align-items:center;justify-content:center;gap:4px;letter-spacing:0.01em;`;
  shareImgBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="13" height="13"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>以圖搜圖`;
  shareImgBtn.title = '以圖搜圖';
  shareImgBtn.addEventListener('click', async () => {
    if (!navigator.share) { toast('此裝置不支援分享', 'err'); return; }
    shareImgBtn.disabled = true;
    const orig = shareImgBtn.innerHTML;
    shareImgBtn.textContent = '取得中…';
    try {
      let blob = null;
      if (item.imageId)  blob = await idbGet(item.imageId).catch(() => null);
      if (!blob && item.mediaUrl) {
        const r = await fetch(item.mediaUrl).catch(() => null);
        if (r?.ok) blob = await r.blob().catch(() => null);
      }
      if (!blob) throw new Error('no media');
      const mime = blob.type || 'image/jpeg';
      const ext  = mime.includes('webm') ? 'webm' : mime.includes('mp4') ? 'mp4' : mime.includes('png') ? 'png' : 'jpg';
      const file = new File([blob], `media.${ext}`, { type: mime });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: item.title || '', text: item.description || '' });
      } else {
        await navigator.share({ url: item.url || item.mediaUrl || '', title: item.title || '' });
      }
    } catch(e) {
      if (e?.name !== 'AbortError') toast('分享失敗', 'err');
    } finally {
      shareImgBtn.disabled = false;
      shareImgBtn.innerHTML = orig;
    }
  });

  // 前往連結寬度調整：有 shareImgBtn 時各佔一半
  if (hasMedia) linkBtn.style.flex = '1';

  actions.appendChild(editBtn);
  actions.appendChild(linkBtn);
  if (hasMedia) actions.appendChild(shareImgBtn);
  actions.appendChild(delBtn);
  info.appendChild(actions);
  card.appendChild(info);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // Spring in
  requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('show')));

  const doClose = () => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 380);
  };
  overlay.addEventListener('click', e => { if (e.target === overlay) doClose(); });

  // 下滑關閉
  let sy = 0, sx = 0;
  card.addEventListener('touchstart', e => { sy = e.touches[0].clientY; sx = e.touches[0].clientX; }, { passive: true });
  card.addEventListener('touchend', e => {
    const dy = e.changedTouches[0].clientY - sy;
    const dx = Math.abs(e.changedTouches[0].clientX - sx);
    if (dy > 80 && dx < 60) doClose();
  }, { passive: true });
}

function openGalleryEditDialog(item, container) {
  const overlay = el('div', 'gallery-overlay');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:9910;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;';
  const box = el('div');
  box.style.cssText = 'background:var(--bg-card,#1a1a2e);border-radius:16px;padding:20px;width:100%;max-width:380px;box-sizing:border-box;max-height:85vh;overflow-y:auto;';
  box.innerHTML = `
    <div style="font-size:15px;font-weight:600;color:#fff;margin-bottom:14px;">編輯書籤</div>
    <div id="_gal-e-preview" style="width:100%;height:160px;border:1.5px dashed rgba(255,255,255,0.2);border-radius:10px;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.3);font-size:13px;margin-bottom:12px;cursor:pointer;overflow:hidden;background:rgba(0,0,0,0.2);"></div>
    <input type="file" accept="image/*,video/*" id="_gal-e-file" style="display:none">
    <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:4px;">標題（選填）</div>
    <input type="text" id="_gal-e-title" value="${esc(item.title||'')}" placeholder="輸入標題…" style="width:100%;box-sizing:border-box;padding:10px 12px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:#fff;font-size:14px;outline:none;margin-bottom:12px;">
    <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:4px;">描述（選填）</div>
    <textarea id="_gal-e-desc" rows="2" placeholder="輸入描述…" style="width:100%;box-sizing:border-box;padding:10px 12px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:#fff;font-size:14px;outline:none;resize:vertical;margin-bottom:12px;">${esc(item.description||'')}</textarea>
    <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:4px;">點擊連結（選填）</div>
    <input type="url" id="_gal-e-url" value="${esc(item.url||'')}" placeholder="https://..." style="width:100%;box-sizing:border-box;padding:10px 12px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:#fff;font-size:14px;outline:none;margin-bottom:16px;">`;

  // 顯示現有圖片
  const preview = box.querySelector('#_gal-e-preview');
  const fileInp = box.querySelector('#_gal-e-file');
  let newBlob = null;

  const showPreview = (url, isVideo, needRevoke) => {
    if (isVideo) {
      preview.innerHTML = `<video src="${url}" style="width:100%;height:160px;object-fit:contain;display:block;" muted playsinline></video>`;
      if (needRevoke) preview.querySelector('video').oncanplay = () => URL.revokeObjectURL(url);
    } else {
      preview.innerHTML = `<img src="${url}" style="width:100%;height:160px;object-fit:contain;display:block;">`;
      if (needRevoke) preview.querySelector('img').onload = () => URL.revokeObjectURL(url);
    }
  };

  if (item.mediaUrl) {
    showPreview(item.mediaUrl, item.type === 'video', false);
  } else if (item.imageId) {
    idbGet(item.imageId).then(b => {
      if (b) showPreview(URL.createObjectURL(b), item.type === 'video', true);
      else preview.textContent = '點擊更換圖片';
    });
  } else {
    preview.textContent = '點擊更換圖片';
  }

  preview.addEventListener('click', () => fileInp.click());
  fileInp.addEventListener('change', async () => {
    const f = fileInp.files[0];
    if (!f) return;
    if (f.type.startsWith('image/')) {
      const cropped = await showCropDialog(f);
      fileInp.value = '';
      if (!cropped) return;
      newBlob = cropped;
      showPreview(URL.createObjectURL(cropped), false, true);
    } else {
      newBlob = f;
      showPreview(URL.createObjectURL(f), true, true);
    }
  });

  // 標籤編輯器
  const tagEditor = buildGalleryTagEditor(box, item.tags || []);

  // 按鈕列
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:10px;';
  btnRow.innerHTML = `
    <button id="_gal-e-cancel" style="flex:1;padding:11px;border-radius:8px;background:rgba(255,255,255,0.08);color:#fff;border:none;font-size:14px;cursor:pointer;">取消</button>
    <button id="_gal-e-save" style="flex:1;padding:11px;border-radius:8px;background:var(--accent,#7c6af5);color:#fff;border:none;font-size:14px;font-weight:600;cursor:pointer;">儲存</button>`;
  box.appendChild(btnRow);

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  btnRow.querySelector('#_gal-e-cancel').addEventListener('click', () => overlay.remove());
  btnRow.querySelector('#_gal-e-save').addEventListener('click', async () => {
    const saveBtn = btnRow.querySelector('#_gal-e-save');
    saveBtn.disabled = true; saveBtn.textContent = '儲存中…';

    // 有換圖才重新處理上傳
    if (newBlob) {
      const isVideo = newBlob.type.startsWith('video/');
      try {
        let uploadBlob = newBlob, uploadType = newBlob.type;
        if (isVideo) {
          const result = await processVideoBlob(newBlob);
          if (result) { uploadBlob = result.blob; uploadType = result.type === 'video' ? 'video/webm' : 'image/jpeg'; item.type = result.type; }
        } else {
          uploadBlob = await compressImage(newBlob); uploadType = 'image/jpeg'; item.type = 'image';
        }
        // 刪舊 R2
        if (item.r2Key) cloudDeleteItem(null, item.r2Key);
        if (S.cfg.cloudToken) {
          const up = await cloudUpload(uploadBlob, uploadType);
          item.mediaUrl = up.url; item.r2Key = up.r2Key;
        } else {
          item.mediaUrl = null; item.r2Key = null;
        }
        const imageId = item.imageId || ('gallery_img_' + item.id);
        await idbSet(imageId, uploadBlob);
        item.imageId = imageId;
        // 重新生成縮圖
        if (!isVideo) {
          const thumbId = 'gallery_thumb_' + item.id;
          try {
            const thumbBlob = await generateThumb(uploadBlob);
            await idbSet(thumbId, thumbBlob);
            item.thumbId = thumbId;
          } catch(_) {}
        }
      } catch(e) { /* 換圖失敗保留舊圖 */ }
    }

    item.title       = box.querySelector('#_gal-e-title').value.trim();
    item.description = box.querySelector('#_gal-e-desc').value.trim();
    item.url         = box.querySelector('#_gal-e-url').value.trim();
    item.tags        = tagEditor.getSelected();
    cloudGalleryPush();
    lsSave(); overlay.remove(); renderGalleryWidget(container);
  });
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
    allTab.addEventListener('click', () => { S.news.activeKw = 'all'; renderMobileNews(container, extSettingsBtn, extLangBtn, extRefBtn); });
    kws.appendChild(allTab);
    S.news.keywords.forEach(kw => {
      const wrap = el('span', 'kw-tag-wrap' + (S.news.activeKw === kw ? ' on' : '') + (editing ? ' editing' : ''));
      const label = el('span', 'kw-label', esc(kw));
      label.addEventListener('click', () => { if (!editing) { S.news.activeKw = kw; renderMobileNews(container, extSettingsBtn, extLangBtn, extRefBtn); } });
      const del = el('button', 'kw-del', '✕');
      del.addEventListener('click', e => {
        e.stopPropagation();
        S.news.keywords = S.news.keywords.filter(k => k !== kw);
        if (S.news.activeKw === kw) S.news.activeKw = 'all';
        lsSave(); S.news.fetchedAt = 0; renderMobileNews(container, extSettingsBtn, extLangBtn, extRefBtn); fetchNews(true);
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
        if (val && !S.news.keywords.includes(val)) { S.news.keywords.push(val); lsSave(); S.news.fetchedAt = 0; renderMobileNews(container, extSettingsBtn, extLangBtn, extRefBtn); fetchNews(true); }
        else { renderMobileNews(container, extSettingsBtn, extLangBtn, extRefBtn); }
      };
      inp.addEventListener('blur', doConfirm);
      inp.addEventListener('keydown', e => { if (e.key==='Enter'){e.preventDefault();inp.blur();} if(e.key==='Escape'){inp.value='';inp.blur();} });
    });
    addWrap.appendChild(addBtn);
    kws.appendChild(addWrap);

    // 重繪後更新展開按鈕可見性
    requestAnimationFrame(() => {
      const btn = kws?.closest('.tags-fold-wrapper')?.querySelector('.tags-expand-btn');
      if (btn) btn.style.display = kws.scrollHeight > kws.clientHeight + 2 ? '' : 'none';
    });
  };
  renderKws(false);
  _initTagsFold(kws);

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

/* ─────────────────────────────────────
   OMNI-SEARCH COMMAND PALETTE (Fuse.js)
───────────────────────────────────── */
let _omniOpen = false;
let _omniCurrentResults = [];  // 閉包安全：作用域在 initOmniSearch 內
let _omniFuse = null;
let _animeCalendarCache = null;  // 本季新番快取（供 _omniBuildIndex 存取）
let _rtcPeer = null;             // PeerJS Peer 實例
let _rtcConn = null;             // 目前的 DataConnection

/* ─────────────────────────────────────
   變色龍 UI — Canvas 圖片主題色萃取
───────────────────────────────────── */

/**
 * 從圖片 URL 萃取主色調（非同步）。
 * 遇到 CORS tainted canvas 時自動透過 imgproxy 重試一次。
 * 完成後呼叫 callback("rgb(r,g,b)")；失敗則靜默略過。
 */

function _omniTruncUrl(u) {
  if (!u) return '';
  try { return new URL(u).hostname; } catch (_) { return String(u).slice(0, 40); }
}

/* 搜尋字型正規化：統一 OpenCC 輸出與使用者慣用繁體字型之間的字型變體
   例如 OpenCC(cn→twp) 固定輸出「回」，但使用者自然輸入「迴」或「廻」
   兩邊用同一函式正規化後即可用 includes() 正確比對 */
function _omniNormalize(str) {
  return (str || '').toLowerCase()
    .replace(/[迴廻]/g, '回')    // 輪迴/輪廻 → OpenCC 輸出 回 (U+56DE)
    .replace(/衹|祇/g,  '只')    // 衹/祇 → 只
    .replace(/説/g,     '說');   // 説(U+8AAC) → 說(U+8AAA)
}

async function _omniBuildIndex() {
  const data = [];

  // 捷徑（私人群組需解鎖才顯示）
  (S.shortcuts || []).forEach(sc => {
    if (sc.groupId === PRIVATE_GROUP_ID && !S.privateUnlocked) return;
    data.push({ type:'shortcut', icon:'📌', title: sc.name || sc.url || '', sub: _omniTruncUrl(sc.url), url: sc.url, raw: sc });
  });

  // 新聞（全部，不限筆數）
  (S.news?.items || []).forEach(item => {
    data.push({ type:'news', icon:'📰', title: item.title || '', sub: item.source || '新聞', url: item.link, raw: item });
  });

  // YouTube（全部，不限筆數）
  (S.yt?.items || []).forEach(item => {
    data.push({ type:'yt', icon:'🎬', title: item.title || '', sub: item.channelName || 'YouTube', url: `https://www.youtube.com/watch?v=${item.videoId}`, raw: item });
  });

  // 便利貼（私人 tag 需解鎖才顯示）
  (S.stickies || []).forEach(s => {
    if (s.tag === PRIVATE_STICKY_TAG && !S.privateUnlocked) return;
    const txt = (s.text || '').slice(0, 100);
    data.push({ type:'sticky', icon:'📝', title: txt, sub: s.tag || '便利貼', url: null, rawId: s.id, raw: s });
  });

  // 動漫收藏（tracked）
  // name_cn 來自 bgm.tv，為簡體中文；用 toTW() 轉為繁體後再建索引，
  // 同時保留原始簡體與日文原名於 extra 欄位，讓搜尋更全面
  // 裏番（is_nsfw / AniList id）需解鎖才顯示
  const trackedIds = S.animeState?.tracked || [];
  const trackedSet = new Set(trackedIds);
  await Promise.all(trackedIds.map(async id => {
    const a = S.animeState?.trackedData?.[id];
    if (!a) return;
    if ((a.is_nsfw || a.id >= 10_000_000) && !S.privateUnlocked) return; // 裏番鎖定時隱藏
    const rawName  = S.animeState?.customNames?.[id] || a?.name_cn || a?.name || String(id);
    const titleTW  = await toTW(rawName);
    // extra：日文原名 + 簡體中文原名，作為補充搜尋文字（支援日文搜索）
    const extra    = [a?.name || '', a?.name_cn || ''].filter(Boolean).join(' ');
    const url      = a ? `https://bgm.tv/subject/${a.id}` : null;
    data.push({ type:'anime', icon:'🎌', title: titleTW, sub: '動漫收藏', url, raw: a || null, extra });
  }));

  // 本季新番（calendarCache，不重複收藏已有的）
  // 使用者進入動漫頁面後才有快取，未開啟前這段跳過
  if (_animeCalendarCache) {
    const calItems = _animeCalendarCache.flatMap(d => d.items || []);
    await Promise.all(calItems.map(async item => {
      if (trackedSet.has(item.id)) return;  // 已在收藏中，跳過避免重複
      if (item.is_nsfw && !S.privateUnlocked) return; // 裏番鎖定時隱藏
      const rawName = item.name_cn || item.name || String(item.id);
      const titleTW = await toTW(rawName);
      const extra   = [item.name || '', item.name_cn || ''].filter(Boolean).join(' ');
      const url     = `https://bgm.tv/subject/${item.id}`;
      data.push({ type:'anime', icon:'🎌', title: titleTW, sub: '本季新番', url, raw: item, extra });
    }));
  }

  // 裏番日曆（nsfwCalendar - 與一般日曆不同的資料來源，需解鎖才索引）
  // ⚠️ 此資料不在 _animeCalendarCache，而在 S.animeState.nsfwCalendar，必須分開處理
  if (S.privateUnlocked && S.animeState?.nsfwCalendar) {
    const nsfwItems = Object.values(S.animeState.nsfwCalendar).flat();
    await Promise.all(nsfwItems.map(async item => {
      if (!item || trackedSet.has(item.id)) return; // 已收藏者跳過
      const rawName = item.name_cn || item.name || String(item.id);
      const titleTW = await toTW(rawName);
      // extra 同時包含日文原名，支援日文關鍵字搜索
      const extra   = [item.name || '', item.name_cn || ''].filter(Boolean).join(' ');
      const url     = `https://bgm.tv/subject/${item.id}`;
      data.push({ type:'anime', icon:'🔞', title: titleTW, sub: '裏番', url, raw: item, extra });
    }));
  }

  // 圖庫書籤
  (S.gallery || []).forEach(item => {
    data.push({ type:'gallery', icon:'🖼', title: item.title || '(無標題)', sub: item.description || _omniTruncUrl(item.url), url: item.url, raw: item });
  });

  // 自製搜尋引擎：中英文雙模式，完全拋棄 Fuse.js
  // Fuse.js 的 Levenshtein 演算法不適合中文，substring 搜尋才是正解
  _omniFuse = {
    search: (q) => {
      const query = (q || '').trim().toLowerCase();
      if (!query) return [];

      // 正規化 query（迴→回 等字型變體），再拆詞
      const queryNorm = _omniNormalize(query);
      const terms = queryNorm.split(/\s+/).filter(Boolean);

      return data
        .map(item => {
          // 正規化 title / sub / extra，消除字型變體差異
          const titleNorm = _omniNormalize(item.title || '');
          const subNorm   = _omniNormalize(item.sub   || '');
          const extraNorm = _omniNormalize(item.extra || '');
          const pool      = titleNorm + ' ' + subNorm + ' ' + extraNorm;

          // 所有 term 都必須出現在正規化後的 pool 中
          const allMatch = terms.every(t => pool.includes(t));
          if (!allMatch) return null;

          // 計算分數：越早出現、命中 title 分越高
          let score = 0;
          terms.forEach(t => {
            const ti = titleNorm.indexOf(t);
            const si = subNorm.indexOf(t);
            if (ti === 0)       score += 100; // title 開頭完全命中
            else if (ti > 0)    score += 60;  // title 中間命中
            else if (si >= 0)   score += 30;  // sub 命中
            else                score += 10;  // extra 命中（日文/簡體備援）
          });
          // 完整字串與 query 相同給最高分
          if (titleNorm === queryNorm) score += 200;
          // query 是 title 的前綴
          if (titleNorm.startsWith(queryNorm)) score += 80;

          return { item, score };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .map(r => ({ item: r.item }));
    }
  };
}

async function openOmniSearch() {
  const ov = $('omni-overlay');
  if (!ov) return;
  await _omniBuildIndex();
  ov.classList.add('omni-active');
  _omniOpen = true;
  const inp = $('omni-input');
  if (inp) {
    inp.value = '';
    // 稍微延遲 focus，避免行動端鍵盤遮住結果
    setTimeout(() => inp.focus(), 80);
  }
  const res = $('omni-results');
  if (res) res.innerHTML = `<div class="omni-hint">
    <div class="omni-nav-hint">
      <kbd>↑</kbd><kbd>↓</kbd>&nbsp;導航&nbsp;&nbsp;
      <kbd>Enter</kbd>&nbsp;開啟&nbsp;&nbsp;
      <kbd>Esc</kbd>&nbsp;關閉
    </div>
  </div>`;
}

function closeOmniSearch() {
  $('omni-overlay')?.classList.remove('omni-active');
  _omniOpen = false;
  _omniCurrentResults = [];
}

/* ─────────────────────────────────────────
   OMNI-FAB  Draggable floating search ball
───────────────────────────────────────── */
const FAB_IDB_KEY        = 'fab_media';
const FAB_IDB_KEY_ACTIVE = 'fab_media_active';
let _fabBlobUrl       = null;   // 平常時 Blob URL
let _fabActiveBlobUrl = null;   // 展開時 Blob URL
let _fabIdleBlob      = null;   // 平常時 Blob 實體
let _fabActiveBlob    = null;   // 展開時 Blob 實體

/** 儲存 blob 並建立 Object URL（會釋放舊的） */
function _storeFabBlob(blob, isActive) {
  if (isActive) {
    if (_fabActiveBlobUrl) { URL.revokeObjectURL(_fabActiveBlobUrl); _fabActiveBlobUrl = null; }
    _fabActiveBlob    = blob;
    _fabActiveBlobUrl = blob ? URL.createObjectURL(blob) : null;
  } else {
    if (_fabBlobUrl) { URL.revokeObjectURL(_fabBlobUrl); _fabBlobUrl = null; }
    _fabIdleBlob = blob;
    _fabBlobUrl  = blob ? URL.createObjectURL(blob) : null;
  }
}

/** 根據展開狀態切換懸浮球媒體（淡入淡出平滑過渡） */
function _syncFabMedia(isActive) {
  const blob = (isActive && _fabActiveBlob) ? _fabActiveBlob : _fabIdleBlob;
  const url  = (isActive && _fabActiveBlobUrl) ? _fabActiveBlobUrl : _fabBlobUrl;
  const vid  = $('fab-media-vid');
  const img  = $('fab-media-img');
  const icon = document.querySelector('.fab-icon');
  const FADE = 280; // ms — 與 CSS transition 一致

  /* 淡出並隱藏元素 */
  const fadeOut = el => {
    if (!el || el.classList.contains('fab-hidden')) return;
    el.style.opacity = '0';
    setTimeout(() => {
      el.classList.add('fab-hidden');
      if (el.tagName === 'VIDEO') el.src = '';
    }, FADE);
  };

  if (!blob) {
    /* 沒有媒體 → 淡出影片/圖片，淡入圖示 */
    fadeOut(vid);
    fadeOut(img);
    if (icon) {
      icon.classList.remove('fab-hidden');
      icon.style.opacity = '0';
      requestAnimationFrame(() => requestAnimationFrame(() => { icon.style.opacity = '1'; }));
    }
    return;
  }

  /* 有媒體 → 隱藏圖示 */
  if (icon) {
    icon.style.opacity = '0';
    setTimeout(() => { icon.classList.add('fab-hidden'); }, FADE);
  }

  if (blob.type?.startsWith('video/')) {
    fadeOut(img);
    if (vid) {
      const already = !vid.classList.contains('fab-hidden') && vid.src === url;
      if (!already) {
        vid.style.opacity = '0';
        vid.classList.remove('fab-hidden');
        vid.src = url;
        const show = () => { vid.style.opacity = '1'; vid.removeEventListener('canplay', show); };
        vid.addEventListener('canplay', show);
      }
    }
  } else {
    fadeOut(vid);
    if (img) {
      const already = !img.classList.contains('fab-hidden') && img.src === url;
      if (!already) {
        img.style.opacity = '0';
        img.classList.remove('fab-hidden');
        img.src = url;
        const show = () => { img.style.opacity = '1'; img.removeEventListener('load', show); };
        img.addEventListener('load', show);
      }
    }
  }
}

function initOmniFab() {
  const wrap            = $('fab-wrap');
  const fab             = $('omni-fab');
  const fileInput       = $('fab-media-upload');
  const fileInputActive = $('fab-media-active-upload');
  if (!wrap || !fab) return;

  /* ── Helper: collapse sub-menu + settings panel + 切回平常時媒體 ── */
  const closeFabMenu = () => {
    wrap.classList.remove('fab-active');
    $('fab-settings-panel')?.classList.add('fab-hidden');
    _syncFabMedia(false);
  };

  /* ── Restore saved size ── */
  const savedSize = parseInt(localStorage.getItem('fab_size')) || 54;
  document.documentElement.style.setProperty('--fab-size', savedSize + 'px');
  const slider  = $('fab-size-slider');
  const sizeVal = $('fab-size-val');
  if (slider)  slider.value = savedSize;
  if (sizeVal) sizeVal.textContent = savedSize + 'px';

  /* ── Restore saved position ── */
  try {
    const pos = JSON.parse(localStorage.getItem('fab_pos') || 'null');
    if (pos) { wrap.style.left = pos.x + 'px'; wrap.style.top = pos.y + 'px'; }
  } catch (_) {}

  /* ── Restore saved media from IDB（雙模式） ── */
  Promise.all([
    idbGet(FAB_IDB_KEY).catch(() => null),
    idbGet(FAB_IDB_KEY_ACTIVE).catch(() => null),
  ]).then(([idleBlob, activeBlob]) => {
    if (idleBlob)   _storeFabBlob(idleBlob, false);
    if (activeBlob) _storeFabBlob(activeBlob, true);
    _syncFabMedia(false); // 初始顯示平常時媒體
  });

  /* ── File picker handler（平常時） ── */
  if (fileInput) {
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try {
        await idbSet(FAB_IDB_KEY, file);
        _storeFabBlob(file, false);
        _syncFabMedia(wrap.classList.contains('fab-active'));
      } catch (_) {}
      fileInput.value = '';
    });
  }

  /* ── File picker handler（展開時） ── */
  if (fileInputActive) {
    fileInputActive.addEventListener('change', async () => {
      const file = fileInputActive.files[0];
      if (!file) return;
      try {
        await idbSet(FAB_IDB_KEY_ACTIVE, file);
        _storeFabBlob(file, true);
        _syncFabMedia(wrap.classList.contains('fab-active'));
      } catch (_) {}
      fileInputActive.value = '';
    });
  }

  /* ── Size slider: live preview + persist ── */
  if (slider) {
    slider.addEventListener('input', () => {
      const sz = slider.value + 'px';
      document.documentElement.style.setProperty('--fab-size', sz);
      if (sizeVal) sizeVal.textContent = slider.value + 'px';
      localStorage.setItem('fab_size', slider.value);
    });
  }

  /* ── Settings panel: 平常時媒體按鈕 ── */
  $('fab-sp-media-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    fileInput?.click();
  });

  /* ── Settings panel: 展開時媒體按鈕 ── */
  $('fab-sp-media-active-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    fileInputActive?.click();
  });

  /* ── Settings panel: 備份與還原摺疊選單 ── */
  const brToggle  = $('fab-sp-br-toggle');
  const brActions = $('fab-sp-br-actions');
  const brArrow   = $('fab-br-arrow');
  if (brToggle && brActions) {
    brToggle.addEventListener('click', e => {
      e.stopPropagation();
      const isHidden = brActions.style.display === 'none';
      brActions.style.display = isHidden ? 'flex' : 'none';
      if (brArrow) brArrow.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
    });
  }
  $('fab-sp-backup-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    exportBackup();
  });
  const backupUpload = $('fab-backup-upload');
  $('fab-sp-restore-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    backupUpload?.click();
  });
  backupUpload?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) { importBackup(file); e.target.value = ''; }
  });

  /* ── Sub-button: 📡 Transfer ── */
  $('fab-sub-transfer')?.addEventListener('click', e => {
    e.stopPropagation();
    closeFabMenu();
    openWebRTCModal();
  });

  /* ── Sub-button: 🤖 AI ── */
  $('fab-sub-ai')?.addEventListener('click', e => {
    e.stopPropagation();
    closeFabMenu();
    $('ai-chat-panel')?.classList.remove('ai-hidden');
    setTimeout(() => $('ai-chat-input')?.focus(), 50);
  });

  /* ── Sub-button: ⚙️ Settings → toggle panel ── */
  $('fab-sub-settings')?.addEventListener('click', e => {
    e.stopPropagation();
    $('fab-settings-panel')?.classList.toggle('fab-hidden');
  });

  /* ── Close menu when tapping anywhere outside ── */
  document.addEventListener('pointerdown', e => {
    if (wrap.classList.contains('fab-active') && !wrap.contains(e.target)) {
      closeFabMenu();
    }
  }, true);

  /* ── 阻止系統「長按儲存圖片」原生選單攔截 pointer 事件 ── */
  fab.addEventListener('contextmenu', e => e.preventDefault());

  /* ── Pointer-drag & tap / long-press logic ── */
  const isMainBall = t => t === wrap || t === fab || fab.contains(t);

  let dragging = false, dragMoved = false;
  let startX, startY, startL, startT;
  let longPressTimer = null, rafId = null;
  let pendingX = 0, pendingY = 0;
  let longPressJustFired = false; // 區分「長按剛展開」與「短按關閉」

  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  wrap.addEventListener('pointerdown', e => {
    if (!isMainBall(e.target)) return;           // ignore sub-buttons / panel
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    wrap.setPointerCapture(e.pointerId);
    dragging  = true;
    dragMoved = false;
    longPressJustFired = false;
    startX = e.clientX; startY = e.clientY;
    startL = parseInt(wrap.style.left) || wrap.getBoundingClientRect().left;
    startT = parseInt(wrap.style.top)  || wrap.getBoundingClientRect().top;
    wrap.classList.add('fab-pressing');

    /* Long-press (620 ms) → toggle sub-menu */
    longPressTimer = setTimeout(() => {
      if (!dragMoved) {
        longPressJustFired = true;   // 標記是長按觸發，pointerup 不應關閉選單
        wrap.classList.remove('fab-pressing');
        const willOpen = !wrap.classList.contains('fab-active');
        wrap.classList.toggle('fab-active');
        $('fab-settings-panel')?.classList.add('fab-hidden'); // reset panel on open/close
        _syncFabMedia(willOpen); // 依展開/收起切換媒體
      }
    }, 620);
  });

  wrap.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!dragMoved && Math.hypot(dx, dy) > 5) {
      dragMoved = true;
      clearTimeout(longPressTimer); longPressTimer = null;
      wrap.classList.remove('fab-pressing');
      closeFabMenu();                             // drag cancels any open menu
    }
    if (!dragMoved) return;
    const sz   = wrap.offsetWidth;
    const maxX = window.innerWidth  - sz;
    const maxY = window.innerHeight - sz;
    pendingX = clamp(startL + dx, 0, maxX);
    pendingY = clamp(startT + dy, 0, maxY);
    if (!rafId) rafId = requestAnimationFrame(() => {
      wrap.style.left = pendingX + 'px';
      wrap.style.top  = pendingY + 'px';
      rafId = null;
    });
  });

  const _endDrag = () => {
    if (!dragging) return;
    dragging = false;
    wrap.classList.remove('fab-pressing');
    clearTimeout(longPressTimer); longPressTimer = null;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  };

  wrap.addEventListener('pointerup', e => {
    if (!dragging) return;
    const wasMoved = dragMoved;
    _endDrag();
    if (wasMoved) {
      /* Save final position */
      localStorage.setItem('fab_pos', JSON.stringify({
        x: parseInt(wrap.style.left) || 0,
        y: parseInt(wrap.style.top)  || 0,
      }));
    } else {
      if (longPressJustFired) {
        /* 長按剛展開選單，鬆手時不做任何事，讓選單保持開啟 */
        longPressJustFired = false;
      } else if (wrap.classList.contains('fab-active')) {
        /* 短按：選單已開 → 關閉 */
        closeFabMenu();
      } else {
        /* 短按：選單未開 → 開啟全域搜尋 */
        openOmniSearch();
      }
    }
  });

  wrap.addEventListener('pointercancel', _endDrag);
}

function initOmniSearch() {
  const ov = $('omni-overlay');
  if (!ov) return;

  const inp = $('omni-input');
  const res = $('omni-results');
  let activeIdx = -1;

  /* ── 切換到指定 widget 的分頁（mobile layout），回傳是否真的切換了 ── */
  const goToWidget = (widgetType) => {
    const idx = (S.mobilePages || []).findIndex(p => p.widget === widgetType);
    if (idx < 0) return false;
    if (S.mobilePageIdx === idx) return true; // 已在該頁，不用切
    const dir = idx > S.mobilePageIdx ? 'left' : 'right';
    S.mobilePageIdx = idx;
    _vtRenderPages(window._mobileRenderPages || (() => {}), dir);
    return true;
  };

  /* ── 執行結果項目動作（直接呼叫函數，繞過 DOM 幽靈陷阱） ── */
  const activate = (idx) => {
    const r = _omniCurrentResults[idx];
    if (!r) return;
    closeOmniSearch();

    switch (r.type) {
      // ── 捷徑：直接新分頁開啟 ──
      case 'shortcut':
        window.open(r.url, '_blank', 'noopener,noreferrer');
        break;

      // ── 新聞：直接新分頁開啟 ──
      case 'news':
        window.open(r.url, '_blank', 'noopener,noreferrer');
        break;

      // ── YouTube：切頁後直接呼叫 showYtSheet（不靠 DOM）──
      case 'yt': {
        goToWidget('youtube');
        setTimeout(() => {
          if (r.raw && typeof showYtSheet === 'function') showYtSheet(r.raw);
        }, 120);
        break;
      }

      // ── 便利貼：切頁 → 確保 tag 篩選正確 → 滾動 + 高亮 ──
      case 'sticky': {
        goToWidget('stickies');
        setTimeout(() => {
          const targetId = r.rawId || r.raw?.id;
          const stickyData = (S.stickies || []).find(s => s.id === targetId);

          // 若便利貼屬於某個 tag，先切換 tag 讓它出現在 DOM
          if (stickyData?.tag && S.activeStickyTag !== stickyData.tag && S.activeStickyTag !== 'all') {
            S.activeStickyTag = stickyData.tag;
            lsSave();
            // 【關鍵】只更新畫面上「真正可見」的 stickies-inner，
            //  避免誤操作隱藏的桌機版 / 手機版 DOM
            document.querySelectorAll('.stickies-inner').forEach(body => {
              if (body.offsetParent !== null) {
                if (typeof body._renderTagBar === 'function') body._renderTagBar();
                if (typeof renderStickiesWidget === 'function') renderStickiesWidget(body);
              }
            });
          }

          // 等切頁動畫完全結束後再定位（350ms 安全邊際）
          setTimeout(() => {
            // 【關鍵】找出畫面上真正可見的那張卡片
            let visibleCard = null;
            document.querySelectorAll(`.sticky-card[data-id="${targetId}"]`).forEach(c => {
              if (c.offsetParent !== null) visibleCard = c;
            });

            if (visibleCard) {
              visibleCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
              // 背景色閃爍高亮（不受 overflow:hidden 裁切）
              visibleCard.style.transition = 'background 0.4s ease';
              const oldBg = visibleCard.style.background;
              visibleCard.style.background = 'rgba(56,189,248,0.35)';
              setTimeout(() => { visibleCard.style.background = oldBg; }, 900);
            }
          }, 350);
        }, 50);
        break;
      }

      // ── 動漫：切頁後直接呼叫 showAnimeSheet（不靠 DOM）──
      case 'anime': {
        goToWidget('anime');
        setTimeout(() => {
          if (r.raw && typeof showAnimeSheet === 'function') showAnimeSheet(r.raw);
        }, 120);
        break;
      }

      // ── 圖庫：切頁後直接呼叫 openGalleryDetail（不靠 DOM）──
      case 'gallery': {
        goToWidget('gallery');
        setTimeout(() => {
          if (r.raw && typeof openGalleryDetail === 'function') openGalleryDetail(r.raw, null);
        }, 120);
        break;
      }

      default:
        if (r.url) window.open(r.url, '_blank', 'noopener,noreferrer');
        break;
    }
  };

  /* ── 渲染搜尋結果 ── */
  const renderResults = (query) => {
    activeIdx = -1;
    const q = (query || '').trim();
    if (!res) return;

    if (!q) {
      _omniCurrentResults = [];
      res.innerHTML = `<div class="omni-hint">
        <div class="omni-nav-hint">
          <kbd>↑</kbd><kbd>↓</kbd>&nbsp;導航&nbsp;&nbsp;
          <kbd>Enter</kbd>&nbsp;開啟&nbsp;&nbsp;
          <kbd>Esc</kbd>&nbsp;關閉
        </div>
      </div>`;
      return;
    }

    _omniCurrentResults = (_omniFuse?.search(q) || []).map(r => r.item).slice(0, 30);

    if (!_omniCurrentResults.length) {
      res.innerHTML = `<div class="omni-empty">找不到「${esc(q)}」的相關內容</div>`;
      return;
    }

    const TYPE_LABEL = { shortcut:'捷徑', news:'新聞', yt:'YouTube', sticky:'便利貼', anime:'動漫', gallery:'圖庫' };
    const groups = {};
    _omniCurrentResults.forEach((r, i) => {
      (groups[r.type] = groups[r.type] || []).push({ r, i });
    });

    let html = '';
    Object.keys(TYPE_LABEL).forEach(type => {
      if (!groups[type]?.length) return;
      html += `<div class="omni-section-title">${TYPE_LABEL[type]}</div>`;
      groups[type].forEach(({ r, i }) => {
        // 關鍵字高亮（不含 HTML 注入）
        const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const hlTitle = esc(r.title || '').replace(new RegExp(`(${esc(safeQ)})`, 'gi'), '<mark>$1</mark>');
        html += `<div class="omni-item" data-idx="${i}">
          <span class="omni-item-icon">${r.icon}</span>
          <span class="omni-item-body">
            <div class="omni-item-title">${hlTitle}</div>
            ${r.sub ? `<div class="omni-item-sub">${esc(r.sub)}</div>` : ''}
          </span>
          ${r.url ? '<span class="omni-item-arrow">↗</span>' : ''}
        </div>`;
      });
    });
    res.innerHTML = html;
    res.querySelectorAll('.omni-item').forEach(el => {
      el.addEventListener('click', () => activate(+el.dataset.idx));
    });
  };

  /* ── 鍵盤導航 ── */
  const navigate = (dir) => {
    const items = res?.querySelectorAll('.omni-item');
    if (!items?.length) return;
    items[activeIdx]?.classList.remove('omni-active');
    activeIdx = Math.max(0, Math.min(items.length - 1, activeIdx + dir));
    items[activeIdx]?.classList.add('omni-active');
    items[activeIdx]?.scrollIntoView({ block: 'nearest' });
  };

  if (inp) {
    // 輸入即時搜尋
    inp.addEventListener('input', () => renderResults(inp.value));

    // 鍵盤：桌機 ↑↓Enter + Esc
    inp.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown')  { e.preventDefault(); navigate(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); navigate(-1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIdx >= 0) activate(activeIdx);
        else if (_omniCurrentResults.length) activate(0);
      }
      else if (e.key === 'Escape') closeOmniSearch();
    });

    // 行動端虛擬鍵盤「前往/搜尋」按鈕：觸發 search 事件
    inp.addEventListener('search', () => {
      if (_omniCurrentResults.length) activate(0);
    });
  }

  // Esc 按鈕 + 背景點擊關閉
  $('omni-esc-kbd')?.addEventListener('click', closeOmniSearch);
  ov.addEventListener('click', e => { if (e.target === ov) closeOmniSearch(); });

  // 全域快捷鍵 Ctrl+K / Cmd+K
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      _omniOpen ? closeOmniSearch() : openOmniSearch();
      return;
    }
    if (e.key === 'Escape' && _omniOpen) closeOmniSearch();
  });

  // Header 按鈕
  $('omni-btn')?.addEventListener('click', openOmniSearch);
}

/* ─────────────────────────────────────
   WebRTC 跨裝置傳送門 (PeerJS P2P)
───────────────────────────────────── */
function _rtcReset() {
  try { _rtcPeer?.destroy(); } catch (_) {}
  _rtcPeer = null;
  _rtcConn = null;
}

function openWebRTCModal() {
  if (document.getElementById('webrtc-modal')) return;
  _rtcReset();

  const pin    = String(Math.floor(1000 + Math.random() * 9000));
  const overlay = document.createElement('div');
  overlay.id = 'webrtc-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);z-index:9998;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;';

  const box = document.createElement('div');
  box.style.cssText = 'background:rgba(13,20,33,0.96);border:1px solid rgba(255,255,255,0.14);backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px);border-radius:20px;width:100%;max-width:360px;padding:20px;box-shadow:0 24px 60px rgba(0,0,0,0.6);color:#f0f4fb;box-sizing:border-box;';

  let _escListener, _dragOver, _drop;
  const closeModal = () => {
    _rtcReset();
    overlay.remove();
    window.removeEventListener('keydown', _escListener);
    window.removeEventListener('dragover', _dragOver);
    window.removeEventListener('drop',     _drop);
  };
  _escListener = (e) => { if (e.key === 'Escape') closeModal(); };
  window.addEventListener('keydown', _escListener);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  // ── 建立 DOM ──
  box.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">
      <span style="font-size:15px;font-weight:700;">📡 跨裝置傳送門</span>
      <button id="_rtc-x" style="background:none;border:none;color:rgba(255,255,255,0.45);font-size:22px;cursor:pointer;padding:0 2px;line-height:1;">×</button>
    </div>
    <div style="background:rgba(255,255,255,0.06);border-radius:12px;padding:14px;margin-bottom:14px;text-align:center;">
      <div style="font-size:11px;color:rgba(255,255,255,0.38);margin-bottom:6px;letter-spacing:.05em;">本機連線碼</div>
      <div id="_rtc-pin-disp" style="font-size:34px;font-weight:800;letter-spacing:8px;color:var(--ac,#38bdf8);">${pin}</div>
      <div id="_rtc-peer-st" style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:6px;">初始化中…</div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:12px;">
      <input id="_rtc-inp" type="text" inputmode="numeric" maxlength="4" placeholder="輸入對方連線碼"
        style="flex:1;padding:10px 12px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.14);border-radius:10px;color:#fff;font-size:18px;letter-spacing:5px;text-align:center;outline:none;">
      <button id="_rtc-conn-btn" style="padding:10px 16px;background:var(--ac,#38bdf8);border:none;border-radius:10px;color:#000;font-size:14px;font-weight:700;cursor:pointer;white-space:nowrap;">連線</button>
    </div>
    <div id="_rtc-st" style="font-size:12px;color:rgba(255,255,255,0.42);min-height:16px;margin-bottom:10px;text-align:center;"></div>
    <div id="_rtc-send" style="display:none;">
      <div style="font-size:11px;color:rgba(255,255,255,0.38);margin-bottom:8px;">傳送給對方</div>
      <div style="display:flex;gap:8px;margin-bottom:8px;">
        <input id="_rtc-txt" type="text" placeholder="輸入文字訊息…"
          style="flex:1;padding:9px 12px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.13);border-radius:10px;color:#fff;font-size:14px;outline:none;">
        <button id="_rtc-send-txt" style="padding:9px 14px;background:rgba(56,189,248,0.18);border:1px solid rgba(56,189,248,0.38);border-radius:10px;color:#38bdf8;font-size:13px;font-weight:600;cursor:pointer;">傳</button>
      </div>
      <button id="_rtc-send-file" style="width:100%;padding:10px;background:rgba(167,139,250,0.14);border:1px solid rgba(167,139,250,0.32);border-radius:10px;color:#a78bfa;font-size:13px;cursor:pointer;">📎 選擇檔案傳送</button>
    </div>
    <div id="_rtc-drop" style="display:none;margin-top:10px;border:2px dashed rgba(255,255,255,0.2);border-radius:12px;padding:22px;text-align:center;color:rgba(255,255,255,0.35);font-size:12px;transition:border-color .2s,background .2s;">
      🖱 可將檔案拖放至此視窗傳送給對方
    </div>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  box.querySelector('#_rtc-x').onclick = closeModal;

  // ── 簡易取 DOM ──
  const $b = id => box.querySelector('#' + id);
  const setStatus    = (msg, ok = null) => {
    const el = $b('_rtc-st');
    if (!el) return;
    el.textContent = msg;
    el.style.color = ok === true ? '#4ade80' : ok === false ? '#f87171' : 'rgba(255,255,255,0.42)';
  };
  const setPeerSt = msg => { const el = $b('_rtc-peer-st'); if (el) el.textContent = msg; };

  // ── 收到資料處理 ──
  const handleData = async (data) => {
    if (typeof data === 'string') {
      // 文字 → 新增便利貼
      if (!S.stickies) S.stickies = [];
      S.stickies.unshift({ id: 'rtc_' + Date.now(), text: data, tag: '互傳', addedAt: Date.now(), color: '' });
      lsSave();
      document.querySelectorAll('.stickies-inner').forEach(el => renderStickiesWidget(el));
      toast('已接收文字，存入便利貼 📝');
      setStatus('✅ 已接收文字訊息', true);
    } else if (typeof data === 'object' && data.type === 'file') {
      // 檔案 → 瀏覽器原生下載（支援任意格式，不存入圖庫）
      try {
        const blob = new Blob([data.data], { type: data.mime || 'application/octet-stream' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url;
        a.download = data.filename || 'received-file';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
        toast('✅ 已下載：' + (data.filename || '檔案'));
        setStatus('✅ 已下載：' + (data.filename || '檔案'), true);
      } catch (err) {
        toast('❌ 檔案下載失敗', 'err');
        setStatus('❌ 下載失敗', false);
      }
    }
  };

  // ── 連線處理 ──
  const wireConn = (conn) => {
    _rtcConn = conn;
    conn.on('open', () => {
      setStatus('✅ 連線成功！', true);
      $b('_rtc-send').style.display = '';
      $b('_rtc-drop').style.display = '';
    });
    conn.on('data',  handleData);
    conn.on('close', () => {
      setStatus('⚠ 連線已中斷', false);
      $b('_rtc-send').style.display = 'none';
      $b('_rtc-drop').style.display = 'none';
      _rtcConn = null;
    });
    conn.on('error', () => { setStatus('❌ 連線錯誤', false); _rtcConn = null; });
  };

  // ── 初始化 PeerJS ──
  try {
    _rtcPeer = new Peer('neocast-' + pin);
    _rtcPeer.on('open',        () => setPeerSt('等待對方連線…'));
    _rtcPeer.on('connection',  conn => { setStatus('有裝置連入…'); wireConn(conn); });
    _rtcPeer.on('error',       err  => { setPeerSt('初始化失敗'); setStatus('❌ ' + (err.type || 'error'), false); });
  } catch (_e) {
    setPeerSt('PeerJS 未載入，請確認網路');
  }

  // ── 連線按鈕 ──
  $b('_rtc-conn-btn').onclick = () => {
    const target = $b('_rtc-inp').value.trim();
    if (!/^\d{4}$/.test(target)) { setStatus('請輸入 4 位數連線碼', false); return; }
    if (!_rtcPeer) { setStatus('PeerJS 未就緒', false); return; }
    setStatus('連線中…');
    try {
      wireConn(_rtcPeer.connect('neocast-' + target, { reliable: true }));
    } catch (_e) { setStatus('❌ 連線失敗', false); }
  };

  // ── 傳送文字 ──
  const sendText = () => {
    const txt = $b('_rtc-txt').value.trim();
    if (!txt || !_rtcConn) return;
    try { _rtcConn.send(txt); $b('_rtc-txt').value = ''; setStatus('✅ 已傳送文字', true); }
    catch (_e) { setStatus('❌ 傳送失敗', false); }
  };
  $b('_rtc-send-txt').onclick = sendText;
  $b('_rtc-txt').addEventListener('keydown', e => { if (e.key === 'Enter') sendText(); });

  // ── 傳送檔案（選擇器，任意格式） ──
  $b('_rtc-send-file').onclick = () => {
    if (!_rtcConn) { setStatus('請先建立連線', false); return; }
    const inp = document.createElement('input');
    inp.type = 'file'; // 不限制格式，支援任意檔案
    inp.onchange = () => {
      const file = inp.files?.[0];
      if (!file) return;
      try {
        _rtcConn.send({ type: 'file', filename: file.name, mime: file.type || 'application/octet-stream', data: file });
        setStatus('✅ 已傳送：' + file.name, true);
      } catch (_e) { setStatus('❌ 傳送失敗', false); }
    };
    inp.click();
  };

  // ── Drag & Drop（全視窗拖放，連線後才接受） ──
  const dropZone = $b('_rtc-drop');
  _dragOver = (e) => {
    e.preventDefault();
    if (_rtcConn && dropZone) {
      dropZone.style.borderColor = 'var(--ac,#38bdf8)';
      dropZone.style.background  = 'rgba(56,189,248,0.07)';
    }
  };
  _drop = (e) => {
    e.preventDefault();
    if (dropZone) { dropZone.style.borderColor = ''; dropZone.style.background = ''; }
    if (!_rtcConn) { setStatus('請先建立連線再拖放', false); return; }
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    try {
      _rtcConn.send({ type: 'file', filename: file.name, mime: file.type || 'application/octet-stream', data: file });
      setStatus('✅ 已傳送：' + file.name, true);
    } catch (_e) { setStatus('❌ 傳送失敗', false); }
  };
  window.addEventListener('dragover', _dragOver);
  window.addEventListener('drop',     _drop);
}

/* ── 換頁切換：瞬間切換，完全不附加動畫 class，保護毛玻璃 backdrop-filter ── */
function _vtRenderPages(renderFn, _dir) {
  renderFn();
}

/* ─────────────────────────────────────
   AI CHAT — Ollama Streaming
───────────────────────────────────── */
const OLLAMA_URL   = 'http://10.242.133.187:11434/api/chat';
const OLLAMA_MODEL = 'neocast-soul';
const TTS_URL  = 'http://10.242.133.187:5050/tts';
let ttsRate      = '+0%';
let ttsPitch     = '+0Hz';
let ttsMuted     = false;
let chatFontScale = 100;   // 對話字級百分比
let _ttsState       = 'idle';   // 'idle' | 'loading' | 'playing' | 'paused'
let _ttsAudio       = null;
let _ttsToggle      = null;
let _ttsActBtn      = null;     // 當前作用中的訊息播放按鈕
let _ttsQueue       = [];       // 串流分段 TTS 佇列
let _ttsQueueActive = false;    // 佇列是否正在消費

const _TTS_STORAGE_KEY = 'neocast_tts_settings';

const _SVG = {
  play:   `<svg viewBox="0 0 16 16" fill="currentColor"><polygon points="4,2 13,8 4,14"/></svg>`,
  pause:  `<svg viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="2" width="4" height="12" rx="1"/><rect x="9" y="2" width="4" height="12" rx="1"/></svg>`,
  replay: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8a4 4 0 1 1-1.5-3.1M10.5 2v3h-3"/></svg>`,
  spk:    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h3l3-3v10L5 10H2V6z"/><path d="M11 4.5a5 5 0 0 1 0 7"/></svg>`,
  mute:   `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h3l3-3v10L5 10H2V6z"/><path d="M12.5 5l-4 6M8.5 5l4 6"/></svg>`,
  gear:   `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="2.5"/><path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.75 3.75l1.06 1.06M11.19 11.19l1.06 1.06M12.25 3.75l-1.06 1.06M4.81 11.19l-1.06 1.06"/></svg>`,
  close:  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg>`,
  copy:   `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="8" height="9" rx="1.5"/><path d="M3 11V3a1 1 0 0 1 1-1h6"/></svg>`,
  check:  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,8 6.5,12 13,4"/></svg>`,
};

function _applyFontScale(scale) {
  document.documentElement.style.setProperty('--ai-msg-fs', (scale * 0.82 / 100).toFixed(3) + 'rem');
}

function _saveTtsSettings() {
  try {
    localStorage.setItem(_TTS_STORAGE_KEY, JSON.stringify({
      rate:     ttsRate,
      pitch:    ttsPitch,
      muted:    ttsMuted,
      title:    $('ai-chat-title')?.textContent || '專屬管家',
      fontSize: chatFontScale,
    }));
  } catch (_) {}
}

function _loadTtsSettings() {
  try {
    return JSON.parse(localStorage.getItem(_TTS_STORAGE_KEY) || '{}');
  } catch (_) { return {}; }
}

function _updateTtsMuteBtn() {
  if (!_ttsToggle) return;
  _ttsToggle.innerHTML = ttsMuted ? _SVG.mute : _SVG.spk;
  _ttsToggle.classList.toggle('tts-muted', ttsMuted);
}

function _setActBtn(btn, icon) {
  if (_ttsActBtn && _ttsActBtn !== btn) {
    _ttsActBtn.innerHTML = _SVG.play;
    _ttsActBtn.disabled  = false;
  }
  _ttsActBtn = btn;
  if (btn) { btn.innerHTML = icon; btn.disabled = false; }
  _updateTtsMuteBtn();
}

function stopSpeaking() {
  _ttsQueue.length = 0;          // 清除所有排隊的句子
  _ttsQueueActive  = false;
  if (_ttsAudio) { _ttsAudio.pause(); _ttsAudio = null; }
  _ttsState = 'idle';
  if (_ttsActBtn) { _ttsActBtn.innerHTML = _SVG.play; _ttsActBtn.disabled = false; }
  _ttsActBtn = null;
  _updateTtsMuteBtn();
}

// ── 串流分段 TTS：逐句取音檔並等待播完 ──
async function _fetchAndPlayQueued(text) {
  return new Promise(async (resolve) => {
    const processed = preprocessTtsText(text);
    if (!processed) return resolve();
    _ttsState = 'loading';
    try {
      const res = await fetch(TTS_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text: processed, rate: ttsRate, pitch: ttsPitch }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const url   = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      _ttsAudio   = audio;
      _ttsState   = 'playing';
      _updateTtsMuteBtn();
      audio.play().catch(e => console.warn('[TTS q play]', e));
      audio.onended = () => { URL.revokeObjectURL(url); _ttsAudio = null; _ttsState = 'idle'; resolve(); };
      audio.onerror = () => { URL.revokeObjectURL(url); _ttsAudio = null; _ttsState = 'idle'; resolve(); };
    } catch (err) {
      console.warn('[TTS queue]', err);
      _ttsAudio = null; _ttsState = 'idle'; resolve();
    }
  });
}

async function _processQueue() {
  if (_ttsQueueActive) return;
  _ttsQueueActive = true;
  while (_ttsQueue.length > 0) {
    if (ttsMuted) { _ttsQueue.length = 0; break; }   // 靜音時清空佇列
    const seg = _ttsQueue.shift();
    await _fetchAndPlayQueued(seg);
    if (!_ttsQueueActive) break;                      // stopSpeaking() 中途停止
  }
  _ttsQueueActive = false;
  _updateTtsMuteBtn();
}

function _handleMsgPlayBtn(text, btn) {
  if (_ttsActBtn === btn) {
    if (_ttsState === 'playing') {
      _ttsAudio.pause();
      _ttsState = 'paused';
      btn.innerHTML = _SVG.play;
    } else if (_ttsState === 'paused') {
      _ttsAudio.play().catch(e => console.warn('[TTS resume]', e));
      _ttsState = 'playing';
      btn.innerHTML = _SVG.pause;
    } else {
      _speakWithBtn(text, btn);
    }
  } else {
    _speakWithBtn(text, btn);
  }
}

function preprocessTtsText(text) {
  return text
    .replace(/\([^)]*\)/g, '')
    .replace(/（[^）]*）/g, '')
    .replace(/\*+/g, '')
    .replace(/#/g, '')
    .replace(/[\u{1F300}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FEFF}]/gu, '')
    .replace(/[喔耶啦]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function _speakWithBtn(text, btn) {
  stopSpeaking();
  const processed = preprocessTtsText(text);
  if (!processed) return;
  _ttsState  = 'loading';
  _ttsActBtn = btn;
  if (btn) { btn.innerHTML = _SVG.pause; btn.disabled = true; }
  _updateTtsMuteBtn();
  try {
    const res = await fetch(TTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: processed, rate: ttsRate, pitch: ttsPitch })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob  = await res.blob();
    const url   = URL.createObjectURL(blob);
    const audio = new Audio(url);
    _ttsAudio   = audio;
    _ttsState   = 'playing';
    if (btn) btn.disabled = false;
    _updateTtsMuteBtn();
    audio.play().catch(e => console.warn('[TTS play]', e));
    audio.onended = () => {
      URL.revokeObjectURL(url);
      _ttsAudio  = null;
      _ttsState  = 'idle';
      if (_ttsActBtn === btn) {
        if (btn) btn.innerHTML = _SVG.replay;
        _ttsActBtn = null;
      }
      _updateTtsMuteBtn();
    };
  } catch (err) {
    console.warn('[TTS]', err);
    _ttsAudio  = null;
    _ttsState  = 'idle';
    if (btn) { btn.innerHTML = _SVG.play; btn.disabled = false; }
    _ttsActBtn = null;
    _updateTtsMuteBtn();
  }
}

function _addMsgPlayBtn(msgDiv, text) {
  const actDiv = document.createElement('div');
  actDiv.className = 'ai-msg-actions';

  // ── 複製按鈕 ──
  const copyBtn = document.createElement('button');
  copyBtn.className = 'ai-icon-btn ai-msg-play-btn';
  copyBtn.innerHTML = _SVG.copy;
  copyBtn.title     = '複製此則訊息';
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(text).then(() => {
      copyBtn.innerHTML = _SVG.check;
      setTimeout(() => { copyBtn.innerHTML = _SVG.copy; }, 1500);
    }).catch(() => {});
  });

  // ── 播放按鈕 ──
  const btn = document.createElement('button');
  btn.className = 'ai-icon-btn ai-msg-play-btn';
  btn.innerHTML = _SVG.play;
  btn.title     = '朗讀此則訊息';
  btn.addEventListener('click', () => _handleMsgPlayBtn(text, btn));

  actDiv.appendChild(copyBtn);
  actDiv.appendChild(btn);
  msgDiv.appendChild(actDiv);
  return btn;
}

function initAiChat() {
  const panel      = $('ai-chat-panel');
  const closeBtn   = $('ai-chat-close');
  const messages   = $('ai-chat-messages');
  const input      = $('ai-chat-input');
  const sendBtn    = $('ai-chat-send');
  if (!panel || !messages || !input || !sendBtn) return;

  let aiHistory = [];
  let streaming  = false;

  // ── 載入並套用已儲存的設定 ──
  {
    const s = _loadTtsSettings();
    if (s.rate)  ttsRate  = s.rate;
    if (s.pitch) ttsPitch = s.pitch;
    if (typeof s.muted === 'boolean') ttsMuted = s.muted;
    if (s.fontSize) { chatFontScale = s.fontSize; _applyFontScale(chatFontScale); }
    if (s.title) {
      const t = $('ai-chat-title');
      if (t) t.textContent = s.title;
      const inp = $('ai-title-input');
      if (inp) inp.value = s.title;
    }
    // 同步滑桿顯示
    const rateSlider = $('tts-rate-slider');
    if (rateSlider) {
      const rv = parseInt(ttsRate);
      rateSlider.value = rv;
      const rl = $('tts-rate-label');
      if (rl) rl.textContent = ttsRate;
    }
    const pitchSlider = $('tts-pitch-slider');
    if (pitchSlider) {
      const pv = parseInt(ttsPitch);
      pitchSlider.value = pv;
      const pl = $('tts-pitch-label');
      if (pl) pl.textContent = ttsPitch;
    }
    const fsSlider = $('tts-font-slider');
    if (fsSlider) {
      fsSlider.value = chatFontScale;
      const fl = $('tts-font-label');
      if (fl) fl.textContent = chatFontScale + '%';
    }
  }

  closeBtn?.addEventListener('click', () => {
    stopSpeaking();
    aiHistory.length = 0;
    messages.innerHTML = '';
    panel.classList.add('ai-hidden');
  });

  _ttsToggle = $('ai-tts-toggle');
  _updateTtsMuteBtn();

  _ttsToggle?.addEventListener('click', () => {
    ttsMuted = !ttsMuted;
    _updateTtsMuteBtn();
    _saveTtsSettings();
  });

  $('ai-tts-settings-btn')?.addEventListener('click', () => {
    const sp = $('ai-tts-settings');
    if (!sp) return;
    sp.style.display = (sp.style.display === 'flex') ? 'none' : 'flex';
  });

  $('tts-rate-slider')?.addEventListener('input', e => {
    const v = parseInt(e.target.value);
    ttsRate = (v >= 0 ? '+' : '') + v + '%';
    const label = $('tts-rate-label');
    if (label) label.textContent = ttsRate;
    _saveTtsSettings();
  });

  $('tts-pitch-slider')?.addEventListener('input', e => {
    const v = parseInt(e.target.value);
    ttsPitch = (v >= 0 ? '+' : '') + v + 'Hz';
    const label = $('tts-pitch-label');
    if (label) label.textContent = ttsPitch;
    _saveTtsSettings();
  });

  $('tts-font-slider')?.addEventListener('input', e => {
    chatFontScale = parseInt(e.target.value);
    const label = $('tts-font-label');
    if (label) label.textContent = chatFontScale + '%';
    _applyFontScale(chatFontScale);
    _saveTtsSettings();
  });

  $('ai-title-input')?.addEventListener('input', e => {
    const t = $('ai-chat-title');
    if (t) t.textContent = e.target.value.trim() || '專屬管家';
    _saveTtsSettings();
  });



  function appendMsg(role, text) {
    const div = document.createElement('div');
    div.className = `ai-msg ${role}`;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  async function handleSend() {
    const text = input.value.trim();
    if (!text || streaming) return;

    appendMsg('user', text);
    aiHistory.push({ role: 'user', content: text });
    input.value = '';
    input.style.height = '40px';

    streaming = true;
    sendBtn.disabled = true;
    const replyBubble = appendMsg('assistant thinking', '⏳ 思考中...');

    try {
      const res = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model: OLLAMA_MODEL, messages: aiHistory, stream: true })
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      replyBubble.textContent = '';
      replyBubble.classList.remove('thinking');
      const reader  = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let fullReply     = '';
      let sentenceBuf   = '';                                   // 句子緩衝
      const SENT_RE     = /[。！？；…\n]/;                     // 句尾符號

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value, { stream: true }).split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            if (json.message?.content) {
              const chunk = json.message.content;
              fullReply   += chunk;
              replyBubble.textContent = fullReply;
              messages.scrollTop = messages.scrollHeight;

              // ── 句級 TTS 佇列 ──
              if (!ttsMuted) {
                sentenceBuf += chunk;
                if (SENT_RE.test(chunk)) {
                  const seg = sentenceBuf.trim();
                  if (seg) { _ttsQueue.push(seg); _processQueue(); }
                  sentenceBuf = '';
                }
              }
            }
          } catch (_) { /* 不完整的 chunk，略過 */ }
        }
      }

      // 沖出最後一段（無句尾標點的結尾）
      if (!ttsMuted && sentenceBuf.trim()) {
        _ttsQueue.push(sentenceBuf.trim());
        _processQueue();
      }

      if (fullReply) {
        aiHistory.push({ role: 'assistant', content: fullReply });
        _addMsgPlayBtn(replyBubble, fullReply);   // 僅加按鈕，串流已分段播放
      } else {
        replyBubble.textContent = '（無回應）';
      }

    } catch (err) {
      replyBubble.classList.remove('thinking');
      replyBubble.textContent = '❌ 連線錯誤：請確認 ZeroTier 已連線且 Ollama 正在運行。';
      console.error('[AI Chat]', err);
    } finally {
      streaming = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  sendBtn.addEventListener('click', handleSend);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });

  // 自動調整 textarea 高度
  input.addEventListener('input', () => {
    input.style.height = '40px';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
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
  // 向下相容：確保每個分頁都有 id（舊版資料可能沒有）
  S.mobilePages.forEach(p => { if (!p.id) p.id = uid(); });

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
            const delId = page.id;
            S.mobilePages.splice(idx, 1);
            if (S.mobilePageIdx >= S.mobilePages.length) S.mobilePageIdx = S.mobilePages.length - 1;
            if (delId) idbDel(PAGE_VID_KEY(delId)).catch(() => {}); // 釋放分頁影片儲存
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
        swipeArea.appendChild(panel); // 先掛載到 DOM
        // 只渲染當前可見的頁面，非 active 頁面留空殼節省 CPU/RAM
        if (idx === S.mobilePageIdx) {
          renderYoutubeWidget(inner, ytAddBtn, ytRefBtn);
          const mHead = inner.querySelector('.yt-mobile-head');
          if (mHead) mHead.style.display = 'none';
        }
        const dot = el('div', 'mobile-dot' + (idx === S.mobilePageIdx ? ' active' : ''));
        dot.title = idx === 0 ? '捷徑（不可刪除）' : '長按刪除';
        if (idx > 0) {
          let lpTimer = null;
          dot.addEventListener('touchstart', () => { lpTimer = setTimeout(() => { if (confirm(`刪除「${meta?.label || page.widget}」頁？`)) { S.mobilePages.splice(idx, 1); if (S.mobilePageIdx >= S.mobilePages.length) S.mobilePageIdx = S.mobilePages.length - 1; lsSave(); renderPages(); } }, 600); });
          dot.addEventListener('touchend', () => clearTimeout(lpTimer));
          dot.addEventListener('touchmove', () => clearTimeout(lpTimer));
        }
        dot.addEventListener('click', () => { S.mobilePageIdx = idx; renderPages(); });
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
        swipeArea.appendChild(panel); // 先掛載到 DOM
        if (idx === S.mobilePageIdx) {
          renderMobileNews(inner, newsSettingsBtn, newsLangBtn, newsRefBtn);
        }
        const dot = el('div', 'mobile-dot' + (idx === S.mobilePageIdx ? ' active' : ''));
        dot.title = idx === 0 ? '捷徑（不可刪除）' : '長按刪除';
        if (idx > 0) {
          let lpTimer = null;
          dot.addEventListener('touchstart', () => { lpTimer = setTimeout(() => { if (confirm(`刪除「${meta?.label || page.widget}」頁？`)) { S.mobilePages.splice(idx, 1); if (S.mobilePageIdx >= S.mobilePages.length) S.mobilePageIdx = S.mobilePages.length - 1; lsSave(); renderPages(); } }, 600); });
          dot.addEventListener('touchend', () => clearTimeout(lpTimer));
          dot.addEventListener('touchmove', () => clearTimeout(lpTimer));
        }
        dot.addEventListener('click', () => { S.mobilePageIdx = idx; renderPages(); });
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
        if (idx === S.mobilePageIdx) {
          renderAnimeWidget(inner, animeCfgBtn);
        }
        const dot = el('div', 'mobile-dot' + (idx === S.mobilePageIdx ? ' active' : ''));
        dot.title = idx === 0 ? '捷徑（不可刪除）' : '長按刪除';
        if (idx > 0) {
          let lpTimer = null;
          dot.addEventListener('touchstart', () => { lpTimer = setTimeout(() => { if (confirm(`刪除「${meta?.label || page.widget}」頁？`)) { S.mobilePages.splice(idx, 1); if (S.mobilePageIdx >= S.mobilePages.length) S.mobilePageIdx = S.mobilePages.length - 1; lsSave(); renderPages(); } }, 600); });
          dot.addEventListener('touchend', () => clearTimeout(lpTimer));
          dot.addEventListener('touchmove', () => clearTimeout(lpTimer));
        }
        dot.addEventListener('click', () => { S.mobilePageIdx = idx; renderPages(); });
        dotsBar.appendChild(dot);
        return;
      }

      // Widget content
      panel.appendChild(panelHead);
      swipeArea.appendChild(panel); // 先掛載到 DOM，確保 container.closest('#mobile-layout') 能正確偵測
      if (idx === S.mobilePageIdx) {
        buildMobileWidgetContent(page.widget, panel);
      }

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
        const dir = idx > S.mobilePageIdx ? 'left' : 'right';
        S.mobilePageIdx = idx;
        _vtRenderPages(renderPages, dir);
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
      document.querySelectorAll('.mobile-panel-btns').forEach(b => b.classList.remove('hidden'));
      addBtn.classList.remove('hidden');
      // 【修復】切頁後重新附加發光邊框 overlay，確保每個 panel 都有
      document.querySelectorAll('.mobile-page-panel').forEach(p => {
        p.classList.add('mobile-editing');
        if (!p.querySelector('.mobile-edit-overlay')) {
          const ov = document.createElement('div');
          ov.className = 'mobile-edit-overlay';
          p.appendChild(ov);
        }
      });
    }

    // Scroll active page into view
    const activePanels = swipeArea.querySelectorAll('.mobile-page-panel');
    if (activePanels[S.mobilePageIdx]) {
      activePanels[S.mobilePageIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
    }

    // 切換背景影片至當前分頁的設定
    const activePage = S.mobilePages[S.mobilePageIdx];
    if (activePage?.id) switchPageVideo(activePage.id);
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
    const dir = dx < 0 ? 'left' : 'right';
    if (dx < 0) S.mobilePageIdx = (S.mobilePageIdx + 1) % n;
    else        S.mobilePageIdx = (S.mobilePageIdx - 1 + n) % n;
    _vtRenderPages(renderPages, dir);
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

  // ── 分頁獨立背景設定（置頂，優先於小工具選項）──
  const page   = S.mobilePages[pageIdx];
  if (!page.id) { page.id = uid(); lsSave(); }
  const pageId = page.id;

  const bgSetItem = el('div', 'mobile-picker-item');
  bgSetItem.style.cssText = 'border-bottom:1px solid rgba(255,255,255,0.12);margin-bottom:10px;padding-bottom:12px;';
  bgSetItem.innerHTML = `<span class="awp-icon">🖼</span><span>為此分頁設定獨立背景（圖片或影片）</span>`;
  bgSetItem.addEventListener('click', () => {
    const fi = document.createElement('input');
    fi.type = 'file'; fi.accept = 'image/*,video/mp4,video/webm,video/*';
    fi.addEventListener('change', async () => {
      const file = fi.files[0];
      if (!file) return;
      try {
        // 儲存類型 hint（防止 IDB 遺失 MIME type）
        try { localStorage.setItem('_bgPageIsImg_' + pageId, _isImgBlob(file) ? '1' : '0'); } catch(_) {}
        await idbSet(PAGE_VID_KEY(pageId), file);
        // 若目前正在這個分頁，立即套用
        if (S.mobilePages[S.mobilePageIdx]?.id === pageId) {
          _pvGen++;
          if (pageVideoBlobUrl) { URL.revokeObjectURL(pageVideoBlobUrl); pageVideoBlobUrl = null; }
          pageVideoBlobUrl = URL.createObjectURL(file);
          _applyBgBlob(file, pageVideoBlobUrl);
        }
        toast(_isImgBlob(file) ? '分頁背景圖片已設定 ✓' : '分頁背景影片已設定 ✓');
      } catch (_) { toast('設定失敗', 'err'); }
    });
    fi.click();
  });
  list.appendChild(bgSetItem);

  // 非同步確認是否已設定過（若有則顯示移除按鈕）
  idbGet(PAGE_VID_KEY(pageId)).then(blob => {
    if (!blob) return;
    const bgRmItem = el('div', 'mobile-picker-item');
    bgRmItem.style.cssText = 'border-bottom:1px solid rgba(255,255,255,0.12);margin-bottom:10px;padding-bottom:12px;color:rgba(255,120,120,0.9);';
    bgRmItem.innerHTML = `<span class="awp-icon">🗑</span><span>移除此分頁獨立背景</span>`;
    bgRmItem.addEventListener('click', async () => {
      await idbDel(PAGE_VID_KEY(pageId)).catch(() => {});
      if (S.mobilePages[S.mobilePageIdx]?.id === pageId) switchPageVideo(pageId);
      toast('已移除分頁背景');
      document.body.removeChild(overlay);
    });
    // 插在 bgSetItem 之後，小工具列表之前
    list.insertBefore(bgRmItem, bgSetItem.nextSibling);
  });

  // ── 小工具選項 ──
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
  await checkShareTarget().catch(()=>{});
  cloudGalleryPull().catch(() => {});

  // Build widgets (only if visible, undefined counts as visible)
  if (S.widgets.clock?.visible     !== false) buildClockWidget();
  if (S.widgets.shortcuts?.visible !== false) buildShortcutsWidget();
  if (S.widgets.news?.visible      !== false) buildNewsWidget();
  if (S.widgets.stickies?.visible  === true)  buildStickiesWidget();
  if (S.widgets.anime?.visible     === true)  buildAnimeWidget();
  if (S.widgets.youtube?.visible   === true)  buildYoutubeWidget();
  if (S.widgets.gallery?.visible   === true)  buildGalleryDesktopWidget();
  initMobileLayout();

  // Search + voice
  initSearch();
  initLockBtn();
  initWeather();
  initOmniSearch();
  initOmniFab();
  $('rtc-btn')?.addEventListener('click', openWebRTCModal);

  // Context menu
  initCtx();

  // Buttons
  $('edit-btn').addEventListener('click', () => setEditMode(!S.editMode));
  $('sync-btn').addEventListener('click', async () => {
    await Promise.all([ gistPush(), cloudGalleryPush() ]);
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
      const [ok] = await Promise.all([ gistPull(), cloudGalleryPull() ]);
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
    let lat, lon, city = '';
    try {
      // 第一優先：瀏覽器 GPS / 網路定位
      const pos = await geoLocate();
      lat = pos.lat; lon = pos.lon;
      city = await reverseGeocode(lat, lon);
    } catch(e) {
      // 後備：IP 定位（不需任何權限，Firefox / 任何瀏覽器皆可用）
      try {
        statusEl.textContent = '瀏覽器定位失敗，改用 IP 定位…';
        const r = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(8000) });
        const d = await r.json();
        if (!d.latitude) throw new Error('no data');
        lat = d.latitude; lon = d.longitude;
        city = d.city || d.region || '';
      } catch(_) {
        statusEl.textContent = typeof e === 'string' ? e : '定位失敗，請手動輸入城市';
        return;
      }
    }
    S.cfg.weatherLat = lat;
    S.cfg.weatherLon = lon;
    $('cfg-city').value = city;
    statusEl.textContent = `✓ ${city}`;
    lsSave();
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

  // AI Chat
  initAiChat();

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
  // 隱藏全部 Widget 按鈕（三段式：全顯 → 只留時鐘 → 全收 → 全顯）
  const hideAllBtn = document.getElementById('hide-all-btn');
  if (hideAllBtn) {
    const HIDE_KEY = 'neocast_widgets_hide_state'; // 0=全顯 1=僅時鐘 2=全收
    // 各狀態的圖示 SVG 內容
    const STATE_ICONS = [
      '<polyline points="4 15 12 7 20 15"/>',              // 0→上箭頭（可收起）
      '<line x1="4" y1="12" x2="20" y2="12"/>',           // 1→橫線（再收時鐘）
      '<polyline points="4 9 12 17 20 9"/>',               // 2→下箭頭（可展開）
    ];
    const STATE_TITLES = [
      '收起所有 Widget（保留時鐘）',
      '收起時鐘',
      '展開所有 Widget',
    ];
    const applyState = (state) => {
      // ── 第一段（僅時鐘）：JS 直接操控 inline style，完全繞過 CSS 優先權問題 ──
      document.body.classList.remove('widgets-clock-only');
      document.body.classList.toggle('widgets-hidden', state === 2);

      const ml = document.getElementById('mobile-layout');
      if (state === 1) {
        // 只對非 clock 的桌機 widget 設 display:none，完全不碰 clock
        document.querySelectorAll('#wc > .widget').forEach(w => {
          if (w.dataset.wid !== 'clock') {
            w.style.setProperty('display', 'none', 'important');
          }
        });
        // 手機版：保留 #mobile-layout（含時鐘），只收起換頁區與點點列
        if (ml) {
          ml.querySelector('.mobile-swipe-area')?.style.setProperty('display', 'none', 'important');
          ml.querySelector('.mobile-dots-bar')?.style.setProperty('display', 'none', 'important');
        }
      } else {
        // 恢復所有桌機 widget 的 inline display
        document.querySelectorAll('#wc > .widget').forEach(w => {
          w.style.removeProperty('display');
        });
        // 手機版：恢復換頁區與點點列
        if (ml) {
          ml.querySelector('.mobile-swipe-area')?.style.removeProperty('display');
          ml.querySelector('.mobile-dots-bar')?.style.removeProperty('display');
        }
      }

      const icon = document.getElementById('hide-all-icon');
      if (icon) icon.innerHTML = STATE_ICONS[state];
      hideAllBtn.title = STATE_TITLES[state];
      localStorage.setItem(HIDE_KEY, String(state));
      // 重新計算桌機 widget 尺寸（scrollbar 出現/消失會改變 #wc.clientWidth）
      requestAnimationFrame(() => onResize());
    };
    hideAllBtn.addEventListener('click', () => {
      const cur = parseInt(localStorage.getItem(HIDE_KEY) || '0', 10);
      applyState((cur + 1) % 3);
    });
    // 還原上次狀態
    const saved = parseInt(localStorage.getItem(HIDE_KEY) || '0', 10);
    if (saved > 0) applyState(saved);
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
