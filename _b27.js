/* =====================================================================
   第27批：GitHub 同步（跨网络 · 用你已有 token · 无需本地服务器）
   - 把本机 localStorage 全部记录推/拉到「你自己的 GitHub 私有仓库」的 store.json
   - GitHub API 支持浏览器跨域，iPad / 电脑任意网络都能同步，数据只归你
   - 合并逻辑复用 _b21（含 xiaoti_grade_v1 数组合并），只增不删
   - 依赖 window.esc；可选 window.__b21.mergeInto
   ===================================================================== */
(function(){
  "use strict";

  var API = "https://api.github.com";
  var CFG_KEY = "shenlun_gh_cfg_v1";
  var GRADE_KEY = "xiaoti_grade_v1";
  var ANS_KEY = "shenlun_answers_v2";

  function esc(s){ var f = (typeof window!=="undefined" && typeof window.esc==="function")?window.esc:null; return f?f(s):String(s==null?"":s); }
  function $(id){ return document.getElementById(id); }
  function b64(s){ try{ return btoa(unescape(encodeURIComponent(s))); }catch(_){ return ""; } }
  function ub64(s){ try{ return decodeURIComponent(escape(atob(s))); }catch(_){ return ""; } }

  function loadCfg(){ try{ return JSON.parse(localStorage.getItem(CFG_KEY)||"{}"); }catch(_){ return {}; } }
  function saveCfg(c){ try{ localStorage.setItem(CFG_KEY, JSON.stringify(c)); }catch(_){} }

  function snapshot(){
    var o = {};
    try{ for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k!=null){ try{ o[k]=localStorage.getItem(k); }catch(_){} } } }catch(_){}
    return o;
  }
  function applyMerged(m){ for(var k in m){ try{ localStorage.setItem(k, m[k]); }catch(_){} } }

  // 合并：答案/批改记录按 id+ts 取新，其余键本机优先
  function mergeInto(imp){
    var target = snapshot(); var merged = {};
    for(var k in target){ merged[k] = target[k]; }
    var impKeys = (imp && imp.keys) || {};
    for(var k2 in impKeys){
      if(!(k2 in merged)){ merged[k2] = impKeys[k2]; continue; }
      if(k2 === ANS_KEY || k2 === GRADE_KEY){
        try{
          var tgt = JSON.parse(merged[k2]||(k2===ANS_KEY?"{}":"[]"));
          var src = JSON.parse(impKeys[k2]||(k2===ANS_KEY?"{}":"[]"));
          if(k2 === ANS_KEY){
            for(var rk in src){ if(!(rk in tgt)) tgt[rk]=src[rk]; else { var tt=(tgt[rk]&&tgt[rk].ts)||0, st=(src[rk]&&src[rk].ts)||0; if(st>tt) tgt[rk]=src[rk]; } }
          } else {
            var map = {};
            (tgt||[]).forEach(function(r){ if(r&&r.pid!=null) map[r.pid+"#"+(r.pno!=null?r.pno:"")]=r; });
            (src||[]).forEach(function(r){ if(!r||r.pid==null) return; var key=r.pid+"#"+(r.pno!=null?r.pno:""); var cur=map[key]; var rt=r.ts||0, ct=cur?(cur.ts||0):0; if(!cur) map[key]=r; else if(rt>ct) map[key]=r; });
            tgt = Object.keys(map).map(function(kk){ return map[kk]; });
          }
          merged[k2] = JSON.stringify(tgt);
        }catch(_){}
        continue;
      }
      // 其余键本机优先
    }
    return merged;
  }

  function gh(path, opts){
    opts = opts || {};
    var cfg = loadCfg();
    var headers = Object.assign({ "Accept":"application/vnd.github+json", "Authorization":"Bearer "+cfg.token }, opts.headers||{});
    return fetch(API + path, { method: opts.method||"GET", headers: headers, body: opts.body });
  }

  async function getFile(owner, repo, path){
    var r = await gh("/repos/"+owner+"/"+repo+"/contents/"+encodeURIComponent(path));
    if(r.status === 404) return { notfound:true };
    if(!r.ok) return { err: "HTTP "+r.status };
    var j = await r.json();
    return { content: ub64(j.content||""), sha: j.sha };
  }

  async function putFile(owner, repo, path, text, sha){
    var body = { message: "shenlun sync "+new Date().toISOString(), content: b64(text) };
    if(sha) body.sha = sha;
    var r = await gh("/repos/"+owner+"/"+repo+"/contents/"+encodeURIComponent(path), { method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
    if(!r.ok) return { err: "HTTP "+r.status };
    return { ok:true };
  }

  async function createPrivateRepo(name){
    var r = await gh("/user/repos", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ name:name, private:true, auto_init:false, description:"求是申论素材库 · 同步数据（私有）" }) });
    if(!r.ok) return { err: "创建仓库失败 HTTP "+r.status+"（token 需有 repo 权限）" };
    return { ok:true };
  }

  function setStatus(msg, isErr){
    var el = $("ghStatus");
    if(el){
      el.className = "b27-status" + (isErr ? " err" : "");
      el.textContent = msg;
    } else {
      showToast(msg, isErr);
    }
  }

  function showToast(msg, isErr){
    if(typeof document === "undefined") return;
    var d = document.createElement("div");
    d.textContent = msg;
    d.style.cssText = "position:fixed; left:50%; bottom:80px; transform:translateX(-50%); z-index:9999; padding:10px 16px; border-radius:20px; font-size:13px; background:"+(isErr?"#c0392b":"#27ae60")+"; color:#fff; box-shadow:0 4px 12px rgba(0,0,0,.15); opacity:0; transition:opacity .3s; max-width:80%; text-align:center; pointer-events:none;";
    document.body.appendChild(d);
    requestAnimationFrame(function(){ d.style.opacity = "1"; });
    setTimeout(function(){ d.style.opacity = "0"; setTimeout(function(){ if(d.parentNode) d.parentNode.removeChild(d); }, 300); }, 2500);
  }

  async function doSync(only){
    var cfg = loadCfg();
    if(!cfg.token || !cfg.owner || !cfg.repo){
      setStatus("请先填写 Token 与仓库（或点「一键建私有仓库」）", true); return;
    }
    var path = cfg.path || "store.json";
    try{
      setStatus("正在拉取云端…");
      var remote = await getFile(cfg.owner, cfg.repo, path);
      if(remote.err){ setStatus("拉取失败："+remote.err, true); return; }
      if(!remote.notfound && remote.content){
        var imp = JSON.parse(remote.content||"{}");
        var merged = mergeInto(imp);
        applyMerged(merged);
      }
      if(only === "pull"){ setStatus("已拉取并合并 ✓ "+new Date().toLocaleTimeString()); afterSync(); return; }

      // 上传（已先合并云端，保证双向补齐）
      setStatus("正在上传…");
      var snap = { _app:"求是申论素材库", _schema:1, exportedAt:new Date().toISOString(), keys: snapshot() };
      var cur = await getFile(cfg.owner, cfg.repo, path);
      var sha = cur && cur.sha ? cur.sha : undefined;
      var put = await putFile(cfg.owner, cfg.repo, path, JSON.stringify(snap, null, 1), sha);
      if(put.err){ setStatus("上传失败："+put.err, true); return; }
      setStatus("已双向同步 ✓ "+new Date().toLocaleTimeString());
      afterSync();
    }catch(e){
      setStatus("网络/接口错误："+e, true);
    }
  }

  function afterSync(){
    try{ if(typeof window.__render==="function") window.__render(); }catch(_){}
    if(typeof renderGithubSync==="function") renderGithubSync();
  }

  function autoSync(){
    var cfg = loadCfg();
    if(!cfg.token || !cfg.owner || !cfg.repo) return;
    doSync();
  }

  function tryAutoSyncOnLoad(){
    var cfg = loadCfg();
    if(!cfg.token || !cfg.owner || !cfg.repo) return;
    if(typeof navigator !== "undefined" && !navigator.onLine) return;
    var last = cfg._lastAutoSync || 0;
    if(Date.now() - last < 60000) return; // 1 分钟内不再自动同步
    cfg._lastAutoSync = Date.now(); saveCfg(cfg);
    setTimeout(function(){ autoSync(); }, 2000);
  }

  async function oneClickRepo(){
    var cfg = loadCfg();
    if(!cfg.token){ setStatus("先填 Token", true); return; }
    setStatus("正在创建私有仓库 shenlun-sync …");
    var c = await createPrivateRepo("shenlun-sync");
    if(c.err){ setStatus(c.err, true); return; }
    cfg.owner = cfg.owner || whoami();
    cfg.repo = "shenlun-sync"; cfg.path = "store.json";
    saveCfg(cfg);
    setStatus("私有仓库已就绪，点「立即同步」", false);
    renderGithubSync();
  }

  function whoami(){
    // 优先用已填 owner；否则尝试拿登录名
    var cfg = loadCfg(); if(cfg.owner) return cfg.owner;
    return "";
  }

  async function tryWhoami(){
    try{
      var r = await gh("/user");
      if(r.ok){ var j = await r.json(); var cfg=loadCfg(); if(!cfg.owner){ cfg.owner=j.login; saveCfg(cfg); } return j.login; }
    }catch(_){}
    return "";
  }

  window.renderGithubSync = function(){
    var cfg = loadCfg();
    var h = '';
    h += '<div class="b27-wrap">';
    h += '<div class="b27-h2">🔗 GitHub 同步 <span class="b27-sub">跨网络 · 用你自己的私有仓库 · 电脑/iPad 共用一份</span></div>';
    h += '<div id="ghStatus" class="b27-status">未同步</div>';

    h += '<div class="b27-card">';
    h += '<div class="b27-h3">① GitHub Token（存本机浏览器，仅用于访问你的仓库）</div>';
    h += '<input id="ghToken" type="password" class="b27-in" placeholder="粘贴你的 GitHub Personal Access Token（需 repo 权限）" value="">';
    h += '<div class="b27-tip">token 只在你的浏览器里使用，直连 GitHub，不经过任何第三方。用途：部署 Pages + 本同步。生成：GitHub → Settings → Developer settings → PAT（勾 repo）。</div>';
    h += '</div>';

    h += '<div class="b27-card">';
    h += '<div class="b27-h3">② 同步仓库</div>';
    h += '<div class="b27-row"><label>仓库 owner<input id="ghOwner" class="b27-in" placeholder="如 shiwuooo" value="'+esc(cfg.owner||"")+'"></label>';
    h += '<label>仓库名<input id="ghRepo" class="b27-in" placeholder="shenlun-sync" value="'+esc(cfg.repo||"")+'"></label></div>';
    h += '<label>文件路径<input id="ghPath" class="b27-in" placeholder="store.json" value="'+esc(cfg.path||"store.json")+'"></label>';
    h += '<div class="b27-tip">推荐「一键建私有仓库」：数据存在你自己的私有仓库，外人看不到。若放在公开仓库，数据会被公开。</div>';
    h += '<div class="b27-btns">';
    h += '<button class="b27-b" onclick="__b27Save()">保存配置</button>';
    h += '<button class="b27-b ghost" onclick="__b27OneClick()">一键建私有仓库</button>';
    h += '</div>';
    h += '</div>';

    h += '<div class="b27-card">';
    h += '<div class="b27-h3">③ 同步</div>';
    h += '<div class="b27-btns">';
    h += '<button class="b27-b primary" onclick="__b27Sync()">立即同步（双向）</button>';
    h += '<button class="b27-b" onclick="__b27SyncPull()">仅下载</button>';
    h += '</div>';
    h += '<div class="b27-tip">配置会保存在本机浏览器。首次：电脑端先「立即同步」上传；iPad 端填同一 token+仓库后「立即同步」一次。之后每次打开 app 会自动双向同步，无需再进这个页面。</div>';
    h += '</div>';

    h += '<div class="b27-card">';
    h += '<div class="b27-h3">对比其它方式</div>';
    h += '<div class="b27-cmp">局域网同步：需电脑开机+同 WiFi，出门不可用。<br>坚果云：需电脑端本地服务器代理，跨网络同样受限。<br><b>GitHub 同步：任意网络、无需开电脑，最适你「Pad 为主、偶尔电脑」。</b></div>';
    h += '</div>';

    h += '</div>';
    var c = $("content"); if(c) c.innerHTML = h;
  };

  window.__b27Save = function(){
    var cfg = loadCfg();
    cfg.token = ($("ghToken").value || "").trim() || cfg.token;
    cfg.owner = ($("ghOwner").value || "").trim();
    cfg.repo = ($("ghRepo").value || "").trim();
    cfg.path = ($("ghPath").value || "").trim() || "store.json";
    saveCfg(cfg);
    setStatus("配置已保存", false);
    tryWhoami().then(function(){ renderGithubSync(); });
  };
  window.__b27OneClick = oneClickRepo;
  window.__b27Sync = function(){ doSync(); };
  window.__b27SyncPull = function(){ doSync("pull"); };

  // 启动：尝试补全 owner（若只填了 token）；配置完整则自动同步
  if(typeof window !== "undefined"){
    if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", function(){ var c=loadCfg(); if(c.token && !c.owner) tryWhoami(); tryAutoSyncOnLoad(); });
    else { var c=loadCfg(); if(c.token && !c.owner) tryWhoami(); tryAutoSyncOnLoad(); }
  }
})();
