/* =====================================================================
   第21批·方案 C 客户端桥接 (_b21_sync.js)
   作用：让「存档同步」页面支持家里同 WiFi 的实时共用一份记录。
   原理（不改动任何既有 20 个模块）：
     - 页面加载时探测 /api/store.json（局域网服务器）
     - 命中则进入「服务器模式」：把服务器共享存档合并进本机 localStorage，
       之后每 4 秒若本机有变化就防抖推回服务器（合并，不覆盖）
     - 每 9 秒自动拉取一次服务器最新记录（自动拉取）：
         · 正在作答 / 光标在输入框里 → 本轮跳过，绝不打断
         · 拉到新内容 → 右下角提示，并安全重绘当前页面
     - 未命中（file:// 或不在同一 WiFi）则静默禁用，一切照旧
   合并规则与 _b21.js 一致：答案按 pid#qno+ts 取新，其余键本机优先。
   依赖：window.renderArchive / window.b21RenderSync（_b21.js 提供）
        window.__render（主站提供，用于安全重绘）
   ===================================================================== */
(function(){
  "use strict";

  const SERVER = "/api/store.json";
  const ANS_KEY = "shenlun_answers_v2";
  const GRADE_KEY = "xiaoti_grade_v1";   // _b25 小题批改记录（数组，按 pid#pno + ts 合并）
  const PUSH_MS = 4000;    // 本机有改动 → 推给服务器
  const PULL_MS = 9000;    // 定时拉取服务器新记录
  let enabled = false, lastSync = "", lastHash = "";

  function snapshot(){
    const o = {};
    try{
      for(let i=0;i<localStorage.length;i++){
        const k = localStorage.key(i);
        if(k!=null){ try{ o[k] = localStorage.getItem(k); }catch(_){} }
      }
    }catch(e){}
    return o;
  }
  function hashOf(o){
    try{
      const keys = Object.keys(o).sort();
      return keys.map(k=>k+":"+(o[k]||"").length).join("|");
    }catch(_){ return ""; }
  }
  // 把 imp 合并进 target（target 优先，不删本机键）
  function mergeInto(target, imp){
    const merged = {};
    for(const k in target){ merged[k] = target[k]; }
    const impKeys = (imp && imp.keys) || {};
    for(const k in impKeys){
      if(!(k in merged)){ merged[k] = impKeys[k]; continue; }
      if(k === ANS_KEY){
        try{
          const t = JSON.parse(merged[k]||"{}");
          const s = JSON.parse(impKeys[k]||"{}");
          for(const rk in s){
            if(!(rk in t)){ t[rk] = s[rk]; }
            else{
              const tt = (t[rk] && t[rk].ts) || 0;
              const st = (s[rk] && s[rk].ts) || 0;
              if(st > tt){ t[rk] = s[rk]; }
            }
          }
          merged[k] = JSON.stringify(t);
        }catch(_){}
        continue;
      }
      if(k === GRADE_KEY){
        try{
          const tgt = JSON.parse(merged[k]||"[]");
          const src = JSON.parse(impKeys[k]||"[]");
          const map = {};
          tgt.forEach(function(r){ if(r && r.pid!=null) map[r.pid+"#"+(r.pno!=null?r.pno:"")] = r; });
          src.forEach(function(r){
            if(!r || r.pid==null) return;
            const key = r.pid+"#"+(r.pno!=null?r.pno:"");
            const cur = map[key];
            const rt = r.ts||0, ct = cur ? (cur.ts||0) : 0;
            if(!cur){ map[key] = r; }
            else if(rt > ct){ map[key] = r; }
          });
          merged[k] = JSON.stringify(Object.keys(map).map(function(kk){ return map[kk]; }));
        }catch(_){}
        continue;
      }
      // 其余键本机优先，不覆盖
    }
    return merged;
  }
  function applyMerged(m){
    for(const k in m){ try{ localStorage.setItem(k, m[k]); }catch(_){} }
  }
  function setStatus(){
    if(window.__shenlunSync){ window.__shenlunSync.status = enabled ? "on" : "off"; window.__shenlunSync.lastSync = lastSync; }
    if(typeof window.b21RenderSync === "function"){ try{ window.b21RenderSync(); }catch(_){} }
  }

  /* 正在动笔就别打扰：作答弹窗开着、或光标停在任何输入框里 */
  function busy(){
    try{
      if(document.getElementById("ansText")) return true;
      const a = document.activeElement;
      if(a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT" || a.isContentEditable)) return true;
    }catch(_){}
    return false;
  }

  function toast(msg){
    try{
      let t = document.getElementById("b21SyncToast");
      if(!t){
        t = document.createElement("div");
        t.id = "b21SyncToast";
        t.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:99999;background:#1f2937;color:#fff;"
                        + "padding:10px 14px;border-radius:8px;font-size:13px;line-height:1.5;"
                        + "box-shadow:0 6px 18px rgba(0,0,0,.18);opacity:0;transition:opacity .25s;pointer-events:none;";
        document.body.appendChild(t);
      }
      t.textContent = msg;
      t.style.opacity = "1";
      if(t.__tm) clearTimeout(t.__tm);
      t.__tm = setTimeout(function(){ t.style.opacity = "0"; }, 3200);
    }catch(_){}
  }

  async function pull(opt){
    opt = opt || {};
    try{
      const r = await fetch(SERVER, {cache:"no-store"});
      if(!r.ok) return false;
      const imp = await r.json();
      const before = hashOf(snapshot());
      const merged = mergeInto(snapshot(), imp);
      applyMerged(merged);
      const after = hashOf(snapshot());
      lastSync = new Date().toLocaleString();
      setStatus();
      const changed = (before !== after);
      if(changed && opt.notify){
        toast("已同步到其他设备的新记录");
        if(!busy() && typeof window.__render === "function"){
          try{ window.__render(); }catch(_){}
        }
      }
      return changed;
    }catch(e){ return false; }
  }

  async function push(){
    try{
      const cur = snapshot();
      const h = hashOf(cur);
      if(h === lastHash) return;          // 未变化不推
      const r = await fetch(SERVER, {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({_app:"求是申论素材库", keys:cur})});
      if(r.ok){ lastHash = h; lastSync = new Date().toLocaleString(); setStatus(); }
    }catch(e){}
  }

  (async function init(){
    try{
      const r = await fetch(SERVER, {cache:"no-store"});
      if(!r.ok) return;
      enabled = true;
      window.__shenlunSync = { status:"on", lastSync:"", url: location.origin, pull:pull, push:push };
      await pull();          // 首次加载：把服务器共享记录合并进本机
      await push();          // 再把本机独有记录推上去，双向补齐
      setStatus();
      setInterval(function(){ if(enabled) push(); }, PUSH_MS);                       // 防抖回写
      setInterval(async function(){                                                  // 自动拉取
        if(!enabled || busy()) return;
        if(document.hidden) return;      // 页面在后台不折腾
        await pull({notify:true});
        await push();
      }, PULL_MS);
      // 从后台切回前台立刻拉一次，省得等
      document.addEventListener("visibilitychange", function(){
        if(!document.hidden && enabled && !busy()) pull({notify:true});
      });
    }catch(e){ /* file:// 或未启动服务器：静默禁用 */ }
  })();

})();
