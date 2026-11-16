// オフライン対応: アプリのファイルを保存しておき、保存済みのものを先に返す。
// 通信できるときは裏で最新版を取得し、次回の起動から反映される。
const CACHE = 'ba-viewer-v1';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/db.js',
  'js/ui.js',
  'js/images.js',
  'js/slider.js',
  'js/viewer.js',
  'js/library.js',
  'js/backup.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req)
      .then(res => { if (res.ok) cache.put(req, res.clone()); return res; })
      .catch(() => null);
    if (cached) { e.waitUntil(fresh); return cached; }
    return (await fresh) || new Response('オフラインです', { status: 503 });
  })());
});
