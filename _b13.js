(function(){
  "use strict";
  /* ==================================================================
     _b13 题型专项突破包（Type Drill Pack）
     把全部真题按 qtype 聚合成"题型包"，用 getRec 的命中率算出每类
     题型的平均水平，指出最薄弱的一类，并生成"今日专攻"清单，
     点「✍️ 作答」直接调主站 openAnswerModal 进入答题。
     与主站隔离：只读 DATA / findQ / getRec / openAnswerModal，
     不写任何 localStorage，暴露 window.renderDrill。
     所有类名 b13- 前缀，样式复用主站 :root 变量。
     ================================================================== */

  var WEAK      = 60;   /* 命中率低于此值判为"薄弱" */
  var GOOD      = 80;   /* 命中率不低于此值判为"稳" */
  var TODAY_MAX = 8;    /* 今日专攻最多列几题 */
  var STORE_KEY = "shenlun_answers_v2";

  /* 模块内状态（不碰主站 state） */
  var S = { open: null, today: true };
  var IDX = [];   /* 当前这次渲染的全部有效题目，行按钮用下标引用 */

  /* ---------- 自带 HTML 转义 ---------- */
  function esc(s){
    s = (s == null) ? "" : String(s);
    return s.replace(/[&<>"']/g, function(c){
      return ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c];
    });
  }

  /* ---------- 样式自挂载（主站未 link _b13.css 时兜底，不改任何文件） ---------- */
  function ensureCss(){
    try{
      var ls = document.getElementsByTagName("link"), i;
      for(i=0;i<ls.length;i++){
        if(String(ls[i].getAttribute("href") || "").indexOf("_b13.css") >= 0) return;
      }
      var el = document.createElement("link");
      el.rel = "stylesheet"; el.href = "_b13.css";
      (document.head || document.documentElement).appendChild(el);
    }catch(e){}
  }

  /* ---------- 数据安全访问 ---------- */
  function isArr(x){ return Object.prototype.toString.call(x) === "[object Array]"; }

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
    }
    return null;
  }

  /* 优先用主站 findQ 校验，失败回落本地遍历 */
  function getQ(pid, qno){
    if(pid == null || qno == null || qno === "") return null;
    try{
      if(typeof findQ === "function"){
        var f = findQ(pid, qno);
        if(!f && String(Number(qno)) === String(qno)) f = findQ(pid, Number(qno));
        if(f && f.q) return f;
      }
    }catch(e){}
    try{ return localFind(pid, qno); }catch(e){ return null; }
  }

  /* 一次性读作答记录快照；读不到就逐题回落 getRec */
  function recLookup(){
    var map = null;
    try{
      var raw = localStorage.getItem(STORE_KEY);
      if(raw){
        var o = JSON.parse(raw);
        if(o && typeof o === "object") map = o;
      }
    }catch(e){ map = null; }
    return function(pid, qno){
      if(map) return map[pid + "#" + qno] || null;
      try{ if(typeof getRec === "function") return getRec(pid, qno) || null; }catch(e){}
      return null;
    };
  }

  function scoreOf(rec){
    if(!rec || typeof rec !== "object") return null;
    var s = rec.score;
    if(typeof s !== "number" || isNaN(s)){
      if(typeof rec.rate === "number" && !isNaN(rec.rate)) s = rec.rate * 100;
      else return null;
    }
    s = Math.round(s);
    if(s < 0) s = 0;
    if(s > 100) s = 100;
    return s;
  }

  function lvl(sc){
    if(sc == null) return "na";
    if(sc < WEAK)  return "lo";
    if(sc < GOOD)  return "mid";
    return "hi";
  }

  /* ---------- 聚合：按 qtype 分组 ---------- */
  function build(){
    var ps = papers(), look = recLookup();
    var order = [], map = {}, i, j;
    IDX = [];

    for(i=0;i<ps.length;i++){
      var p = ps[i];
      if(!p || typeof p !== "object" || !isArr(p.questions)) continue;
      for(j=0;j<p.questions.length;j++){
        var q = p.questions[j];
        if(!q || typeof q !== "object") continue;
        if(!getQ(p.id, q.no)) continue;              /* 用 findQ 校验 pid/qno */

        var qt = String(q.qtype == null ? "" : q.qtype).trim() || "未标题型";
        var sc = scoreOf(look(p.id, q.no));
        var it = {
          i: IDX.length,
          pid: p.id, qno: q.no, qtype: qt, score: sc,
          year: (p.year == null ? "" : p.year),
          paper: (p.paper == null ? "" : p.paper),
          province: (p.province == null ? "" : p.province),
          pts: isArr(q.points) ? q.points.length : 0
        };
        IDX.push(it);

        var k = "t:" + qt;
        if(!Object.prototype.hasOwnProperty.call(map, k)){
          map[k] = { qtype:qt, items:[], answered:0, sum:0, weak:0 };
          order.push(k);
        }
        var g = map[k];
        g.items.push(it);
        if(sc != null){ g.answered++; g.sum += sc; if(sc < WEAK) g.weak++; }
      }
    }

    var gs = [];
    for(i=0;i<order.length;i++){
      var it2 = map[order[i]];
      it2.avg = it2.answered ? Math.round(it2.sum / it2.answered) : null;
      gs.push(it2);
    }
    /* 答过的排前面、平均命中率低的优先；没答过的按题量降序垫后 */
    gs.sort(function(a, b){
      if((a.avg == null) !== (b.avg == null)) return a.avg == null ? 1 : -1;
      if(a.avg != null && a.avg !== b.avg) return a.avg - b.avg;
      return b.items.length - a.items.length;
    });
    return gs;
  }

  /* 专攻排序：命中率低的在前，未作答的垫后，同分按年份新→旧 */
  function drillSort(a, b){
    var as = (a.score == null) ? 1e6 : a.score;
    var bs = (b.score == null) ? 1e6 : b.score;
    if(as !== bs) return as - bs;
    var ay = Number(a.year) || 0, by = Number(b.year) || 0;
    if(ay !== by) return by - ay;
    return (Number(a.qno) || 0) - (Number(b.qno) || 0);
  }

  function groupByType(gs, qtype){
    for(var i=0;i<gs.length;i++) if(gs[i].qtype === qtype) return gs[i];
    return null;
  }

  /* ---------- 片段 ---------- */
  function scoreTag(it){
    if(it.score == null) return '<span class="b13-sc na">未作答</span>';
    return '<span class="b13-sc ' + lvl(it.score) + '">命中率 ' + it.score + '%</span>';
  }

  function rowHtml(it, withType){
    var weak = (it.score != null && it.score < WEAK);
    return '' +
      '<div class="b13-row' + (weak ? " wk" : "") + '">' +
        '<div class="b13-rl">' +
          '<span class="b13-yr">' + esc(it.year) + ' ' + esc(it.paper) + '</span>' +
          (it.province ? '<span class="b13-pv">' + esc(it.province) + '</span>' : "") +
          '<span class="b13-qn">题 ' + esc(it.qno) + '</span>' +
          (withType ? '<span class="b13-tt">' + esc(it.qtype) + '</span>' : "") +
          (it.pts ? '<span class="b13-pt">' + it.pts + ' 采分点</span>' : "") +
        '</div>' +
        '<div class="b13-rr">' +
          scoreTag(it) +
          (weak ? '<span class="b13-wk">薄弱</span>' : "") +
          '<button class="b13-btn" data-b13="ans" data-i="' + it.i + '">✍️ 作答</button>' +
        '</div>' +
      '</div>';
  }

  function cardHtml(g, isWeakest){
    var avgTxt = (g.avg == null) ? "—" : (g.avg + "%");
    var cls = "b13-card b13-tcard " + lvl(g.avg) +
              (S.open === g.qtype ? " on" : "") + (isWeakest ? " first" : "");
    return '' +
      '<div class="' + cls + '" data-b13="type" data-t="' + esc(g.qtype) + '">' +
        '<div class="b13-ct">' +
          '<b>' + esc(g.qtype) + '</b>' +
          (isWeakest ? '<span class="b13-flag">最该攻</span>' : "") +
        '</div>' +
        '<div class="b13-cn">共 <b>' + g.items.length + '</b> 题 · 你已答 <b>' + g.answered + '</b> 题' +
          (g.weak ? ' · <i>' + g.weak + ' 题薄弱</i>' : "") + '</div>' +
        '<div class="b13-bar"><i style="width:' + (g.avg == null ? 0 : g.avg) + '%"></i></div>' +
        '<div class="b13-avg">平均命中率 <b>' + avgTxt + '</b></div>' +
      '</div>';
  }

  function todayHtml(gs){
    if(!S.today) return "";
    var g = null, i;
    for(i=0;i<gs.length;i++){ if(gs[i].answered > 0){ g = gs[i]; break; } }
    var body, head;
    if(!g){
      head = '今日专攻';
      body = '<div class="b13-empty">还没有任何作答记录。先随便点开一类题型，做完 2～3 题，' +
             '这里就会自动锁定你最薄弱的题型并排出专攻清单。</div>';
    }else{
      var list = g.items.slice(0).sort(drillSort).slice(0, TODAY_MAX);
      head = '今日专攻 · <span class="b13-sub">锁定最弱题型「<b>' + esc(g.qtype) +
             '</b>」（平均 ' + g.avg + '%），按命中率从低到高排</span>';
      body = list.map(function(x){ return rowHtml(x, false); }).join("") ||
             '<div class="b13-empty">该题型下暂无可作答的题目。</div>';
    }
    return '<div class="b13-card b13-today">' +
             '<div class="b13-h3">🔥 ' + head +
               '<button class="b13-mini" data-b13="hide">收起</button>' +
             '</div>' + body +
           '</div>';
  }

  function listHtml(gs){
    if(!S.open) return "";
    var g = groupByType(gs, S.open);
    if(!g) return "";
    var rows = g.items.slice(0).sort(drillSort)
                 .map(function(x){ return rowHtml(x, false); }).join("");
    return '<div class="b13-card b13-list">' +
             '<div class="b13-h3">📂 ' + esc(g.qtype) + ' · 全部 ' + g.items.length + ' 题 ' +
               '<span class="b13-sub">已答 ' + g.answered + ' 题 · 平均 ' +
               (g.avg == null ? "—" : g.avg + "%") + ' · 命中率低的排在前面</span>' +
               '<button class="b13-mini" data-b13="close">收起</button>' +
             '</div>' +
             (rows || '<div class="b13-empty">这一类暂时没有题目。</div>') +
           '</div>';
  }

  /* ---------- 渲染 ---------- */
  function draw(){
    ensureCss();
    var box = document.getElementById("content");
    if(!box) return;

    var gs = build();

    try{
      var st = document.getElementById("stats");
      if(st) st.textContent = "题型专项突破包 · " + gs.length + " 类题型 · 共 " + IDX.length + " 题";
    }catch(e){}

    if(!gs.length){
      box.innerHTML = '<div class="b13-wrap"><div class="b13-card">' +
        '<div class="b13-empty">没有读到可用的真题数据（DATA.papers 为空或题目缺少题号）。</div>' +
        '</div></div>';
      return;
    }

    var weakest = (gs[0] && gs[0].avg != null) ? gs[0] : null;
    var lead = weakest
      ? '按题型把全部真题打成"专攻包"。<b>建议先攻平均命中率最低的那类题型</b>——' +
        '当前最弱是「<b>' + esc(weakest.qtype) + '</b>」，平均命中率仅 <b>' + weakest.avg + '%</b>，' +
        '同类题练透一类，提分最快。'
      : '按题型把全部真题打成"专攻包"。<b>建议先攻平均命中率最低的那类题型</b>——' +
        '你还没有作答记录，先各题型试做几题，系统才能算出你的薄弱项。';

    var cards = gs.map(function(g){ return cardHtml(g, weakest === g); }).join("");

    box.innerHTML = '' +
      '<div class="b13-wrap">' +
        '<div class="b13-head">' +
          '<h2>🎯 题型专项突破包</h2>' +
          '<p class="b13-lead">' + lead + '</p>' +
          '<div class="b13-ops">' +
            '<button class="b13-mini" data-b13="refresh">🔄 刷新统计</button>' +
            (S.today ? "" : '<button class="b13-mini" data-b13="show">🔥 显示今日专攻</button>') +
            '<span class="b13-tip">命中率 &lt; ' + WEAK + '% 记为薄弱，≥ ' + GOOD + '% 记为已稳</span>' +
          '</div>' +
        '</div>' +
        todayHtml(gs) +
        '<div class="b13-grid">' + cards + '</div>' +
        listHtml(gs) +
      '</div>';

    bind(box);
  }

  /* ---------- 事件（委托，不用内联 onclick） ---------- */
  function bind(root){
    if(root.__b13bound) return;
    root.__b13bound = true;
    root.addEventListener("click", function(ev){
      var el = ev.target, act = null, i;
      while(el && el !== root){
        act = el.getAttribute && el.getAttribute("data-b13");
        if(act) break;
        el = el.parentNode;
      }
      if(!act) return;

      if(act === "ans"){
        ev.stopPropagation();
        i = parseInt(el.getAttribute("data-i"), 10);
        var it = (!isNaN(i) && IDX[i]) ? IDX[i] : null;
        if(!it) return;
        try{
          if(typeof openAnswerModal === "function") openAnswerModal(it.pid, it.qno);
          else if(typeof window.openAnswerModal === "function") window.openAnswerModal(it.pid, it.qno);
          else alert("作答弹窗未加载");
        }catch(err){ try{ console.error("[_b13]", err); }catch(e){} }
        return;
      }
      if(act === "type"){
        var t = el.getAttribute("data-t");
        S.open = (S.open === t) ? null : t;
        draw();
        return;
      }
      if(act === "close"){ S.open  = null;  draw(); return; }
      if(act === "hide"){  S.today = false; draw(); return; }
      if(act === "show"){  S.today = true;  draw(); return; }
      if(act === "refresh"){ draw(); return; }
    });
  }

  /* ================= 路由入口 ================= */
  window.renderDrill = function(){
    try{
      draw();
    }catch(err){
      try{
        var box = document.getElementById("content");
        if(box) box.innerHTML = '<div class="b13-empty">题型专项突破包运行出错：' +
          esc(String((err && err.message) || err)) + '</div>';
      }catch(e){}
      try{ console.error("[_b13]", err); }catch(e){}
    }
  };

})();
