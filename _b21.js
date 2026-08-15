/* =====================================================================
   第21批：数据存档 · 导出 / 导入 JSON  (_b21.js)
   「先做 A」方案：把本机全部作答与训练记录打包成一个 JSON 文件，
   由你自己通过网盘在电脑 / Pad / 手机之间搬运；换设备时导入即合并。
   设计铁律：
     - 纯前端、离线可用、隐私优先（数据只经过你的设备与你的网盘）
     - 导入时【绝不覆盖本机已有记录】
         · 答案(shenlun_answers_v2) 按 pid#qno + ts 取较新一条做合并
         · 其余键本机优先：本机有则保留本机，仅补入本机缺少的键
     - 导入前先自动备份本机当前存档，确认后再写回
   后续「方案 C」局域网同步会复用本模块暴露的合并函数与存档页。
   依赖：主站 window.esc（存在则用，否则兜底）
   ===================================================================== */
(function(){
  "use strict";

  const APP = "求是申论素材库";
  const SCHEMA = 1;
  const ANS_KEY = "shenlun_answers_v2";   // 与主站 STORE_KEY 保持一致
  const GRADE_KEY = "xiaoti_grade_v1";    // _b25 小题批改记录（数组，按 pid#pno + ts 合并）

  function esc2(s){ const f = window.esc; return (typeof f==="function") ? f(s) : String(s==null?"":s); }
  function $(id){ return document.getElementById(id); }
  function pad2(n){ return String(n).padStart(2,"0"); }
  function todayStr(){ const d=new Date(); return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate()); }

  // ---- 取本机全部 localStorage 键值（同源下所有键，保证不漏）----
  function snapshot(){
    const keys = {};
    try{
      for(let i=0;i<localStorage.length;i++){
        const k = localStorage.key(i);
        if(k==null) continue;
        try{ keys[k] = localStorage.getItem(k); }catch(_){}
      }
    }catch(e){}
    return keys;
  }

  // ---- 递归清除 base64 图片（data: 开头的字符串）----
  function stripImages(v){
    if(typeof v === "string"){
      return /^data:/.test(v.trim()) ? "" : v;
    }
    if(Array.isArray(v)){ return v.map(stripImages); }
    if(v && typeof v === "object"){
      const o = {};
      for(const k in v){ o[k] = stripImages(v[k]); }
      return o;
    }
    return v;
  }

  function download(name, text){
    const blob = new Blob([text], {type:"application/json;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 120);
  }

  // ---- 当前存档概览 ----
  function storeStats(){
    const keys = snapshot();
    const out = { keyCount:0, ansCount:0, imgBytes:0, jsonBytes:0 };
    out.keyCount = Object.keys(keys).length;
    for(const k in keys){
      const raw = keys[k] || "";
      out.jsonBytes += raw.length;
      if(/^data:/.test(raw.trim())){ out.imgBytes += raw.length; }
      if(k === ANS_KEY){
        try{ out.ansCount = Object.keys(JSON.parse(raw)||{}).length; }catch(_){}
      }
    }
    return out;
  }

  // ============================ 导出 ============================
  function doExport(noImg){
    const keys = snapshot();
    if(noImg){
      // 仅对 JSON 值去图，非 JSON 原样保留
      for(const k in keys){
        try{ keys[k] = JSON.stringify(stripImages(JSON.parse(keys[k]))); }
        catch(_){ /* 非 JSON，保持原字符串 */ }
      }
    }
    const payload = {
      _app: APP,
      _schema: SCHEMA,
      exportedAt: new Date().toISOString(),
      mode: noImg ? "noimg" : "full",
      device: (navigator.userAgent||"").slice(0,90),
      note: "由「求是申论素材库」存档同步模块导出；导入时按题号+时间戳合并，不覆盖本机。",
      keys: keys
    };
    const sizeKB = (JSON.stringify(payload).length/1024).toFixed(0);
    download("求是申论存档_"+todayStr()+(noImg?"_无图":"")+".json", JSON.stringify(payload,null,2));
    const tip = noImg
      ? "已导出【不含图片】存档，约 "+sizeKB+" KB。\n照片已剥离，适合发微信/网盘小文件；在另一台设备导入即可合并。"
      : "已导出【含图片】存档，约 "+sizeKB+" KB。\n含你拍照/圈画的材料图；传到网盘后在另一台设备导入即可合并。";
    alert(tip);
    if(window.renderArchive) renderArchive();
  }

  // ============================ 合并 ============================
  // 返回 {merged, report}，merged 为合并后完整键值；绝不删除本机键
  function mergeInto(imp){
    const target = snapshot();
    const merged = {};
    for(const k in target){ merged[k] = target[k]; }   // 先全量保留本机
    const impKeys = (imp && imp.keys) || {};
    const rep = { newKeys:0, addAns:0, updAns:0, sameAns:0, conflictOther:0, keptOther:0 };

    for(const k in impKeys){
      if(!(k in merged)){ merged[k] = impKeys[k]; rep.newKeys++; continue; }

      if(k === ANS_KEY){
        try{
          const tgt = JSON.parse(merged[k]||"{}");
          const src = JSON.parse(impKeys[k]||"{}");
          for(const rk in src){
            if(!(rk in tgt)){ tgt[rk] = src[rk]; rep.addAns++; }
            else{
              const tt = (tgt[rk] && tgt[rk].ts) || 0;
              const st = (src[rk] && src[rk].ts) || 0;
              if(st > tt){ tgt[rk] = src[rk]; rep.updAns++; }
              else { rep.sameAns++; }
            }
          }
          merged[k] = JSON.stringify(tgt);
        }catch(_){ rep.conflictOther++; /* 解析失败保留本机 */ }
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
            if(!cur){ map[key] = r; rep.addAns++; }
            else if(rt > ct){ map[key] = r; rep.updAns++; }
            else { rep.sameAns++; }
          });
          merged[k] = JSON.stringify(Object.keys(map).map(function(kk){ return map[kk]; }));
        }catch(_){ rep.conflictOther++; }   // 解析失败保留本机
        continue;
      }

      // 其余键：本机优先。不同则统计冲突，但不覆盖本机
      if(merged[k] !== impKeys[k]){ rep.conflictOther++; }
      else { rep.keptOther++; }
    }
    return { merged: merged, report: rep };
  }

  function applyMerged(merged){
    for(const k in merged){
      try{ localStorage.setItem(k, merged[k]); }catch(e){ console.warn("写入失败", k, e); }
    }
  }

  // ============================ 导入流程 ============================
  let _pending = null;   // 暂存待确认合并结果

  function onFilePicked(file){
    if(!file){ return; }
    const reader = new FileReader();
    reader.onload = function(){
      let imp = null;
      try{ imp = JSON.parse(reader.result); }catch(e){ alert("文件解析失败：不是有效的存档 JSON。"); return; }
      if(!imp || imp._app !== APP || !imp.keys){ alert("这不是「求是申论素材库」的存档文件。"); return; }

      // 先自动备份本机当前存档
      const bakName = "求是申论备份_"+todayStr()+"_导入前.json";
      try{ download(bakName, JSON.stringify({_app:APP,_schema:SCHEMA,_autoBackup:true,exportedAt:new Date().toISOString(),keys:snapshot()},null,2)); }
      catch(_){}

      const { merged, report } = mergeInto(imp);
      _pending = merged;
      renderConfirm(report, file.name, bakName);
    };
    reader.readAsText(file);
  }

  function doApply(){
    if(!_pending){ return; }
    applyMerged(_pending);
    _pending = null;
    alert("导入完成：本机记录已与存档合并。记录只增不删，原记录全部保留。");
    if(window.renderArchive) renderArchive();
  }

  // ============================ 渲染 ============================
  function renderArchive(){
    const st = storeStats();
    const sizeKB = (st.jsonBytes/1024).toFixed(0);
    const sizeMB = (st.jsonBytes/1024/1024).toFixed(2);
    const sz = st.jsonBytes > 1024*1024 ? sizeMB+" MB" : sizeKB+" KB";

    let h = '<div class="b21-wrap">';
    h += '<div class="b21-h2">💾 存档同步 <span class="b21-sub">把记录装进一个文件，由你自己搬运 · 隐私优先 · 不覆盖本机</span></div>';

    // 当前状态卡
    h += '<div class="b21-card">';
    h += '<div class="b21-row"><span class="b21-k">本机已存</span><span class="b21-v"><b>'+st.ansCount+'</b> 道作答记录 · 共 <b>'+st.keyCount+'</b> 个数据键</span></div>';
    h += '<div class="b21-row"><span class="b21-k">占用体积</span><span class="b21-v">约 '+sz+(st.imgBytes>0?'（含图片 '+ (st.imgBytes/1024/1024).toFixed(1) +' MB）':'')+'</span></div>';
    h += '<div class="b21-tip">浏览器按「设备+浏览器+网址」各自存一份，换设备打开是空的。用下面的导出/导入，把记录带走或合并回来。</div>';
    h += '</div>';

    // 导出区
    h += '<div class="b21-card">';
    h += '<div class="b21-h3">① 导出存档（带走 / 备份）</div>';
    h += '<div class="b21-btns">';
    h += '<button class="b21-btn" onclick="b21Export(false)">📦 导出（含图片）</button>';
    h += '<button class="b21-btn b21-ghost" onclick="b21Export(true)">📄 导出（不含图片·更小）</button>';
    h += '</div>';
    h += '<div class="b21-tip">导出后把 .json 传到网盘（光鸭/夸克/微信文件传输助手均可）。出门用 Pad/手机时，从网盘下载再「导入」。</div>';
    h += '</div>';

    // 导入区
    h += '<div class="b21-card">';
    h += '<div class="b21-h3">② 导入存档（合并到本机）</div>';
    h += '<div class="b21-btns"><label class="b21-btn b21-file">📥 选择存档文件<input type="file" id="b21File" accept=".json,application/json" onchange="b21Pick(this.files[0])"></label></div>';
    h += '<div class="b21-tip">导入会按题号+时间戳合并：电脑做过的、Pad 做过的，合并后全在；本机原有记录绝不丢失。导入前会自动备份本机当前存档。</div>';
    h += '<div id="b21Confirm"></div>';
    h += '</div>';

    // 局域网同步（方案 C）占位：若已加载桥接则填充
    h += '<div id="b21Sync"></div>';

    // 方案 B 异地同步（坚果云）占位
    h += '<div id="b22Cloud"></div>';

    // 用法
    h += '<div class="b21-card b21-usage">';
    h += '<div class="b21-h3">怎么在家里 / 外面用 Pad 刷题</div>';
    h += '<ul>';
    h += '<li><b>家里（同 WiFi）</b>：电脑开「局域网同步」后，Pad 浏览器访问电脑地址即可实时共用一份记录（见上方同步区）。</li>';
    h += '<li><b>外面 / 换设备</b>：用「导出存档」→ 传网盘 → 在目标设备下载 →「导入存档」合并。</li>';
    h += '<li><b>记录是真的在存</b>：每次作答/训练都写进本机，下次打开仍在，并随你导出带走、随导入累积成长。</li>';
    h += '</ul>';
    h += '</div>';

    h += '</div>';

    const c = $("content");
    if(c) c.innerHTML = h;
    const s = $("stats");
    if(s) s.textContent = "存档同步 · 本机 "+st.ansCount+" 道作答";

    // 若已加载局域网桥接，渲染同步区
    if(typeof window.b21RenderSync === "function"){ try{ window.b21RenderSync(); }catch(_){} }
  }

  function renderConfirm(rep, fname, bakName){
    const box = $("b21Confirm");
    if(!box) return;
    const parts = [];
    if(rep.addAns>0) parts.push("新增 <b>"+rep.addAns+"</b> 条作答");
    if(rep.updAns>0) parts.push("更新 <b>"+rep.updAns+"</b> 条作答（取较新）");
    if(rep.sameAns>0) parts.push(rep.sameAns+" 条已是最新");
    if(rep.newKeys>0) parts.push("补入 <b>"+rep.newKeys+"</b> 个其他数据键");
    if(rep.conflictOther>0) parts.push(rep.conflictOther+" 个其他键本机优先保留");
    const summary = parts.length ? parts.join("，") : "无新增，本机已是最新";
    box.innerHTML =
      '<div class="b21-confirm">'+
      '<div class="b21-crow">待合并文件：<code>'+esc2(fname)+'</code></div>'+
      '<div class="b21-crow">合并结果：'+summary+'</div>'+
      '<div class="b21-crow b21-ok">✅ 已自动备份本机到 <code>'+esc2(bakName)+'</code></div>'+
      '<div class="b21-btns">'+
      '<button class="b21-btn" onclick="b21Apply()">确认合并并写入</button>'+
      '<button class="b21-btn b21-ghost" onclick="b21Cancel()">取消</button>'+
      '</div></div>';
  }

  function b21Cancel(){ _pending = null; const box=$("b21Confirm"); if(box) box.innerHTML=""; }

  // ============================ 暴露全局 ============================
  window.b21Export = doExport;
  window.b21Pick   = onFilePicked;
  window.b21Apply  = doApply;
  window.b21Cancel = b21Cancel;
  window.renderArchive = renderArchive;
  // 调试句柄（无害）：供 jsdom 实测合并逻辑使用
  window.__b21 = { mergeInto: mergeInto, snapshot: snapshot, ANS_KEY: ANS_KEY, GRADE_KEY: GRADE_KEY };

  // 供方案 C（局域网同步）桥接调用：在 #b21Sync 渲染同步状态与按钮
  // 桥接脚本需设置 window.__shenlunSync = { status, lastSync, push, pull, url }
  window.b21RenderSync = function(){
    const sync = window.__shenlunSync;
    const box = $("b21Sync");
    if(!box || !sync) return;
    let h = '<div class="b21-card">';
    h += '<div class="b21-h3">③ 局域网同步（家里同 WiFi 实时共用）</div>';
    h += '<div class="b21-row"><span class="b21-k">状态</span><span class="b21-v '+(sync.status==="on"?"b21-on":"b21-off")+'">'+(sync.status==="on"?"已连接服务器 · 实时同步中":"未连接（用 file:// 或不在同一 WiFi）")+'</span></div>';
    if(sync.lastSync) h += '<div class="b21-row"><span class="b21-k">上次同步</span><span class="b21-v">'+esc2(sync.lastSync)+'</span></div>';
    h += '<div class="b21-btns">';
    h += '<button class="b21-btn" onclick="if(window.__shenlunSync)window.__shenlunSync.pull()">⬇️ 从服务器拉取</button>';
    h += '<button class="b21-btn b21-ghost" onclick="if(window.__shenlunSync)window.__shenlunSync.push()">⬆️ 推送到服务器</button>';
    h += '</div>';
    h += '<div class="b21-tip">在家里电脑启动同步服务器后，Pad/手机连同一 WiFi 访问服务器地址，记录自动共用一份，无需手动导出导入。</div>';
    h += '</div>';
    box.innerHTML = h;
  };

})();
