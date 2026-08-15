/* 求是申论素材库 · Service Worker（缓存优先 + 离线秒开） */
const CACHE = "shenlun-v2";   // 版本升级：v1 -> v2（旧的 stale 缓存会被清理）
const SW_JS = "sw.js";        // 自己不缓存，保证逻辑更新即时生效

self.addEventListener("install", function(e){
  self.skipWaiting();
});

self.addEventListener("activate", function(e){
  // 清理 v1 等旧缓存，避免体积堆积
  e.waitUntil((async function(){
    var keys = await caches.keys();
    await Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", function(e){
  var req = e.request;
  if(req.method !== "GET") return;
  // 同步请求（GitHub API）与 service worker 自身：直连，不缓存
  if(req.url.indexOf("api.github.com") >= 0) return;
  if(req.url.indexOf("/" + SW_JS) >= 0 && req.url.indexOf(SW_JS) >= 0) return;

  e.respondWith((async function(){
    var cache = await caches.open(CACHE);
    // 缓存优先：有就秒返回，后台悄悄更新
    var cached = await cache.match(req);
    var fetchPromise = (async function(){
      try{
        var net = await fetch(req);
        if(req.mode === "navigate" || req.url.startsWith(self.location.origin)){
          cache.put(req, net.clone());
        }
        return net;
      }catch(_){
        return null;
      }
    })();

    if(cached){
      // 后台刷新，下次更准；这次直接返回缓存，iPad 秒开
      fetchPromise.catch(function(){});
      return cached;
    }
    // 没缓存（首次）：等网络，拿到即存
    var net = await fetchPromise;
    if(net) return net;
    if(req.mode === "navigate"){
      var idx = await cache.match("./");
      if(idx) return idx;
    }
    return new Response("离线不可用，请先联网打开一次。", { status: 503 });
  })());
});
