// Changelog:
// - v2.0.3: update audio hotkey, auto-focus typing input on keypress.
const VERSION = "2.0.3";
const CACHE_NAME = `kats-date-game-cache-v${VERSION}`;
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./Audio/base/manifest.json",
  "./date_game_data.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];
const ASSET_URLS = ASSETS.map((asset) => new URL(asset, self.location).href);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS.map((asset) => new Request(asset, {cache: "reload"})));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  event.respondWith((async () => {
    if(event.request.method !== "GET"){
      return fetch(event.request);
    }

    const cache = await caches.open(CACHE_NAME);
    const isNavigation = event.request.mode === "navigate";
    const isAsset = ASSET_URLS.includes(event.request.url) || isNavigation;

    if(isAsset){
      try{
        const freshRequest = new Request(event.request, {cache: "reload"});
        const res = await fetch(freshRequest);
        cache.put(event.request, res.clone());
        return res;
      }catch(e){
        const cached = await cache.match(event.request);
        if(cached) return cached;
        if(isNavigation){
          const fallback = await cache.match("./index.html");
          if(fallback) return fallback;
        }
        return new Response("Offline", {status: 200, headers: {"Content-Type":"text/plain"}});
      }
    }

    const cached = await cache.match(event.request);
    if(cached) return cached;
    try{
      const res = await fetch(event.request);
      cache.put(event.request, res.clone());
      return res;
    }catch(e){
      return cached || new Response("Offline", {status: 200, headers: {"Content-Type":"text/plain"}});
    }
  })());
});
