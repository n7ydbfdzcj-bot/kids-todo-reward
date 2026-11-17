/* 오프라인에서도 앱이 열리도록 화면 파일을 기기에 저장해 둡니다.
   파일을 고친 뒤에는 아래 버전 이름을 바꾸면 새 파일로 바뀝니다. */
var CACHE_NAME = 'kids-todo-reward-v4';
var ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon.svg',
  './chiikawa-bg.gif',
  './chiikawa-bg-still.jpg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  // 브라우저의 임시 보관(cache: 'reload')을 건너뛰고 새 파일을 받아 와야
  // 방금 바꿔 올린 배경이 예전 파일로 되살아나지 않아요.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) {
        return Promise.all(ASSETS.map(function (url) {
          var request;
          try { request = new Request(url, { cache: 'reload' }); }
          catch (e) { request = url; }
          return fetch(request).then(function (res) {
            if (res && res.ok) { return cache.put(url, res); }
          }).catch(function () { /* 한 파일이 실패해도 나머지는 저장 */ });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') { return; }
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) { return; }

  event.respondWith(
    caches.match(req).then(function (cached) {
      var fresh = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () { return cached; });
      return cached || fresh;
    })
  );
});
