(function(){
  "use strict";
  /* ==================================================================
     _b20 同类薄弱题聚合（Weak-Point Aggregator）
     以「你历次作答勾选的难点标签」反向聚合同类题，做专项打穿。
     只读 shenlun_answers_v2；只写 shenlun_today_v1（加入今日清单）。
     暴露 window.renderWeakAgg，全部类名 b20- 前缀，纯前端零依赖。
     ================================================================== */

  var ANS_KEY   = "shenlun_answers_v2";
  var TODAY_KEY = "shenlun_today_v1";
  var MAX_PER_BUCKET = 10;   /* 每个弱点桶最多推荐题数 */
  var TOP_WEAK       = 7;    /* 弱点画像展示前 N 个 */
  var OPEN_DEFAULT   = 3;    /* 默认展开的分组数 */
  var TODAY_CAP      = 200;  /* 今日清单上限 */

  /* 自带 HTML 转义（优先复用主站 esc） */
  var esc = window.esc || function(s){
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };
  /* 属性值转义：额外处理单双引号，避免属性截断 */
  function attr(s){
    return esc(s).replace(/'/g, "&#39;").replace(/\u0022/g, "&quot;");
  }

  /* 模块内状态（不碰主站 state） */
  var S = {
    open: null,      /* {tag:true} 展开状态；null 表示未初始化，按默认展开 Top3 */
    focus: "",       /* 一键专攻聚焦的标签 */
    flash: ""        /* 顶部一次性提示 */
  };

  /* ---------------- 弱点标签归一（库里真实标签 → 规范键） ---------------- */
  var TAG_ALIAS = {
    "不会归纳概括": "不会归纳",
    "归纳概括弱":   "不会归纳",
    "原词还是提炼": "原词vs提炼",
    "原词或提炼":   "原词vs提炼",
    "不知格式规范": "不知格式",
    "格式不会":     "不知格式",
    "不知道写什么": "不知写什么",
    "题干看不懂":   "看不懂题干",
    "找不到点":     "找不到材料",
    "时间不足":     "时间不够"
  };
  function normTag(t){
    t = String(t == null ? "" : t).replace(/^\s+|\s+$/g, "");
    return TAG_ALIAS[t] || t;
  }

  /* ---------------- B. 弱点 → 题型映射表 ---------------- */
  var TAG_TO_QTYPE = {
    "找不到材料":  ["概括题", "分析题", "对策题", "公文题"],
    "不会归纳":    ["概括题", "分析题"],
    "原词vs提炼":  ["概括题"],
    "不知格式":    ["公文题"],
    "不知写什么":  ["大作文", "对策题"],
    "看不懂题干":  ["分析题", "公文题", "大作文"],
    "时间不够":    ["概括题", "对策题", "大作文"]
  };

  /* ---------------- C. 弱点 → 题干关键词映射 ---------------- */
  var TAG_TO_KEYWORDS = {
    "找不到材料":  ["概括", "总结", "归纳", "提炼", "梳理", "指出", "分析"],
    "不会归纳":    ["概括", "总结", "归纳", "提炼", "概述"],
    "原词vs提炼":  ["概括", "归纳", "提炼"],
    "不知格式":    ["通知", "倡议书", "讲话稿", "报告", "函", "公开信", "建议", "简报", "短评", "提纲", "宣传"],
    "不知写什么":  ["为题", "围绕", "结合", "论述", "文章", "自拟"],
    "看不懂题干":  ["谈谈", "分析", "阐述", "说明", "理解", "看法"],
    "时间不够":    []
  };

  /* 教练一句话（每个弱点的打穿要领） */
  var TAG_TIP = {
    "找不到材料":  "先练「圈画定位」：读题圈主体+对象，回材料只找这一类信息。",
    "不会归纳":    "先练「同类合并」：去例子、留观点，一条一个核心词。",
    "原词vs提炼":  "先练「转化判断」：政策术语照抄，口语现象提炼成规范词。",
    "不知格式":    "先练「文种模板」：标题-称谓-正文-落款，背熟五种常考文种。",
    "不知写什么":  "先练「立意+分论点」：从材料主旨切三刀，别自己另起炉灶。",
    "看不懂题干":  "先练「拆题干」：作答对象、范围、限定词，逐个标出来再动笔。",
    "时间不够":    "先练「限时找点」：小题按分值卡时间，作文留够 50 分钟。"
  };

  /* ---------------- 样式自挂载（主站未 link _b20.css 时兜底） ---------------- */
  function ensureCss(){
    try{
      var ls = document.getElementsByTagName("link"), i;
      for(i = 0; i < ls.length; i++){
        if(String(ls[i].getAttribute("href") || "").indexOf("_b20.css") >= 0) return;
      }
      var el = document.createElement("link");
      el.rel = "stylesheet"; el.href = "_b20.css";
      (document.head || document.documentElement).appendChild(el);
    }catch(e){}
  }

  /* ---------------- 安全访问 ---------------- */
  function isArr(x){ return Object.prototype.toString.call(x) === "[object Array]"; }
  function D(){
    try{ return (typeof DATA !== "undefined" && DATA) ? DATA : (window.DATA || null); }
    catch(e){ return null; }
  }
  function papers(){
    try{ var d = D(); return (d && isArr(d.papers)) ? d.papers : []; }catch(e){ return []; }
  }
  function loadAnswers(){
    try{
      var raw = localStorage.getItem(ANS_KEY);
      var o = raw ? JSON.parse(raw) : {};
      return (o && typeof o === "object") ? o : {};
    }catch(e){ return {}; }
  }
  function loadToday(){
    try{
      var raw = localStorage.getItem(TODAY_KEY);
      var a = raw ? JSON.parse(raw) : [];
      return isArr(a) ? a : [];
    }catch(e){ return []; }
  }
  function saveToday(a){
    try{
      if(!isArr(a)) a = [];
      if(a.length > TODAY_CAP) a = a.slice(a.length - TODAY_CAP);
      localStorage.setItem(TODAY_KEY, JSON.stringify(a));
      return true;
    }catch(e){ return false; }
  }
  function keyOf(pid, qno){ return String(pid) + "#" + String(qno); }
  function inToday(pid, qno){
    var a = loadToday(), i;
    for(i = 0; i < a.length; i++){
      if(a[i] && String(a[i].pid) === String(pid) && String(a[i].qno) === String(qno)) return true;
    }
    return false;
  }
  function addToday(pid, qno, tag){
    if(inToday(pid, qno)) return "already";
    var a = loadToday();
    a.push({ pid: String(pid), qno: qno, ts: Date.now(), tag: String(tag || "") });
    return saveToday(a) ? "ok" : "fail";
  }

  /* ---------------- 题型归一：库里 qtype → 规范题型类目 ---------------- */
  function qtypeCat(t){
    t = String(t == null ? "" : t);
    if(!t) return "";
    if(t.indexOf("概括") >= 0 || t.indexOf("归纳") >= 0) return "概括题";
    if(t.indexOf("贯彻") >= 0 || t.indexOf("公文") >= 0 || t.indexOf("应用文") >= 0) return "公文题";
    if(t.indexOf("对策") >= 0 || t.indexOf("建议") >= 0) return "对策题";
    if(t.indexOf("作文") >= 0 || t.indexOf("文章") >= 0 || t.indexOf("写作") >= 0) return "大作文";
    if(t.indexOf("分析") >= 0 || t.indexOf("理解") >= 0) return "分析题";
    return "";
  }

  /* ---------------- 题库索引（每次渲染构建一次） ---------------- */
  function buildIndex(){
    var list = [];
    try{
      var ps = papers(), i, j;
      for(i = 0; i < ps.length; i++){
        var p = ps[i];
        if(!p || !isArr(p.questions)) continue;
        for(j = 0; j < p.questions.length; j++){
          var q = p.questions[j];
          if(!q) continue;
          var txt = "";
          try{
            if(isArr(q.stem))     txt += q.stem.join(" ");
            if(isArr(q.material)) txt += " " + q.material.join(" ");
            else if(typeof q.material === "string") txt += " " + q.material;
          }catch(e){ txt = ""; }
          list.push({
            pid:   p.id,
            qno:   q.no,
            year:  p.year,
            label: String(p.year == null ? "" : p.year) +
                   String(p.province || "") + String(p.paper || ""),
            qtype: String(q.qtype || ""),
            cat:   qtypeCat(q.qtype),
            text:  txt.slice(0, 3000)
          });
        }
      }
    }catch(e){}
    return list;
  }

  /* ---------------- 聚合过程标签 ---------------- */
  function aggregate(){
    var data = loadAnswers();
    var count = {};             /* 规范tag -> 次数 */
    var byKey = {};             /* pid#qno -> {score, tags[], answered} */
    var totalRec = 0, withProc = 0;
    try{
      Object.keys(data).forEach(function(k){
        var rec = data[k];
        if(!rec || typeof rec !== "object") return;
        totalRec++;
        var sc = null;
        if(typeof rec.score === "number") sc = rec.score;
        else if(typeof rec.total === "number" && rec.total > 0)
          sc = Math.round((Number(rec.hitCount) || 0) / rec.total * 100);
        var tags = [];
        var pr = rec.process;
        if(pr && typeof pr === "object" && isArr(pr.tags)){
          pr.tags.forEach(function(t){
            var nt = normTag(t);
            if(!nt) return;
            tags.push(nt);
            count[nt] = (count[nt] || 0) + 1;
          });
          if(tags.length) withProc++;
        }
        byKey[k] = { score: sc, tags: tags, answered: true };
      });
    }catch(e){}
    var sorted = Object.keys(count).map(function(t){ return { tag: t, n: count[t] }; })
      .sort(function(a, b){ return b.n - a.n; });
    return { count: count, sorted: sorted, byKey: byKey, totalRec: totalRec, withProc: withProc };
  }

  /* ---------------- 单个弱点 → 同类题桶 ---------------- */
  function buildBucket(tag, idx, agg){
    var cats = TAG_TO_QTYPE[tag] || [];
    var kws  = TAG_TO_KEYWORDS[tag] || [];
    var hitCats = {}, hitKws = {};
    var out = [], i, j;

    for(i = 0; i < idx.length; i++){
      var it = idx[i];
      var rec = agg.byKey[keyOf(it.pid, it.qno)] || null;
      var why = [], w = 0;

      /* 条件1：题型同类 */
      for(j = 0; j < cats.length; j++){
        if(it.cat && it.cat === cats[j]){
          why.push("题型≈" + cats[j]); w += 2; hitCats[cats[j]] = 1; break;
        }
      }
      /* 条件2：题干/材料含弱点关键词 */
      for(j = 0; j < kws.length; j++){
        if(kws[j] && it.text.indexOf(kws[j]) >= 0){
          why.push("题干含「" + kws[j] + "」"); w += 1; hitKws[kws[j]] = 1; break;
        }
      }
      /* 条件3：这道题你已经卡过同一个点 */
      if(rec && rec.tags && rec.tags.length){
        for(j = 0; j < rec.tags.length; j++){
          if(rec.tags[j] === tag){ why.push("你在此题卡过"); w += 3; break; }
        }
      }
      if(!why.length) continue;

      var sc = (rec && typeof rec.score === "number") ? rec.score : null;
      out.push({
        pid: it.pid, qno: it.qno, label: it.label, qtype: it.qtype, cat: it.cat,
        year: Number(it.year) || 0,
        answered: !!rec, score: sc, why: why, w: w
      });
    }

    /* 兜底：条件全不命中时，给出通用推荐，保证桶非空 */
    if(!out.length){
      for(i = 0; i < idx.length; i++){
        var t2 = idx[i];
        var r2 = agg.byKey[keyOf(t2.pid, t2.qno)] || null;
        out.push({
          pid: t2.pid, qno: t2.qno, label: t2.label, qtype: t2.qtype, cat: t2.cat,
          year: Number(t2.year) || 0,
          answered: !!r2,
          score: (r2 && typeof r2.score === "number") ? r2.score : null,
          why: ["通用推荐"], w: 0
        });
      }
    }

    /* 排序：已答且命中低 → 已答中等 → 未作答 → 已答命中高 */
    function rank(o){
      if(o.answered){
        if(o.score == null) return 1;
        if(o.score < 60) return 0;
        if(o.score < 80) return 1;
        return 3;
      }
      return 2;
    }
    out.sort(function(a, b){
      var ra = rank(a), rb = rank(b);
      if(ra !== rb) return ra - rb;
      if(b.w !== a.w) return b.w - a.w;
      var sa = (a.score == null) ? 101 : a.score;
      var sb = (b.score == null) ? 101 : b.score;
      if(sa !== sb) return sa - sb;
      return b.year - a.year;
    });

    return {
      tag: tag,
      list: out.slice(0, MAX_PER_BUCKET),
      totalFound: out.length,
      cats: Object.keys(hitCats),
      kws: Object.keys(hitKws)
    };
  }

  /* ---------------- 渲染片段 ---------------- */
  function weakChips(sorted){
    if(!sorted.length) return "";
    var h = "", i;
    for(i = 0; i < sorted.length && i < TOP_WEAK; i++){
      var s = sorted[i];
      h += "<span class='b20-weak" + (i < 2 ? " b20-weak-top" : "") + "'>" +
             esc(s.tag) + "<b class='b20-x'>×" + s.n + "</b></span>";
    }
    return h;
  }

  function drillBtns(buckets){
    var h = "", i;
    for(i = 0; i < buckets.length; i++){
      var b = buckets[i];
      h += "<button type='button' class='b20-btn" + (S.focus === b.tag ? " on" : "") +
           "' data-b20act='focus' data-tag='" + attr(b.tag) + "'>练【" + esc(b.tag) +
           "】的同类题（" + b.list.length + " 道）</button>";
    }
    return h;
  }

  function rowHtml(o, tag){
    var right = o.answered
      ? ("你的命中率 <b class='" + (o.score != null && o.score < 60 ? "b20-low" : "b20-ok") + "'>" +
         (o.score == null ? "—" : (o.score + "%")) + "</b>（已答）")
      : "<span class='b20-none'>未作答</span>";
    var whys = "", i;
    for(i = 0; i < o.why.length; i++){
      whys += "<span class='b20-why'>" + esc(o.why[i]) + "</span>";
    }
    var added = inToday(o.pid, o.qno);
    return "<div class='b20-card'>" +
             "<div class='b20-main'>" +
               "<span class='b20-src'>" + esc(o.label) + "</span>" +
               "<span class='b20-sep'>·</span><span class='b20-qno'>第" + esc(o.qno) + "题</span>" +
               "<span class='b20-sep'>·</span><span class='b20-qt'>" + esc(o.cat || o.qtype || "未分类") + "</span>" +
               "<span class='b20-sep'>·</span><span class='b20-rate'>" + right + "</span>" +
               "<span class='b20-whys'>" + whys + "</span>" +
             "</div>" +
             "<div class='b20-ops'>" +
               "<button type='button' class='b20-op' data-b20act='ans' data-pid='" + attr(o.pid) +
                 "' data-qno='" + attr(o.qno) + "'>✍️作答</button>" +
               "<button type='button' class='b20-op b20-add" + (added ? " done" : "") +
                 "' data-b20act='today' data-pid='" + attr(o.pid) + "' data-qno='" + attr(o.qno) +
                 "' data-tag='" + attr(tag) + "'>" + (added ? "✅已在今日" : "📌加入今日") + "</button>" +
             "</div>" +
           "</div>";
  }

  function groupHtml(b, i, n){
    var open = !!(S.open && S.open[b.tag]);
    var catTxt = b.cats.length ? ("题型≈" + b.cats.join(" / ")) : "题型不限";
    var kwTxt  = b.kws.length  ? ("题干含 " + b.kws.slice(0, 5).join(" / ")) : "无关键词命中";
    var sub = "系统从题库按「" + catTxt + "」或「" + kwTxt + "」过滤出 " +
              b.totalFound + " 道同类题，优先推 " + b.list.length + " 道";
    var h = "<section class='b20-group" + (open ? " open" : "") + (S.focus === b.tag ? " focus" : "") +
              "' id='b20g-" + attr(b.tag) + "'>";
    h += "<div class='b20-ghead' data-b20act='toggle' data-tag='" + attr(b.tag) + "'>" +
           "<span class='b20-gt'>" + (i < 2 ? "🔴" : "🟠") + " " + esc(b.tag) +
             "（你卡了 " + n + " 次）" + (i < 2 ? " — 推荐先攻" : "") + "</span>" +
           "<span class='b20-fold'>" + (open ? "收起 ▲" : "展开 ▼") + "</span>" +
         "</div>";
    h += "<div class='b20-gsub'>" + esc(sub) + "</div>";
    if(TAG_TIP[b.tag]) h += "<div class='b20-gtip'>💡 " + esc(TAG_TIP[b.tag]) + "</div>";
    if(open){
      if(!b.list.length){
        h += "<div class='b20-empty'>题库里暂时没有匹配到同类题。</div>";
      }else{
        var s = "", k;
        for(k = 0; k < b.list.length; k++) s += rowHtml(b.list[k], b.tag);
        h += "<div class='b20-list'>" + s + "</div>";
      }
    }
    h += "</section>";
    return h;
  }

  /* ---------------- 主绘制 ---------------- */
  function draw(){
    ensureCss();
    var box = document.getElementById("content");
    if(!box) return;

    var agg = aggregate();
    var head = "<div class='b20-wrap'>" +
      "<div class='b20-hero'>" +
        "<div class='b20-title'>🎯 同类薄弱题聚合</div>" +
        "<div class='b20-coach'>把一类卡点彻底打穿再换下一类，比杂刷 100 道不同题型更提分</div>" +
      "</div>";

    if(S.flash){
      head += "<div class='b20-flash'>" + esc(S.flash) + "</div>";
      S.flash = "";
    }

    /* 空状态 */
    if(!agg.sorted.length){
      box.innerHTML = head +
        "<div class='b20-empty b20-empty-big'>还没过程笔记记录，去作答几次带勾选难点标签后再来。</div>" +
        "</div>";
      return;
    }

    var idx = buildIndex();
    if(!idx.length){
      box.innerHTML = head +
        "<div class='b20-empty b20-empty-big'>题库数据未加载，暂时无法聚合同类题。</div>" +
        "</div>";
      return;
    }

    /* 初始化展开态：默认展开 Top3 */
    if(!S.open){
      S.open = {};
      for(var a = 0; a < agg.sorted.length && a < OPEN_DEFAULT; a++) S.open[agg.sorted[a].tag] = true;
    }

    /* 构建各弱点桶 */
    var buckets = [], i;
    for(i = 0; i < agg.sorted.length; i++){
      buckets.push(buildBucket(agg.sorted[i].tag, idx, agg));
    }

    /* 弱点画像 */
    var top = agg.sorted.slice(0, 2).map(function(x){ return x.tag; }).join("、");
    var html = head +
      "<section class='b20-panel'>" +
        "<div class='b20-ph'>📊 我的弱点画像" +
          "<span class='b20-meta'>共 " + agg.withProc + " 次作答留下过程笔记 / 记录 " + agg.totalRec + " 条</span>" +
        "</div>" +
        "<div class='b20-pbody'>" +
          "<div class='b20-chips'>" + weakChips(agg.sorted) + "</div>" +
          "<div class='b20-advice'>系统建议你先攻最常卡的 1-2 类：<b>" + esc(top) + "</b></div>" +
        "</div>" +
      "</section>";

    /* 一键专攻 */
    html += "<section class='b20-panel'>" +
              "<div class='b20-ph'>⚡ 一键专攻</div>" +
              "<div class='b20-btns'>" + drillBtns(buckets) +
                (S.focus ? "<button type='button' class='b20-btn b20-ghost' data-b20act='unfocus'>显示全部弱点</button>" : "") +
              "</div>" +
            "</section>";

    /* 分组题列表 */
    var groups = "";
    for(i = 0; i < buckets.length; i++){
      if(S.focus && buckets[i].tag !== S.focus) continue;
      groups += groupHtml(buckets[i], i, agg.sorted[i].n);
    }
    html += "<div class='b20-groups'>" + groups + "</div></div>";

    box.innerHTML = html;
  }

  /* ---------------- 事件委托（只绑一次） ---------------- */
  function findAct(el){
    var n = 0;
    while(el && el !== document && n < 8){
      if(el.getAttribute && el.getAttribute("data-b20act")) return el;
      el = el.parentNode; n++;
    }
    return null;
  }
  function onClick(ev){
    var t = null;
    try{ t = findAct(ev.target || ev.srcElement); }catch(e){ t = null; }
    if(!t) return;
    var act = t.getAttribute("data-b20act");
    var tag = t.getAttribute("data-tag") || "";
    var pid = t.getAttribute("data-pid") || "";
    var qno = t.getAttribute("data-qno") || "";

    try{
      if(act === "toggle"){
        if(!S.open) S.open = {};
        S.open[tag] = !S.open[tag];
        draw(); return;
      }
      if(act === "focus"){
        S.focus = tag;
        if(!S.open) S.open = {};
        S.open[tag] = true;
        draw();
        try{
          var g = document.getElementById("b20g-" + tag);
          if(g && g.scrollIntoView) g.scrollIntoView(true);
        }catch(e){}
        return;
      }
      if(act === "unfocus"){ S.focus = ""; draw(); return; }
      if(act === "ans"){
        var n = parseInt(qno, 10);
        var real = isNaN(n) ? qno : n;
        if(typeof window.openAnswerModal === "function"){
          window.openAnswerModal(pid, real);
        }else{
          S.flash = "作答弹窗未加载，请回主站真题库中作答"; draw();
        }
        return;
      }
      if(act === "today"){
        var n2 = parseInt(qno, 10);
        var real2 = isNaN(n2) ? qno : n2;
        var r = addToday(pid, real2, tag);
        S.flash = (r === "ok")      ? ("已加入今日清单：" + pid + " 第" + real2 + "题（过程教练下次会展示）")
                : (r === "already") ? "这道题已经在今日清单里了"
                                    : "写入失败，浏览器拒绝本地存储";
        draw(); return;
      }
    }catch(err){
      try{ console.error("[_b20]", err); }catch(e){}
    }
  }
  function bindOnce(){
    if(window.__b20Bound) return;
    try{
      document.addEventListener("click", onClick, false);
      window.__b20Bound = true;
    }catch(e){}
  }

  /* ================= 路由入口 ================= */
  window.renderWeakAgg = function(){
    bindOnce();
    try{
      draw();
    }catch(err){
      try{
        var box = document.getElementById("content");
        if(box) box.innerHTML = "<div class='b20-empty b20-empty-big'>同类薄弱聚合运行出错：" +
          esc(String((err && err.message) || err)) + "</div>";
      }catch(e){}
      try{ console.error("[_b20]", err); }catch(e){}
    }
  };

})();
