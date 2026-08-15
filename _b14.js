(function(){
  "use strict";
  /* ==================================================================
     _b14 大作文速构器（Essay Builder）
     把申论大作文拆成可练的四步：定主题 → 生骨架 → 填素材 → 对范文。
     纯前端模板生成（不调任何模型 / 不联网），只读主站 DATA，
     草稿存 localStorage("shenlun_essaybuild_v1")。
     暴露 window.renderEssayBuilder，全部类名 b14- 前缀。
     ================================================================== */

  var STORE   = "shenlun_essaybuild_v1";
  var MAXDRAFT = 40;

  /* 内置热点主题（DATA 里的热点/母题会自动追加） */
  var HOT = ["新质生产力","基层治理","乡村振兴","数字政府","生态文明",
             "文化自信","民生共同富裕","科技自立自强","青年成长成才"];

  /* 常见"动词枢纽"，用来把主题句切成 A（手段/主体）+ B（目标/价值） */
  var HINGE = ["托举","筑牢","夯实","激活","擦亮","绘就","书写","答好","跑出","跑好",
               "凝聚","汇聚","锻造","守护","赋能","引领","开创","成就","推动","促进",
               "实现","建设","培育","涵养","点亮","撑起","护航","注入","唱响","扛起",
               "助力","服务","支撑","提升","激发","塑造","走好","开辟"];

  /* 分论点角度模式 */
  var MODES = [
    { k:"wwh", n:"是什么—为什么—怎么办",
      angles:["内涵界定：讲清概念与要义","价值判断：讲透意义与紧迫性","实践路径：讲实办法与保障"] },
    { k:"pnc", n:"问题—原因—对策",
      angles:["摆问题：现象、表现、危害","挖根源：思想、机制、能力","提对策：主体、抓手、保障"] },
    { k:"idea", n:"理念—制度—行动",
      angles:["理念先导：思想认识是总开关","制度托底：把好做法固化为规矩","行动见效：一分部署九分落实"] },
    { k:"level", n:"个人—社会—国家",
      angles:["于个人：自觉与担当","于社会：协同与共治","于国家：战略与长远"] }
  ];

  /* 模块内状态（不碰主站 state） */
  var S = { topic:"", mode:"wwh", sk:null, cmp:null, flash:"", pick:[0,0,0] };

  /* ---------- 自带 HTML 转义 ---------- */
  function esc(s){
    s = (s == null) ? "" : String(s);
    return s.replace(/[&<>"']/g, function(c){
      return ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c];
    });
  }

  /* ---------- 样式自挂载（主站未 link _b14.css 时兜底，不改任何文件） ---------- */
  function ensureCss(){
    try{
      var ls = document.getElementsByTagName("link"), i;
      for(i=0;i<ls.length;i++){
        if(String(ls[i].getAttribute("href") || "").indexOf("_b14.css") >= 0) return;
      }
      var el = document.createElement("link");
      el.rel = "stylesheet"; el.href = "_b14.css";
      (document.head || document.documentElement).appendChild(el);
    }catch(e){}
  }

  /* ---------- 数据安全访问 ---------- */
  function isArr(x){ return Object.prototype.toString.call(x) === "[object Array]"; }
  function D(){
    try{ return (typeof DATA !== "undefined" && DATA) ? DATA : (window.DATA || null); }
    catch(e){ return null; }
  }
  function arrOf(key){
    try{ var d = D(); return (d && isArr(d[key])) ? d[key] : []; }catch(e){ return []; }
  }
  function papers(){ return arrOf("papers"); }
  function entries(){ return arrOf("entries"); }
  function articles(){ return arrOf("articles"); }
  function hotspots(){ return arrOf("hotspots"); }

  /* ---------- 主题词拆解：A（手段/主体）+ B（目标/价值） ---------- */
  function coreWords(topic){
    var t = String(topic || "").trim()
              .replace(/[《》“”"'?？!！。，,、；;：:\s]+/g, " ").trim();
    if(!t) return { a:"", b:"" };
    var s = t.replace(/^[以让用把为凭靠向]/, "").trim(), i, p, a, b;
    for(i=0;i<HINGE.length;i++){
      p = s.indexOf(HINGE[i]);
      if(p > 1 && p < s.length - 1){
        a = s.slice(0, p); b = s.slice(p + HINGE[i].length);
        break;
      }
    }
    if(!a){
      p = s.search(/[与和及]/);
      if(p > 1 && p < s.length - 2){ a = s.slice(0, p); b = s.slice(p + 1); }
    }
    if(!a && s.length > 7){
      p = s.lastIndexOf("的");
      if(p > 1 && p < s.length - 2){ a = s.slice(p + 1); b = s.slice(0, p); }
    }
    if(!a){ a = s; b = ""; }
    a = String(a).replace(/^[以让用把为的]/, "").replace(/[的之]$/, "").trim();
    for(i=0;i<HINGE.length;i++){          /* 去掉打头的动词，如"推动乡村振兴"→"乡村振兴" */
      if(a.indexOf(HINGE[i]) === 0 && a.length > HINGE[i].length + 1){
        a = a.slice(HINGE[i].length); break;
      }
    }
    b = String(b || "").replace(/^[的之]/, "").trim();
    if(a.length > 12) a = a.slice(0, 12);
    if(b.length > 12) b = b.slice(0, 12);
    return { a:a, b:b };
  }

  /* ---------- 标题候选（对仗式公式） ---------- */
  function titleCands(topic){
    var c = coreWords(topic), a = c.a, b = c.b;
    if(!a) return ["【填：请先输入主题】"];
    if(b){
      return [
        "以" + a + "筑牢" + b + "根基",
        "让" + a + "成为" + b + "的最强底色",
        "在" + a + "中书写" + b + "新答卷",
        a + "为笔　" + b + "为卷",
        "涵养" + a + "之力　绘就" + b + "之景"
      ];
    }
    return [
      "以" + a + "之笔　绘就【填：目标图景】",
      a + "：新时代的必答题",
      "让" + a + "成为【填：价值落点】的最强底色",
      "答好" + a + "这道时代命题",
      "以" + a + "破题　向【填：愿景】而行"
    ];
  }

  /* ---------- 段落模板 ---------- */
  function introOf(topic, a, b){
    var goal = b || "【填：价值落点】";
    return "【引材料/引现象：用一句话概述材料中的事实、数据或身边现象】。" +
           "从“" + topic + "”这一时代命题出发不难发现，" + a + "从来不是抽象的口号，" +
           "而是关乎" + goal + "的现实课题。审视当下，成绩固然可喜，短板依然明显——" +
           "【填：一句问题现象，正反对照更有张力】。" +
           "行程万里，初心为要。唯有以" + a + "为着力点、以【填：关键抓手】为落脚点，" +
           "才能真正托举起" + goal + "。";
  }

  function ptsOf(mode, topic, a, b){
    var goal = b || "【填：目标愿景】";
    var M = {
      wwh: [
        { c:"认清" + a + "的深刻内涵，是做好" + topic + "这篇大文章的前提。",
          r:"概念不清则方向不明。" + a + "的核心要义在于【填：内涵界定，尽量用规范词】，它既是【填：属性一】，也是【填：属性二】；" +
            "把内涵吃透，才不至于把好经念歪、把好事办偏。" },
        { c:"把握" + a + "的时代价值，是推进" + goal + "的动力所在。",
          r:"意义讲不透，行动就没劲。往大了说，它关系【填：全局意义】；往小了说，它连着【填：群众感受】。" +
            "正反两面一比较，价值自然立得住。" },
        { c:"找准" + a + "的实践路径，是" + goal + "落地见效的关键。",
          r:"空谈误国，实干兴邦。要在【填：主体责任】上压实、在【填：机制保障】上完善、在【填：考核评价】上较真，" +
            "让一张蓝图干到底。" }
      ],
      pnc: [
        { c:"直面问题，是推进" + topic + "的破题之始。",
          r:"成绩要看到，问题更要正视。当前【填：具体表现一】【填：具体表现二】仍不同程度存在，" +
            "群众的“急难愁盼”正卡在这些环节上。" },
        { c:"深挖根源，是解决" + a + "难题的治本之策。",
          r:"问题在表面，根子在深层。既有思想认识上【填：认识偏差】的原因，也有体制机制上【填：机制短板】的掣肘，" +
            "还有能力本领上【填：能力不足】的欠缺。" },
        { c:"精准施策，是" + goal + "落地见效的必由之路。",
          r:"对症下药方能药到病除。要明确【填：责任主体】、抓住【填：关键抓手】、健全【填：长效机制】，" +
            "以钉钉子精神一抓到底。" }
      ],
      idea: [
        { c:"理念先导，为" + topic + "校准方向。",
          r:"思想是行动的先导。树牢【填：核心理念】的观念，摒弃【填：错误倾向】的惯性，" +
            "方向对了，路才不会越走越偏。" },
        { c:"制度托底，为" + a + "立起规矩。",
          r:"好经验要靠制度固化下来。健全【填：制度/标准】，压实【填：责任链条】，" +
            "让好做法不因人事变动而人走政息。" },
        { c:"行动见效，让" + goal + "落到实处。",
          r:"一分部署，九分落实。既要【填：具体举措一】，也要【填：具体举措二】，" +
            "用可感可及的变化回应群众期待。" }
      ],
      level: [
        { c:"于个人而言，" + a + "是一份沉甸甸的自觉与担当。",
          r:"每个人都是【填：价值主体】的一分子。从【填：日常小事】做起，把担当落在岗位上，" +
            "涓滴之力方能汇成江海。" },
        { c:"于社会而言，" + a + "考验的是协同与共治的水平。",
          r:"独行快，众行远。要发挥【填：多元主体】的作用，构建【填：协同机制】，" +
            "让人人尽责成为社会风尚。" },
        { c:"于国家而言，" + a + "关乎" + goal + "的战略全局。",
          r:"于国之大者要心中有数。着眼长远谋篇布局，在【填：战略部署】上落子，" +
            "把制度优势转化为治理效能。" }
      ]
    };
    var src = M[mode] || M.wwh, out = [], i;
    for(i=0;i<src.length;i++){
      out.push({ c:src[i].c, r:src[i].r,
        e:"【素材：填一条案例/数据/《求是》金句 —— 点右上「取素材」可从素材库抽取】" });
    }
    return out;
  }

  function conclOf(topic, a, b, title){
    var goal = b || "【填：目标愿景】";
    return "【回扣材料/时代坐标：填一句能升华的表述】。" +
           "从" + a + "到" + goal + "，变的是路径与方法，不变的是【填：初心/价值追求】。" +
           "征途漫漫，惟有奋斗。以" + a + "筑基、以实干为桨，" +
           "“" + title + "”便不只是一个题目，而会成为可感可及的现实图景。";
  }

  /* ---------- 生成骨架 ---------- */
  function buildSk(topic, mode){
    var c = coreWords(topic), a = c.a || "【填：核心词】", b = c.b;
    var cands = titleCands(topic), title = cands[0];
    return {
      topic: topic,
      mode : mode,
      cands: cands,
      title: title,
      intro: introOf(topic, a, b),
      pts  : ptsOf(mode, topic, a, b),
      concl: conclOf(topic, a, b, title),
      ts   : Date.now()
    };
  }

  function modeName(k){
    for(var i=0;i<MODES.length;i++){ if(MODES[i].k === k) return MODES[i].n; }
    return MODES[0].n;
  }
  function modeAngles(k){
    for(var i=0;i<MODES.length;i++){ if(MODES[i].k === k) return MODES[i].angles; }
    return MODES[0].angles;
  }

  /* ---------- 关键词（用于素材/范文匹配） ---------- */
  function keywords(topic){
    var c = coreWords(topic), ks = [], seen = {}, i, w;
    var raw = [c.a, c.b, String(topic || "").replace(/[以让用把为的]/g, "")];
    for(i=0;i<raw.length;i++){
      w = String(raw[i] || "").trim();
      if(w.length >= 2 && !seen[w]){ seen[w] = 1; ks.push(w); }
      if(w.length >= 6){                     /* 长词再切前后两半，提高召回 */
        var h1 = w.slice(0, 3), h2 = w.slice(-3);
        if(!seen[h1]){ seen[h1] = 1; ks.push(h1); }
        if(!seen[h2]){ seen[h2] = 1; ks.push(h2); }
      }
    }
    return ks.slice(0, 6);
  }
  function hitAny(text, ks){
    var s = String(text || "").toLowerCase(), i;
    for(i=0;i<ks.length;i++){ if(ks[i] && s.indexOf(String(ks[i]).toLowerCase()) >= 0) return true; }
    return false;
  }

  /* ---------- 从素材库抽一条可用素材 ---------- */
  function matLines(topic){
    var ks = keywords(topic), es = entries(), out = [], i, j, ls, e;
    if(!ks.length) return out;
    for(i=0;i<es.length && out.length < 60;i++){
      e = es[i]; if(!e || !isArr(e.lines)) continue;
      if(["金句库","规范词库","案例库","框架库"].indexOf(e.lib) < 0) continue;
      ls = e.lines;
      for(j=0;j<ls.length;j++){
        if(hitAny(ls[j], ks) || hitAny(e.theme + " " + e.title, ks)){
          out.push(String(ls[j]).replace(/^[-　\s]+/, ""));
          if(out.length >= 60) break;
        }
      }
    }
    return out;
  }

  /* ---------- 对照范文：真题大作文 + 求是文章 + 可用素材 ---------- */
  function isEssayQ(q){
    return !!(q && /作文|文章|议论|策论|写作/.test(String(q.qtype || "")));
  }
  function findCompare(topic){
    var ks = keywords(topic), ps = papers(), as = articles();
    var res = { qs:[], arts:[], mats:[], ks:ks };
    if(!ks.length) return res;
    var i, j, p, q, blob;
    for(i=0;i<ps.length && res.qs.length < 4;i++){
      p = ps[i]; if(!p || !isArr(p.questions)) continue;
      for(j=0;j<p.questions.length;j++){
        q = p.questions[j]; if(!isEssayQ(q)) continue;
        blob = [ isArr(q.stem) ? q.stem.join(" ") : q.stem,
                 isArr(q.material) ? q.material.join(" ") : "",
                 isArr(q.points) ? q.points.map(function(x){ return x && x.text; }).join(" ") : "" ].join(" ");
        if(!hitAny(blob, ks)) continue;
        res.qs.push({
          head : (p.year || "") + " " + (p.province || "") + " " + (p.paper || "") + " 第" + (q.no || "?") + "题",
          stem : (isArr(q.stem) ? q.stem.join(" ") : String(q.stem || "")).slice(0, 160),
          pts  : (isArr(q.points) ? q.points : []).slice(0, 6)
                   .map(function(x){ return String((x && x.text) || ""); }),
          rev  : (isArr(q.review) ? q.review : []).slice(0, 3),
          ai   : (isArr(q.ai) ? q.ai : []).slice(0, 2)
        });
        if(res.qs.length >= 4) break;
      }
    }
    for(i=0;i<as.length && res.arts.length < 8;i++){
      var a = as[i]; if(!a) continue;
      if(hitAny([a.title, a.author, (isArr(a.themes) ? a.themes.join(" ") : "")].join(" "), ks)){
        res.arts.push(a);
      }
    }
    res.mats = matLines(topic).slice(0, 8);
    return res;
  }

  /* ---------- 草稿（localStorage） ---------- */
  function loadDrafts(){
    try{
      var raw = localStorage.getItem(STORE);
      var arr = raw ? JSON.parse(raw) : [];
      return isArr(arr) ? arr : [];
    }catch(e){ return []; }
  }
  function saveDrafts(arr){
    try{ localStorage.setItem(STORE, JSON.stringify(arr.slice(0, MAXDRAFT))); return true; }
    catch(e){ return false; }
  }
  function fmtTs(ts){
    try{
      var d = new Date(ts), z = function(n){ return (n < 10 ? "0" : "") + n; };
      return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) +
             " " + z(d.getHours()) + ":" + z(d.getMinutes());
    }catch(e){ return "—"; }
  }

  /* ---------- 全文拼接 / 字数 ---------- */
  function fullText(sk){
    if(!sk) return "";
    var lines = [String(sk.title || "").trim(), String(sk.intro || "").trim()], i, p;
    for(i=0;i<sk.pts.length;i++){
      p = sk.pts[i];
      lines.push([String(p.c || "").trim(), String(p.r || "").trim(), String(p.e || "").trim()]
                 .filter(Boolean).join(""));
    }
    lines.push(String(sk.concl || "").trim());
    return lines.filter(Boolean).join("\n");
  }
  function countOf(sk){
    return fullText(sk).replace(/\s/g, "").length;
  }

  /* ================= 渲染 ================= */
  function topicCards(){
    var list = HOT.slice(0), hs = hotspots(), i, n;
    for(i=0;i<hs.length && list.length < 16;i++){
      n = hs[i] && hs[i].name;
      if(n && list.indexOf(n) < 0) list.push(n);
    }
    return list;
  }

  function step1Html(){
    var chips = topicCards().map(function(t, i){
      return '<span class="b14-chip' + (i < HOT.length ? "" : " hot") +
             '" data-b14="pick" data-t="' + esc(t) + '">' + esc(t) + '</span>';
    }).join("");
    var modes = MODES.map(function(m){
      return '<button class="b14-mini' + (S.mode === m.k ? " on" : "") +
             '" data-b14="mode" data-m="' + m.k + '">' + esc(m.n) + '</button>';
    }).join("");
    return '<div class="b14-card" id="b14-s1">' +
      '<div class="b14-h3"><span class="b14-num">1</span>输入作文主题' +
        '<span class="b14-sub">一句话把「做什么 + 为了什么」说清楚，越具体骨架越好用</span></div>' +
      '<input class="b14-topic" id="b14-topic" data-f="topic" placeholder="例：以高质量发展托举民生幸福" value="' +
        esc(S.topic) + '">' +
      '<div class="b14-lbl">🔥 热点主题（点一下直接填入）</div>' +
      '<div class="b14-chips">' + chips + '</div>' +
      '<div class="b14-lbl">🧭 分论点角度模式</div>' +
      '<div class="b14-chips">' + modes + '</div>' +
      '<div class="b14-ops">' +
        '<button class="b14-btn" data-b14="build">⚡ 生成骨架</button>' +
        (S.sk ? '<button class="b14-mini" data-b14="rebuild">♻ 按当前模式重生成（清空已填内容）</button>' : "") +
        (S.sk ? '<button class="b14-mini" data-b14="clear">✕ 清空</button>' : "") +
        (S.flash ? '<span class="b14-flash">' + esc(S.flash) + '</span>' : "") +
      '</div></div>';
  }

  function segHtml(idx, p, angle){
    var f = "p" + idx;
    return '<div class="b14-seg">' +
      '<div class="b14-sh"><b>分论点 ' + (idx + 1) + '</b>' +
        '<span class="b14-angle">' + esc(angle || "") + '</span>' +
        '<button class="b14-mini" data-b14="mat" data-i="' + idx + '">🎁 取素材</button></div>' +
      '<div class="b14-fl">分论点句（段首亮明，扣题、对仗、可复用）</div>' +
      '<textarea class="b14-ta" data-f="' + f + 'c" rows="2">' + esc(p.c) + '</textarea>' +
      '<div class="b14-fl">说理（讲清"为什么成立"，忌只举例不分析）</div>' +
      '<textarea class="b14-ta" data-f="' + f + 'r" rows="3">' + esc(p.r) + '</textarea>' +
      '<div class="b14-fl">论据 / 素材（我的案例·数据·金句）</div>' +
      '<textarea class="b14-ta evi" data-f="' + f + 'e" rows="3">' + esc(p.e) + '</textarea>' +
    '</div>';
  }

  function step2Html(){
    var sk = S.sk, angles = modeAngles(sk.mode), i;
    var cands = (isArr(sk.cands) ? sk.cands : []).map(function(t, k){
      return '<span class="b14-chip" data-b14="title" data-k="' + k + '">' + esc(t) + '</span>';
    }).join("");
    var segs = "";
    for(i=0;i<sk.pts.length;i++) segs += segHtml(i, sk.pts[i], angles[i]);
    return '<div class="b14-card" id="b14-s2">' +
      '<div class="b14-h3"><span class="b14-num">2</span>编辑骨架' +
        '<span class="b14-sub">角度：<b>' + esc(modeName(sk.mode)) +
        '</b>　【填：…】【素材：…】是留给你的坑，逐个填掉就是一篇完整作文</span></div>' +
      '<div class="b14-seg title">' +
        '<div class="b14-sh"><b>标题</b><span class="b14-sub">公式：把主题词嵌进对仗结构</span></div>' +
        '<input class="b14-in" data-f="title" value="' + esc(sk.title) + '">' +
        '<div class="b14-lbl">换一个标题公式：</div><div class="b14-chips">' + cands + '</div>' +
      '</div>' +
      '<div class="b14-seg">' +
        '<div class="b14-sh"><b>开头段</b><span class="b14-sub">破题 + 亮明总论点，建议 150 字以内</span></div>' +
        '<textarea class="b14-ta" data-f="intro" rows="4">' + esc(sk.intro) + '</textarea>' +
      '</div>' +
      segs +
      '<div class="b14-seg end">' +
        '<div class="b14-sh"><b>结尾段</b><span class="b14-sub">升华 + 呼应标题，忌喊口号不落地</span></div>' +
        '<textarea class="b14-ta" data-f="concl" rows="3">' + esc(sk.concl) + '</textarea>' +
      '</div>' +
      '<div class="b14-hint">角度提示：' +
        angles.map(function(x, k){ return "分论点" + (k + 1) + "｜" + esc(x); }).join("　·　") +
      '</div>' +
      '<div class="b14-ops">' +
        '<button class="b14-btn" data-b14="save">💾 存草稿</button>' +
        '<button class="b14-mini" data-b14="copy">📋 复制全文</button>' +
        '<button class="b14-mini" data-b14="cmp">📖 对照范文</button>' +
      '</div></div>';
  }

  function prevHtml(){
    var sk = S.sk, i, p, txt, pars = "";
    pars += '<div class="b14-ptitle">' + esc(sk.title || "【填：标题】") + '</div>';
    var segs = [String(sk.intro || "")];
    for(i=0;i<sk.pts.length;i++){
      p = sk.pts[i];
      segs.push(String(p.c || "") + String(p.r || "") + String(p.e || ""));
    }
    segs.push(String(sk.concl || ""));
    for(i=0;i<segs.length;i++){
      txt = segs[i].trim(); if(!txt) continue;
      pars += '<div class="b14-ppar' + (/【/.test(txt) ? " hole" : "") + '">' + esc(txt) + '</div>';
    }
    return '<div class="b14-prevwrap" id="b14-s3"><div class="b14-card">' +
      '<div class="b14-h3"><span class="b14-num">3</span>实时预览' +
        '<span class="b14-sub">橙色段落=还有【】没填</span></div>' +
      '<div class="b14-paper" id="b14-paper">' + pars + '</div>' +
      '<div class="b14-count" id="b14-count">全文约 <b>' + countOf(sk) + '</b> 字（含标题）　' +
        '国考大作文一般要求 1000～1200 字</div>' +
    '</div></div>';
  }

  function cmpHtml(){
    var c = S.cmp, h = "", i;
    h += '<div class="b14-card" id="b14-s4"><div class="b14-h3"><span class="b14-num">4</span>对照范文 / 同主题素材' +
         '<span class="b14-sub">关键词：' + esc((c.ks || []).join("、") || "—") + '</span>' +
         '<button class="b14-mini" data-b14="cmpclose" style="margin-left:auto">收起</button></div>';
    if(!c.qs.length && !c.arts.length && !c.mats.length){
      h += '<div class="b14-empty">暂无可对照范文，可去<b>文章清单</b> / <b>热点专题</b>看素材，' +
           '或把主题换成更常见的提法（如“基层治理”“乡村振兴”）再试。</div></div>';
      return h;
    }
    for(i=0;i<c.qs.length;i++){
      var q = c.qs[i];
      h += '<div class="b14-ref"><div class="rh"><span class="b14-tag">真题大作文</span><b>' + esc(q.head) + '</b></div>' +
           (q.stem ? '<div class="rstem">题干：' + esc(q.stem) + '…</div>' : "") +
           (q.pts.length ? '<div class="rstem"><b>结构/踩分要点：</b></div><ul>' +
              q.pts.map(function(x){ return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
           (q.rev.length ? '<div class="rstem" style="margin-top:6px"><b>点评：</b>' +
              esc(q.rev.join(" ").slice(0, 220)) + "</div>" : "") +
           (q.ai.length ? '<div class="rstem"><b>提分建议：</b>' + esc(q.ai.join(" ").slice(0, 220)) + "</div>" : "") +
           "</div>";
    }
    if(c.arts.length){
      h += '<div class="b14-ref"><div class="rh"><span class="b14-tag lib">同主题《求是》文章</span>' +
           '<b>' + c.arts.length + ' 篇（可当范文精读结构）</b></div><ul>' +
        c.arts.map(function(a){
          var t = esc(a.title || "");
          var link = a.url ? '<a href="' + esc(a.url) + '" target="_blank">' + t + "</a>" : t;
          return "<li>" + esc(a.year || "") + "/" + esc(String(a.issue || "").replace(/^(\d)$/, "0$1")) +
                 "　" + link + (a.author ? "　<span class='b14-sub'>" + esc(a.author) + "</span>" : "") +
                 (isArr(a.themes) && a.themes.length ? "　<span class='b14-tag gr'>" + esc(a.themes[0]) + "</span>" : "") +
                 "</li>";
        }).join("") + "</ul></div>";
    }
    if(c.mats.length){
      h += '<div class="b14-ref"><div class="rh"><span class="b14-tag gr">可直接用的素材</span>' +
           '<b>金句 / 规范词 / 案例</b></div><ul>' +
        c.mats.map(function(x){ return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>";
    }
    return h + "</div>";
  }

  function draftHtml(){
    var ds = loadDrafts(), h = "";
    h += '<div class="b14-card" id="b14-s5"><div class="b14-h3"><span class="b14-num">5</span>我的草稿' +
         '<span class="b14-sub">存在本机浏览器（' + esc(STORE) + '），不上传任何服务器　共 ' + ds.length + ' 份</span></div>';
    if(!ds.length){
      return h + '<div class="b14-empty">还没有草稿。搭好骨架后点「💾 存草稿」，下次可一键回载继续打磨。</div></div>';
    }
    h += ds.map(function(d, i){
      return '<div class="b14-draft"><span class="dt">' + esc(fmtTs(d.ts)) + '</span>' +
        '<span class="dn">' + esc(d.title || d.topic || "无标题") + '</span>' +
        '<span class="dw">' + esc(d.topic || "") + '　' + (d.words || 0) + ' 字　' + esc(modeName(d.mode)) + '</span>' +
        '<span class="sp"></span>' +
        '<button class="b14-mini" data-b14="load" data-i="' + i + '">↩ 回载</button>' +
        '<button class="b14-mini del" data-b14="del" data-i="' + i + '">删除</button></div>';
    }).join("");
    return h + "</div>";
  }

  function draw(){
    ensureCss();
    var box = document.getElementById("content");
    if(!box) return;
    try{
      if(typeof renderSimpleNav === "function"){
        var nav = [{ label:"① 输入主题", target:"b14-s1" },
                   { label:"② 编辑骨架", target:"b14-s2" }];
        if(S.sk)  nav.push({ label:"③ 实时预览", target:"b14-s3" });
        if(S.cmp) nav.push({ label:"④ 对照范文", target:"b14-s4" });
        nav.push({ label:"⑤ 我的草稿", target:"b14-s5" });
        renderSimpleNav("大作文速构器", nav);
      }
    }catch(e){}
    try{
      var st = document.getElementById("stats");
      if(st) st.textContent = "大作文速构器 — 主题→骨架→素材→范文，四步搭出一篇 1000 字议论文（纯本地模板，不联网）";
    }catch(e){}

    var body = "";
    if(S.sk){
      body = '<div class="b14-cols"><div>' + step2Html() + (S.cmp ? cmpHtml() : "") + '</div>' +
             "<div>" + prevHtml() + "</div></div>";
    }else{
      body = '<div class="b14-empty" id="b14-s2">输入主题后点「⚡ 生成骨架」，' +
             '这里会出现<b>标题 + 开头 + 3 个分论点 + 结尾</b>的可编辑骨架，右侧同步预览全文。</div>';
    }

    box.innerHTML =
      '<div class="b14-wrap"><div class="b14-head">' +
        "<h2>✍️ 大作文速构器</h2>" +
        '<div class="b14-lead">大作文难，难在<b>下不去笔</b>。本模块把它拆成可练的步骤：' +
        '选主题 → 一键生成标准结构骨架 → 逐个填掉【坑位】 → 对照真题范文改。' +
        '模板全部本地生成，<b>不调模型、不联网</b>，草稿只存你自己的浏览器。</div></div>' +
        step1Html() + body + draftHtml() +
      "</div>";

    S.flash = "";
    autoGrowAll();
    bind(box);
  }

  /* ---------- 文本框自适应高度 ---------- */
  function autoGrow(el){
    try{
      if(!el || el.tagName !== "TEXTAREA") return;
      el.style.height = "auto";
      el.style.height = (el.scrollHeight + 2) + "px";
    }catch(e){}
  }
  function autoGrowAll(){
    try{
      var ts = document.querySelectorAll("#content .b14-ta"), i;
      for(i=0;i<ts.length;i++) autoGrow(ts[i]);
    }catch(e){}
  }

  /* ---------- 表单 → 状态 ---------- */
  function syncField(el){
    var f = el && el.getAttribute && el.getAttribute("data-f");
    if(!f) return false;
    var v = el.value == null ? "" : el.value;
    if(f === "topic"){ S.topic = v; return false; }
    if(!S.sk) return false;
    if(f === "title"){ S.sk.title = v; return true; }
    if(f === "intro"){ S.sk.intro = v; return true; }
    if(f === "concl"){ S.sk.concl = v; return true; }
    var m = /^p(\d+)([cre])$/.exec(f);
    if(m && S.sk.pts[+m[1]]){ S.sk.pts[+m[1]][m[2]] = v; return true; }
    return false;
  }

  /* 只刷新预览，避免重绘导致输入框失焦 */
  function updatePreview(){
    if(!S.sk) return;
    try{
      var wrap = document.getElementById("b14-s3");
      if(!wrap) return;
      var tmp = document.createElement("div");
      tmp.innerHTML = prevHtml();
      var np = tmp.querySelector("#b14-paper"), nc = tmp.querySelector("#b14-count");
      var op = document.getElementById("b14-paper"), oc = document.getElementById("b14-count");
      if(np && op) op.innerHTML = np.innerHTML;
      if(nc && oc) oc.innerHTML = nc.innerHTML;
    }catch(e){}
  }

  function readTopic(){
    try{
      var el = document.getElementById("b14-topic");
      if(el) S.topic = String(el.value || "").trim();
    }catch(e){}
    return S.topic;
  }

  /* ---------- 事件（委托到 #content，不用内联 onclick） ---------- */
  function bind(root){
    if(root.__b14bound) return;
    root.__b14bound = true;

    root.addEventListener("input", function(ev){
      var el = ev.target;
      if(!el || !el.getAttribute || !el.getAttribute("data-f")) return;
      autoGrow(el);
      if(syncField(el)) updatePreview();
    });

    root.addEventListener("keydown", function(ev){
      if(ev.keyCode === 13 && ev.target && ev.target.id === "b14-topic"){
        ev.preventDefault(); act("build", null);
      }
    });

    root.addEventListener("click", function(ev){
      var el = ev.target, a = null;
      while(el && el !== root){
        a = el.getAttribute && el.getAttribute("data-b14");
        if(a) break;
        el = el.parentNode;
      }
      if(!a) return;
      ev.preventDefault();
      try{ act(a, el); }catch(err){ try{ console.error("[_b14]", err); }catch(e){} }
    });
  }

  /* ---------- 动作 ---------- */
  function act(a, el){
    var i;
    if(a === "pick"){
      S.topic = el.getAttribute("data-t") || "";
      var tin = document.getElementById("b14-topic");
      if(tin){ tin.value = S.topic; tin.focus(); }
      return;
    }
    if(a === "mode"){
      readTopic();
      S.mode = el.getAttribute("data-m") || "wwh";
      if(S.sk){ S.sk = buildSk(S.sk.topic, S.mode); S.flash = "已切换角度并重生成骨架"; }
      draw(); return;
    }
    if(a === "build" || a === "rebuild"){
      readTopic();
      if(!S.topic){
        S.flash = "";
        try{
          var t2 = document.getElementById("b14-topic");
          if(t2){ t2.focus(); t2.placeholder = "先写一个主题，例如：以高质量发展托举民生幸福"; }
        }catch(e){}
        return;
      }
      S.sk = buildSk(S.topic, S.mode);
      S.pick = [0, 0, 0];
      S.cmp = null;
      S.flash = "骨架已生成，逐个填掉【坑位】即可成文";
      draw(); return;
    }
    if(a === "clear"){ S.sk = null; S.cmp = null; draw(); return; }
    if(a === "title"){
      i = parseInt(el.getAttribute("data-k"), 10);
      if(S.sk && !isNaN(i) && S.sk.cands[i]){
        S.sk.title = S.sk.cands[i];
        var tel = document.querySelector('#content [data-f="title"]');
        if(tel) tel.value = S.sk.title;
        updatePreview();
      }
      return;
    }
    if(a === "mat"){
      i = parseInt(el.getAttribute("data-i"), 10);
      if(!S.sk || isNaN(i) || !S.sk.pts[i]) return;
      var ls = matLines(S.sk.topic);
      if(!ls.length){ S.flash = "素材库里没找到同主题内容，先去「热点专题 / 文章清单」找"; draw(); return; }
      var k = (S.pick[i] || 0) % ls.length;
      S.pick[i] = k + 1;
      var cur = String(S.sk.pts[i].e || "");
      S.sk.pts[i].e = /^【素材：/.test(cur) ? ls[k] : (cur ? cur + "\n" + ls[k] : ls[k]);
      var box = document.querySelector('#content [data-f="p' + i + 'e"]');
      if(box){ box.value = S.sk.pts[i].e; autoGrow(box); }
      updatePreview();
      return;
    }
    if(a === "cmp"){
      if(!S.sk) return;
      S.cmp = findCompare(S.sk.topic);
      draw();
      try{ var n = document.getElementById("b14-s4"); if(n) n.scrollIntoView({ behavior:"smooth" }); }catch(e){}
      return;
    }
    if(a === "cmpclose"){ S.cmp = null; draw(); return; }
    if(a === "save"){
      if(!S.sk) return;
      var ds = loadDrafts();
      ds.unshift({
        ts: Date.now(), topic: S.sk.topic, mode: S.sk.mode, title: S.sk.title,
        cands: S.sk.cands, intro: S.sk.intro, pts: S.sk.pts, concl: S.sk.concl,
        words: countOf(S.sk)
      });
      S.flash = saveDrafts(ds) ? "已存草稿（本机）" : "浏览器拒绝写入本地存储，草稿未保存";
      draw(); return;
    }
    if(a === "load"){
      i = parseInt(el.getAttribute("data-i"), 10);
      var d = loadDrafts()[i];
      if(!d) return;
      S.topic = d.topic || "";
      S.mode  = d.mode || "wwh";
      S.sk = {
        topic: S.topic, mode: S.mode,
        cands: isArr(d.cands) ? d.cands : titleCands(S.topic),
        title: d.title || "", intro: d.intro || "",
        pts: isArr(d.pts) ? d.pts : ptsOf(S.mode, S.topic, coreWords(S.topic).a, coreWords(S.topic).b),
        concl: d.concl || "", ts: d.ts || Date.now()
      };
      S.cmp = null;
      S.flash = "已回载草稿：" + (d.title || d.topic || "");
      draw();
      try{ var s2 = document.getElementById("b14-s2"); if(s2) s2.scrollIntoView({ behavior:"smooth" }); }catch(e){}
      return;
    }
    if(a === "del"){
      i = parseInt(el.getAttribute("data-i"), 10);
      var arr = loadDrafts();
      if(isNaN(i) || !arr[i]) return;
      arr.splice(i, 1);
      saveDrafts(arr);
      S.flash = "已删除 1 份草稿";
      draw(); return;
    }
    if(a === "copy"){
      if(!S.sk) return;
      var txt = fullText(S.sk), ok = false;
      try{
        var ta = document.createElement("textarea");
        ta.value = txt;
        ta.style.position = "fixed"; ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      }catch(e){ ok = false; }
      S.flash = ok ? "全文已复制到剪贴板" : "复制失败，请在预览区手动选中复制";
      draw(); return;
    }
  }

  /* ================= 路由入口 ================= */
  window.renderEssayBuilder = function(){
    try{
      draw();
    }catch(err){
      try{
        var box = document.getElementById("content");
        if(box) box.innerHTML = '<div class="b14-empty">大作文速构器运行出错：' +
          esc(String((err && err.message) || err)) + "</div>";
      }catch(e){}
      try{ console.error("[_b14]", err); }catch(e){}
    }
  };

})();
