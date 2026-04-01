/* NeoCast Service Worker */
const CACHE = 'neocast-v461';
const SHELL = ['./', './index.html', './style.css', './app.js', './manifest.json', './icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* ── Web Share Target：IDB 輔助（與 app.js 共用同一個 DB/store） ── */
function _swIdbOpen() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('neocast', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('blobs');
    req.onsuccess = e => res(e.target.result);
    req.onerror   = rej;
  });
}
async function _swIdbSet(key, val) {
  const db = await _swIdbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction('blobs', 'readwrite');
    tx.objectStore('blobs').put(val, key);
    tx.oncomplete = res;
    tx.onerror    = rej;
  });
}

/* ── Share Target 主處理 ── */
async function handleShareTarget(request) {
  try {
    const fd    = await request.formData();
    const title = fd.get('title') || '';
    const text  = fd.get('text')  || '';
    const url   = fd.get('url')   || '';
    const file  = fd.get('media');          // File object 或 null
    await _swIdbSet('_share_pending', {
      title,
      text,
      url,
      blob:     file   || null,
      fileType: file?.type || null,
    });
  } catch (err) {
    console.error('[SW] share-target error', err);
  }
  // 重導回 app，帶 ?share=1 觸發 app 讀取
  return Response.redirect('./?share=1', 303);
}

self.addEventListener('fetch', e => {
  if (e.request.url.includes('chrome-extension')) return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // ── 攔截 Share Target POST ──
  if (url.searchParams.has('share-target') && e.request.method === 'POST') {
    e.respondWith(handleShareTarget(e.request));
    return;
  }

  // Always fetch sw.js fresh, no cache
  if (url.pathname.endsWith('sw.js')) {
    e.respondWith(fetch(e.request, { cache: 'no-store' }));
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
