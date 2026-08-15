/* =====================================================================
   第22批：坚果云 WebDAV 异地同步  · 配置 UI  (_b22.js)
   - 在「存档同步」模块下渲染一组"云端配置 + 状态 + 手动操作"卡片
   - 配置存在 localStorage（key: shenlun_cloud_v1，账号/密码以 base64 存）
   - 桥接由 _b22_cloud.js 自动做 push/pull；这里只暴露手动按钮
   - 隐私：账号密码只在浏览器内 / 局域网转发到坚果云（标准 WebDAV Basic）
           服务器进程不持久化任何密码
   ===================================================================== */
(function(){
  "use strict";

  const STORAGE_KEY = "shenlun_cloud_v1";

  function $(id){ return document.getElementById(id); }
  function esc(s){ const f = window.esc; return (typeof f==="function") ? f(s) : String(s==null?"":s); }

  function loadCfg(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return { account:"", password:"", path:"", autoSync:false, lastSync:"" };
      return Object.assign({ account:"", password:"", path:"", autoSync:false, lastSync:"" }, JSON.parse(raw));
    }catch(_){ return { account:"", password:"", path:"", autoSync:false, lastSync:"" }; }
  }
  function saveCfg(c){
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); }catch(_){}
  }
  function clearCfg(){
    try{ localStorage.removeItem(STORAGE_KEY); }catch(_){}
  }

  function renderPanel(){
    const box = $("b22Cloud");
    if(!box) return;
    const cfg = loadCfg();
    const st = (window.__shenlunCloud && window.__shenlunCloud.status) || "off";

    const onoff = (s)=> s==="on" ? "b22-on" : s==="err" ? "b22-err" : "b22-off";
    const onoffLabel = (s)=> s==="on" ? "已连接 · 自动同步中" : s==="err" ? "连接异常 · 见下方提示" : "未连接";
    const lastSync = cfg.lastSync || (window.__shenlunCloud && window.__shenlunCloud.lastSync) || "—";
    const lastErr  = (window.__shenlunCloud && window.__shenlunCloud.lastErr) || "";

    let h = "";
    h += '<div class="b22-card">';
    h += '<div class="b22-h3">☁️ 坚果云异地同步（跨网络 / 电脑关机也能带走）</div>';
    h += '<div class="b22-row"><span class="b22-k">状态</span><span class="b22-v '+onoff(st)+'">'+onoffLabel(st)+'</span></div>';
    h += '<div class="b22-row"><span class="b22-k">上次同步</span><span class="b22-v">'+esc(lastSync)+'</span></div>';
    if(lastErr) h += '<div class="b22-err">'+esc(lastErr)+'</div>';
    h += '</div>';

    h += '<div class="b22-card">';
    h += '<div class="b22-h3">① 配置坚果云账号</div>';
    h += '<div class="b22-tip">去 <code>https://www.jianguoyun.com/d/</code> 注册（免费 1GB/月）→ 账号设置 → 高级 → 加一个「应用授权密码」→ 复制粘贴到下面。原始密码不要填，填「应用授权密码」更安全。</div>';
    h += '<div class="b22-form">';
    h += '<label>账号（手机号/邮箱）<input id="b22Acct" type="text" autocomplete="off" placeholder="例如 13800000000" value="'+esc(cfg.account)+'"></label>';
    h += '<label>应用授权密码 <input id="b22Pwd" type="password" autocomplete="off" placeholder="不是登录密码，是在坚果云后台生成的应用授权密码"></label>';
    h += '<label>云端文件路径 <input id="b22Path" type="text" autocomplete="off" placeholder="/shenlun_store.json" value="'+esc(cfg.path||"/shenlun_store.json")+'"></label>';
    h += '</div>';
    h += '<div class="b22-btns">';
    h += '<button class="b22-btn" onclick="b22Save()">💾 保存配置</button>';
    h += '<button class="b22-btn b22-ghost" onclick="b22Test()">🔌 测试连接</button>';
    h += '<button class="b22-btn b22-danger" onclick="b22Clear()">🗑 清除配置</button>';
    h += '</div>';
    h += '<div id="b22TestResult"></div>';
    h += '</div>';

    h += '<div class="b22-card">';
    h += '<div class="b22-h3">② 手动同步</h3>';
    h += '<div class="b22-btns">';
    h += '<button class="b22-btn" onclick="if(window.__shenlunCloud)window.__shenlunCloud.pull()">⬇️ 从云端拉取</button>';
    h += '<button class="b22-btn b22-ghost" onclick="if(window.__shenlunCloud)window.__shenlunCloud.push()">⬆️ 推送到云端</button>';
    h += '<label class="b22-toggle"><input type="checkbox" id="b22Auto" '+(cfg.autoSync?"checked":"")+' onchange="b22AutoToggle(this.checked)"> 开启自动同步（每 25 秒）</label>';
    h += '</div>';
    h += '<div class="b22-tip">自动同步只在浏览器开着时生效。电脑关机时不会丢数据——下次打开浏览器会自动从云端拉取最新记录。</div>';
    h += '</div>';

    box.innerHTML = h;
  }

  function setTestResult(msg, ok){
    const box = $("b22TestResult"); if(!box) return;
    box.innerHTML = '<div class="'+(ok?"b22-ok":"b22-err")+'">'+esc(msg)+'</div>';
  }

  function save(){
    const cfg = loadCfg();
    cfg.account = ($("b22Acct")||{}).value || "";
    cfg.password = ($("b22Pwd")||{}).value || "";
    cfg.path = (($("b22Path")||{}).value || "/shenlun_store.json").trim() || "/shenlun_store.json";
    saveCfg(cfg);
    if(typeof window.__shenlunCloudRebind === "function"){ try{ window.__shenlunCloudRebind(); }catch(_){} }
    setTestResult("已保存。下一步点「测试连接」确认能连上。", true);
    if(window.renderArchive) try{ window.renderArchive(); }catch(_){}
  }

  async function test(){
    const cfg = loadCfg();
    if(!cfg.account || !cfg.password){
      setTestResult("请先填账号和应用授权密码。", false); return;
    }
    setTestResult("正在连接坚果云…", true);
    try{
      const r = await fetch("/api/cloud/ping?u=" + encodeURIComponent(cfg.account) + "&p=" + encodeURIComponent(cfg.password), {cache:"no-store"});
      const j = await r.json();
      if(j.ok){ setTestResult("连通成功 ✓ 可用。", true); }
      else    { setTestResult("失败：" + (j.err||"未知错误"), false); }
    }catch(e){
      setTestResult("网络错误：" + e, false);
    }
  }

  function clearAll(){
    if(!confirm("确定要清除云端配置吗？这会断开自动同步，已上传的云端文件不会删除。")) return;
    clearCfg();
    if(typeof window.__shenlunCloudRebind === "function"){ try{ window.__shenlunCloudRebind(); }catch(_){} }
    if(window.renderArchive) try{ window.renderArchive(); }catch(_){}
  }

  function autoToggle(on){
    const cfg = loadCfg();
    cfg.autoSync = !!on;
    saveCfg(cfg);
    if(typeof window.__shenlunCloudRebind === "function"){ try{ window.__shenlunCloudRebind(); }catch(_){} }
  }

  // 暴露
  window.b22Save = save;
  window.b22Test = test;
  window.b22Clear = clearAll;
  window.b22AutoToggle = autoToggle;
  window.b22Render = renderPanel;
  window.b22LoadCfg = loadCfg;
  window.b22SaveCfg = saveCfg;

  // 主站 renderArchive() 每次被调用后，#b22Cloud 占位区就重新挂一次
  // 避免依赖外部顺序声明
  function hook(){
    const orig = window.renderArchive;
    if(typeof orig === "function" && !orig.__b22Patched){
      const wrapped = function(){
        try{ orig.apply(this, arguments); }catch(_){}
        try{ renderPanel(); }catch(_){}
      };
      wrapped.__b22Patched = true;
      window.renderArchive = wrapped;
    } else if(typeof orig !== "function") {
      setTimeout(hook, 200);
    }
  }
  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", hook);
  } else {
    hook();
  }
})();
