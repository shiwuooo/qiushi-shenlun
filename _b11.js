(function(){
  "use strict";
  /* ==================================================================
     _b11 采分点自标校准（Self-Calibration Drill）
     训练"评分者视角"：先不看成案，自己列出"我猜有哪几个采分点"，
     再与 q.points 对照，输出 命中 / 漏标 / 偏标，并沉淀校准记录。
     与主站隔离：只读 DATA、findQ（不可用时自带兜底），
     只写 localStorage["shenlun_selfcal_v1"]，暴露 window.renderSelfCal。
     所有类名 b11- 前缀，样式复用主站 :root 变量。
     ================================================================== */

  var LS_KEY   = "shenlun_selfcal_v1";
  var MIN_ROWS = 3;      // 至少 3 行自标
  var MAX_ROWS = 20;
  var HIT      = 0.5;    // 字符重叠率 ≥ 0.5 判命中
  var TAG_CN   = { core:"核心", flex:"弹性", fmt:"格式" };

  /* 自带 HTML 转义，不依赖主站 */
  var ESC = window.esc || function(s){
    s = (s == null) ? "" : String(s);
    return s.replace(/[&<>"']/g, function(c){
      return ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c];
    });
  };

  /* 模块内状态（不碰主站 state） */
  var S = { pid:"", qno:"", rows:["","",""], result:null, showMat:false };

  /* ---------- 样式自挂载（主站未 link _b11.css 时兜底，不改任何文件） ---------- */
  function ensureCss(){
    try{
      var ls = document.getElementsByTagName("link"), i;
      for(i=0;i<ls.length;i++){
        if(String(ls[i].getAttribute("href")||"").indexOf("_b11.css") >= 0) return;
      }
      var el = document.createElement("link");
      el.rel = "stylesheet"; el.href = "_b11.css";
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
  /* 优先用主站 findQ（其 no 为数字，做双形态尝试），失败回落本地实现 */
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

  /* ---------- 文本相似：2-4gram 重叠率 ---------- */
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
  function overlap(ga, gb){
    var ka = Object.keys(ga), kb = Object.keys(gb), hit = 0, i;
    if(!ka.length || !kb.length) return 0;
    for(i=0;i<ka.length;i++) if(gb[ka[i]]) hit++;
    return hit / Math.min(ka.length, kb.length);
  }
  function sim(a, b){
    var A = norm(a), B = norm(b);
    if(!A || !B) return 0;
    if(A.length >= 3 && B.indexOf(A) >= 0) return 1;   // 包含即命中
    if(B.length >= 3 && A.indexOf(B) >= 0) return 1;
    var s2 = overlap(grams(A,2), grams(B,2));
    var s3 = overlap(grams(A,3), grams(B,3));
    var s4 = overlap(grams(A,4), grams(B,4));
    return Math.min(1, Math.max(s2, s3 * 1.2, s4 * 1.4)); // 长 gram 命中更可信，给权重
  }

  /* ---------- 校准：贪心一对一匹配 ---------- */
  function calibrate(mine, points){
    var pairs = [], missed = [], extra = [], used = {}, i, j, best, bestS, s;
    for(i=0;i<points.length;i++){
      best = -1; bestS = 0;
      for(j=0;j<mine.length;j++){
        if(used[j]) continue;
        s = sim(mine[j].text, (points[i] && points[i].text) || "");
        if(s > bestS){ bestS = s; best = j; }
      }
      if(best >= 0 && bestS >= HIT){
        used[best] = 1;
        pairs.push({ pt:points[i], mine:mine[best], s:bestS });
      }else{
        missed.push(points[i]);
      }
    }
    for(j=0;j<mine.length;j++) if(!used[j]) extra.push(mine[j]);
    return { pairs:pairs, missed:missed, extra:extra, total:points.length, hit:pairs.length };
  }

  /* ---------- 训练价值文案 ---------- */
  var BUCKETS = [
    { k:"对策", re:/(要|应|须|应当|加强|完善|建立|健全|推进|落实|强化|优化|加大|构建|推动|开展|规范|加快|坚持|扶持|引导|培育|整治|完善机制)/,
      tip:"你常漏「对策类」要点——下次先扫材料里的“要 / 应 / 须 / 加强 / 完善 / 建立”，凡是动词打头的句子，基本都是采分点。" },
    { k:"问题", re:/(不足|缺乏|缺失|不够|难以|滞后|薄弱|问题|矛盾|困难|不到位|欠缺|失衡|短板|流失|下降|不高|不强|无人|闲置)/,
      tip:"你常漏「问题类」要点——材料里的否定词（不、缺、难、少、弱）就是采分点的路标，读的时候把它们直接圈出来。" },
    { k:"原因", re:/(原因|由于|因为|导致|源于|根源|造成|受限于|以致)/,
      tip:"你常漏「原因类」要点——看到“由于 / 导致 / 之所以”就要停一下，问题背后的成因往往单独占分。" },
    { k:"影响", re:/(有利于|促进|带动|提升|提高|增强|意义|作用|影响|效果|成效|实现|保障了|激发)/,
      tip:"你常漏「意义/影响类」要点——做法写完别停，材料后半段的“促进了 / 带动了 / 有利于”通常是另一个独立得分点。" },
    { k:"主体", re:/(政府|部门|企业|村民|群众|社会|社区|高校|媒体|市场|干部|农民|居民|志愿者|协会|合作社)/,
      tip:"你常漏「主体类」要点——同一件事换个主体（政府/企业/群众/社会组织）就是新的一条，按主体扫一遍材料能补回不少分。" }
  ];
  function bucketOf(text){
    var t = String(text || ""), i;
    for(i=0;i<BUCKETS.length;i++) if(BUCKETS[i].re.test(t)) return i;
    return -1;
  }
  function advise(res, q, guessN){
    var tips = [], i, k, cnt = {}, top = -1, coreMiss = 0, rate;
    if(!res.total) return ["这道题库里暂时没有标准采分点，先自己列点，再回材料逐句核对。"];
    rate = res.hit / res.total;

    for(i=0;i<res.missed.length;i++){
      k = bucketOf(res.missed[i] && res.missed[i].text);
      if(k < 0) continue;
      cnt[k] = (cnt[k] || 0) + 1;
      if(top < 0 || cnt[k] > cnt[top]) top = k;
    }
    if(top >= 0) tips.push(BUCKETS[top].tip);

    for(i=0;i<res.missed.length;i++) if((res.missed[i] && res.missed[i].tag) === "core") coreMiss++;
    if(coreMiss >= 2){
      tips.push("漏掉的点里有 " + coreMiss + " 个是「核心点」。核心点通常藏在段首句、领导/专家讲话句、带数据的结论句——读材料时先给这三类句子画线。");
    }
    if(res.extra.length > Math.max(1, Math.round(res.total * 0.5))){
      tips.push("你多标了 " + res.extra.length + " 条，这是典型的“凭印象编点”。阅卷只认材料里有出处的点，宁可少写一条，也别写想当然的话。");
    }
    if(guessN > res.total + 2){
      tips.push("你猜了 " + guessN + " 个点，实际只有 " + res.total + " 个：你的问题不是找不到，而是<b>没合并同类项</b>，答案会被拆得又碎又长。");
    }else if(guessN > 0 && guessN < res.total - 1){
      tips.push("你只列了 " + guessN + " 个点，实际有 " + res.total + " 个：先按“材料段数 ≈ 要点数”做个下限估计，别提前收手。");
    }
    if(rate >= 0.8){
      tips.push("命中率 " + Math.round(rate * 100) + "%，你的“评分者视角”已经建立起来了——接下来练的是把点写全、写短、写规范。");
    }else if(rate < 0.4){
      tips.push("命中率低不是坏事：它说明你写出来的答案和阅卷人心里的答案是两套东西。连做 5 道自标校准，比多写 5 篇答案有用。");
    }
    if(!tips.length) tips.push("继续练，让你脑子里的“采分点清单”一点点和标准答案重合。");
    return tips;
  }

  /* ---------- 历史记录 ---------- */
  function loadHis(){
    try{
      var a = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
      return (Object.prototype.toString.call(a) === "[object Array]") ? a : [];
    }catch(e){ return []; }
  }
  function saveHis(a){
    try{ localStorage.setItem(LS_KEY, JSON.stringify(a.slice(0, 200))); }catch(e){}
  }
  function pushHis(rec){
    var a = loadHis(); a.unshift(rec); saveHis(a);
  }
  function fmtTime(t){
    try{
      var d = new Date(t);
      function z(n){ return (n < 10 ? "0" : "") + n; }
      return d.getFullYear() + "-" + z(d.getMonth()+1) + "-" + z(d.getDate()) + " " + z(d.getHours()) + ":" + z(d.getMinutes());
    }catch(e){ return ""; }
  }

  /* ---------- 片段渲染 ---------- */
  function pickerHtml(){
    var ps = papers(), i, h = "", p, qs, j;
    if(!ps.length) return '<div class="b11-empty">没有读到题库数据（DATA.papers）。请确认已在主站页面内运行本模块。</div>';
    h += '<div class="b11-pick">';
    h += '<label class="b11-lb">套卷</label><select class="b11-sel" data-act="pid"><option value="">— 请选择套卷 —</option>';
    for(i=0;i<ps.length;i++){
      p = ps[i];
      h += '<option value="' + ESC(p.id) + '"' + (String(p.id) === String(S.pid) ? " selected" : "") + '>'
         + ESC(String(p.year || "") + " " + String(p.paper || "")) + (p.province ? "（" + ESC(p.province) + "）" : "") + "</option>";
    }
    h += "</select>";
    h += '<label class="b11-lb">题目</label><select class="b11-sel" data-act="qno">';
    p = paperById(S.pid);
    qs = p ? (p.questions || []) : [];
    if(!p){ h += '<option value="">— 先选套卷 —</option>'; }
    else{
      h += '<option value="">— 请选择题目 —</option>';
      for(j=0;j<qs.length;j++){
        h += '<option value="' + ESC(qs[j].no) + '"' + (String(qs[j].no) === String(S.qno) ? " selected" : "") + '>'
           + ESC("题" + qs[j].no + " " + (qs[j].qtype || "")) + "</option>";
      }
    }
    h += "</select>";
    h += "</div>";
    return h;
  }

  function drillHtml(f){
    var q = f.q, p = f.p, h = "", i, stem, mat;
    stem = (q.stem || []).map(function(s){ return "<div>" + ESC(s) + "</div>"; }).join("");
    h += '<div class="b11-card">';
    h += '<div class="b11-h3">② 审题（标准答案已隐藏）</div>';
    h += '<div class="b11-qmeta">' + ESC(String(p.year || "") + " " + String(p.paper || "")) + ' · 题' + ESC(q.no) + ' · <b>' + ESC(q.qtype || "") + "</b></div>";
    h += '<div class="b11-stem">' + (stem || '<div class="b11-sub">（该题无题干文本）</div>') + "</div>";
    if((q.material || []).length){
      h += '<button class="b11-btn ghost" data-act="mat">' + (S.showMat ? "收起给定资料" : "展开给定资料（" + q.material.length + " 段）") + "</button>";
      if(S.showMat){
        mat = q.material.map(function(s){ return "<div>" + ESC(s) + "</div>"; }).join("");
        h += '<div class="b11-mat">' + mat + "</div>";
      }
    }
    h += "</div>";

    h += '<div class="b11-card">';
    h += '<div class="b11-h3">③ 自标：你猜这道题有几个采分点，分别是什么</div>';
    h += '<div class="b11-warn">先别翻答案。凭材料和直觉一条一条列出来——列错不丢人，列不出来才是真问题。</div>';
    h += '<div class="b11-rows">';
    for(i=0;i<S.rows.length;i++){
      h += '<div class="b11-row"><span class="b11-no">' + (i + 1) + "</span>"
         + '<textarea class="b11-ta" data-i="' + i + '" rows="2" placeholder="我认为的第 ' + (i + 1) + ' 个采分点…">' + ESC(S.rows[i]) + "</textarea>"
         + '<button class="b11-x" data-act="del" data-i="' + i + '" title="删除这行">×</button></div>';
    }
    h += "</div>";
    h += '<div class="b11-acts">';
    h += '<button class="b11-btn ghost" data-act="add">＋ 再加一行</button>';
    h += '<button class="b11-btn primary" data-act="check">对照标准 →</button>';
    h += '<button class="b11-btn ghost" data-act="reset">清空重来</button>';
    h += '<span class="b11-sub">已列 ' + S.rows.filter(function(t){ return String(t).trim(); }).length + " 条</span>";
    h += "</div></div>";
    return h;
  }

  function resultHtml(f){
    var r = S.result, h = "", i, tips, rate, pct;
    if(!r) return "";
    rate = r.total ? r.hit / r.total : 0;
    pct  = Math.round(rate * 100);
    tips = advise(r, f.q, r.guessN);

    h += '<div class="b11-card b11-res">';
    h += '<div class="b11-h3">④ 校准结果</div>';
    h += '<div class="b11-score"><b class="' + (pct >= 70 ? "ok" : (pct >= 40 ? "mid" : "bad")) + '">' + r.hit + " / " + r.total + "</b>"
       + '<span class="b11-sub">你标中 ' + r.hit + " 个，共 " + r.total + " 个采分点 · 命中率 " + pct + "%"
       + "（你猜有 " + r.guessN + " 个）</span></div>";
    h += '<div class="b11-track"><i style="width:' + pct + '%"></i></div>';

    h += '<div class="b11-cols">';
    /* 命中 */
    h += '<div class="b11-col ok"><div class="b11-colh">✅ 你标中的（' + r.pairs.length + "）</div>";
    if(!r.pairs.length) h += '<div class="b11-sub">一个都没对上——别慌，这正是这道训练存在的意义。</div>';
    for(i=0;i<r.pairs.length;i++){
      h += '<div class="b11-item"><div class="b11-std"><span class="b11-tag ' + ESC(r.pairs[i].pt.tag || "") + '">'
         + ESC(TAG_CN[r.pairs[i].pt.tag] || r.pairs[i].pt.tag || "点") + "</span>" + ESC(r.pairs[i].pt.text || "") + "</div>"
         + '<div class="b11-mine">你写的：' + ESC(r.pairs[i].mine.text) + ' <span class="b11-sub">（重叠 ' + Math.round(r.pairs[i].s * 100) + "%）</span></div></div>";
    }
    h += "</div>";
    /* 漏标 */
    h += '<div class="b11-col bad"><div class="b11-colh">❌ 你漏标的点（' + r.missed.length + "）</div>";
    if(!r.missed.length) h += '<div class="b11-sub">全部覆盖，采分点雷达很准。</div>';
    for(i=0;i<r.missed.length;i++){
      h += '<div class="b11-item"><div class="b11-std"><span class="b11-tag ' + ESC(r.missed[i].tag || "") + '">'
         + ESC(TAG_CN[r.missed[i].tag] || r.missed[i].tag || "点") + "</span>" + ESC(r.missed[i].text || "") + "</div></div>";
    }
    h += "</div>";
    /* 偏标 */
    h += '<div class="b11-col warn"><div class="b11-colh">⚠️ 你偏标 / 多标的（' + r.extra.length + "）</div>";
    if(!r.extra.length) h += '<div class="b11-sub">没有多余动作，很干净。</div>';
    for(i=0;i<r.extra.length;i++){
      h += '<div class="b11-item"><div class="b11-mine">' + ESC(r.extra[i].text) + "</div></div>";
    }
    h += "</div>";
    h += "</div>";

    h += '<div class="b11-tip"><b>训练价值</b>';
    for(i=0;i<tips.length;i++) h += "<div>· " + tips[i] + "</div>";
    h += "</div>";
    h += '<div class="b11-acts"><button class="b11-btn ghost" data-act="reset">再练一遍这道题</button></div>';
    h += "</div>";
    return h;
  }

  function historyHtml(){
    var a = loadHis(), h = "", i, rec, pct, sum = 0, n = 0;
    h += '<div class="b11-card">';
    h += '<div class="b11-h3">⑤ 历史校准记录 <span class="b11-sub">（本机 localStorage，离线保存）</span></div>';
    if(!a.length){
      h += '<div class="b11-sub">还没有记录。做完第一次对照就会自动存在这里。</div></div>';
      return h;
    }
    for(i=0;i<a.length;i++){
      if(a[i] && a[i].total){ sum += (a[i].hit / a[i].total); n++; }
    }
    h += '<div class="b11-stat">累计 <b>' + a.length + "</b> 次校准 · 平均命中率 <b>" + (n ? Math.round(sum / n * 100) : 0) + "%</b>"
       + ' <button class="b11-btn ghost sm" data-act="clearhis">清空记录</button></div>';
    h += '<div class="b11-his">';
    for(i=0;i<a.length && i<40;i++){
      rec = a[i] || {};
      pct = rec.total ? Math.round((rec.hit || 0) / rec.total * 100) : 0;
      h += '<div class="b11-hi"><div class="b11-hih">'
         + '<b class="' + (pct >= 70 ? "ok" : (pct >= 40 ? "mid" : "bad")) + '">' + (rec.hit || 0) + "/" + (rec.total || 0) + "</b> "
         + ESC(String(rec.title || rec.pid || "")) + " · 题" + ESC(rec.qno) + " " + ESC(rec.qtype || "")
         + '<span class="b11-sub">' + ESC(fmtTime(rec.time)) + "</span>"
         + '<button class="b11-x sm" data-act="delhis" data-i="' + i + '" title="删除">×</button></div>';
      if((rec.mine || []).length){
        h += '<div class="b11-hib">自标：' + ESC(rec.mine.join(" ｜ ")) + "</div>";
      }
      h += "</div>";
    }
    h += "</div></div>";
    return h;
  }

  /* ---------- 主渲染 ---------- */
  function draw(){
    var box, h, f;
    box = document.getElementById("content");
    if(!box) return;
    ensureCss();

    h  = '<div class="b11-wrap">';
    h += '<div class="b11-head"><h2>🎯 采分点自标校准</h2>'
       + '<p class="b11-lead">不看成案，先自己列出“我认为这道题有哪几个采分点”，再一键对照标准。练的不是写作，是<b>评分者视角</b>——申论提分中最被低估的元认知训练。</p></div>';
    h += '<div class="b11-card"><div class="b11-h3">① 选题</div>' + pickerHtml() + "</div>";

    f = getQ(S.pid, S.qno);
    if(S.pid && S.qno && !f){
      h += '<div class="b11-card"><div class="b11-empty">未找到该题（findQ 校验失败），请重新选择。</div></div>';
    }else if(f){
      h += drillHtml(f);
      h += resultHtml(f);
    }
    h += historyHtml();
    h += "</div>";

    box.innerHTML = h;
    bind(box);

    try{
      var st = document.getElementById("stats");
      if(st) st.textContent = "采分点自标校准 · 训练评分者视角";
    }catch(e){}
  }

  /* ---------- 事件 ---------- */
  function syncRows(root){
    try{
      var tas = root.querySelectorAll(".b11-ta"), i, idx;
      for(i=0;i<tas.length;i++){
        idx = parseInt(tas[i].getAttribute("data-i"), 10);
        if(!isNaN(idx)) S.rows[idx] = tas[i].value;
      }
    }catch(e){}
  }
  function doCheck(root){
    var f = getQ(S.pid, S.qno), mine = [], i, t, pts, res, p;
    if(!f){ draw(); return; }
    syncRows(root);
    for(i=0;i<S.rows.length;i++){
      t = String(S.rows[i] || "").trim();
      if(t) mine.push({ i:i, text:t });
    }
    if(!mine.length){
      try{ alert("先至少列出 1 条你自己认为的采分点，再来对照。"); }catch(e){}
      return;
    }
    pts = (f.q.points || []).filter(function(x){ return x && x.text; });
    res = calibrate(mine, pts);
    res.guessN = mine.length;
    S.result = res;

    p = f.p;
    pushHis({
      time : Date.now(),
      pid  : S.pid,
      qno  : S.qno,
      title: String(p.year || "") + " " + String(p.paper || ""),
      qtype: f.q.qtype || "",
      mine : mine.map(function(m){ return m.text; }),
      hit  : res.hit,
      total: res.total,
      missed: res.missed.map(function(x){ return x.text; })
    });
    draw();
  }
  function bind(box){
    var root = box.querySelector(".b11-wrap");
    if(!root) return;

    root.addEventListener("input", function(ev){
      var el = ev.target;
      if(el && el.className && String(el.className).indexOf("b11-ta") >= 0){
        var idx = parseInt(el.getAttribute("data-i"), 10);
        if(!isNaN(idx)) S.rows[idx] = el.value;
      }
    });

    root.addEventListener("change", function(ev){
      var el = ev.target, act = el && el.getAttribute && el.getAttribute("data-act");
      if(act === "pid"){
        S.pid = el.value; S.qno = ""; S.rows = ["", "", ""]; S.result = null; S.showMat = false; draw();
      }else if(act === "qno"){
        S.qno = el.value; S.rows = ["", "", ""]; S.result = null; S.showMat = false; draw();
      }
    });

    root.addEventListener("click", function(ev){
      var el = ev.target, act, idx, a;
      while(el && el !== root && !(el.getAttribute && el.getAttribute("data-act"))) el = el.parentNode;
      if(!el || el === root) return;
      act = el.getAttribute("data-act");
      idx = parseInt(el.getAttribute("data-i"), 10);

      if(act === "add"){
        syncRows(root);
        if(S.rows.length < MAX_ROWS) S.rows.push("");
        draw();
      }else if(act === "del"){
        syncRows(root);
        if(S.rows.length > MIN_ROWS && !isNaN(idx)) S.rows.splice(idx, 1);
        else if(!isNaN(idx)) S.rows[idx] = "";
        draw();
      }else if(act === "check"){
        doCheck(root);
      }else if(act === "reset"){
        S.rows = ["", "", ""]; S.result = null; draw();
      }else if(act === "mat"){
        syncRows(root); S.showMat = !S.showMat; draw();
      }else if(act === "delhis"){
        a = loadHis();
        if(!isNaN(idx) && idx >= 0 && idx < a.length){ a.splice(idx, 1); saveHis(a); draw(); }
      }else if(act === "clearhis"){
        try{ if(!confirm("确定清空全部校准记录？")) return; }catch(e){}
        saveHis([]); draw();
      }
    });
  }

  /* ---------- 路由入口 ---------- */
  window.renderSelfCal = function(){
    try{
      draw();
    }catch(err){
      try{
        var box = document.getElementById("content");
        if(box) box.innerHTML = '<div class="b11-empty">采分点自标校准模块运行出错：' + ESC(String((err && err.message) || err)) + "</div>";
      }catch(e){}
      try{ console.error("[_b11]", err); }catch(e){}
    }
  };

})();
