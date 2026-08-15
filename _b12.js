(function(){
  "use strict";
  /* ==================================================================
     _b12 材料阅读训练器（Material Reading Trainer）
     申论 80% 的分藏在材料里。本模块专训"材料 → 要点"的转化：
       模式A 标层次：给每段材料打 问题/原因/做法/成效/其他 标签，
                     再按"采分点来源段是否被标对"给反馈；
       模式B 摘原词：从材料里摘可直接入答案的原词原句，
                     与 q.points 做 2-4gram 重叠匹配，报告覆盖率。
     与主站隔离：只读 DATA / findQ（不可用时自带兜底遍历），
     只写 localStorage["shenlun_mattrain_v1"]，暴露 window.renderMatTrain。
     所有类名 b12- 前缀，样式复用主站 :root 变量。
     ================================================================== */

  var LS_KEY = "shenlun_mattrain_v1";
  var HIT    = 0.45;   /* 摘词命中阈值：与采分点重叠率 ≥ 0.45 视为覆盖 */
  var SRC    = 0.30;   /* 溯源阈值：采分点与某段材料重叠率 ≥ 0.30 视为出自该段 */
  var TAG_CN = { core:"核心", flex:"弹性", fmt:"格式" };

  /* 层次标签体系 */
  var LEVELS = [
    { k:"problem", cn:"问题", cls:"pb" },
    { k:"cause",   cn:"原因", cls:"cs" },
    { k:"action",  cn:"做法", cls:"ac" },
    { k:"effect",  cn:"成效", cls:"ef" },
    { k:"other",   cn:"其他", cls:"ot" }
  ];
  function levelCn(k){
    for(var i=0;i<LEVELS.length;i++) if(LEVELS[i].k === k) return LEVELS[i].cn;
    return "未标";
  }
  function levelCls(k){
    for(var i=0;i<LEVELS.length;i++) if(LEVELS[i].k === k) return LEVELS[i].cls;
    return "";
  }

  /* 自带 HTML 转义，不依赖主站 */
  function esc(s){
    s = (s == null) ? "" : String(s);
    return s.replace(/[&<>"']/g, function(c){
      return ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c];
    });
  }

  /* 模块内状态（不碰主站 state） */
  var S = {
    pid:"", qno:"", mode:"A",
    tags:{},        /* 段索引 -> level key */
    pick:"",        /* 模式B 的摘词框内容 */
    resA:null, resB:null,
    showStd:false
  };

  /* ---------- 样式自挂载（主站未 link _b12.css 时兜底，不改任何文件） ---------- */
  function ensureCss(){
    try{
      var ls = document.getElementsByTagName("link"), i;
      for(i=0;i<ls.length;i++){
        if(String(ls[i].getAttribute("href") || "").indexOf("_b12.css") >= 0) return;
      }
      var el = document.createElement("link");
      el.rel = "stylesheet"; el.href = "_b12.css";
      (document.head || document.documentElement).appendChild(el);
    }catch(e){}
  }

  /* ---------- 数据安全访问 ---------- */
  function papers(){
    try{
      var D = (typeof DATA !== "undefined" && DATA) ? DATA : (window.DATA || null);
      return (D && Object.prototype.toString.call(D.papers) === "[object Array]") ? D.papers : [];
    }catch(e){ return []; }
  }
  function localFind(pid, qno){
    var ps = papers(), i, j, qs;
    for(i=0;i<ps.length;i++){
      if(String(ps[i] && ps[i].id) !== String(pid)) continue;
      qs = (ps[i].questions || []);
      for(j=0;j<qs.length;j++){
        if(String(qs[j] && qs[j].no) === String(qno)) return { p:ps[i], q:qs[j] };
      }
    }
    return null;
  }
  /* 优先用主站 findQ（其 no 为数字，做双形态尝试），失败回落本地遍历 */
  function getQ(pid, qno){
    if(!pid || qno === "" || qno == null) return null;
    try{
      if(typeof findQ === "function"){
        var f = findQ(pid, qno);
        if(!f && String(Number(qno)) === String(qno)) f = findQ(pid, Number(qno));
        if(f && f.q) return f;
      }
    }catch(e){}
    try{ return localFind(pid, qno); }catch(e){ return null; }
  }
  function paperById(pid){
    var ps = papers(), i;
    for(i=0;i<ps.length;i++) if(String(ps[i].id) === String(pid)) return ps[i];
    return null;
  }
  function matOf(q){
    try{
      var m = q && q.material;
      if(Object.prototype.toString.call(m) !== "[object Array]") return [];
      return m.filter(function(x){ return String(x == null ? "" : x).trim(); })
              .map(function(x){ return String(x); });
    }catch(e){ return []; }
  }
  function ptsOf(q){
    try{
      var a = q && q.points;
      if(Object.prototype.toString.call(a) !== "[object Array]") return [];
      return a.filter(function(x){ return x && x.text; });
    }catch(e){ return []; }
  }

  /* ---------- 文本相似：2-4gram 重叠 ---------- */
  function norm(s){
    return String(s == null ? "" : s).toLowerCase()
      .replace(/[\s\u3000]/g, "")
      .replace(/[，。、；：？！“”‘’（）《》〈〉【】—…·,.;:?!"'()<>\[\]{}\/\\|`~@#$%^&*_+=\-]/g, "");
  }
  function grams(s, n){
    var out = {}, i;
    if(!s) return out;
    if(s.length <= n){ out[s] = 1; return out; }
    for(i=0;i+n<=s.length;i++) out[s.substr(i, n)] = 1;
    return out;
  }
  /* 以 a 为基准，看 a 的 gram 有多少落在 b 里（覆盖率，方向敏感） */
  function cover(a, b, n){
    var ga = grams(a, n), gb = grams(b, n), ka = Object.keys(ga), hit = 0, i;
    if(!ka.length || !Object.keys(gb).length) return 0;
    for(i=0;i<ka.length;i++) if(gb[ka[i]]) hit++;
    return hit / ka.length;
  }
  /* 用户摘的词 vs 采分点：短句被长句包含也算命中 */
  function sim(mine, pt){
    var A = norm(mine), B = norm(pt);
    if(!A || !B) return 0;
    if(A.length >= 4 && B.indexOf(A) >= 0) return 1;
    if(B.length >= 4 && A.indexOf(B) >= 0) return 1;
    var base = A.length <= B.length ? A : B;
    var other = A.length <= B.length ? B : A;
    var s2 = cover(base, other, 2);
    var s3 = cover(base, other, 3);
    var s4 = cover(base, other, 4);
    return Math.min(1, Math.max(s2 * 0.85, s3, s4 * 1.15));
  }
  /* 采分点溯源：该点最像哪一段材料 */
  function traceSource(ptText, mats){
    var best = -1, bestS = 0, i, s;
    for(i=0;i<mats.length;i++){
      s = Math.max(cover(norm(ptText), norm(mats[i]), 3), cover(norm(ptText), norm(mats[i]), 2) * 0.8);
      if(s > bestS){ bestS = s; best = i; }
    }
    return { idx: bestS >= SRC ? best : -1, score: bestS };
  }

  /* ---------- 规则：材料段落的"应然层次"推断（用于标准拆解 + 模式A 判分） ---------- */
  var RULES = [
    { k:"effect",  re:/(成效|效果|成果|取得|实现了|带动了|促进了|提升了|提高了|增加了|增长|增收|下降了|荣获|获评|示范|典型|变成了|如今|截至目前|累计|同比|亩产|收入达|突破)/ },
    { k:"action",  re:/(要|应当|应该|必须|加强|完善|建立|健全|推进|推动|落实|强化|优化|加大|构建|开展|实施|探索|出台|制定|引入|引导|培育|整治|扶持|组织|设立|打造|推行|试点|统筹|规范|加快|坚持|通过.{0,8}(方式|办法|机制))/ },
    { k:"cause",   re:/(原因|由于|因为|之所以|导致|源于|根源|造成|受制于|受限于|以致|归因|究其)/ },
    { k:"problem", re:/(不足|缺乏|缺失|缺少|不够|难以|滞后|薄弱|问题|矛盾|困难|不到位|欠缺|失衡|短板|流失|闲置|下降|不高|不强|无人|空心化|老龄化|抱怨|投诉|反映强烈|亟待|亟需|尚未|没有)/ }
  ];
  function inferLevel(text){
    var t = String(text || ""), i;
    /* 优先级：成效 > 做法 > 原因 > 问题，先命中先返回；均不命中为其他 */
    for(i=0;i<RULES.length;i++) if(RULES[i].re.test(t)) return RULES[i].k;
    return "other";
  }

  /* ---------- 记录 ---------- */
  function loadHis(){
    try{
      var a = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
      return (Object.prototype.toString.call(a) === "[object Array]") ? a : [];
    }catch(e){ return []; }
  }
  function saveHis(a){
    try{ localStorage.setItem(LS_KEY, JSON.stringify(a.slice(0, 200))); }catch(e){}
  }
  function pushHis(rec){ var a = loadHis(); a.unshift(rec); saveHis(a); }
  function fmtTime(t){
    try{
      var d = new Date(t);
      function z(n){ return (n < 10 ? "0" : "") + n; }
      return d.getFullYear() + "-" + z(d.getMonth()+1) + "-" + z(d.getDate()) + " " + z(d.getHours()) + ":" + z(d.getMinutes());
    }catch(e){ return ""; }
  }

  /* ================= 判分：模式A 标层次 ================= */
  /*
     规则（可解释、不玄学）：
     1) 先把每个采分点溯源到最像的那一段材料（traceSource）。
     2) 该点属于"做法/成效"类（由采分点文本推断），
        且其来源段被用户标成了 做法 或 成效 → 记为"逻辑线覆盖成功"。
     3) 其余采分点，只要来源段的用户标签 == 该点的推断层次，也算对。
     4) 溯源失败（材料里找不到出处）的点单列，不计入对错，只作提示。
  */
  function gradeA(q, mats){
    var pts = ptsOf(q), i, tr, want, got, ok = [], bad = [], lost = [], usedSeg = {};
    for(i=0;i<pts.length;i++){
      tr = traceSource(pts[i].text, mats);
      if(tr.idx < 0){ lost.push({ pt:pts[i] }); continue; }
      usedSeg[tr.idx] = 1;
      want = inferLevel(pts[i].text);
      got  = S.tags[tr.idx] || "";
      /* 做法/成效 互认：申论里"做法"与其"成效"常同段，标中任一即算读懂了这条逻辑线 */
      var pass = (got === want) ||
                 ((want === "action" || want === "effect") && (got === "action" || got === "effect"));
      (pass ? ok : bad).push({ pt:pts[i], seg:tr.idx, want:want, got:got, s:tr.score });
    }
    /* 统计用户标签分布 */
    var dist = {}, k;
    for(k in S.tags){ if(S.tags.hasOwnProperty(k) && S.tags[k]) dist[S.tags[k]] = (dist[S.tags[k]] || 0) + 1; }
    /* 空标段（有采分点出处但用户没打标签）*/
    var blank = [];
    for(i=0;i<mats.length;i++) if(usedSeg[i] && !S.tags[i]) blank.push(i);
    return {
      ok:ok, bad:bad, lost:lost, dist:dist, blank:blank,
      total: ok.length + bad.length, hit: ok.length,
      tagged: Object.keys(S.tags).filter(function(x){ return S.tags[x]; }).length,
      segs: mats.length
    };
  }

  /* ================= 判分：模式B 摘原词 ================= */
  function splitPicks(txt){
    return String(txt || "")
      .split(/[\n\r；;｜|]+/)
      .map(function(s){ return s.trim(); })
      .filter(function(s){ return s.length >= 2; });
  }
  function gradeB(q, mats){
    var pts = ptsOf(q), mine = splitPicks(S.pick), i, j, best, bestS, s;
    var covered = [], missed = [], extra = [], used = {};
    for(i=0;i<pts.length;i++){
      best = -1; bestS = 0;
      for(j=0;j<mine.length;j++){
        s = sim(mine[j], pts[i].text);
        if(s > bestS){ bestS = s; best = j; }
      }
      if(best >= 0 && bestS >= HIT){
        used[best] = 1;
        covered.push({ pt:pts[i], mine:mine[best], s:bestS });
      }else{
        missed.push({ pt:pts[i], s:bestS });
      }
    }
    for(j=0;j<mine.length;j++) if(!used[j]) extra.push(mine[j]);

    /* 原词率：摘出来的句子里，有多少确实来自材料原文（3gram 覆盖 ≥ 0.6） */
    var raw = 0, matAll = norm(mats.join(""));
    for(j=0;j<mine.length;j++){
      if(cover(norm(mine[j]), matAll, 3) >= 0.6) raw++;
    }
    return {
      covered:covered, missed:missed, extra:extra,
      total:pts.length, hit:covered.length,
      pickN:mine.length, rawN:raw
    };
  }

  /* ================= 反馈文案 ================= */
  function adviseA(r){
    var t = [], d = r.dist || {};
    if(!r.total){
      t.push("这道题库里的采分点无法与材料段落对上（可能是概括类改写题）。此时更该练模式B：先把材料原词摘出来，再压缩。");
      return t;
    }
    if(r.tagged < Math.ceil(r.segs * 0.6)){
      t.push("你只标了 " + r.tagged + "/" + r.segs + " 段。读材料不能挑着读——<b>每段都必须落一个层次</b>，标成「其他」也比空着强，空着说明你根本没读。");
    }
    if(!d.action){
      t.push("你一个「做法」都没标。申论 60% 以上的分在对策/做法上，读材料时看到「要、加强、建立、推行」就该立刻标做法。");
    }
    if(!d.problem && !d.cause){
      t.push("你没标出任何「问题/原因」。问题句是对策的镜像——找不到问题，你写的对策就是悬空的套话。");
    }
    if((d.other || 0) > r.segs * 0.5){
      t.push("超过一半的段被你标成「其他」，这通常不是材料没用，而是<b>你没读出它在讲什么</b>。回去逐段问自己：这段是在说「坏事、为什么坏、怎么做、做完怎么样」里的哪一种。");
    }
    var i;
    for(i=0;i<r.bad.length && i<3;i++){
      t.push("第 " + (r.bad[i].seg + 1) + " 段其实是「" + levelCn(r.bad[i].want) + "」段（采分点「" +
             esc(String(r.bad[i].pt.text).slice(0, 18)) + "…」就出自这里），你标成了「" +
             (r.bad[i].got ? levelCn(r.bad[i].got) : "未标") + "」。");
    }
    if(r.lost.length){
      t.push("有 " + r.lost.length + " 个采分点在材料里找不到明显出处——这类点靠<b>归纳</b>而非摘抄，是拉开档次的地方。");
    }
    var rate = r.total ? r.hit / r.total : 0;
    if(rate >= 0.8) t.push("层次判断准确率 " + Math.round(rate * 100) + "%，你的材料分层能力已经过关，下一步练摘原词的精度。");
    else if(rate < 0.4) t.push("准确率偏低说明你在「平读」材料：从头读到尾但不分层。改掉它的唯一办法是强制每段落标签，连做 5 道。");
    return t;
  }
  function adviseB(r){
    var t = [];
    if(!r.total){ t.push("这道题暂无标准采分点，先把你认为能入答案的原词摘出来，回头对照机构答案。"); return t; }
    var rate = r.hit / r.total;
    if(!r.pickN){ t.push("你什么都没摘。摘原词不是抄材料，是<b>把阅卷人想看到的那几个词先固定下来</b>。"); return t; }
    if(r.rawN < r.pickN * 0.6){
      t.push("你摘的 " + r.pickN + " 条里只有 " + r.rawN + " 条真正来自材料原文，其余是你自己造的话。申论阅卷认材料词，<b>自造词=零分风险</b>，先摘后改。");
    }
    if(r.extra.length > Math.max(2, r.total * 0.6)){
      t.push("有 " + r.extra.length + " 条没对上任何采分点：摘得太散。判断标准很简单——这句话去掉后答案会不会丢分，不会就别摘。");
    }
    if(r.missed.length){
      var near = r.missed.filter(function(x){ return x.s >= 0.2; }).length;
      if(near) t.push("有 " + near + " 个点你其实「擦边」摘到了但不够准：说明你抓的是句子的<b>修饰部分</b>而不是核心动宾结构。摘的时候只留「动词+对象」。");
    }
    if(rate >= 0.8) t.push("原词覆盖 " + Math.round(rate * 100) + "%，材料转化这一关你已经打通，接下来练「合并同类项+分条书写」。");
    else if(rate < 0.4) t.push("覆盖率低于 40%：你的问题不在写作，在<b>读</b>。先别急着写答案，把这道题的材料逐段摘一遍再提交。");
    return t;
  }

  /* ================= 渲染：选题 ================= */
  function pickerHtml(){
    var ps = papers(), i, h = "", p, qs, j;
    if(!ps.length) return '<div class="b12-empty">没有读到题库数据（DATA.papers）。请确认本模块运行在主站页面内。</div>';
    h += '<div class="b12-pick">';
    h += '<label class="b12-lb">套卷</label><select class="b12-sel" data-act="pid"><option value="">— 请选择套卷 —</option>';
    for(i=0;i<ps.length;i++){
      p = ps[i];
      h += '<option value="' + esc(p.id) + '"' + (String(p.id) === String(S.pid) ? " selected" : "") + ">"
         + esc(String(p.year || "") + " " + String(p.paper || "")) + (p.province ? "（" + esc(p.province) + "）" : "") + "</option>";
    }
    h += "</select>";
    h += '<label class="b12-lb">题目</label><select class="b12-sel" data-act="qno">';
    p = paperById(S.pid);
    qs = p ? (p.questions || []) : [];
    if(!p){ h += '<option value="">— 先选套卷 —</option>'; }
    else{
      h += '<option value="">— 请选择题目 —</option>';
      for(j=0;j<qs.length;j++){
        h += '<option value="' + esc(qs[j].no) + '"' + (String(qs[j].no) === String(S.qno) ? " selected" : "") + ">"
           + esc("题" + qs[j].no + " " + (qs[j].qtype || "")) + "（材料 " + matOf(qs[j]).length + " 段 / 采分点 " + ptsOf(qs[j]).length + "）</option>";
      }
    }
    h += "</select></div>";
    return h;
  }

  /* ================= 渲染：模式切换 ================= */
  function tabsHtml(){
    var h = '<div class="b12-tabs">';
    h += '<button class="b12-tab' + (S.mode === "A" ? " on" : "") + '" data-act="mode" data-m="A">Ⓐ 标层次</button>';
    h += '<button class="b12-tab' + (S.mode === "B" ? " on" : "") + '" data-act="mode" data-m="B">Ⓑ 摘原词</button>';
    h += '<span class="b12-sub">' + (S.mode === "A"
        ? "给每段材料判定它在讲什么（问题 / 原因 / 做法 / 成效 / 其他），练的是<b>结构感</b>。"
        : "从材料里挑出能直接进答案的原词原句，练的是<b>转化精度</b>。") + "</span>";
    h += "</div>";
    return h;
  }

  /* ================= 渲染：题面 ================= */
  function stemHtml(f){
    var h = "", p = f.p, q = f.q;
    h += '<div class="b12-qmeta">' + esc(String(p.year || "") + " " + String(p.paper || ""))
       + " · 题" + esc(q.no) + " · <b>" + esc(q.qtype || "") + "</b>"
       + (q.score ? " · " + esc(q.score) : "") + (q.words ? " · " + esc(q.words) : "") + "</div>";
    h += '<div class="b12-stem">'
       + ((q.stem || []).map(function(s){ return "<div>" + esc(s) + "</div>"; }).join("")
          || '<div class="b12-sub">（该题无题干文本）</div>')
       + "</div>";
    return h;
  }

  /* ================= 渲染：模式A 段落打标 ================= */
  function modeAHtml(mats){
    var h = "", i, j, cur;
    h += '<div class="b12-card">';
    h += '<div class="b12-h3">③ 逐段判层次 <span class="b12-sub">（' + mats.length + ' 段，每段必须落一个标签）</span></div>';
    h += '<div class="b12-warn">别先看采分点。读一段，问一句：它在说<b>坏事（问题）</b>、<b>为什么坏（原因）</b>、<b>怎么做（做法）</b>，还是<b>做完怎么样（成效）</b>？</div>';
    h += '<div class="b12-segs">';
    for(i=0;i<mats.length;i++){
      cur = S.tags[i] || "";
      h += '<div class="b12-seg' + (cur ? " done" : "") + '">';
      h += '<div class="b12-segno">' + (i + 1) + "</div>";
      h += '<div class="b12-segbd"><div class="b12-segtx">' + esc(mats[i]) + "</div>";
      h += '<div class="b12-lvs">';
      for(j=0;j<LEVELS.length;j++){
        h += '<button class="b12-lv ' + LEVELS[j].cls + (cur === LEVELS[j].k ? " on" : "") + '"'
           + ' data-act="tag" data-i="' + i + '" data-k="' + LEVELS[j].k + '">' + LEVELS[j].cn + "</button>";
      }
      h += "</div></div></div>";
    }
    h += "</div>";
    h += '<div class="b12-acts">';
    h += '<button class="b12-btn primary" data-act="subA">提交，看逻辑线是否对上 →</button>';
    h += '<button class="b12-btn ghost" data-act="clearA">清空标签</button>';
    h += '<span class="b12-sub">已标 ' + Object.keys(S.tags).filter(function(k){ return S.tags[k]; }).length + " / " + mats.length + " 段</span>";
    h += "</div></div>";
    return h;
  }

  /* ================= 渲染：模式B 摘原词 ================= */
  function modeBHtml(mats){
    var h = "", i;
    h += '<div class="b12-card">';
    h += '<div class="b12-h3">③ 摘原词 <span class="b12-sub">（' + mats.length + " 段，点「摘」把整段送进下方，再自己删到只剩要点）</span></div>";
    h += '<div class="b12-warn">摘的标准只有一条：<b>这句话删掉，答案会不会丢分</b>。会，就摘；不会，跳过。保留材料原词，别急着换成自己的话。</div>';
    h += '<div class="b12-segs">';
    for(i=0;i<mats.length;i++){
      h += '<div class="b12-seg"><div class="b12-segno">' + (i + 1) + "</div>";
      h += '<div class="b12-segbd"><div class="b12-segtx">' + esc(mats[i]) + "</div>";
      h += '<div class="b12-lvs"><button class="b12-btn sm" data-act="copy" data-i="' + i + '">⬇ 摘此段</button></div>';
      h += "</div></div>";
    }
    h += "</div>";
    h += '<div class="b12-h3" style="margin-top:14px">我摘出的要点原词 <span class="b12-sub">（一行一条，或用 ；/｜ 分隔）</span></div>';
    h += '<textarea class="b12-ta" data-act="pick" rows="8" placeholder="每行一条，例如：&#10;推行网格化管理&#10;引入第三方专业机构&#10;村民收入实现翻番">' + esc(S.pick) + "</textarea>";
    h += '<div class="b12-acts">';
    h += '<button class="b12-btn primary" data-act="subB">提交，看覆盖了几个采分点 →</button>';
    h += '<button class="b12-btn ghost" data-act="clearB">清空</button>';
    h += '<span class="b12-sub">已摘 ' + splitPicks(S.pick).length + " 条</span>";
    h += "</div></div>";
    return h;
  }

  /* ================= 渲染：结果A ================= */
  function resAHtml(){
    var r = S.resA, h = "", i, pct, tips;
    if(!r) return "";
    pct = r.total ? Math.round(r.hit / r.total * 100) : 0;
    tips = adviseA(r);
    h += '<div class="b12-card b12-res">';
    h += '<div class="b12-h3">④ 逻辑线反馈</div>';
    h += '<div class="b12-score"><b class="' + (pct >= 70 ? "ok" : (pct >= 40 ? "mid" : "bad")) + '">' + r.hit + " / " + r.total + "</b>"
       + '<span class="b12-sub">采分点的来源段中，你标对层次的有 ' + r.hit + " 个 · 准确率 " + pct + "%</span></div>";
    h += '<div class="b12-track"><i style="width:' + pct + '%"></i></div>';

    h += '<div class="b12-cols">';
    h += '<div class="b12-col ok"><div class="b12-colh">✅ 标对的逻辑线（' + r.ok.length + "）</div>";
    if(!r.ok.length) h += '<div class="b12-sub">暂时一条都没对上——这正是这个模块存在的理由。</div>';
    for(i=0;i<r.ok.length;i++){
      h += '<div class="b12-item"><div class="b12-std"><span class="b12-tag ' + esc(r.ok[i].pt.tag || "") + '">'
         + esc(TAG_CN[r.ok[i].pt.tag] || r.ok[i].pt.tag || "点") + "</span>" + esc(r.ok[i].pt.text || "") + "</div>"
         + '<div class="b12-from">出自第 ' + (r.ok[i].seg + 1) + " 段 · 你标「" + levelCn(r.ok[i].got) + "」</div></div>";
    }
    h += "</div>";

    h += '<div class="b12-col bad"><div class="b12-colh">❌ 标错层次的（' + r.bad.length + "）</div>";
    if(!r.bad.length) h += '<div class="b12-sub">全部命中，材料结构你读懂了。</div>';
    for(i=0;i<r.bad.length;i++){
      h += '<div class="b12-item"><div class="b12-std"><span class="b12-tag ' + esc(r.bad[i].pt.tag || "") + '">'
         + esc(TAG_CN[r.bad[i].pt.tag] || r.bad[i].pt.tag || "点") + "</span>" + esc(r.bad[i].pt.text || "") + "</div>"
         + '<div class="b12-from">出自第 ' + (r.bad[i].seg + 1) + " 段 · 应为「" + levelCn(r.bad[i].want) + "」，你标「"
         + (r.bad[i].got ? levelCn(r.bad[i].got) : "未标") + "」</div></div>";
    }
    h += "</div>";

    h += '<div class="b12-col warn"><div class="b12-colh">🔎 材料里没有直接出处的点（' + r.lost.length + "）</div>";
    if(!r.lost.length) h += '<div class="b12-sub">所有采分点都能在材料里溯源，属于典型摘抄型题。</div>';
    for(i=0;i<r.lost.length;i++){
      h += '<div class="b12-item"><div class="b12-std">' + esc(r.lost[i].pt.text || "") + "</div>"
         + '<div class="b12-from">需要跨段归纳，摘抄拿不到</div></div>';
    }
    h += "</div></div>";

    h += '<div class="b12-tip"><b>下一步怎么练</b>';
    for(i=0;i<tips.length;i++) h += "<div>· " + tips[i] + "</div>";
    h += "</div></div>";
    return h;
  }

  /* ================= 渲染：结果B ================= */
  function resBHtml(){
    var r = S.resB, h = "", i, pct, tips;
    if(!r) return "";
    pct = r.total ? Math.round(r.hit / r.total * 100) : 0;
    tips = adviseB(r);
    h += '<div class="b12-card b12-res">';
    h += '<div class="b12-h3">④ 原词覆盖反馈</div>';
    h += '<div class="b12-score"><b class="' + (pct >= 70 ? "ok" : (pct >= 40 ? "mid" : "bad")) + '">' + r.hit + " / " + r.total + "</b>"
       + '<span class="b12-sub">你摘的原词覆盖了 ' + r.hit + " 个采分点（共 " + r.total + " 个）· 覆盖率 " + pct + "%"
       + " · 摘了 " + r.pickN + " 条，其中 " + r.rawN + " 条确为材料原文</span></div>";
    h += '<div class="b12-track"><i style="width:' + pct + '%"></i></div>';

    h += '<div class="b12-cols">';
    h += '<div class="b12-col ok"><div class="b12-colh">✅ 已覆盖（' + r.covered.length + "）</div>";
    if(!r.covered.length) h += '<div class="b12-sub">一个都没覆盖到——先回材料，把带动词的句子整句摘下来再删。</div>';
    for(i=0;i<r.covered.length;i++){
      h += '<div class="b12-item"><div class="b12-std"><span class="b12-tag ' + esc(r.covered[i].pt.tag || "") + '">'
         + esc(TAG_CN[r.covered[i].pt.tag] || r.covered[i].pt.tag || "点") + "</span>" + esc(r.covered[i].pt.text || "") + "</div>"
         + '<div class="b12-mine">你摘的：' + esc(r.covered[i].mine) + ' <span class="b12-sub">（重叠 ' + Math.round(r.covered[i].s * 100) + "%）</span></div></div>";
    }
    h += "</div>";

    h += '<div class="b12-col bad"><div class="b12-colh">❌ 没摘到的采分点（' + r.missed.length + "）</div>";
    if(!r.missed.length) h += '<div class="b12-sub">全覆盖，材料转化满分。</div>';
    for(i=0;i<r.missed.length;i++){
      h += '<div class="b12-item"><div class="b12-std"><span class="b12-tag ' + esc(r.missed[i].pt.tag || "") + '">'
         + esc(TAG_CN[r.missed[i].pt.tag] || r.missed[i].pt.tag || "点") + "</span>" + esc(r.missed[i].pt.text || "") + "</div>"
         + (r.missed[i].s >= 0.2 ? '<div class="b12-from">你擦边了（' + Math.round(r.missed[i].s * 100) + "%），差在没抓住核心动宾</div>" : "")
         + "</div>";
    }
    h += "</div>";

    h += '<div class="b12-col warn"><div class="b12-colh">⚠️ 摘了但没用上（' + r.extra.length + "）</div>";
    if(!r.extra.length) h += '<div class="b12-sub">没有多余动作，摘得很干净。</div>';
    for(i=0;i<r.extra.length;i++){
      h += '<div class="b12-item"><div class="b12-mine">' + esc(r.extra[i]) + "</div></div>";
    }
    h += "</div></div>";

    h += '<div class="b12-tip"><b>下一步怎么练</b>';
    for(i=0;i<tips.length;i++) h += "<div>· " + tips[i] + "</div>";
    h += "</div></div>";
    return h;
  }

  /* ================= 渲染：标准拆解 ================= */
  function stdHtml(f, mats){
    var h = "", i, j, pts = ptsOf(f.q), lv, groups = {}, tr, list, order;
    h += '<div class="b12-card">';
    h += '<div class="b12-h3">⑤ 标准拆解 '
       + '<button class="b12-btn sm" data-act="std">' + (S.showStd ? "收起" : "展开对照") + "</button></div>";
    if(!S.showStd){
      h += '<div class="b12-sub">练完再看。提前看会毁掉这道题的训练价值。</div></div>';
      return h;
    }
    h += '<div class="b12-h4">材料逻辑线（系统按关键词推断，供校准用，不是唯一解）</div>';
    h += '<div class="b12-line">';
    for(i=0;i<mats.length;i++){
      lv = inferLevel(mats[i]);
      h += '<div class="b12-lineitem"><span class="b12-lv ' + levelCls(lv) + ' on">' + levelCn(lv) + "</span>"
         + '<span class="b12-linetx">第' + (i + 1) + "段：" + esc(String(mats[i]).slice(0, 46)) + (String(mats[i]).length > 46 ? "…" : "") + "</span>"
         + (S.tags[i] && S.tags[i] !== lv ? '<span class="b12-diff">你标：' + levelCn(S.tags[i]) + "</span>" : "")
         + "</div>";
    }
    h += "</div>";
    h += '<div class="b12-h4" style="margin-top:12px">各采分点来自哪类段落</div>';
    if(!pts.length){
      h += '<div class="b12-sub">该题暂无标准采分点数据。</div>';
    }else{
      for(i=0;i<pts.length;i++){
        tr = traceSource(pts[i].text, mats);
        lv = tr.idx >= 0 ? inferLevel(mats[tr.idx]) : "none";
        if(!groups[lv]) groups[lv] = [];
        groups[lv].push({ pt:pts[i], seg:tr.idx, s:tr.score });
      }
      order = ["problem", "cause", "action", "effect", "other", "none"];
      for(j=0;j<order.length;j++){
        list = groups[order[j]];
        if(!list || !list.length) continue;
        h += '<div class="b12-grp"><div class="b12-grph"><span class="b12-lv ' + levelCls(order[j]) + ' on">'
           + (order[j] === "none" ? "无出处" : levelCn(order[j])) + "</span> 段落贡献了 " + list.length + " 个采分点</div>";
        for(i=0;i<list.length;i++){
          h += '<div class="b12-item"><div class="b12-std"><span class="b12-tag ' + esc(list[i].pt.tag || "") + '">'
             + esc(TAG_CN[list[i].pt.tag] || list[i].pt.tag || "点") + "</span>" + esc(list[i].pt.text || "") + "</div>"
             + '<div class="b12-from">' + (list[i].seg >= 0
                 ? "← 第 " + (list[i].seg + 1) + " 段（原文重叠 " + Math.round(list[i].s * 100) + "%）"
                 : "← 材料中无直接原句，需跨段归纳") + "</div></div>";
        }
        h += "</div>";
      }
    }
    h += '<div class="b12-tip"><b>怎么用这张拆解表</b>'
       + "<div>· 先看逻辑线：问题段和做法段是不是成对出现？申论材料几乎都是「摆问题 → 找原因 → 给做法 → 报成效」的循环。</div>"
       + "<div>· 再看来源分布：如果采分点集中在「做法」段，说明这是典型对策题，读材料时应把 70% 注意力压在动词句上。</div>"
       + "<div>· 最后看无出处的点：这些是命题人要你<b>归纳</b>的，也是区分 35 分和 42 分的地方。</div>"
       + "</div>";
    h += "</div>";
    return h;
  }

  /* ================= 渲染：历史记录 ================= */
  function historyHtml(){
    var a = loadHis(), h = "", i, rec, pct, sumA = 0, nA = 0, sumB = 0, nB = 0;
    h += '<div class="b12-card">';
    h += '<div class="b12-h3">⑥ 训练记录 <span class="b12-sub">（本机 localStorage，离线保存）</span></div>';
    if(!a.length){
      h += '<div class="b12-sub">还没有记录。提交一次训练就会自动存在这里。</div></div>';
      return h;
    }
    for(i=0;i<a.length;i++){
      if(!a[i] || !a[i].total) continue;
      if(a[i].mode === "A"){ sumA += a[i].hit / a[i].total; nA++; }
      else { sumB += a[i].hit / a[i].total; nB++; }
    }
    h += '<div class="b12-stat">累计 <b>' + a.length + "</b> 次"
       + " · 标层次平均 <b>" + (nA ? Math.round(sumA / nA * 100) : 0) + "%</b>（" + nA + " 次）"
       + " · 摘原词平均 <b>" + (nB ? Math.round(sumB / nB * 100) : 0) + "%</b>（" + nB + " 次）"
       + ' <button class="b12-btn ghost sm" data-act="clearhis">清空记录</button></div>';
    h += '<div class="b12-his">';
    for(i=0;i<a.length && i<40;i++){
      rec = a[i] || {};
      pct = rec.total ? Math.round((rec.hit || 0) / rec.total * 100) : 0;
      h += '<div class="b12-hi"><div class="b12-hih">'
         + '<span class="b12-mtag ' + (rec.mode === "A" ? "ma" : "mb") + '">' + (rec.mode === "A" ? "标层次" : "摘原词") + "</span>"
         + '<b class="' + (pct >= 70 ? "ok" : (pct >= 40 ? "mid" : "bad")) + '">' + (rec.hit || 0) + "/" + (rec.total || 0) + "</b> "
         + esc(String(rec.title || rec.pid || "")) + " · 题" + esc(rec.qno) + " " + esc(rec.qtype || "")
         + '<span class="b12-sub">' + esc(fmtTime(rec.time)) + "</span>"
         + '<button class="b12-x sm" data-act="delhis" data-i="' + i + '" title="删除">×</button></div>';
      if(rec.note) h += '<div class="b12-hib">' + esc(rec.note) + "</div>";
      h += "</div>";
    }
    h += "</div></div>";
    return h;
  }

  /* ================= 渲染：底部训练价值说明 ================= */
  function footHtml(){
    var h = "";
    h += '<div class="b12-card b12-foot">';
    h += '<div class="b12-h3">为什么要单独练「材料 → 要点」</div>';
    h += "<p>申论不是作文考试，是<b>阅读理解 + 信息加工</b>考试。80% 的分写在材料里，命题人只是把它们打散、埋进案例和访谈里。绝大多数人失分不是因为不会写，而是因为<b>没看见</b>。</p>";
    h += '<div class="b12-steps">';
    h += '<div class="b12-step"><span class="b12-stepno">1</span><div><b>先分层</b>：读一段判一段——问题 / 原因 / 做法 / 成效。分层解决的是「材料太长记不住」，把上千字压成一条结构线。<i>对应模式Ⓐ。</i></div></div>';
    h += '<div class="b12-step"><span class="b12-stepno">2</span><div><b>再摘原词</b>：在已分层的段里，只挑能直接进答案的动宾短语。摘原词解决的是「意思对但不给分」——阅卷按关键词踩分，你换了说法就丢分。<i>对应模式Ⓑ。</i></div></div>';
    h += '<div class="b12-step"><span class="b12-stepno">3</span><div><b>最后归纳</b>：把同层次的原词合并同类项，加上「主体 + 动词 + 对象」的规范表述，才是成稿。<b>顺序不能倒</b>——先归纳后读材料，写出来的一定是套话。</div></div>';
    h += "</div>";
    h += '<p class="b12-sub">练法建议：同一道题先做Ⓐ再做Ⓑ，最后展开⑤标准拆解校准。连续 10 道之后，你读材料时会自动出现分层意识，这个能力一旦形成不会退化。</p>';
    h += "</div>";
    return h;
  }

  /* ================= 主渲染 ================= */
  function draw(){
    var box = document.getElementById("content"), h, f, mats;
    if(!box) return;
    ensureCss();

    h  = '<div class="b12-wrap">';
    h += '<div class="b12-head"><h2>📖 材料阅读训练器</h2>'
       + '<p class="b12-lead">申论 80% 的分藏在材料里，但几乎没人专门练「材料 → 要点」这一步。'
       + '这里把它拆成两个可反复训练的动作：<b>标层次</b>（读懂结构）和 <b>摘原词</b>（抓住踩分词）。</p></div>';
    h += '<div class="b12-card"><div class="b12-h3">① 选题</div>' + pickerHtml() + "</div>";

    f = getQ(S.pid, S.qno);
    if(S.pid && S.qno && !f){
      h += '<div class="b12-card"><div class="b12-empty">未找到该题（findQ 校验失败），请重新选择。</div></div>';
    }else if(f){
      mats = matOf(f.q);
      h += '<div class="b12-card"><div class="b12-h3">② 题面</div>' + stemHtml(f) + tabsHtml() + "</div>";
      if(!mats.length){
        h += '<div class="b12-card"><div class="b12-empty">这道题没有材料段落数据（q.material 为空），换一道有材料的题再练。</div></div>';
      }else{
        h += (S.mode === "A" ? modeAHtml(mats) : modeBHtml(mats));
        h += (S.mode === "A" ? resAHtml() : resBHtml());
        h += stdHtml(f, mats);
      }
    }else{
      h += '<div class="b12-card"><div class="b12-empty">先在上方选一套卷和一道题，材料会逐段展开在这里。</div></div>';
    }
    h += historyHtml();
    h += footHtml();
    h += "</div>";

    box.innerHTML = h;
    bind(box);

    try{
      var st = document.getElementById("stats");
      if(st) st.textContent = "材料阅读训练器 · 专训「材料 → 要点」的转化能力";
    }catch(e){}
  }

  /* ================= 事件 ================= */
  function syncPick(root){
    try{
      var ta = root.querySelector('.b12-ta[data-act="pick"]');
      if(ta) S.pick = ta.value;
    }catch(e){}
  }
  function resetQ(){
    S.tags = {}; S.pick = ""; S.resA = null; S.resB = null; S.showStd = false;
  }
  function submitA(f, mats){
    var r, p = f.p;
    if(!Object.keys(S.tags).filter(function(k){ return S.tags[k]; }).length){
      try{ alert("先给至少一段材料打上层次标签，再提交。"); }catch(e){}
      return;
    }
    r = gradeA(f.q, mats);
    S.resA = r;
    pushHis({
      time:Date.now(), mode:"A", pid:S.pid, qno:S.qno,
      title:String(p.year || "") + " " + String(p.paper || ""),
      qtype:f.q.qtype || "",
      hit:r.hit, total:r.total,
      note:"已标 " + r.tagged + "/" + r.segs + " 段；标错 " + r.bad.length + " 处，无出处点 " + r.lost.length + " 个"
    });
    draw();
  }
  function submitB(f, mats){
    var r, p = f.p;
    if(!splitPicks(S.pick).length){
      try{ alert("先摘几条原词到下方文本框，再提交。"); }catch(e){}
      return;
    }
    r = gradeB(f.q, mats);
    S.resB = r;
    pushHis({
      time:Date.now(), mode:"B", pid:S.pid, qno:S.qno,
      title:String(p.year || "") + " " + String(p.paper || ""),
      qtype:f.q.qtype || "",
      hit:r.hit, total:r.total,
      note:"摘 " + r.pickN + " 条（原文 " + r.rawN + " 条），未用上 " + r.extra.length + " 条"
    });
    draw();
  }

  function bind(box){
    var root = box.querySelector(".b12-wrap");
    if(!root) return;

    root.addEventListener("input", function(ev){
      var el = ev.target;
      if(el && el.getAttribute && el.getAttribute("data-act") === "pick") S.pick = el.value;
    });

    root.addEventListener("change", function(ev){
      var el = ev.target, act = el && el.getAttribute && el.getAttribute("data-act");
      if(act === "pid"){ S.pid = el.value; S.qno = ""; resetQ(); draw(); }
      else if(act === "qno"){ S.qno = el.value; resetQ(); draw(); }
    });

    root.addEventListener("click", function(ev){
      var el = ev.target, act, idx, f, mats, a;
      while(el && el !== root && !(el.getAttribute && el.getAttribute("data-act"))) el = el.parentNode;
      if(!el || el === root) return;
      act = el.getAttribute("data-act");
      idx = parseInt(el.getAttribute("data-i"), 10);
      f = getQ(S.pid, S.qno);
      mats = f ? matOf(f.q) : [];

      if(act === "mode"){
        syncPick(root);
        S.mode = el.getAttribute("data-m") === "B" ? "B" : "A";
        draw();
      }else if(act === "tag"){
        if(!isNaN(idx)){
          var k = el.getAttribute("data-k");
          S.tags[idx] = (S.tags[idx] === k) ? "" : k;   /* 再点一次取消 */
          draw();
        }
      }else if(act === "clearA"){
        S.tags = {}; S.resA = null; draw();
      }else if(act === "subA"){
        if(f && mats.length) submitA(f, mats);
      }else if(act === "copy"){
        if(!isNaN(idx) && mats[idx] != null){
          syncPick(root);
          S.pick = (S.pick ? S.pick.replace(/\s*$/, "") + "\n" : "") + String(mats[idx]);
          draw();
          try{
            var ta = box.querySelector('.b12-ta[data-act="pick"]');
            if(ta){ ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; ta.scrollTop = ta.scrollHeight; }
          }catch(e){}
        }
      }else if(act === "clearB"){
        S.pick = ""; S.resB = null; draw();
      }else if(act === "subB"){
        syncPick(root);
        if(f && mats.length) submitB(f, mats);
      }else if(act === "std"){
        syncPick(root); S.showStd = !S.showStd; draw();
      }else if(act === "delhis"){
        a = loadHis();
        if(!isNaN(idx) && idx >= 0 && idx < a.length){ a.splice(idx, 1); saveHis(a); draw(); }
      }else if(act === "clearhis"){
        try{ if(!confirm("确定清空全部材料训练记录？")) return; }catch(e){}
        saveHis([]); draw();
      }
    });
  }

  /* ================= 路由入口 ================= */
  window.renderMatTrain = function(){
    try{
      draw();
    }catch(err){
      try{
        var box = document.getElementById("content");
        if(box) box.innerHTML = '<div class="b12-empty">材料阅读训练器运行出错：' + esc(String((err && err.message) || err)) + "</div>";
      }catch(e){}
      try{ console.error("[_b12]", err); }catch(e){}
    }
  };

})();
