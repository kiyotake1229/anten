/* 暗転 Service Worker
 * - index.html（アプリ本体）: ネット優先。取れたらキャッシュを新しくし、オフラインや4秒待っても返事が無いときはキャッシュを出す
 *   → index.html を直して公開すれば次に開いたときに届く（このファイルの版を上げなくてよい）
 * - manifest.json・アイコン: キャッシュ優先。一覧（PRECACHE）を変えたときは VERSION を上げる
 * - 古い版のキャッシュは activate で消す。消すのは名前が「anten-」で始まるものだけ（github.io はほかのアプリと同じドメイン）
 * - ほかのアプリに消されても、ネットにつながった状態で開けば無くなった分だけ取り直す（refill）
 * 登録は index.html の最後の小さなスクリプトが行う（iOS アプリの中・Claude Artifact・localhost では登録しない）
 */
'use strict';
const VERSION = 'v1';
const PREFIX = 'anten-';
const CACHE = PREFIX + 'app-' + VERSION;
const PAGE_TIMEOUT = 4000;
const PRECACHE = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './icon-512-maskable.png', './apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith(PREFIX) && n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

const isPage = (url) => url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');

async function refill(cache) {
  try {
    for (const u of PRECACHE) {
      if (!(await cache.match(u))) { const res = await fetch(new Request(u, { cache: 'reload' })); if (res.ok) await cache.put(u, res); }
    }
  } catch (e) { /* オフラインなら次回 */ }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (isPage(url)) {
      // ネット優先（4秒まで待つ）。だめならキャッシュ
      try {
        const res = await Promise.race([
          fetch(req),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), PAGE_TIMEOUT)),
        ]);
        if (res && res.ok) { cache.put(req, res.clone()); refill(cache); return res; }
        throw new Error('bad response');
      } catch (e) {
        const hit = (await cache.match(req)) || (await cache.match('./index.html'));
        if (hit) return hit;
        throw e;
      }
    }
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  })());
});
