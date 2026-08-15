/* =====================================================================
   第十六批：申论成长史时间线（Growth Timeline）  (_b16.js)
   把历次作答 + 过程笔记 + 命中率聚成一条可搜索的时间线，
   直观看出「一个月前我总卡归纳，现在卡格式」式的成长轨迹。
   依赖（全部带守卫，缺失即降级）：
     DATA / findQ / openAnswerModal / b8OpenCompare / localStorage
   只读 localStorage("shenlun_answers_v2")，不写任何数据。
   类名统一 b16- 前缀；样式复用主站 :root 变量。
   入口：window.renderGrowth()
   ===================================================================== */
(function(){
  "use strict";

  var STORE_KEY = "shenlun_answers_v2";
  var PAGE = 20;    /* 每屏条数 */
  var PASS = 60;    /* 命中率达标线：≥ 红/达标，< 绿/待提升 */
  var WIN  = 5;     /* 趋势对比窗口：近 5 次 vs 此前 5 次 */

  var esc = window.esc || function(s){
    return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  };

  /* 模块内状态（不碰主站 state） */
  var S     = { q:"", limit:PAGE, desc:true };
  var ITEMS = [];   /* 全部记录，按时间升序 */
  var VIEW  = [];   /* 当前过滤 + 排序后的可见集合 */
  var TOP   = [];   /* 最常卡的难点标签 Top N */

  /* ---------------- 基础工具 ---------------- */
  function isArr(x){ return Object.prototype.toString.call(x) === "[object Array]"; }

  function ensureCss(){
    try{
      var ls = document.getElementsByTagName("link"), i;
      for(i=0;i<ls.length;i++){
        if(String(ls[i].getAttribute("href") || "").indexOf("_b16.css") >= 0) return;
      }
      var el = document.createElement("link");
      el.rel = "stylesheet"; el.href = "_b16.css";
      (document.head || document.documentElement).appendChild(el);
    }catch(e){}
  }

  function pad(n){ return (n < 10 ? "0" : "") + n; }

  function dateOf(ts){
    if(typeof ts !== "number" || !isFinite(ts) || ts <= 0) return null;
    try{ var d = new Date(ts); return isNaN(d.getTime()) ? null : d; }catch(e){ return null; }
  }
  function fmtDT(d){
    if(!d) return "时间未记录";
    return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())+" "+pad(d.getHours())+":"+pad(d.getMinutes());
  }
  function fmtD(d){
    if(!d) return "—";
    return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
  }
  function monthOf(d){
    if(!d) return "时间未记录的早期作答";
    return d.getFullYear()+" 年 "+(d.getMonth()+1)+" 月";
  }
  function avg(a){
    if(!a || !a.length) return null;
    var s = 0, i;
    for(i=0;i<a.length;i++) s += a[i];
    return Math.round(s / a.length);
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
      return { p:ps[i], q:null };   /* 套卷在、题号对不上时也保留套卷信息 */
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
    try{ return localFind(pid, qno); }catch(e){ return null; }
  }

  function loadRecs(){
    try{
      if(typeof localStorage === "undefined" || !localStorage) return null;
      var raw = localStorage.getItem(STORE_KEY);
      if(!raw) return null;
      var o = JSON.parse(raw);
      return (o && typeof o === "object") ? o : null;
    }catch(e){ return null; }
  }

  function scoreOf(rec){
    var s;
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

  /* ---------------- 建时间线 ---------------- */
  function buildItems(){
    ITEMS = [];
    var map = loadRecs();
    if(!map) return;

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
          var tv = String(pr.tags[t] == null ? "" : pr.tags[t]).trim();
          if(tv) tags.push(tv);
        }
      }
      var note = (pr && typeof pr.note === "string") ? pr.note.trim() : "";
      var d = dateOf(rec.ts);

      var it = {
        i: 0, idx: i, key: k, pid: pid, qno: qno,
        d: d, ts: (d ? d.getTime() : null),
        year:  (p && p.year != null)  ? String(p.year)  : "",
        paper: (p && p.paper)         ? String(p.paper) : "",
        prov:  (p && p.province)      ? String(p.province) : "",
        qtype: String(rec.qtype || (q && q.qtype) || "").trim(),
        score: scoreOf(rec),
        hit:   (typeof rec.hitCount === "number" && !isNaN(rec.hitCount)) ? rec.hitCount : null,
        total: (typeof rec.total === "number" && !isNaN(rec.total)) ? rec.total : null,
        tags: tags, note: note,
        text: (typeof rec.text === "string") ? rec.text : "",
        hasImg: !!(pr && (pr.img || pr.noteImg || pr.materialImg))
      };
      it.blob = [fmtD(d), it.year, it.paper, it.prov, "题" + it.qno, it.qtype,
                 tags.join(" "), note, it.text].join(" ").toLowerCase();
      ITEMS.push(it);
    }

    /* 升序：有 ts 按 ts，无 ts 的按 key 原始顺序垫在最前（视作更早的历史记录） */
    ITEMS.sort(function(a, b){
      if(a.ts == null && b.ts == null) return a.idx - b.idx;
      if(a.ts == null) return -1;
      if(b.ts == null) return 1;
      if(a.ts !== b.ts) return a.ts - b.ts;
      return a.idx - b.idx;
    });
    for(var j=0;j<ITEMS.length;j++) ITEMS[j].i = j;
  }

  function buildTop(n){
    var cnt = {}, i, j, t, out = [];
    for(i=0;i<ITEMS.length;i++){
      for(j=0;j<ITEMS[i].tags.length;j++){
        t = ITEMS[i].tags[j];
        cnt[t] = (cnt[t] || 0) + 1;
      }
    }
    try{
      out = Object.keys(cnt).map(function(k){ return { t:k, c:cnt[k] }; });
    }catch(e){ out = []; }
    out.sort(function(a, b){ return (b.c - a.c) || (a.t < b.t ? -1 : 1); });
    return out.slice(0, n);
  }

  function applyFilter(){
    var terms = S.q ? S.q.toLowerCase().split(/\s+/) : [];
    var use = [], i, j;
    for(i=0;i<terms.length;i++) if(terms[i]) use.push(terms[i]);

    var out = [];
    for(i=0;i<ITEMS.length;i++){
      var ok = true;
      for(j=0;j<use.length;j++){
        if(ITEMS[i].blob.indexOf(use[j]) < 0){ ok = false; break; }
      }
      if(ok) out.push(ITEMS[i]);
    }
    if(S.desc) out.reverse();
    VIEW = out;
  }

  /* ---------------- 片段 ---------------- */
  function trendHtml(){
    var sc = [], i;
    for(i=0;i<ITEMS.length;i++) if(ITEMS[i].score != null) sc.push(ITEMS[i].score);
    if(sc.length < 2) return '<span class="b16-flat">作答次数还太少，再做几题就能算出趋势</span>';

    var n = sc.length;
    var rec = sc.slice(Math.max(0, n - WIN));
    var pre = sc.slice(Math.max(0, n - rec.length - WIN), n - rec.length);
    var ra  = avg(rec);
    if(!pre.length){
      return '近 ' + rec.length + ' 次平均 <b>' + ra + '%</b> <span class="b16-flat">（还没有更早的对照样本）</span>';
    }
    var ba = avg(pre), d = ra - ba;
    var cls  = d > 0 ? "up" : (d < 0 ? "down" : "flat");
    var mark = d > 0 ? ("🔺 +" + d + " 个百分点")
                     : (d < 0 ? ("🔻 " + d + " 个百分点") : "➖ 持平");
    return '近 ' + rec.length + ' 次平均 <b>' + ra + '%</b> · 此前 ' + pre.length + ' 次平均 <b>' + ba + '%</b> · ' +
           '<span class="b16-trend ' + cls + '">' + mark + '</span>';
  }

  function overviewHtml(){
    var first = null, last = null, i;
    for(i=0;i<ITEMS.length;i++){ if(ITEMS[i].d){ first = ITEMS[i].d; break; } }
    for(i=ITEMS.length-1;i>=0;i--){ if(ITEMS[i].d){ last = ITEMS[i].d; break; } }

    var tagHtml = "";
    if(TOP.length){
      for(i=0;i<TOP.length;i++){
        tagHtml += '<span class="b16-chip hot" data-b16="top" data-i="' + i + '">' +
                     esc(TOP[i].t) + '<i>' + TOP[i].c + '</i></span>';
      }
    }else{
      tagHtml = '<span class="b16-flat">还没记过难点标签。作答提交时勾一勾「卡在哪」，这里就能长出你的薄弱画像</span>';
    }

    return '<div class="b16-card b16-ov">' +
             '<div class="b16-ovh">📈 成长概览</div>' +
             '<div class="b16-ovg">' +
               '<div class="b16-kv"><span>总作答次数</span><b>' + ITEMS.length + '</b></div>' +
               '<div class="b16-kv"><span>最早作答</span><b>' + esc(fmtD(first)) + '</b></div>' +
               '<div class="b16-kv"><span>最近作答</span><b>' + esc(fmtD(last)) + '</b></div>' +
             '</div>' +
             '<div class="b16-line"><span class="b16-lb">命中率趋势</span>' + trendHtml() + '</div>' +
             '<div class="b16-line"><span class="b16-lb">最常卡的难点</span>' + tagHtml + '</div>' +
           '</div>';
  }

  function itemHtml(it){
    var lv    = (it.score == null) ? "na" : (it.score >= PASS ? "pass" : "low");
    var scTxt = (it.score == null) ? "—" : (it.score + '<i>%</i>');
    var scTip = (it.score == null) ? "未评分" : (it.score >= PASS ? "达标" : "待提升");

    var meta = [];
    if(it.year)  meta.push(esc(it.year));
    if(it.prov)  meta.push(esc(it.prov));
    if(it.paper) meta.push(esc(it.paper));
    var title = meta.join(" · ") || esc(it.pid);

    var h = '<div class="b16-item">' +
              '<span class="b16-dot ' + lv + '"></span>' +
              '<div class="b16-card b16-it">' +
                '<div class="b16-ih">' +
                  '<div class="b16-il">' +
                    '<div class="b16-date">🗓 ' + esc(fmtDT(it.d)) + '</div>' +
                    '<div class="b16-tt">' + title +
                      '<span class="b16-qn">题 ' + esc(it.qno || "?") + '</span>' +
                      (it.qtype ? '<span class="b16-qt">' + esc(it.qtype) + '</span>' : "") +
                    '</div>' +
                  '</div>' +
                  '<div class="b16-ir ' + lv + '">' +
                    '<div class="b16-sc">' + scTxt + '</div>' +
                    '<div class="b16-sct">' + scTip +
                      ((it.hit != null && it.total) ? ' · 命中 ' + it.hit + '/' + it.total : "") +
                    '</div>' +
                  '</div>' +
                '</div>';

    if(it.tags.length || it.note || it.hasImg){
      h += '<div class="b16-proc">';
      if(it.tags.length){
        h += '<div class="b16-tags">';
        for(var j=0;j<it.tags.length;j++){
          h += '<span class="b16-chip" data-b16="tag" data-i="' + it.i + '" data-j="' + j + '">' +
                 esc(it.tags[j]) + '</span>';
        }
        h += '</div>';
      }
      if(it.note) h += '<div class="b16-note">' + esc(it.note) + '</div>';
      if(it.hasImg) h += '<div class="b16-imgtip">📎 该次作答另存有手写/材料图片</div>';
      h += '</div>';
    }

    h += '<div class="b16-acts">' +
           '<button class="b16-btn" data-b16="redo" data-i="' + it.i + '">✍️ 重做</button>' +
           '<button class="b16-btn ghost" data-b16="cmp" data-i="' + it.i + '">🔍 答案对照</button>' +
         '</div>' +
        '</div></div>';
    return h;
  }

  function paintList(){
    applyFilter();

    var cnt = document.getElementById("b16-cnt");
    if(cnt){
      cnt.innerHTML = '命中 <b>' + VIEW.length + '</b> 条' +
        (S.q ? '（共 ' + ITEMS.length + ' 条记录）' : '') +
        ' · 当前 ' + (S.desc ? "新 → 旧" : "旧 → 新");
    }

    var box = document.getElementById("b16-list");
    if(!box) return;

    if(!VIEW.length){
      box.innerHTML = '<div class="b16-card b16-empty">没有匹配的记录，换个题型 / 关键词 / 标签试试。</div>';
      var m0 = document.getElementById("b16-more");
      if(m0) m0.innerHTML = "";
      return;
    }

    var show = VIEW.slice(0, S.limit);
    var h = '<div class="b16-tl">', curMon = null, i;
    for(i=0;i<show.length;i++){
      var mon = monthOf(show[i].d);
      if(mon !== curMon){
        curMon = mon;
        h += '<div class="b16-mon"><span class="b16-mdot"></span>' + esc(mon) + '</div>';
      }
      h += itemHtml(show[i]);
    }
    h += '</div>';
    box.innerHTML = h;

    var more = document.getElementById("b16-more");
    if(more){
      var rest = VIEW.length - show.length;
      more.innerHTML = rest > 0
        ? '<button class="b16-more" data-b16="more">⬇️ 加载更多（还有 ' + rest + ' 条）</button>'
        : (VIEW.length > PAGE ? '<div class="b16-end">— 到底了，共 ' + VIEW.length + ' 条 —</div>' : "");
    }
  }

  /* ---------------- 渲染 ---------------- */
  function draw(){
    ensureCss();
    var box = document.getElementById("content");
    if(!box) return;

    buildItems();
    TOP = buildTop(3);
    S.limit = PAGE;

    try{
      var st = document.getElementById("stats");
      if(st) st.textContent = "申论成长史 · 共 " + ITEMS.length + " 条作答记录";
    }catch(e){}

    if(!ITEMS.length){
      box.innerHTML = '<div class="b16-wrap">' +
          '<div class="b16-head"><h2>🌱 申论成长史</h2>' +
          '<p class="b16-lead">把历次作答、过程笔记和命中率串成一条时间线，看清自己是怎么一步步变强的。</p></div>' +
          '<div class="b16-card b16-empty">还没有作答记录，去真题库做几题，这里会沉淀你的成长史。</div>' +
        '</div>';
      return;
    }

    box.innerHTML = '<div class="b16-wrap">' +
        '<div class="b16-head">' +
          '<h2>🌱 申论成长史</h2>' +
          '<p class="b16-lead">一人专属成长轨迹：按时间串起每一次作答、当时卡在哪、命中率多少。' +
            '对比<b>近 ' + WIN + ' 次</b>与<b>此前 ' + WIN + ' 次</b>，就能看出难点是不是从「归纳」挪到了「格式」。</p>' +
        '</div>' +
        overviewHtml() +
        '<div class="b16-bar">' +
          '<input id="b16q" class="b16-search" type="search" placeholder="搜题型 / 关键词 / 难点标签 / 年份…（空格分词=同时包含）" value="' + esc(S.q) + '">' +
          '<button class="b16-mini" data-b16="clear">✖ 清空</button>' +
          '<button class="b16-mini" id="b16-order" data-b16="order">' + (S.desc ? "⏫ 改为旧→新" : "⏬ 改为新→旧") + '</button>' +
        '</div>' +
        '<div class="b16-cnt" id="b16-cnt"></div>' +
        '<div id="b16-list"></div>' +
        '<div id="b16-more" class="b16-morebox"></div>' +
      '</div>';

    bind(box);
    paintList();
  }

  /* ---------------- 事件（委托，不用内联 onclick） ---------------- */
  function pick(i){
    var n = parseInt(i, 10);
    return (!isNaN(n) && ITEMS[n]) ? ITEMS[n] : null;
  }

  function setQ(v){
    S.q = String(v == null ? "" : v);
    S.limit = PAGE;
    paintList();
  }

  function bind(root){
    if(root.__b16bound) return;
    root.__b16bound = true;

    root.addEventListener("input", function(ev){
      var el = ev.target;
      if(el && el.id === "b16q") setQ(el.value);
    });

    root.addEventListener("click", function(ev){
      var el = ev.target, act = null, it, j;
      while(el && el !== root){
        act = el.getAttribute && el.getAttribute("data-b16");
        if(act) break;
        el = el.parentNode;
      }
      if(!act) return;

      if(act === "redo"){
        it = pick(el.getAttribute("data-i"));
        if(!it) return;
        try{
          if(window.openAnswerModal) window.openAnswerModal(it.pid, it.qno);
          else alert("作答弹窗未加载");
        }catch(err){ try{ console.error("[_b16]", err); }catch(e){} }
        return;
      }
      if(act === "cmp"){
        it = pick(el.getAttribute("data-i"));
        if(!it) return;
        try{
          if(window.b8OpenCompare) window.b8OpenCompare(it.pid, it.qno);
          else alert("答案对照模块未加载");
        }catch(err){ try{ console.error("[_b16]", err); }catch(e){} }
        return;
      }
      if(act === "tag"){
        it = pick(el.getAttribute("data-i"));
        j = parseInt(el.getAttribute("data-j"), 10);
        if(!it || isNaN(j) || !it.tags[j]) return;
        var inp = document.getElementById("b16q");
        if(inp) inp.value = it.tags[j];
        setQ(it.tags[j]);
        return;
      }
      if(act === "top"){
        j = parseInt(el.getAttribute("data-i"), 10);
        if(isNaN(j) || !TOP[j]) return;
        var inp2 = document.getElementById("b16q");
        if(inp2) inp2.value = TOP[j].t;
        setQ(TOP[j].t);
        return;
      }
      if(act === "clear"){
        var inp3 = document.getElementById("b16q");
        if(inp3) inp3.value = "";
        setQ("");
        return;
      }
      if(act === "order"){
        S.desc = !S.desc;
        S.limit = PAGE;
        var ob = document.getElementById("b16-order");
        if(ob) ob.textContent = S.desc ? "⏫ 改为旧→新" : "⏬ 改为新→旧";
        paintList();
        return;
      }
      if(act === "more"){
        S.limit += PAGE;
        paintList();
        return;
      }
    });
  }

  /* ================= 路由入口 ================= */
  window.renderGrowth = function(){
    try{
      draw();
    }catch(err){
      try{
        var box = document.getElementById("content");
        if(box) box.innerHTML = '<div class="b16-card b16-empty">申论成长史运行出错：' +
          esc(String((err && err.message) || err)) + '</div>';
      }catch(e){}
      try{ console.error("[_b16]", err); }catch(e){}
    }
  };

})();
