/* 求是申论素材库 · Service Worker（离线 + 秒开） */
const CACHE = "shenlun-v1";

self.addEventListener("install", function(e){
  self.skipWaiting();
});

self.addEventListener("activate", function(e){
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", function(e){
  var req = e.request;
  if(req.method !== "GET") return;
  if(req.url.indexOf("api.github.com") >= 0) return; // 同步请求不走缓存
  e.respondWith((async function(){
    var cache = await caches.open(CACHE);
    try{
      var net = await fetch(req);
      if(req.mode === "navigate" || req.url.startsWith(self.location.origin)){
        cache.put(req, net.clone());
      }
      return net;
    }catch(_){
      var cached = await cache.match(req);
      if(cached) return cached;
      if(req.mode === "navigate"){
        var idx = await cache.match("./");
        if(idx) return idx;
      }
      return new Response("离线不可用，请先联网打开一次。", { status: 503 });
    }
  })());
});
