(function(){
  "use strict";
  /* ==================================================================
     _b17 单题限时模考 + 考场节奏复盘（Timed Drill）
     A. 选套卷 → 选题 → 设倒计时 → 限时作答 → 交卷算命中率
     B. 读全部限时记录，复盘时间分配（超时/提前、最常超时题型、教练提示）
     纯前端离线、零依赖；只写 localStorage("shenlun_timed_v1")。
     暴露 window.renderTimedDrill，全部类名 b17- 前缀。
     ================================================================== */

  var STORE = "shenlun_timed_v1";
  var MAXREC = 300;

  /* 模块级计时器 id —— 全模块只允许存在一个，切换/重进必须先清 */
  var TIMER = null;

  /* 自带 HTML 转义（优先复用主站 esc） */
  var esc = window.esc || function(s){
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };

  /* 模块内状态（不碰主站 state） */
  var S = {
    tab: "drill",        /* drill | review */
    pid: "", qno: null,
    mins: 20,            /* 设定分钟 */
    custom: false,       /* 是否手动改过时长 */
    running: false,
    startAt: 0,          /* 开考时间戳 */
    limitSec: 0,         /* 本次设定秒数 */
    sugSec: 0,           /* 本题型建议秒数 */
    text: "",            /* 作答草稿（重绘时回填） */
    result: null,        /* 上一次交卷结果 */
    flash: ""
  };

  /* ---------- 通用小工具 ---------- */
  function isArr(x){ return Object.prototype.toString.call(x) === "[object Array]"; }
  function num(x, d){ var n = parseInt(x, 10); return isNaN(n) ? d : n; }
  function pad2(n){ n = Math.floor(Math.abs(n)); return (n < 10 ? "0" : "") + n; }

  function fmtClock(sec){
    sec = Math.floor(Math.abs(num(sec, 0)));
    return pad2(Math.floor(sec / 60)) + ":" + pad2(sec % 60);
  }
  function fmtCn(sec){
    sec = Math.floor(Math.abs(num(sec, 0)));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m > 0 ? (m + " 分 ") : "") + s + " 秒";
  }
  function fmtDay(ts){
    try{
      var d = new Date(num(ts, 0));
      if(!ts || isNaN(d.getTime())) return "—";
      return (d.getMonth() + 1) + "/" + d.getDate() + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    }catch(e){ return "—"; }
  }

  /* ---------- 样式自挂载（主站未 link _b17.css 时兜底，不改任何文件） ---------- */
  function ensureCss(){
    try{
      var ls = document.getElementsByTagName("link"), i;
      for(i = 0; i < ls.length; i++){
        if(String(ls[i].getAttribute("href") || "").indexOf("_b17.css") >= 0) return;
      }
      var el = document.createElement("link");
      el.rel = "stylesheet"; el.href = "_b17.css";
      (document.head || document.documentElement).appendChild(el);
    }catch(e){}
  }

  /* ---------- 数据安全访问 ---------- */
  function D(){
    try{ return (typeof DATA !== "undefined" && DATA) ? DATA : (window.DATA || null); }
    catch(e){ return null; }
  }
  function papers(){
    try{ var d = D(); return (d && isArr(d.papers)) ? d.papers : []; }catch(e){ return []; }
  }
  function paperOf(pid){
    var ps = papers(), i;
    for(i = 0; i < ps.length; i++){ if(ps[i] && ps[i].id === pid) return ps[i]; }
    return null;
  }
  function qsOf(p){
    try{ return (p && isArr(p.questions)) ? p.questions : []; }catch(e){ return []; }
  }
  /* findQ 优先用主站的，拿不到就自己找 */
  function findQ2(pid, qno){
    var r = null;
    try{ if(typeof findQ === "function") r = findQ(pid, qno); }catch(e){ r = null; }
    if(!r){ try{ if(typeof window.findQ === "function") r = window.findQ(pid, qno); }catch(e){ r = null; } }
    if(r && r.q) return r;
    var p = paperOf(pid), qs = qsOf(p), i;
    for(i = 0; i < qs.length; i++){
      if(qs[i] && String(qs[i].no) === String(qno)) return { p: p, q: qs[i] };
    }
    return null;
  }
  function paperName(p){
    if(!p) return "—";
    var pv = String(p.province || "");
    return String(p.year || "") + " " + (pv && pv !== "国考" ? pv + "·" : "") + String(p.paper || "");
  }

  /* ---------- 题型 → 维度 / 建议时长 ---------- */
  function dimOf(qtype){
    var t = String(qtype || "");
    if(/作文|文章写作/.test(t)) return "大作文";
    if(/公文|贯彻执行|应用文|简报|短评|提纲|宣传/.test(t)) return "公文题";
    if(/对策|建议|措施/.test(t)) return "对策题";
    if(/分析/.test(t)) return "分析题";
    if(/概括|归纳/.test(t)) return "概括题";
    return "其他题";
  }
  function sugMin(qtype){
    var d = dimOf(qtype);
    if(d === "大作文") return 60;
    if(d === "公文题") return 25;
    return 20;                     /* 概括 / 分析 / 对策 / 其他 */
  }

  /* ---------- 评分：优先主站 scoreAnswer，其次 _b8 scoreEnhance，最后本地兜底 ---------- */
  var STOP = {};
  (function(){
    var w = ["可以","应该","我们","他们","这个","那个","以及","通过","由于","对于","进行","问题",
             "方面","需要","必须","一个","没有","这样","就是","因此","所以","但是","并且","而且",
             "如果","因为","为了","能够","实现","提供","建立","加强","完善","提高","在于","成为",
             "工作","开展","推动","促进","发挥","作用","重要","不断","切实","有效"], i;
    for(i = 0; i < w.length; i++) STOP[w[i]] = 1;
  })();

  function localScore(text, q){
    var a = String(text || ""), pts = (q && isArr(q.points)) ? q.points : [];
    var hits = [], missed = [], i, j, L, t, w, ok;
    for(i = 0; i < pts.length; i++){
      t = String((pts[i] && pts[i].text) || "").replace(/[^\u4e00-\u9fa5]/g, "");
      ok = false;
      for(j = 0; j < t.length && !ok; j++){
        for(L = 2; L <= 4 && j + L <= t.length; L++){
          w = t.substr(j, L);
          if(STOP[w]) continue;
          if(a.indexOf(w) >= 0){ ok = true; break; }
        }
      }
      (ok ? hits : missed).push(pts[i]);
    }
    var total = pts.length, rate = total ? hits.length / total : 0;
    return { hits: hits, missed: missed, rate: rate, score: Math.round(rate * 100),
             total: total, hitCount: hits.length };
  }
  function doScore(text, q){
    var r = null;
    try{ if(typeof scoreAnswer === "function") r = scoreAnswer(text, q); }catch(e){ r = null; }
    if(!r){ try{ if(typeof window.scoreAnswer === "function") r = window.scoreAnswer(text, q); }catch(e){ r = null; } }
    if(!r){ try{ if(typeof window.scoreEnhance === "function") r = window.scoreEnhance(text, q); }catch(e){ r = null; } }
    if(!r || typeof r.rate !== "number"){ r = localScore(text, q); }
    return r;
  }

  /* ---------- 限时记录存储 ---------- */
  function loadRecs(){
    try{
      var s = localStorage.getItem(STORE);
      var a = s ? JSON.parse(s) : [];
      return isArr(a) ? a : [];
    }catch(e){ return []; }
  }
  function saveRecs(a){
    try{
      localStorage.setItem(STORE, JSON.stringify((isArr(a) ? a : []).slice(0, MAXREC)));
      return true;
    }catch(e){ return false; }
  }

  /* ---------- 计时器（全模块唯一，任何入口先清） ---------- */
  function stopTimer(){
    try{ if(TIMER !== null) clearInterval(TIMER); }catch(e){}
    TIMER = null;
  }
  function elapsed(){
    if(!S.startAt) return 0;
    var v = Math.floor((Date.now() - S.startAt) / 1000);
    return v < 0 ? 0 : v;
  }
  function tick(){
    var el, bar, tip, used, left;
    try{
      el = document.getElementById("b17-clock");
      /* 页面被主站重绘 / 用户离开本模块 → 计时器自杀，防止叠加空跑 */
      if(!el || !document.body || !document.body.contains(el)){ stopTimer(); return; }
      used = elapsed();
      left = S.limitSec - used;
      el.textContent = (left < 0 ? "-" : "") + fmtClock(left);
      el.className = "b17-clock" + (left <= 0 ? " over" : (left <= 60 ? " warn" : ""));
      bar = document.getElementById("b17-barfill");
      if(bar){
        var pct = S.limitSec > 0 ? (left > 0 ? left / S.limitSec : 0) * 100 : 0;
        bar.style.width = pct.toFixed(2) + "%";
        bar.className = left <= 0 ? "over" : (left <= 60 ? "warn" : "");
      }
      tip = document.getElementById("b17-tip");
      if(tip){
        tip.textContent = left > 0
          ? ("设定 " + Math.round(S.limitSec / 60) + " 分钟 · 建议 " + Math.round(S.sugSec / 60) + " 分钟，写完就交，别拖")
          : ("⏰ 时间到，请提交！已超时 " + fmtCn(-left));
        tip.className = "b17-tip" + (left <= 0 ? " over" : "");
      }
    }catch(e){ stopTimer(); }
  }
  function startTimer(){
    stopTimer();
    try{ TIMER = setInterval(tick, 1000); }catch(e){ TIMER = null; }
    tick();
  }

  /* ---------- 选择项校正 ---------- */
  function normalize(){
    var ps = papers(), i, p, qs;
    if(!ps.length){ S.pid = ""; S.qno = null; return; }
    p = paperOf(S.pid);
    if(!p){
      for(i = 0; i < ps.length; i++){ if(qsOf(ps[i]).length){ p = ps[i]; break; } }
      p = p || ps[0];
      S.pid = p.id; S.qno = null; S.custom = false;
    }
    qs = qsOf(p);
    if(!qs.length){ S.qno = null; return; }
    var hit = false;
    for(i = 0; i < qs.length; i++){
      if(String(qs[i].no) === String(S.qno)){ S.qno = qs[i].no; hit = true; break; }  /* 回写成 DATA 里的原始类型，供主站 findQ 严格比较 */
    }
    if(!hit){ S.qno = qs[0].no; S.custom = false; }
    if(!S.custom){
      var f = findQ2(S.pid, S.qno);
      S.mins = sugMin(f && f.q ? f.q.qtype : "");
    }
  }

  /* ================= 渲染：头部 ================= */
  function headHtml(){
    return '' +
      '<div class="b17-head">' +
        '<h2>⏱ 单题限时模考 · 考场节奏复盘</h2>' +
        '<p class="b17-lead">申论是<b>限时战</b>：会写不等于写得完。这里按单题掐表练，' +
          '交卷后立刻看命中率与时间偏差，再用复盘找出你最容易超时的题型。</p>' +
        '<div class="b17-tabs">' +
          '<button class="b17-tab' + (S.tab === "drill" ? " on" : "") + '" data-b17="tab" data-v="drill">① 单题限时模考</button>' +
          '<button class="b17-tab' + (S.tab === "review" ? " on" : "") + '" data-b17="tab" data-v="review">② 考场节奏复盘</button>' +
        '</div>' +
      '</div>';
  }
  function flashHtml(){
    return S.flash ? '<span class="b17-flash">' + esc(S.flash) + '</span>' : '';
  }

  /* ================= A. 单题限时模考 ================= */
  function drillHtml(){
    if(!papers().length){
      return '<div class="b17-card"><div class="b17-empty">没读到 DATA.papers，真题数据未加载，无法开始限时模考。</div></div>';
    }
    if(S.running) return runHtml();
    return setupHtml() + (S.result ? resultHtml() : "");
  }

  function setupHtml(){
    var ps = papers(), i, o = [], p = paperOf(S.pid), qs = qsOf(p);
    for(i = 0; i < ps.length; i++){
      o.push('<option value="' + esc(ps[i].id) + '"' + (ps[i].id === S.pid ? " selected" : "") + '>' +
             esc(paperName(ps[i])) + '</option>');
    }
    var qo = [];
    for(i = 0; i < qs.length; i++){
      qo.push('<option value="' + esc(qs[i].no) + '"' + (String(qs[i].no) === String(S.qno) ? " selected" : "") + '>' +
              '题' + esc(qs[i].no) + '　' + esc(qs[i].qtype || "") + '</option>');
    }
    var f = findQ2(S.pid, S.qno), q = f ? f.q : null;
    var sug = sugMin(q ? q.qtype : "");
    var meta = q
      ? ('<span class="b17-tag">' + esc(dimOf(q.qtype)) + '</span>' +
         (q.score ? '<span class="b17-mt">分值 ' + esc(q.score) + '</span>' : '') +
         (q.words ? '<span class="b17-mt">字数 ' + esc(q.words) + '</span>' : '') +
         '<span class="b17-mt">采分点 ' + ((q.points && q.points.length) || 0) + ' 条</span>' +
         '<span class="b17-mt sug">建议 ' + sug + ' 分钟</span>')
      : '<span class="b17-mt">未选到题目</span>';

    var chips = [15, 20, 25, 30, 45, 60], c = [], k;
    for(k = 0; k < chips.length; k++){
      c.push('<button class="b17-chip' + (S.mins === chips[k] ? " on" : "") + '" data-b17="mins" data-v="' + chips[k] + '">' +
             chips[k] + ' 分</button>');
    }
    c.push('<button class="b17-chip sug' + (S.mins === sug ? " on" : "") + '" data-b17="mins" data-v="' + sug + '">建议 ' + sug + ' 分</button>');

    return '' +
    '<div class="b17-card">' +
      '<div class="b17-h3"><span class="b17-num">1</span>选题 &amp; 设时</div>' +
      '<div class="b17-row">' +
        '<label class="b17-lbl2">套卷</label>' +
        '<select class="b17-sel" data-b17="pid">' + o.join("") + '</select>' +
      '</div>' +
      '<div class="b17-row">' +
        '<label class="b17-lbl2">题目</label>' +
        '<select class="b17-sel" data-b17="qno">' + (qo.length ? qo.join("") : '<option>该卷暂无题目</option>') + '</select>' +
      '</div>' +
      '<div class="b17-qmeta">' + meta + '</div>' +
      '<div class="b17-row wrap">' +
        '<label class="b17-lbl2">时长</label>' +
        '<div class="b17-chips">' + c.join("") + '</div>' +
        '<span class="b17-custom">自定义 <input type="number" class="b17-numin" data-b17="custom" min="1" max="180" value="' +
          esc(S.mins) + '"> 分钟</span>' +
      '</div>' +
      '<div class="b17-ops">' +
        '<button class="b17-btn"' + (q ? '' : ' disabled') + ' data-b17="start">▶ 开始计时</button>' +
        '<span class="b17-tip">开始后题干与作答区展开，倒计时归零会变红提示交卷（不会强制打断）。</span>' +
        flashHtml() +
      '</div>' +
    '</div>';
  }

  function runHtml(){
    var f = findQ2(S.pid, S.qno);
    if(!f){ return '<div class="b17-card"><div class="b17-empty">题目丢失，请返回重新选择。</div></div>'; }
    var p = f.p, q = f.q, i, st = [];
    var stem = isArr(q.stem) ? q.stem : (q.stem ? [q.stem] : []);
    for(i = 0; i < stem.length; i++) st.push('<div>' + esc(stem[i]) + '</div>');

    return '' +
    '<div class="b17-card b17-run">' +
      '<div class="b17-runhead">' +
        '<div class="b17-rtitle">' + esc(paperName(p)) + ' · 题' + esc(q.no) +
          '<span class="b17-tag">' + esc(q.qtype || dimOf(q.qtype)) + '</span></div>' +
        '<div class="b17-clock" id="b17-clock">' + fmtClock(S.limitSec) + '</div>' +
      '</div>' +
      '<div class="b17-bar"><i id="b17-barfill" style="width:100%"></i></div>' +
      '<div class="b17-label">题干</div>' +
      '<div class="b17-stem">' + (st.length ? st.join("") : '<div class="b17-empty">该题暂无题干文本</div>') + '</div>' +
      '<div class="b17-label">我的作答（限时）</div>' +
      '<textarea id="b17-text" class="b17-text" placeholder="开考了，直接写要点，别回头改字…">' + esc(S.text) + '</textarea>' +
      '<div class="b17-cnt" id="b17-cnt"></div>' +
      '<div class="b17-ops">' +
        '<button class="b17-btn" data-b17="submit">📤 交卷并评分</button>' +
        '<button class="b17-mini del" data-b17="abort">放弃本次</button>' +
        '<span class="b17-tip" id="b17-tip"></span>' +
      '</div>' +
    '</div>';
  }

  function ptsHtml(res){
    var out = [], i, arr;
    arr = isArr(res.hits) ? res.hits : [];
    for(i = 0; i < arr.length && i < 12; i++){
      out.push('<li class="hit">✅ ' + esc((arr[i] && arr[i].text) || arr[i]) + '</li>');
    }
    arr = isArr(res.missed) ? res.missed : [];
    for(i = 0; i < arr.length && i < 12; i++){
      out.push('<li class="miss">❌ ' + esc((arr[i] && arr[i].text) || arr[i]) + '</li>');
    }
    return out.length ? '<ul class="b17-pts">' + out.join("") + '</ul>' : '';
  }

  function resultHtml(){
    var r = S.result, dev = r.used - r.sug;
    var devTxt = dev === 0 ? "与建议时长持平"
      : (dev > 0 ? '<b class="b17-over">🔺 比建议多 ' + Math.abs(dev) + ' 秒</b>'
                 : '<b class="b17-under">🔻 比建议少 ' + Math.abs(dev) + ' 秒</b>');
    var devLimit = r.used - r.limit;
    return '' +
    '<div class="b17-card b17-res">' +
      '<div class="b17-h3"><span class="b17-num">2</span>本次成绩</div>' +
      '<div class="b17-resline">' +
        '<span class="b17-big">' + Math.round(r.rate * 100) + '%</span>' +
        '<span class="b17-kv">命中 ' + r.hit + '/' + r.total + ' 个采分点</span>' +
        '<span class="b17-kv">用时 ' + fmtCn(r.used) + '</span>' +
        '<span class="b17-kv">设定 ' + fmtCn(r.limit) + (devLimit > 0 ? '（超时 ' + devLimit + ' 秒交卷）' : '') + '</span>' +
        '<span class="b17-kv">' + devTxt + '</span>' +
      '</div>' +
      '<div class="b17-note">' + esc(r.tip) + '</div>' +
      ptsHtml(r.res) +
      '<div class="b17-ops">' +
        '<button class="b17-mini" data-b17="goans">✍️ 去完整作答（存记录）</button>' +
        '<button class="b17-mini" data-b17="gocmp">📑 去答案对照</button>' +
        '<button class="b17-mini" data-b17="again">🔁 再练一题</button>' +
        '<button class="b17-mini" data-b17="tab" data-v="review">📊 看节奏复盘</button>' +
        flashHtml() +
      '</div>' +
    '</div>';
  }

  /* ================= B. 考场节奏复盘 ================= */
  var COACH = {
    "公文题": "你常在公文题超时，下次先花 2 分钟列格式提纲（标题—称谓—开头—主体—结尾），再动笔填内容，控制在 25 分钟内。",
    "大作文": "你常在大作文超时，先用 5 分钟定总论点＋3 个分论点，再按段写，别边写边想立意，60 分钟必须收尾。",
    "概括题": "你常在概括题超时，多半是反复读材料。改成一遍勾画、直接归并同类项，20 分钟内出条理化答案。",
    "分析题": "你常在分析题超时，套死「亮观点—拆维度—落对策」三步，写够即止，别展开成小作文。",
    "对策题": "你常在对策题超时，对策直接从问题反推，主体＋动作＋抓手一句一条，不做过度解释。",
    "其他题": "你有稳定超时倾向，做题前先给自己划死时间线：审题 2 分、找点 8 分、成文 10 分。"
  };

  function reviewHtml(){
    var recs = loadRecs();
    if(!recs.length){
      return '<div class="b17-card"><div class="b17-empty">还没有限时记录。先去 <b>① 单题限时模考</b> 掐表做一题，' +
             '交卷后这里会自动生成你的时间分配复盘。</div>' +
             '<div class="b17-ops"><button class="b17-btn" data-b17="tab" data-v="drill">▶ 去做单题限时模考</button></div></div>';
    }
    var i, r, sumUsed = 0, sumSug = 0, sumRate = 0, over = {}, overN = 0;
    for(i = 0; i < recs.length; i++){
      r = recs[i] || {};
      sumUsed += num(r.used, 0);
      sumSug  += num(r.sug, 0);
      sumRate += (typeof r.rate === "number" ? r.rate : 0);
      if(num(r.used, 0) > num(r.sug, 0)){
        var d = r.dim || dimOf(r.qtype);
        over[d] = (over[d] || 0) + 1; overN++;
      }
    }
    var n = recs.length;
    var avgUsed = Math.round(sumUsed / n), avgSug = Math.round(sumSug / n);
    var avgRate = Math.round(sumRate / n * 100), diff = avgUsed - avgSug;
    var topDim = "", topN = 0, k;
    for(k in over){ if(Object.prototype.hasOwnProperty.call(over, k) && over[k] > topN){ topN = over[k]; topDim = k; } }

    var ovHtml = '' +
      '<div class="b17-ov">' +
        '<div class="b17-ovi"><span class="b17-ovn">' + n + '</span><span class="b17-ovl">限时练习次数</span></div>' +
        '<div class="b17-ovi"><span class="b17-ovn">' + fmtCn(avgUsed) + '</span><span class="b17-ovl">平均用时</span></div>' +
        '<div class="b17-ovi"><span class="b17-ovn">' + fmtCn(avgSug) + '</span><span class="b17-ovl">平均建议时长</span></div>' +
        '<div class="b17-ovi"><span class="b17-ovn ' + (diff > 0 ? "b17-over" : (diff < 0 ? "b17-under" : "")) + '">' +
          (diff > 0 ? "🔺 +" : (diff < 0 ? "🔻 -" : "±")) + Math.abs(diff) + ' 秒</span>' +
          '<span class="b17-ovl">平均偏差</span></div>' +
        '<div class="b17-ovi"><span class="b17-ovn">' + avgRate + '%</span><span class="b17-ovl">平均命中率</span></div>' +
        '<div class="b17-ovi"><span class="b17-ovn">' + (topDim ? esc(topDim) + '（' + topN + ' 次）' : "无") + '</span>' +
          '<span class="b17-ovl">最常超时题型</span></div>' +
      '</div>';

    var rows = [], rec, dv, oc;
    for(i = 0; i < recs.length; i++){
      rec = recs[i] || {};
      dv = num(rec.used, 0) - num(rec.sug, 0);
      oc = dv > 0;
      rows.push('<tr class="' + (oc ? "b17-tr-over" : "") + '">' +
        '<td>' + esc(fmtDay(rec.ts)) + '</td>' +
        '<td>' + esc(rec.title || (String(rec.pid || "") + " 题" + String(rec.qno || ""))) + '</td>' +
        '<td>' + esc(rec.dim || dimOf(rec.qtype)) + '</td>' +
        '<td>' + fmtCn(rec.sug) + '</td>' +
        '<td>' + fmtCn(rec.used) + '</td>' +
        '<td class="' + (oc ? "b17-over" : (dv < 0 ? "b17-under" : "")) + '">' +
          (dv > 0 ? "🔺 +" : (dv < 0 ? "🔻 -" : "±")) + Math.abs(dv) + ' 秒</td>' +
        '<td>' + Math.round((typeof rec.rate === "number" ? rec.rate : 0) * 100) + '%</td>' +
      '</tr>');
    }

    var coach;
    if(!overN) coach = "节奏很稳：目前每一次都在建议时长内完成，接着把命中率往上提，别放松手速。";
    else if(overN >= Math.ceil(n * 0.6)) coach = (COACH[topDim] || COACH["其他题"]) + " 你有 " + overN + "/" + n + " 次超时，先练「写得完」，再练「写得好」。";
    else coach = (COACH[topDim] || COACH["其他题"]);
    if(avgRate < 50) coach += " 另外平均命中率仅 " + avgRate + "%，超时往往是找点慢：先练一遍勾画定要点。";

    return '' +
    '<div class="b17-card">' +
      '<div class="b17-h3"><span class="b17-num">1</span>节奏概览' +
        '<span class="b17-sub">🔺 红＝比建议慢　🔻 绿＝比建议快</span></div>' +
      ovHtml +
      '<div class="b17-coach">🎯 教练提示：' + esc(coach) + '</div>' +
    '</div>' +
    '<div class="b17-card">' +
      '<div class="b17-h3"><span class="b17-num">2</span>逐题时间账<span class="b17-sub">共 ' + n + ' 条（新→旧）</span></div>' +
      '<div class="b17-tbwrap"><table class="b17-tb">' +
        '<thead><tr><th>时间</th><th>题目</th><th>题型</th><th>建议</th><th>实际</th><th>偏差</th><th>命中率</th></tr></thead>' +
        '<tbody>' + rows.join("") + '</tbody>' +
      '</table></div>' +
      '<div class="b17-ops">' +
        '<button class="b17-btn" data-b17="tab" data-v="drill">▶ 再练一题</button>' +
        '<button class="b17-mini del" data-b17="clear">🗑 清空全部限时记录</button>' +
        flashHtml() +
      '</div>' +
    '</div>';
  }

  /* ================= 渲染主流程 ================= */
  function syncCount(){
    try{
      var ta = document.getElementById("b17-text"), cnt = document.getElementById("b17-cnt");
      if(!ta || !cnt) return;
      var f = findQ2(S.pid, S.qno), need = (f && f.q && f.q.words) ? ("　·　要求 " + String(f.q.words)) : "";
      cnt.textContent = "已写 " + String(ta.value || "").length + " 字" + need;
    }catch(e){}
  }

  function draw(){
    var box = null;
    try{ box = document.getElementById("content"); }catch(e){ box = null; }
    if(!box) return;
    ensureCss();
    normalize();
    if(!S.running) stopTimer();          /* 非计时态一律先清，杜绝叠加 */
    box.innerHTML = '<div class="b17-wrap">' + headHtml() +
                    (S.tab === "review" ? reviewHtml() : drillHtml()) + '</div>';
    bind(box);
    if(S.running) startTimer();          /* 计时态重绘后重新挂钟 */
    syncCount();
  }

  /* ================= 事件（委托到 #content，不用内联 onclick） ================= */
  function bind(root){
    if(!root || root.__b17bound) return;
    root.__b17bound = true;

    root.addEventListener("change", function(ev){
      var el = ev.target, a = el && el.getAttribute && el.getAttribute("data-b17");
      if(!a) return;
      if(a === "pid"){ S.pid = el.value; S.qno = null; S.custom = false; S.flash = ""; draw(); return; }
      if(a === "qno"){ S.qno = el.value; S.custom = false; S.flash = ""; draw(); return; }
    });

    root.addEventListener("input", function(ev){
      var el = ev.target;
      if(!el) return;
      if(el.id === "b17-text"){ S.text = String(el.value || ""); syncCount(); return; }
      var a = el.getAttribute && el.getAttribute("data-b17");
      if(a === "custom"){
        var v = num(el.value, 0);
        if(v >= 1 && v <= 180){ S.mins = v; S.custom = true; markChips(); }
      }
    });

    root.addEventListener("click", function(ev){
      var el = ev.target, a = null;
      while(el && el !== root){
        a = el.getAttribute && el.getAttribute("data-b17");
        if(a && el.tagName !== "SELECT" && el.tagName !== "INPUT") break;
        a = null; el = el.parentNode;
      }
      if(!a) return;
      ev.preventDefault();
      try{ act(a, el); }catch(err){ try{ console.error("[_b17]", err); }catch(e){} }
    });
  }

  /* 只刷新时长 chip 的高亮，避免输入框失焦 */
  function markChips(){
    try{
      var cs = document.querySelectorAll('#content [data-b17="mins"]'), i, v;
      for(i = 0; i < cs.length; i++){
        v = num(cs[i].getAttribute("data-v"), -1);
        cs[i].className = "b17-chip" + (/建议/.test(cs[i].textContent || "") ? " sug" : "") + (v === S.mins ? " on" : "");
      }
    }catch(e){}
  }

  /* ================= 动作 ================= */
  function act(a, el){
    var f, v;

    if(a === "tab"){
      v = (el && el.getAttribute("data-v")) || "drill";
      S.tab = (v === "review") ? "review" : "drill";
      S.flash = "";
      draw(); return;
    }

    if(a === "mins"){
      v = num(el && el.getAttribute("data-v"), 0);
      if(v >= 1){ S.mins = v; S.custom = true; }
      var inp = document.querySelector('#content [data-b17="custom"]');
      if(inp) inp.value = S.mins;
      markChips(); return;
    }

    if(a === "start"){
      f = findQ2(S.pid, S.qno);
      if(!f || !f.q){ S.flash = "没选到题目，换一套卷试试"; draw(); return; }
      if(!(S.mins >= 1)) S.mins = sugMin(f.q.qtype);
      S.limitSec = S.mins * 60;
      S.sugSec   = sugMin(f.q.qtype) * 60;
      S.startAt  = Date.now();
      S.text     = "";
      S.result   = null;
      S.running  = true;
      S.flash    = "";
      draw();
      try{ var ta = document.getElementById("b17-text"); if(ta) ta.focus(); }catch(e){}
      return;
    }

    if(a === "abort"){
      stopTimer();
      S.running = false; S.text = ""; S.startAt = 0;
      S.flash = "已放弃本次限时，未记录";
      draw(); return;
    }

    if(a === "submit"){
      f = findQ2(S.pid, S.qno);
      if(!f || !f.q){ stopTimer(); S.running = false; S.flash = "题目丢失，本次未记录"; draw(); return; }
      try{
        var ta0 = document.getElementById("b17-text");
        if(ta0) S.text = String(ta0.value || "");
      }catch(e){}
      if(!S.text.replace(/\s/g, "").length){
        S.flash = "还没写内容，写几句再交卷（不想练就点「放弃本次」）";
        var tipEl = document.getElementById("b17-tip");
        if(tipEl) tipEl.textContent = S.flash;
        return;
      }
      var used = elapsed();
      stopTimer();
      S.running = false;

      var res = doScore(S.text, f.q);
      var rate = (typeof res.rate === "number") ? res.rate : 0;
      var hit  = num(res.hitCount, (isArr(res.hits) ? res.hits.length : 0));
      var tot  = num(res.total, (isArr(f.q.points) ? f.q.points.length : 0));
      var dev  = used - S.sugSec;
      var tip  = "本次命中率 " + Math.round(rate * 100) + "%　用时 " + fmtCn(used) + "　" +
                 (dev > 0 ? ("比建议多 " + dev + " 秒，下次压缩找点时间")
                          : (dev < 0 ? ("比建议少 " + Math.abs(dev) + " 秒，节奏不错，注意别为了快漏点")
                                     : "与建议时长持平，节奏稳定"));

      S.result = {
        rate: rate, hit: hit, total: tot, used: used,
        limit: S.limitSec, sug: S.sugSec, res: res, tip: tip
      };

      var recs = loadRecs();
      recs.unshift({
        ts: Date.now(), pid: S.pid, qno: S.qno,
        title: paperName(f.p) + " 题" + String(f.q.no),
        qtype: f.q.qtype || "", dim: dimOf(f.q.qtype),
        limit: S.limitSec, sug: S.sugSec, used: used,
        rate: rate, hit: hit, total: tot, chars: S.text.length
      });
      S.flash = saveRecs(recs) ? "已记入限时档案（本机）" : "浏览器拒绝写入本地存储，本次未存档";
      S.startAt = 0;
      draw(); return;
    }

    if(a === "again"){
      S.result = null; S.text = ""; S.flash = "";
      draw(); return;
    }

    if(a === "goans"){
      f = findQ2(S.pid, S.qno);
      if(!f) return;
      stopTimer();
      try{
        if(typeof openAnswerModal === "function") openAnswerModal(S.pid, S.qno);
        else if(typeof window.openAnswerModal === "function") window.openAnswerModal(S.pid, S.qno);
        else { S.flash = "主站作答弹窗未加载"; draw(); }
      }catch(e){ S.flash = "打开作答弹窗失败"; draw(); }
      return;
    }

    if(a === "gocmp"){
      stopTimer();
      try{
        if(typeof window.b8OpenCompare === "function") window.b8OpenCompare(S.pid, S.qno);
        else if(typeof window.renderCompare === "function") window.renderCompare();
        else { S.flash = "答案对照模块未加载"; draw(); }
      }catch(e){ S.flash = "打开答案对照失败"; draw(); }
      return;
    }

    if(a === "clear"){
      var ok = true;
      try{ ok = window.confirm("确定清空全部限时记录？该操作不可恢复。"); }catch(e){ ok = true; }
      if(!ok) return;
      S.flash = saveRecs([]) ? "已清空全部限时记录" : "清空失败，浏览器拒绝写入本地存储";
      draw(); return;
    }
  }

  /* ================= 路由入口 ================= */
  window.renderTimedDrill = function(){
    stopTimer();                 /* 重进先清计时器，避免多个 setInterval 叠加 */
    S.running = false;
    S.startAt = 0;
    try{
      draw();
    }catch(err){
      try{
        var box = document.getElementById("content");
        if(box) box.innerHTML = '<div class="b17-empty">单题限时模考运行出错：' +
          esc(String((err && err.message) || err)) + '</div>';
      }catch(e){}
      try{ console.error("[_b17]", err); }catch(e){}
    }
  };
  window.b17StopTimer = stopTimer;   /* 供主站/其它模块离开本页时手动清理 */

})();
