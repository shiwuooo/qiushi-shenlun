(function(){
  "use strict";
  /* ==================================================================
     _b15 答题助手（规范词 / 金句 主动召回）
     A. window.renderRecall()            —— 独立页面：搜索 + 类型筛选 + 分组列表
     B. window.b15MountRecall(pid,qno)   —— 作答弹窗内 #b15Recall 面板：按题型召回
     C. window.b15OnInput(text)          —— 作答框输入时轻量过滤召回列表
     纯前端 / 离线 / 零依赖，全部类名 b15- 前缀，不改主站任何全局。
     ================================================================== */

  /* ---------- 自带 HTML 转义 ---------- */
  var esc = window.esc || function(s){
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };
  /* 属性值转义（额外处理引号） */
  function escA(s){
    return esc(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ---------- 通用小工具 ---------- */
  function arrOf(a){ return Object.prototype.toString.call(a) === "[object Array]" ? a : []; }
  function cut(s, n){ s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n) + "…" : s; }

  /* 安全读取 DATA.entries */
  function entries(){
    try{
      if(typeof DATA === "undefined" || !DATA) return [];
      return arrOf(DATA.entries);
    }catch(e){ return []; }
  }
  function entryAt(i){
    var list = entries();
    i = parseInt(i, 10);
    return (i >= 0 && i < list.length && list[i]) ? list[i] : null;
  }
  function textOf(e){
    if(!e) return "";
    return String(e.title || "") + " " + arrOf(e.lines).join(" ");
  }
  function fullText(e){
    if(!e) return "";
    var ls = arrOf(e.lines);
    return String(e.title || "") + (ls.length ? "\n" + ls.join("\n") : "");
  }

  /* ---------- 分词 ---------- */
  /* 搜索框：空格分词 = 同时包含 */
  function tokens(s){
    return String(s == null ? "" : s).trim().split(/\s+/).filter(function(t){ return !!t; });
  }
  /* 作答正文：抽中文 2-gram + 英数词，做轻量任一命中 */
  function softTokens(s){
    s = String(s == null ? "" : s);
    if(s.length > 300) s = s.slice(-300);
    var chunks = s.match(/[\u4e00-\u9fa5]+|[A-Za-z0-9]{2,}/g) || [];
    var out = [], seen = {}, i, j, c, g;
    for(i = 0; i < chunks.length && out.length < 80; i++){
      c = chunks[i];
      if(/^[A-Za-z0-9]+$/.test(c)){
        if(!seen[c]){ seen[c] = 1; out.push(c); }
        continue;
      }
      if(c.length <= 2){
        if(c.length === 2 && !seen[c]){ seen[c] = 1; out.push(c); }
        continue;
      }
      for(j = 0; j + 2 <= c.length && out.length < 80; j++){
        g = c.slice(j, j + 2);
        if(!seen[g]){ seen[g] = 1; out.push(g); }
      }
    }
    return out;
  }
  function hitAll(txt, toks){
    if(!toks.length) return true;
    for(var i = 0; i < toks.length; i++){ if(txt.indexOf(toks[i]) < 0) return false; }
    return true;
  }
  function hitAny(txt, toks){
    for(var i = 0; i < toks.length; i++){ if(txt.indexOf(toks[i]) >= 0) return true; }
    return false;
  }

  /* ---------- 库标签样式映射 ---------- */
  var TAGCLS = { "规范词库":"b15-t-norm", "金句库":"b15-t-gold", "案例库":"b15-t-case", "框架库":"b15-t-frame" };
  function tagCls(lib){ return TAGCLS[lib] || "b15-t-other"; }
  var LIBORDER = ["规范词库", "金句库", "案例库", "框架库"];

  /* ---------- 轻提示 ---------- */
  var toastTimer = null;
  function toast(msg){
    try{
      if(!document.body) return;
      var el = document.getElementById("b15Toast");
      if(!el){
        el = document.createElement("div");
        el.id = "b15Toast";
        el.className = "b15-toast";
        document.body.appendChild(el);
      }
      el.textContent = String(msg == null ? "" : msg);
      el.classList.add("b15-toast-on");
      if(toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function(){
        try{ el.classList.remove("b15-toast-on"); }catch(e){}
      }, 1300);
    }catch(e){}
  }

  /* ---------- 复制（clipboard → textarea 降级） ---------- */
  function copyFallback(s){
    try{
      var ta = document.createElement("textarea");
      ta.value = s;
      ta.setAttribute("readonly", "readonly");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try{ ok = document.execCommand("copy"); }catch(e){ ok = false; }
      document.body.removeChild(ta);
      toast(ok ? "已复制" : "复制失败，请手动选中");
    }catch(e){ toast("复制失败，请手动选中"); }
  }
  function copyText(t){
    var s = String(t == null ? "" : t);
    try{
      if(navigator && navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(s).then(function(){ toast("已复制"); }, function(){ copyFallback(s); });
        return;
      }
    }catch(e){}
    copyFallback(s);
  }

  /* ---------- 插入到作答文本框 ---------- */
  function insertToAns(txt){
    try{
      var ta = document.getElementById("ansText");
      if(!ta){ toast("未找到作答框"); return false; }
      var s = String(txt == null ? "" : txt);
      var v = ta.value == null ? "" : String(ta.value);
      var a = (typeof ta.selectionStart === "number") ? ta.selectionStart : v.length;
      var b = (typeof ta.selectionEnd === "number") ? ta.selectionEnd : a;
      if(a > v.length) a = v.length;
      if(b < a) b = a;
      ta.value = v.slice(0, a) + s + v.slice(b);
      var pos = a + s.length;
      try{ ta.focus(); ta.setSelectionRange(pos, pos); }catch(e){}
      try{ ta.dispatchEvent(new Event("input", { bubbles:true })); }catch(e){}
      toast("已插入");
      return true;
    }catch(e){ return false; }
  }

  /* ==================================================================
     A. 独立页面 window.renderRecall
     ================================================================== */
  var P = { kw:"", lib:"全部" };
  var CHIPS = ["全部", "规范词库", "金句库", "案例库"];

  function pageShell(){
    var i, h = "";
    for(i = 0; i < CHIPS.length; i++){
      h += '<button type="button" class="b15-chip' + (P.lib === CHIPS[i] ? " b15-chip-on" : "") +
           '" data-lib="' + escA(CHIPS[i]) + '">' + esc(CHIPS[i]) + '</button>';
    }
    return '' +
      '<div class="b15-wrap">' +
        '<div class="b15-hd">' +
          '<div class="b15-h1">🧰 答题助手 · 主动召回</div>' +
          '<div class="b15-h2">搜规范词 / 金句 / 案例，空格分词 = 同时包含；复制后直接用进答案。</div>' +
        '</div>' +
        '<div class="b15-bar">' +
          '<input id="b15-kw" class="b15-input" type="text" autocomplete="off" ' +
            'placeholder="输入关键词，如：乡村振兴 治理" value="' + escA(P.kw) + '">' +
          '<div class="b15-chips">' + h + '</div>' +
        '</div>' +
        '<div id="b15-list" class="b15-list"></div>' +
      '</div>';
  }

  function itemHTML(i, e){
    var lines = arrOf(e.lines);
    var lib = String(e.lib || "其他");
    var h = '<div class="b15-item">' +
      '<div class="b15-row">' +
        '<span class="b15-tag ' + tagCls(lib) + '">' + esc(lib) + '</span>' +
        '<span class="b15-ttl">' + esc(e.title || "(无标题)") + '</span>' +
        '<span class="b15-sp"></span>' +
        (lines.length ? '<button type="button" class="b15-btn b15-tg" data-i="' + i + '">展开 ▾</button>' : '') +
        '<button type="button" class="b15-btn b15-cp" data-i="' + i + '">📋 复制</button>' +
      '</div>';
    if(lines.length){
      h += '<div class="b15-lines" id="b15-ln-' + i + '" hidden>';
      for(var k = 0; k < lines.length; k++){
        h += '<div class="b15-line">' + esc(lines[k]) + '</div>';
      }
      h += '</div>';
    }
    return h + '</div>';
  }

  function paintList(){
    var box;
    try{ box = document.getElementById("b15-list"); }catch(e){ box = null; }
    if(!box) return;
    try{
      var list = entries();
      if(!list.length){
        box.innerHTML = '<div class="b15-empty">素材数据未就绪（DATA.entries 为空）。</div>';
        return;
      }
      var toks = tokens(P.kw), buckets = {}, order = [], i, e, lib, n = 0;
      for(i = 0; i < list.length; i++){
        e = list[i];
        if(!e) continue;
        lib = String(e.lib || "其他");
        if(P.lib !== "全部" && lib !== P.lib) continue;
        if(toks.length && !hitAll(textOf(e), toks)) continue;
        if(!buckets[lib]){ buckets[lib] = []; order.push(lib); }
        buckets[lib].push(itemHTML(i, e));
        n++;
      }
      if(!n){
        box.innerHTML = '<div class="b15-empty">没有命中的素材。<br>试试减少关键词，或把类型切回「全部」。</div>';
        return;
      }
      /* 固定顺序在前，其余按出现顺序追加 */
      var seq = [], k;
      for(k = 0; k < LIBORDER.length; k++){ if(buckets[LIBORDER[k]]) seq.push(LIBORDER[k]); }
      for(k = 0; k < order.length; k++){ if(seq.indexOf(order[k]) < 0) seq.push(order[k]); }

      var html = '<div class="b15-count">共命中 <b>' + n + '</b> 条</div>';
      for(k = 0; k < seq.length; k++){
        lib = seq[k];
        html += '<div class="b15-group">' +
                  '<div class="b15-gh"><span class="b15-tag ' + tagCls(lib) + '">' + esc(lib) + '</span>' +
                  '<span class="b15-gn">' + buckets[lib].length + ' 条</span></div>' +
                  buckets[lib].join("") +
                '</div>';
      }
      box.innerHTML = html;
    }catch(err){
      try{ box.innerHTML = '<div class="b15-empty">列表渲染出错，已跳过。</div>'; }catch(e2){}
    }
  }

  window.renderRecall = function(){
    try{
      var host = document.getElementById("content");
      if(!host) return;
      host.innerHTML = pageShell();
      paintList();
    }catch(err){
      try{
        var h2 = document.getElementById("content");
        if(h2) h2.innerHTML = '<div class="b15-empty">答题助手加载失败，请返回重试。</div>';
      }catch(e){}
    }
  };

  /* ==================================================================
     B. 作答弹窗内召回面板 window.b15MountRecall
     ================================================================== */
  var RC = { qtype:"", filter:"", norm:[], gold:[] };

  /* 题型同义扩展（宽松匹配，数据里没有也不影响） */
  var QSYN = {
    "概括":["概括","归纳","要点","总结","梳理"],
    "归纳":["概括","归纳","要点","总结"],
    "分析":["分析","原因","内涵","理解","阐释","本质"],
    "对策":["对策","措施","建议","办法","解决","路径"],
    "公文":["公文","讲话","倡议","方案","通知","发言","汇报","提纲"],
    "应用":["公文","应用","方案","倡议","发言","提纲"],
    "作文":["论证","论述","立意","开头","结尾","文章","主题"],
    "评论":["评价","评论","看法","观点","论证"]
  };
  function qkeys(qt){
    var keys = [], base;
    qt = String(qt == null ? "" : qt).trim();
    if(!qt) return keys;
    keys.push(qt);
    base = qt.replace(/题$/, "");
    if(base && keys.indexOf(base) < 0) keys.push(base);
    for(var k in QSYN){
      if(!Object.prototype.hasOwnProperty.call(QSYN, k)) continue;
      if(base.indexOf(k) >= 0){
        for(var i = 0; i < QSYN[k].length; i++){
          if(keys.indexOf(QSYN[k][i]) < 0) keys.push(QSYN[k][i]);
        }
      }
    }
    return keys;
  }

  /* 取某库前 n 条，按题型相关性排序（title 命中 +2，lines 命中 +1） */
  function pick(lib, qt, n){
    var out = [];
    try{
      var list = entries(), keys = qkeys(qt), i, j, e, sc, t, ls;
      for(i = 0; i < list.length; i++){
        e = list[i];
        if(!e || String(e.lib || "") !== lib) continue;
        sc = 0;
        if(keys.length){
          t = String(e.title || "");
          ls = arrOf(e.lines).join(" ");
          for(j = 0; j < keys.length; j++){
            if(t.indexOf(keys[j]) >= 0) sc += 2;
            else if(ls.indexOf(keys[j]) >= 0) sc += 1;
          }
        }
        out.push({ i:i, e:e, s:sc, o:out.length });
      }
      out.sort(function(a, b){ return b.s - a.s || a.o - b.o; });
      out = out.slice(0, n);
    }catch(err){ out = []; }
    return out;
  }

  function cardHTML(it){
    var e = it.e, ls = arrOf(e.lines);
    var sub = ls.length ? ls[0] : "";
    return '<div class="b15-card">' +
      '<div class="b15-card-t">' + esc(e.title || "(无标题)") + '</div>' +
      (sub ? '<div class="b15-card-s">' + esc(cut(sub, 42)) + '</div>' : '') +
      '<div class="b15-card-a">' +
        '<button type="button" class="b15-mini b15-ins" data-i="' + it.i + '">➕插入</button>' +
        '<button type="button" class="b15-mini b15-cp" data-i="' + it.i + '">📋复制</button>' +
      '</div></div>';
  }

  function groupHTML(title, cls, arr){
    if(!arr.length) return "";
    var h = '<div class="b15-rg"><div class="b15-rg-h"><span class="b15-tag ' + cls + '">' +
            esc(title) + '</span><span class="b15-gn">' + arr.length + '</span></div><div class="b15-cards">';
    for(var i = 0; i < arr.length; i++) h += cardHTML(arr[i]);
    return h + '</div></div>';
  }

  function filterArr(arr, toks){
    if(!toks.length) return arr;
    var out = [];
    for(var i = 0; i < arr.length; i++){
      if(hitAny(textOf(arr[i].e), toks)) out.push(arr[i]);
    }
    return out;
  }

  function panelHTML(){
    var toks = softTokens(RC.filter);
    var nm = filterArr(RC.norm, toks), gd = filterArr(RC.gold, toks);
    var note = "";
    if(toks.length && !nm.length && !gd.length){
      nm = RC.norm; gd = RC.gold;
      note = '<div class="b15-note">当前正文暂无匹配，已回到默认推荐。</div>';
    }else if(toks.length){
      note = '<div class="b15-note">已按你正在写的内容过滤。</div>';
    }
    var body = groupHTML("规范词库", "b15-t-norm", nm) + groupHTML("金句库", "b15-t-gold", gd);
    if(!body) body = '<div class="b15-empty b15-empty-s">暂无可召回素材，不影响作答。</div>';
    return '<div class="b15-tip">💡 写答案时可直接点「➕插入」规范词，让表达更对路' +
             (RC.qtype ? '<span class="b15-qt">当前题型：' + esc(RC.qtype) + '</span>' : '') +
           '</div>' + note + '<div class="b15-scroll">' + body + '</div>';
  }

  window.b15MountRecall = function(pid, qno){
    var box = null;
    try{ box = document.getElementById("b15Recall"); }catch(e){ box = null; }
    if(!box) return;
    try{
      var qt = "";
      try{
        if(typeof findQ === "function"){
          var r = findQ(pid, qno);
          if(r && r.q && r.q.qtype) qt = String(r.q.qtype);
        }
      }catch(e1){ qt = ""; }
      RC.qtype = qt;
      RC.filter = "";
      RC.norm = pick("规范词库", qt, 8);
      RC.gold = pick("金句库", qt, 8);
      box.innerHTML = panelHTML();
    }catch(err){
      try{ box.innerHTML = ""; }catch(e2){}
    }
  };

  /* ==================================================================
     C. 作答框输入联动 window.b15OnInput
     ================================================================== */
  window.b15OnInput = function(text){
    try{
      var box = document.getElementById("b15Recall");
      if(!box) return;
      RC.filter = String(text == null ? "" : text);
      if(!RC.norm.length && !RC.gold.length){
        RC.norm = pick("规范词库", RC.qtype, 8);
        RC.gold = pick("金句库", RC.qtype, 8);
      }
      box.innerHTML = panelHTML();
    }catch(err){}
  };

  /* ==================================================================
     事件委托（页面 + 弹窗共用，只绑一次）
     ================================================================== */
  function upTo(el, cls){
    var n = el;
    while(n && n !== document){
      if(n.classList && n.classList.contains(cls)) return n;
      n = n.parentNode;
    }
    return null;
  }

  try{
    document.addEventListener("click", function(ev){
      try{
        var t = ev.target, b;
        if(!t) return;

        if((b = upTo(t, "b15-chip"))){
          P.lib = b.getAttribute("data-lib") || "全部";
          var cs = document.querySelectorAll(".b15-chip"), i;
          for(i = 0; i < cs.length; i++) cs[i].classList.remove("b15-chip-on");
          b.classList.add("b15-chip-on");
          paintList();
          return;
        }
        if((b = upTo(t, "b15-tg"))){
          var id = "b15-ln-" + (b.getAttribute("data-i") || "");
          var ln = document.getElementById(id);
          if(ln){
            var open = ln.hasAttribute("hidden");
            if(open) ln.removeAttribute("hidden"); else ln.setAttribute("hidden", "hidden");
            b.textContent = open ? "收起 ▴" : "展开 ▾";
          }
          return;
        }
        if((b = upTo(t, "b15-cp"))){
          var e1 = entryAt(b.getAttribute("data-i"));
          if(e1) copyText(fullText(e1)); else toast("条目已失效");
          return;
        }
        if((b = upTo(t, "b15-ins"))){
          var e2 = entryAt(b.getAttribute("data-i"));
          if(e2) insertToAns(String(e2.title || "")); else toast("条目已失效");
          return;
        }
      }catch(err){}
    }, false);

    document.addEventListener("input", function(ev){
      try{
        var t = ev.target;
        if(t && t.id === "b15-kw"){
          P.kw = t.value == null ? "" : String(t.value);
          paintList();
        }
      }catch(err){}
    }, false);
  }catch(e){}

})();
