/* =====================================================================
   第十九批：申论成长史 → Obsidian 双推（_b19.js）
   把 localStorage 里的历次作答（含过程笔记 / 难点标签 / 命中率）
   汇成一份 Obsidian 友好的 Markdown：概览 + ASCII 趋势图 + 时间线。
   浏览器沙箱无法直接写用户磁盘，所以落地路径是：
     生成 Markdown → 一键复制 → 到 Vault 指定目录新建同名文件粘贴
   （另备「下载为 .md」与 Advanced URI 跳转，均为可选辅助）
   只读 localStorage("shenlun_answers_v2")；配置写 localStorage("shenlun_obsd_cfg_v1")。
   纯前端离线、零外部依赖；类名统一 b19- 前缀。
   入口：window.renderGrowthPush() / window.b19MdText() / window.b19CopyToClipboard()
   ===================================================================== */
(function(){
  "use strict";

  var ANS_KEY = "shenlun_answers_v2";
  var CFG_KEY = "shenlun_obsd_cfg_v1";
  var WIN     = 5;    /* 趋势对比窗口：近 5 次 vs 此前 5 次 */
  var TOPN    = 3;    /* 常卡难点 Top N */
  var SUMLEN  = 200;  /* 答案摘要字数 */
  var CHARTN  = 40;   /* ASCII 图最多画多少个点 */

  var esc = window.esc || function(s){
    return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  };

  var DEF = {
    subdir: "国考申论/成长史",
    tpl:    "成长史-{YYYY}-{MM}-{DD}",
    scope:  "all",            /* all | d7 | d30 | dn */
    days:   14,               /* scope = dn 时生效 */
    vault:  "ObsidianVault",
    adv:    false
  };

  /* 模块内状态（不碰主站 state） */
  var S     = { cfg:null, md:"", flash:"", bad:false, span:"" };
  var ITEMS = [];   /* 全部作答记录，时间升序 */

  /* ---------------- 基础工具 ---------------- */
  function isArr(x){ return Object.prototype.toString.call(x) === "[object Array]"; }
  function pad(n){ return (n < 10 ? "0" : "") + n; }
  function num(x, d){ var n = parseInt(x, 10); return isNaN(n) ? d : n; }

  function ensureCss(){
    try{
      var ls = document.getElementsByTagName("link"), i;
      for(i=0;i<ls.length;i++){
        if(String(ls[i].getAttribute("href") || "").indexOf("_b19.css") >= 0) return;
      }
      var el = document.createElement("link");
      el.rel = "stylesheet"; el.href = "_b19.css";
      (document.head || document.documentElement).appendChild(el);
    }catch(e){}
  }

  function dateOf(ts){
    if(typeof ts !== "number" || !isFinite(ts) || ts <= 0) return null;
    try{ var d = new Date(ts); return isNaN(d.getTime()) ? null : d; }catch(e){ return null; }
  }
  function fmtD(d){
    if(!d) return "时间未记录";
    return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate());
  }
  function fmtDT(d){
    if(!d) return "时间未记录";
    return fmtD(d) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function avg(a){
    if(!a || !a.length) return null;
    var s = 0, i;
    for(i=0;i<a.length;i++) s += a[i];
    return Math.round(s / a.length);
  }
  function oneLine(s){
    return String(s==null?"":s).replace(/\r/g,"").replace(/\n+/g,"　").replace(/\s+/g," ").trim();
  }
  /* Obsidian 标签不允许空格，做一次安全化 */
  function tagSafe(s){
    var t = String(s==null?"":s).trim();
    t = t.replace(/^#+/,"").replace(/[\s#\[\]\|\\\/]+/g,"-");
    return t;
  }
  /* 双链内容不允许 [] | 等，做一次安全化 */
  function linkSafe(s){
    var t = String(s==null?"":s).trim();
    return t.replace(/[\[\]\|#\^]/g,"").replace(/\s+/g," ");
  }

  /* ---------------- 配置读写 ---------------- */
  function loadCfg(){
    var c = { subdir:DEF.subdir, tpl:DEF.tpl, scope:DEF.scope, days:DEF.days, vault:DEF.vault, adv:DEF.adv };
    try{
      if(typeof localStorage === "undefined" || !localStorage) return c;
      var raw = localStorage.getItem(CFG_KEY);
      if(!raw) return c;
      var o = JSON.parse(raw);
      if(!o || typeof o !== "object") return c;
      if(typeof o.subdir === "string" && o.subdir.trim()) c.subdir = o.subdir.trim();
      if(typeof o.tpl === "string" && o.tpl.trim())       c.tpl    = o.tpl.trim();
      if(o.scope === "all" || o.scope === "d7" || o.scope === "d30" || o.scope === "dn") c.scope = o.scope;
      c.days  = Math.max(1, num(o.days, DEF.days));
      if(typeof o.vault === "string" && o.vault.trim())   c.vault  = o.vault.trim();
      c.adv = !!o.adv;
    }catch(e){}
    return c;
  }
  function saveCfg(){
    try{
      if(typeof localStorage === "undefined" || !localStorage) return false;
      localStorage.setItem(CFG_KEY, JSON.stringify(S.cfg));
      return true;
    }catch(e){ return false; }
  }

  /* ---------------- 数据安全访问 ---------------- */
  function papers(){
    try{
      var D = (typeof DATA !== "undefined" && DATA) ? DATA : (window.DATA || null);
      return (D && isArr(D.papers)) ? D.papers : [];
    }catch(e){ return []; }
  }
  function localFind(pid, qno){
    var ps = papers(), i, j, qs;
    for(i=0;i<ps.length;i++){
      if(!ps[i] || String(ps[i].id) !== String(pid)) continue;
      qs = isArr(ps[i].questions) ? ps[i].questions : [];
      for(j=0;j<qs.length;j++){
        if(qs[j] && String(qs[j].no) === String(qno)) return { p:ps[i], q:qs[j] };
      }
      return { p:ps[i], q:null };
    }
    return null;
  }
  function getPair(pid, qno){
    try{
      if(typeof findQ === "function"){
        var f = findQ(pid, qno);
        if(!f && String(Number(qno)) === String(qno)) f = findQ(pid, Number(qno));
        if(f && f.p) return f;
      }
    }catch(e){}
    try{
      if(typeof window.findQ === "function"){
        var g = window.findQ(pid, qno);
        if(g && g.p) return g;
      }
    }catch(e){}
    try{ return localFind(pid, qno); }catch(e){ return null; }
  }
  function paperName(p, pid){
    if(!p) return String(pid || "未登记套卷");
    var pv = String(p.province || "");
    var s  = String(p.year || "") + (pv && pv !== "国考" ? pv : (pv ? "国考" : "")) + String(p.paper || "");
    s = s.trim();
    return s || String(pid || "未登记套卷");
  }
  function scoreOf(rec){
    var s = null;
    try{ s = rec.score; }catch(e){ return null; }
    if(typeof s !== "number" || isNaN(s)){
      if(rec && typeof rec.rate === "number" && !isNaN(rec.rate)) s = rec.rate * 100;
      else return null;
    }
    s = Math.round(s);
    if(s < 0) s = 0;
    if(s > 100) s = 100;
    return s;
  }

  /* ---------------- 汇集记录 ---------------- */
  function buildItems(){
    ITEMS = [];
    var map = null;
    try{
      if(typeof localStorage === "undefined" || !localStorage) return;
      var raw = localStorage.getItem(ANS_KEY);
      if(!raw) return;
      map = JSON.parse(raw);
      if(!map || typeof map !== "object") return;
    }catch(e){ return; }

    var keys;
    try{ keys = Object.keys(map); }catch(e){ return; }

    for(var i=0;i<keys.length;i++){
      var k = String(keys[i]), rec = null;
      try{ rec = map[keys[i]]; }catch(e){ rec = null; }
      if(!rec || typeof rec !== "object") continue;

      var cut = k.lastIndexOf("#");
      var pid = cut > 0 ? k.slice(0, cut) : k;
      var qno = cut > 0 ? k.slice(cut + 1) : "";

      var pair = getPair(pid, qno);
      var p = (pair && pair.p) ? pair.p : null;
      var q = (pair && pair.q) ? pair.q : null;

      var pr = (rec.process && typeof rec.process === "object") ? rec.process : null;
      var tags = [];
      if(pr && isArr(pr.tags)){
        for(var t=0;t<pr.tags.length;t++){
          var tv = tagSafe(pr.tags[t]);
          if(tv) tags.push(tv);
        }
      }
      var d = dateOf(rec.ts);
      ITEMS.push({
        idx:   i,
        pid:   pid,
        qno:   qno,
        d:     d,
        ts:    (d ? d.getTime() : null),
        paper: paperName(p, pid),
        qtype: String(rec.qtype || (q && q.qtype) || "").trim(),
        score: scoreOf(rec),
        hit:   (typeof rec.hitCount === "number" && !isNaN(rec.hitCount)) ? rec.hitCount : null,
        total: (typeof rec.total === "number" && !isNaN(rec.total)) ? rec.total : null,
        tags:  tags,
        note:  (pr && typeof pr.note === "string") ? pr.note.trim() : "",
        text:  (typeof rec.text === "string") ? rec.text : ""
      });
    }

    ITEMS.sort(function(a, b){
      if(a.ts == null && b.ts == null) return a.idx - b.idx;
      if(a.ts == null) return -1;
      if(b.ts == null) return 1;
      if(a.ts !== b.ts) return a.ts - b.ts;
      return a.idx - b.idx;
    });
  }

  /* 范围过滤：scopeDays 为 null / 非数字＝全部；数字＝近 N 天（无时间戳的老记录一并保留在全部里） */
  function pickScope(scopeDays){
    var n = (scopeDays == null) ? null : num(scopeDays, null);
    if(n == null || isNaN(n) || n <= 0) return ITEMS.slice(0);
    var cut = Date.now() - n * 86400000, out = [], i;
    for(i=0;i<ITEMS.length;i++){
      if(ITEMS[i].ts != null && ITEMS[i].ts >= cut) out.push(ITEMS[i]);
    }
    return out;
  }
  function scopeDaysOfCfg(){
    var c = S.cfg || DEF;
    if(c.scope === "d7")  return 7;
    if(c.scope === "d30") return 30;
    if(c.scope === "dn")  return Math.max(1, num(c.days, DEF.days));
    return null;
  }
  function scopeLabel(){
    var c = S.cfg || DEF;
    if(c.scope === "d7")  return "近 7 天";
    if(c.scope === "d30") return "近 30 天";
    if(c.scope === "dn")  return "近 " + Math.max(1, num(c.days, DEF.days)) + " 天";
    return "全部记录";
  }

  /* ---------------- ASCII 折线图 ---------------- */
  var BLOCKS = ["▁","▂","▃","▄","▅","▆","▇","█"];

  function rep(s, n){
    var o = "", i;
    for(i=0;i<n;i++) o += s;
    return o;
  }

  function chartText(list){
    var pts = [], labs = [], i, j;
    for(i=0;i<list.length;i++){
      if(list[i].score != null){ pts.push(list[i].score); labs.push(list[i].d); }
    }
    if(!pts.length) return "（本范围内还没有算出命中率的记录：先在作答里对一次采分点，这里就会长出折线）";
    if(pts.length > CHARTN){
      pts  = pts.slice(pts.length - CHARTN);
      labs = labs.slice(labs.length - CHARTN);
    }

    var rows = [100, 80, 60, 40, 20, 0];
    var out = [], line, ri, k, at;

    for(ri=0; ri<rows.length; ri++){
      line = ("  " + rows[ri]).slice(-3) + "% |";
      for(k=0; k<pts.length; k++){
        at = Math.round((100 - pts[k]) / 20);
        line += (at === ri ? "# " : "  ");
      }
      out.push(line);
    }
    out.push("     +" + rep("-", pts.length * 2));

    var spark = "";
    for(k=0; k<pts.length; k++){
      var bi = Math.floor(pts[k] / 12.5);
      if(bi > 7) bi = 7;
      if(bi < 0) bi = 0;
      spark += BLOCKS[bi];
    }
    out.push("");
    out.push("折线速览：" + spark);
    var lb0 = labs[0] ? fmtD(labs[0]) : "更早";
    var lb1 = labs[labs.length - 1] ? fmtD(labs[labs.length - 1]) : "更早";
    out.push("样本 " + pts.length + " 次（由早到近）　" + lb0 + " → " + lb1 +
             "　最低 " + Math.min.apply(null, pts) + "%　最高 " + Math.max.apply(null, pts) + "%");
    return out.join("\n");
  }

  /* ---------------- Top 难点 ---------------- */
  function topTags(list, n){
    var cnt = {}, i, j, out = [];
    for(i=0;i<list.length;i++){
      for(j=0;j<list[i].tags.length;j++){
        cnt[list[i].tags[j]] = (cnt[list[i].tags[j]] || 0) + 1;
      }
    }
    try{
      out = Object.keys(cnt).map(function(k){ return { t:k, c:cnt[k] }; });
    }catch(e){ out = []; }
    out.sort(function(a, b){ return (b.c - a.c) || (a.t < b.t ? -1 : 1); });
    return out.slice(0, n);
  }

  /* ---------------- 生成 Markdown ---------------- */
  function mdText(scopeDays){
    try{
      if(!ITEMS.length) buildItems();
      var list = pickScope(scopeDays);
      var now  = new Date();
      var lab  = (scopeDays == null || isNaN(num(scopeDays, NaN)) || num(scopeDays, 0) <= 0)
                   ? "全部记录" : ("近 " + num(scopeDays, 0) + " 天");

      if(!list.length){
        return "# 申论成长史\n\n> 生成于 " + fmtDT(now) + " · 范围：" + lab +
               "\n\n本范围内没有作答记录。换成「全部记录」再生成一次，或者先去真题库做两题。\n";
      }

      var first = null, last = null, i, j;
      for(i=0;i<list.length;i++){ if(list[i].d){ first = list[i].d; break; } }
      for(i=list.length-1;i>=0;i--){ if(list[i].d){ last = list[i].d; break; } }
      S.span = fmtD(first) + " → " + fmtD(last);

      var sc = [];
      for(i=0;i<list.length;i++) if(list[i].score != null) sc.push(list[i].score);
      var mean = avg(sc);

      /* 趋势对比 */
      var trend;
      if(sc.length < 2){
        trend = "样本还不够（只有 " + sc.length + " 次带命中率的记录），再做几题就能算趋势";
      }else{
        var rec = sc.slice(Math.max(0, sc.length - WIN));
        var pre = sc.slice(Math.max(0, sc.length - rec.length - WIN), sc.length - rec.length);
        var ra  = avg(rec);
        if(!pre.length){
          trend = "近 " + rec.length + " 次平均 " + ra + "%（暂无更早的对照样本）";
        }else{
          var ba = avg(pre), dv = ra - ba;
          var mk = dv > 0 ? ("🔺 +" + dv) : (dv < 0 ? ("🔻 " + dv) : "➖ 0");
          trend = "近 " + rec.length + " 次平均 " + ra + "% · 此前 " + pre.length + " 次平均 " + ba + "% · " +
                  mk + " 个百分点";
        }
      }

      /* 常卡难点 */
      var tops = topTags(list, TOPN), topStr = "";
      if(tops.length){
        var ts = [];
        for(i=0;i<tops.length;i++) ts.push("#" + tops[i].t + " (" + tops[i].c + "次)");
        topStr = ts.join(" · ");
      }else{
        topStr = "还没勾过难点标签（作答提交时勾一勾「卡在哪」，这里会长出薄弱画像）";
      }

      var L = [];
      L.push("---");
      L.push("tags: [申论, 成长史]");
      L.push("created: " + fmtDT(now));
      L.push("scope: " + lab);
      L.push("---");
      L.push("");
      L.push("# 申论成长史 · " + S.span);
      L.push("");
      L.push("> 由「求是申论素材库 · 成长史双推」生成于 " + fmtDT(now) + " · 范围：" + lab +
             " · 共 " + list.length + " 条");
      L.push("");
      L.push("## 概览");
      L.push("");
      L.push("- 总作答：" + list.length + " 次 · 平均命中率：" + (mean == null ? "—" : (mean + "%")) +
             " · 最早 " + fmtD(first) + " · 最近 " + fmtD(last));
      L.push("- 近 " + WIN + " 次 vs 前 " + WIN + " 次：" + trend);
      L.push("- 常卡难点 Top" + TOPN + "：" + topStr);
      L.push("");
      L.push("## 趋势图");
      L.push("");
      L.push("```");
      L.push(chartText(list));
      L.push("```");
      L.push("");
      L.push("## 时间线");
      L.push("");

      for(i=0;i<list.length;i++){
        var it = list[i];
        var head = fmtD(it.d) + " · " + linkSafe(it.paper) + " · 第" + linkSafe(it.qno) + "题";
        if(it.qtype) head += " · " + linkSafe(it.qtype);
        head += " · 命中率 " + (it.score == null ? "未评" : (it.score + "%"));
        L.push("### " + head);
        L.push("");
        L.push("- 套卷：[[" + linkSafe(it.paper) + "]]");
        L.push("- 题型：" + (it.qtype ? ("[[" + linkSafe(it.qtype) + "]]") : "未登记"));
        if(it.hit != null && it.total != null){
          L.push("- 采分点：命中 " + it.hit + " / " + it.total);
        }
        if(it.tags.length){
          var tg = [];
          for(j=0;j<it.tags.length;j++) tg.push("#" + it.tags[j]);
          L.push("- 难点标签：" + tg.join(" "));
        }
        if(it.note) L.push("- 反思：" + oneLine(it.note));
        if(it.text){
          var body = oneLine(it.text);
          var cutd = body.length > SUMLEN;
          L.push("- 答案摘要（首 " + SUMLEN + " 字）：" + body.slice(0, SUMLEN) + (cutd ? "……" : ""));
        }
        L.push("");
      }

      L.push("---");
      L.push("");
      L.push("（本文件由离线网页生成，可安全放进 Vault；重复生成会得到同名文件，注意按日期区分）");
      L.push("");
      return L.join("\n");
    }catch(err){
      try{ console.error("[_b19] mdText", err); }catch(e){}
      return "# 申论成长史\n\n生成时出错：" + String((err && err.message) || err) + "\n";
    }
  }

  /* ---------------- 文件名 ---------------- */
  function fileName(){
    var c = S.cfg || DEF, d = new Date();
    var s = String(c.tpl || DEF.tpl)
      .replace(/\{YYYY\}/g, String(d.getFullYear()))
      .replace(/\{MM\}/g,   pad(d.getMonth() + 1))
      .replace(/\{DD\}/g,   pad(d.getDate()))
      .replace(/\{HH\}/g,   pad(d.getHours()))
      .replace(/\{mm\}/g,   pad(d.getMinutes()));
    s = s.replace(/[\\\/:\*\?<>\|]+/g, "-").replace(/\.md$/i, "").trim();
    return s || "成长史";
  }
  function subDir(){
    var c = S.cfg || DEF;
    return String(c.subdir || DEF.subdir).replace(/^\/+|\/+$/g, "").replace(/\\/g, "/");
  }

  /* ---------------- 复制 / 下载 ---------------- */
  function fallbackCopy(text){
    try{
      if(typeof document === "undefined" || !document.body) return false;
      var ta = document.createElement("textarea");
      ta.value = String(text == null ? "" : text);
      ta.setAttribute("readonly", "readonly");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.select();
      try{ ta.setSelectionRange(0, ta.value.length); }catch(e){}
      var ok = false;
      try{ ok = document.execCommand("copy"); }catch(e){ ok = false; }
      try{ document.body.removeChild(ta); }catch(e){}
      return !!ok;
    }catch(e){ return false; }
  }

  /* 共用复制：优先 navigator.clipboard，失败降级 textarea + execCommand
     cb 可选：cb(ok)。同步返回值仅在走降级路径时可靠。 */
  function copyText(text, cb){
    var s = String(text == null ? "" : text);
    var done = function(ok){ if(typeof cb === "function"){ try{ cb(!!ok); }catch(e){} } };
    try{
      if(navigator && navigator.clipboard && typeof navigator.clipboard.writeText === "function"){
        navigator.clipboard.writeText(s).then(function(){ done(true); }, function(){
          done(fallbackCopy(s));
        });
        return true;
      }
    }catch(e){}
    var ok2 = fallbackCopy(s);
    done(ok2);
    return ok2;
  }

  function downloadMd(text, name){
    try{
      if(typeof Blob === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) return false;
      var blob = new Blob(["\ufeff" + String(text == null ? "" : text)],
                          { type: "text/markdown;charset=utf-8" });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement("a");
      a.href = url;
      a.download = String(name || "成长史") + ".md";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(function(){
        try{ document.body.removeChild(a); }catch(e){}
        try{ URL.revokeObjectURL(url); }catch(e){}
      }, 400);
      return true;
    }catch(e){ return false; }
  }

  function advUri(){
    var c = S.cfg || DEF;
    var path = subDir() + "/" + fileName() + ".md";
    var q = "vault=" + encodeURIComponent(c.vault || DEF.vault) +
            "&filepath=" + encodeURIComponent(path) +
            "&clipboard=true&mode=new";
    return "obsidian://advanced-uri?" + q;
  }

  /* ---------------- 顶部飞一行提示 ---------------- */
  var FT = null;
  function flash(msg, bad){
    S.flash = String(msg == null ? "" : msg);
    S.bad   = !!bad;
    try{
      var el = document.getElementById("b19-flash");
      if(!el) return;
      el.className = "b19-flash on" + (bad ? " bad" : "");
      el.innerHTML = (bad ? "⚠️ " : "✅ ") + esc(S.flash);
      if(FT){ try{ clearTimeout(FT); }catch(e){} FT = null; }
      FT = setTimeout(function(){
        try{
          var e2 = document.getElementById("b19-flash");
          if(e2){ e2.className = "b19-flash"; e2.innerHTML = ""; }
        }catch(e){}
        S.flash = ""; FT = null;
      }, 2600);
    }catch(e){}
  }

  /* ---------------- 片段 ---------------- */
  function cfgHtml(){
    var c = S.cfg;
    function radio(v, txt){
      return '<label class="b19-radio' + (c.scope === v ? " on" : "") + '">' +
               '<input type="radio" name="b19scope" value="' + v + '"' +
               (c.scope === v ? " checked" : "") + '>' + esc(txt) + '</label>';
    }
    return '<div class="b19-card">' +
        '<div class="b19-h3"><span class="b19-num">1</span>配置：写到哪个 Vault 目录</div>' +
        '<div class="b19-grid">' +
          '<label class="b19-field"><span>Vault 子目录</span>' +
            '<input id="b19-subdir" class="b19-inp" type="text" value="' + esc(c.subdir) +
              '" placeholder="国考申论/成长史"></label>' +
          '<label class="b19-field"><span>文件名模板</span>' +
            '<input id="b19-tpl" class="b19-inp" type="text" value="' + esc(c.tpl) +
              '" placeholder="成长史-{YYYY}-{MM}-{DD}"></label>' +
        '</div>' +
        '<div class="b19-hint">模板可用占位符：{YYYY} {MM} {DD} {HH} {mm}　当前会生成 ' +
          '<b>' + esc(subDir()) + "/" + esc(fileName()) + '.md</b></div>' +
        '<div class="b19-scope">' +
          '<span class="b19-lb">推送范围</span>' +
          radio("all", "全部记录") + radio("d7", "近 7 天") + radio("d30", "近 30 天") +
          radio("dn", "近 N 天") +
          '<input id="b19-days" class="b19-inp b19-days" type="number" min="1" max="3650" value="' +
            esc(String(c.days)) + '"' + (c.scope === "dn" ? "" : " disabled") + '>' +
          '<span class="b19-lb2">天</span>' +
        '</div>' +
        '<div class="b19-advline">' +
          '<label class="b19-check"><input type="checkbox" id="b19-adv"' + (c.adv ? " checked" : "") +
            '>我装了 Advanced URI 插件（可选，显示一键跳转链接）</label>' +
          '<label class="b19-field b19-vault' + (c.adv ? "" : " off") + '"><span>Vault 名称</span>' +
            '<input id="b19-vault" class="b19-inp" type="text" value="' + esc(c.vault) +
              '" placeholder="ObsidianVault"></label>' +
        '</div>' +
        '<div class="b19-actions">' +
          '<button class="b19-btn primary" data-b19="gen">🧾 生成 Markdown</button>' +
          '<button class="b19-btn" data-b19="reset">↺ 恢复默认配置</button>' +
          '<span class="b19-cnt">本机共 ' + ITEMS.length + ' 条作答记录</span>' +
        '</div>' +
      '</div>';
  }

  function guideHtml(){
    var path = subDir(), fn = fileName() + ".md";
    var adv  = (S.cfg && S.cfg.adv) ?
      ('<div class="b19-uri">锦上添花：先点复制，再点这条链接，Advanced URI 会直接新建文件并粘贴 → ' +
         '<a class="b19-link" href="' + esc(advUri()) + '">obsidian://advanced-uri（新建 ' + esc(fn) + '）</a>' +
       '</div>') : "";
    return '<div class="b19-card b19-guide">' +
        '<div class="b19-h3"><span class="b19-num">3</span>落地：粘到 Obsidian 里</div>' +
        '<ol class="b19-ol">' +
          '<li>打开 Obsidian，切到你的 Vault（长期记忆库根目录：<code>D:/workbuddy/ObsidianVault/</code>）。</li>' +
          '<li>进入子目录 <code>' + esc(path) + '</code>（没有就先新建这个文件夹，Obsidian 里右键左侧目录 → 新建文件夹）。</li>' +
          '<li>在该目录下新建笔记，文件名填 <code>' + esc(fn) + '</code>。</li>' +
          '<li>光标放进正文，Ctrl+V 粘贴，Ctrl+S 保存。双链 <code>[[套卷名]]</code> 会自动生成关系图。</li>' +
        '</ol>' +
        '<div class="b19-warn">说明：浏览器有沙箱限制，网页不能直接往你磁盘写文件，' +
          '所以这里只负责把内容准备好；真正落盘的一步由你粘贴完成，最安全也最可控。</div>' +
        adv +
      '</div>';
  }

  function previewHtml(){
    if(!S.md){
      return '<div class="b19-card">' +
          '<div class="b19-h3"><span class="b19-num">2</span>预览与推送</div>' +
          '<div class="b19-empty">还没生成。选好范围后点上面的「生成 Markdown」。</div>' +
        '</div>';
    }
    var lines = S.md.split("\n").length;
    return '<div class="b19-card">' +
        '<div class="b19-h3"><span class="b19-num">2</span>预览与推送' +
          '<span class="b19-sub">' + esc(scopeLabel()) + " · " + S.md.length + " 字 · " +
            lines + ' 行</span></div>' +
        '<div class="b19-actions">' +
          '<button class="b19-btn primary" data-b19="copy">📋 复制全文</button>' +
          '<button class="b19-btn" data-b19="dl">💾 下载为 .md</button>' +
          '<button class="b19-btn" data-b19="sel">🔎 全选文本框</button>' +
        '</div>' +
        '<textarea id="b19-md" class="b19-md" readonly spellcheck="false">' + esc(S.md) + '</textarea>' +
      '</div>';
  }

  /* ---------------- 渲染 ---------------- */
  function draw(){
    ensureCss();
    var box = null;
    try{ box = document.getElementById("content"); }catch(e){ box = null; }
    if(!box) return;

    if(FT){ try{ clearTimeout(FT); }catch(e){} FT = null; }
    if(!S.cfg) S.cfg = loadCfg();
    buildItems();

    try{
      var st = document.getElementById("stats");
      if(st) st.textContent = "成长史双推 · 本机 " + ITEMS.length + " 条作答记录 · 目标 " + subDir();
    }catch(e){}

    box.innerHTML = '<div class="b19-wrap">' +
        '<div class="b19-head">' +
          '<h2>🔁 申论成长史 → Obsidian 双推</h2>' +
          '<p class="b19-lead">怎么用：' +
            '<b>①</b> 配置 Vault 子目录和文件名　' +
            '<b>②</b> 选推送范围（全部 / 近 7 天 / 近 30 天 / 近 N 天）　' +
            '<b>③</b> 点「生成 Markdown」　' +
            '<b>④</b> 点「复制全文」　' +
            '<b>⑤</b> 打开 Vault 里的目标目录，新建同名文件粘贴保存。</p>' +
        '</div>' +
        '<div id="b19-flash" class="b19-flash"></div>' +
        cfgHtml() +
        previewHtml() +
        guideHtml() +
      '</div>';

    bind(box);
  }

  /* 只重画配置卡里的路径提示，避免打字时整页重绘 */
  function refreshHint(){
    try{
      var box = document.getElementById("content");
      if(!box) return;
      var hs = box.getElementsByClassName("b19-hint");
      if(hs && hs.length){
        hs[0].innerHTML = "模板可用占位符：{YYYY} {MM} {DD} {HH} {mm}　当前会生成 <b>" +
          esc(subDir()) + "/" + esc(fileName()) + ".md</b>";
      }
    }catch(e){}
  }

  /* ---------------- 事件（委托，不用内联 onclick） ---------------- */
  function syncInputs(){
    try{
      var v;
      v = document.getElementById("b19-subdir");
      if(v && String(v.value).trim()) S.cfg.subdir = String(v.value).trim();
      v = document.getElementById("b19-tpl");
      if(v && String(v.value).trim()) S.cfg.tpl = String(v.value).trim();
      v = document.getElementById("b19-days");
      if(v) S.cfg.days = Math.max(1, num(v.value, DEF.days));
      v = document.getElementById("b19-vault");
      if(v && String(v.value).trim()) S.cfg.vault = String(v.value).trim();
      v = document.getElementById("b19-adv");
      if(v) S.cfg.adv = !!v.checked;
    }catch(e){}
  }

  function bind(root){
    if(root.__b19bound) return;
    root.__b19bound = true;

    root.addEventListener("input", function(ev){
      var el = ev.target;
      if(!el || !el.id) return;
      if(el.id === "b19-subdir" || el.id === "b19-tpl" || el.id === "b19-days" || el.id === "b19-vault"){
        syncInputs(); saveCfg(); refreshHint();
      }
    });

    root.addEventListener("change", function(ev){
      var el = ev.target;
      if(!el) return;
      if(el.name === "b19scope"){
        S.cfg.scope = String(el.value || "all");
        syncInputs(); saveCfg(); draw(); return;
      }
      if(el.id === "b19-adv"){
        syncInputs(); saveCfg(); draw(); return;
      }
    });

    root.addEventListener("click", function(ev){
      var el = ev.target, act = null;
      while(el && el !== root){
        act = el.getAttribute && el.getAttribute("data-b19");
        if(act) break;
        el = el.parentNode;
      }
      if(!act) return;

      if(act === "gen"){
        syncInputs(); saveCfg();
        S.md = mdText(scopeDaysOfCfg());
        draw();
        flash("已生成 " + scopeLabel() + " 的 Markdown，接着点「复制全文」", false);
        return;
      }

      if(act === "reset"){
        S.cfg = { subdir:DEF.subdir, tpl:DEF.tpl, scope:DEF.scope, days:DEF.days, vault:DEF.vault, adv:DEF.adv };
        saveCfg(); draw();
        flash("已恢复默认配置", false);
        return;
      }

      if(act === "copy"){
        if(!S.md){ flash("还没生成内容", true); return; }
        copyText(S.md, function(ok){
          if(ok) flash("已复制到剪贴板", false);
          else   flash("浏览器拒绝了复制：请在下方文本框里手动全选（Ctrl+A）再复制（Ctrl+C）", true);
        });
        return;
      }

      if(act === "dl"){
        if(!S.md){ flash("还没生成内容", true); return; }
        if(downloadMd(S.md, fileName())) flash("已触发下载：" + fileName() + ".md（记得移到 Vault 目录里）", false);
        else flash("当前环境不支持下载，请改用「复制全文」", true);
        return;
      }

      if(act === "sel"){
        try{
          var ta = document.getElementById("b19-md");
          if(ta){ ta.focus(); ta.select(); flash("已全选，按 Ctrl+C 复制", false); }
        }catch(e){}
        return;
      }
    });
  }

  /* ---------------- 对外入口 ---------------- */
  window.renderGrowthPush = function(){
    try{
      if(!S.cfg) S.cfg = loadCfg();
      draw();
    }catch(err){
      try{
        var box = document.getElementById("content");
        if(box) box.innerHTML = '<div class="b19-empty">成长史双推运行出错：' +
          esc(String((err && err.message) || err)) + '</div>';
      }catch(e){}
      try{ console.error("[_b19]", err); }catch(e){}
    }
  };

  /* 供其它模块 / 自测调用：scopeDays 为 null＝全部，数字＝近 N 天 */
  window.b19MdText = function(scopeDays){
    try{
      if(!S.cfg) S.cfg = loadCfg();
      buildItems();
      return mdText(scopeDays == null ? null : scopeDays);
    }catch(e){ return ""; }
  };

  /* 共用复制函数：b19CopyToClipboard(text[, cb]) */
  window.b19CopyToClipboard = function(text, cb){ return copyText(text, cb); };

})();
