/* =====================================================================
   第26批：平板 / iPad 适配 · 底部 Tab 栏 + 「更多」抽屉 + PWA 安装提示
   纯前端、零依赖；仅在窄屏(<=900px)激活，桌面维持原侧栏。
   复用全局 state / render() / SCOPES；用 MutationObserver 监听 #content 更新高亮。
   ===================================================================== */
(function(){
  "use strict";

  var PRIMARY = [
    { s:"真题库",   i:"📚" },
    { s:"小题批改", i:"✍️" },
    { s:"省考库",   i:"🗺️" },
    { s:"我的学情", i:"📊" },
    { s:"更多",     i:"☰" }
  ];

  function isNarrow(){ try{ return window.matchMedia("(max-width:900px)").matches; }catch(_){ return false; } }

  function build(){
    if(!isNarrow()) return;

    // 底部 Tab 栏
    var bar = document.createElement("div");
    bar.id = "tabbar";
    PRIMARY.forEach(function(t){
      var el = document.createElement("div");
      el.className = "tab"; el.dataset.scope = t.s;
      el.innerHTML = '<span class="ti">' + t.i + '</span><span>' + t.s + '</span>';
      el.onclick = function(){
        if(t.s === "更多"){ openSheet(); return; }
        goScope(t.s);
      };
      bar.appendChild(el);
    });
    document.body.appendChild(bar);

    // 抽屉
    var mask = document.createElement("div"); mask.id = "sheetMask";
    mask.onclick = closeSheet;
    var panel = document.createElement("div"); panel.id = "sheetPanel";
    var grid = '<div class="sheet-hd"><span>全部模块</span><span class="x" onclick="__b26Close()">✕</span></div>';
    grid += '<div id="sheetGrid">';
    var list = (typeof SCOPES !== "undefined" ? SCOPES : []);
    list.forEach(function(s){
      grid += '<div class="si" data-scope="'+esc(s)+'">'+esc(s)+'</div>';
    });
    grid += '</div>';
    panel.innerHTML = grid;
    panel.querySelectorAll(".si").forEach(function(it){
      it.onclick = function(){ goScope(it.dataset.scope); closeSheet(); };
    });
    document.body.appendChild(mask);
    document.body.appendChild(panel);

    // PWA 安装提示容器
    if(!document.getElementById("pwaTip")){
      var tip = document.createElement("div"); tip.id = "pwaTip";
      document.body.appendChild(tip);
    }

    // 高亮跟随渲染
    var content = document.getElementById("content");
    if(content){
      var mo = new MutationObserver(function(){ updateHL(); });
      mo.observe(content, { childList:true, subtree:true });
    }
    updateHL();
    setupPWA();
  }

  function goScope(s){
    try{
      if(typeof state !== "undefined"){ state.scope = s; state.theme=""; state.paper=""; state.srcTheme=""; state.year="全部"; state.prov=""; state.limit=120; }
    }catch(_){}
    try{ if(typeof render === "function") render(); else if(typeof window.render === "function") window.render(); }catch(_){}
    updateHL();
    if(window.scrollTo) window.scrollTo(0,0);
  }

  function curScope(){
    try{ if(typeof state !== "undefined" && state && state.scope) return state.scope; }catch(_){}
    return "";
  }

  function updateHL(){
    var cur = curScope();
    document.querySelectorAll("#tabbar .tab").forEach(function(el){
      var s = el.dataset.scope;
      el.classList.toggle("on", s === cur);
    });
    document.querySelectorAll("#sheetGrid .si").forEach(function(el){
      el.classList.toggle("on", el.dataset.scope === cur);
    });
  }

  function openSheet(){ var m=document.getElementById("sheetMask"), p=document.getElementById("sheetPanel"); if(m)m.classList.add("on"); if(p)p.classList.add("on"); updateHL(); }
  function closeSheet(){ var m=document.getElementById("sheetMask"), p=document.getElementById("sheetPanel"); if(m)m.classList.remove("on"); if(p)p.classList.remove("on"); }
  window.__b26Close = closeSheet;

  function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }

  /* ---------------- PWA 安装提示 ---------------- */
  function setupPWA(){
    var deferred = null;
    window.addEventListener("beforeinstallprompt", function(e){
      e.preventDefault(); deferred = e; showTip();
    });
    function showTip(){
      var tip = document.getElementById("pwaTip"); if(!tip) return;
      if(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return;
      tip.innerHTML = '📲 可安装到主屏，像 App 一样用 <b>去安装</b>';
      var b = tip.querySelector("b");
      if(b) b.onclick = function(){
        tip.classList.remove("on");
        if(deferred){ deferred.prompt(); deferred.userChoice.then(function(){ deferred=null; }); }
      };
      tip.classList.add("on");
    }
    // iOS：无 beforeinstallprompt，给手动指引（已装则不提示）
    var ua = navigator.userAgent || "";
    var ios = /iPhone|iPad|iPod/.test(ua);
    var standalone = (window.navigator && window.navigator.standalone) ||
                     (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
    if(ios && !standalone){
      setTimeout(function(){
        var tip = document.getElementById("pwaTip"); if(!tip) return;
        tip.innerHTML = '📲 加到主屏：点「分享」→「添加到主屏幕」 <b style="text-decoration:none;opacity:.8">✕</b>';
        var x = tip.querySelector("b");
        if(x) x.onclick = function(){ tip.classList.remove("on"); };
        tip.classList.add("on");
      }, 1800);
    }
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
