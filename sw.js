// Ember - オフライン用サービスワーカー
// ネットワーク優先で毎回キャッシュを上書きするため、更新のたびに版数を上げる必要はない。
// キャッシュを丸ごと捨てたいとき（ASSETS の URL を変えた、壊れた応答が残った等）だけ上げる
const CACHE = 'ember-v1';
const ASSETS = ['./', './index.html', './manifest.json', './assets/icon-192.png', './assets/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ネットワーク優先。失敗したらキャッシュ（機内でも起動できる）
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
