/* =====================================================================
   第二十五批：小题 AI 即时批改 + 弱项诊断 (_b25.js)
   纯前端、离线、零外链。核心：写完答案即时判分（采分点逐条命中判定
   + 失分预警 + 规范提示），并聚合历次记录做弱项诊断（题型雷达 + 失分
   类型分布 + 高频遗漏要点 + 补弱路径）。
   依赖：window.esc / DATA / state / 省考分包全局函数
   路线：本地引擎为主 + AI 增强（可选，AI 精批经本地队列/剪贴板兜底）
   ===================================================================== */
(function () {
  "use strict";
  var LS_KEY = "xiaoti_grade_v1";

  function esc(s) {
    var f = (typeof window !== "undefined" && typeof window.esc === "function") ? window.esc : null;
    return f ? f(s) : String(s == null ? "" : s);
  }
  function $(id) { return document.getElementById(id); }

  /* ---------------- 模块本地状态 ---------------- */
  var B = { tab: "grade", prov: "国考", year: "全部", qt: "全部", pid: "", pno: -1, ansMap: {}, resMap: {} };

  /* ---------------- 题型分类（归一为 4 类小题 + 大作文/其他） ---------------- */
  function classify(qt) {
    if (!qt) return "其他";
    if (qt.indexOf("文章写作") >= 0 || qt.indexOf("申发论述") >= 0) return "大作文";
    if (qt.indexOf("贯彻执行") >= 0) return "公文";
    if (qt.indexOf("对策") >= 0) return "对策";
    if (qt.indexOf("概括") >= 0 || qt.indexOf("归纳") >= 0) return "概括";
    if (qt.indexOf("分析") >= 0 || qt.indexOf("理解") >= 0 || qt.indexOf("评析") >= 0 ||
        qt.indexOf("启示") >= 0 || qt.indexOf("评价") >= 0) return "分析";
    return "其他";
  }
  var BUCKETS = ["概括", "分析", "对策", "公文"];

  /* ---------------- 题库池 ---------------- */
  function gkPapers() { return DATA.papers.filter(function (p) { return p.province === "国考"; }); }
  function papersOfProv(prov) {
    if (prov === "国考") return gkPapers();
    // 省考：优先已加载的真实卷，否则返回 meta 占位（由 loadSKProv 触发加载后重渲染）
    var real = DATA.papers.filter(function (p) { return p.province === prov; });
    if (real.length) return real;
    if (typeof skPapersOf === "function") {
      var meta = skPapersOf(prov);
      if (meta && meta.length) return meta;
    }
    return [];
  }
  function poolYears(prov) {
    return Array.from(new Set(papersOfProv(prov).map(function (p) { return p.year; }))).sort(function (a, b) { return b - a; });
  }
  function pickablePapers(prov) {
    var ps = papersOfProv(prov).filter(function (p) {
      if (B.year !== "全部" && String(p.year) !== B.year) return false;
      if (p._meta) return true; // 省考占位，加载后即见题
      // 小题数量 > 0
      return (p.questions || []).some(function (q) { return classify(q.qtype) !== "大作文"; });
    });
    return ps;
  }

  /* ---------------- 中文处理 / 词典 ---------------- */
  var STOP = new Set(("的了我与及等都是是在对把被我们可以需要通过进行实现提升加强完善建立健全推进落实推动促进" +
    "提高增加优化规范强化保障坚持发挥作用下要求问题能够应该必须要将也就而以为使让给向从到并且或" +
    "其之上下内外后前时所该各项个一二三四五六七八九十不无有新大小多少好更最这那此它他她们我你您本共" +
    "全总已未可能会话即如若做作制定设开展取得获得出来去入进退加减乘除分合同异变化成为").split(""));

  function norm(t) { return String(t == null ? "" : t).replace(/\s+/g, ""); }
  function keysOf(t) {
    t = norm(t);
    var ks = new Set();
    for (var i = 0; i < t.length - 1; i++) ks.add(t.substr(i, 2));
    return ks;
  }
  function meaningful(ks) {
    var out = new Set();
    ks.forEach(function (g) {
      var allStop = true;
      for (var i = 0; i < g.length; i++) if (!STOP.has(g[i])) { allStop = false; break; }
      if (!allStop) out.add(g);
    });
    return out;
  }

  /* 规范词库 -> 同义词簇（运行时一次性构建，缓存） */
  var WBGROUPS = null;
  function buildWordbank() {
    if (WBGROUPS) return WBGROUPS;
    var groups = [];
    (DATA.entries || []).forEach(function (e) {
      if (e.lib !== "规范词库") return;
      (e.lines || []).forEach(function (line) {
        var head = String(line).split("｜")[0];
        head = head.replace(/^规范词[:：]\s*/, "");
        var parts = head.split(/\s*[\/／、]\s*/).map(function (s) { return s.trim(); })
          .filter(function (s) { return s.length >= 2 && s.length <= 12; });
        if (parts.length >= 2) groups.push(parts);
      });
    });
    WBGROUPS = groups;
    return groups;
  }
  function synBoost(pt, a) {
    buildWordbank();
    var boost = 0;
    WBGROUPS.forEach(function (g) {
      var inPt = false, inAns = false;
      g.forEach(function (w) { if (pt.indexOf(w) >= 0) inPt = true; if (a.indexOf(w) >= 0) inAns = true; });
      if (inPt && inAns) boost = Math.max(boost, 0.3);
    });
    return boost;
  }

  /* ---------------- 单点匹配 ---------------- */
  function matchPoint(ptText, ans) {
    var a = norm(ans), pt = norm(ptText);
    if (!pt) return { status: "na", cov: 0 };
    if (a && a.indexOf(pt) >= 0) return { status: "hit", cov: 1 };
    var pk = meaningful(keysOf(pt));
    if (pk.size === 0) {
      var any = false;
      for (var i = 0; i < pt.length; i++) { if (a.indexOf(pt[i]) >= 0) { any = true; break; } }
      return { status: any ? "partial" : "miss", cov: any ? 0.3 : 0 };
    }
    var matched = 0;
    pk.forEach(function (g) { if (a.indexOf(g) >= 0) matched++; });
    var cov = matched / pk.size;
    if (cov < 0.5) cov = Math.min(1, cov + synBoost(pt, a));
    var status = cov >= 0.5 ? "hit" : (cov >= 0.2 ? "partial" : "miss");
    return { status: status, cov: cov };
  }

  /* ---------------- 解析分数 / 字数 ---------------- */
  function parseScore(s) { var m = String(s || "").match(/\d+/); return m ? parseInt(m[0], 10) : 10; }
  function parseLimit(s) { var m = String(s || "").match(/\d+/); return m ? parseInt(m[0], 10) : 0; }

  /* ---------------- 公文格式自检 ---------------- */
  function checkFormat(ans) {
    ans = norm(ans);
    if (!ans) return 0;
    var title = /关于|通报|通知|报告|请示|意见|方案|讲话|倡议|公开信|简报|提纲|发言|报道|宣传|经验|汇报|调研|推荐|纪要|导言|摘要|结语|函/.test(ans) ||
      /：|:/.test((ans.split("\n")[0] || ""));
    var sal = /尊敬的|敬爱的|各位|先生|女士|同志|：|:/.test(ans);
    var sign = /\d{4}年|\d{1,2}月\d{1,2}日|[一-龥]{2,}(公司|政府|委员会|办公室|局|部|处|科|协会|单位|组)$/.test(ans) ||
      /\d{4}\s*[-/年]\s*\d{1,2}\s*[-/月]\s*\d{1,2}\s*日/.test(ans);
    return (title ? 1 : 0) + (sal ? 1 : 0) + (sign ? 1 : 0);
  }

  /* ---------------- 评分主函数 ---------------- */
  function grade(q, ans) {
    var base = parseScore(q.score);
    var contentPts = (q.points || []).filter(function (p) { return p.tag !== "格式"; });
    var fmtPts = (q.points || []).filter(function (p) { return p.tag === "格式"; });
    var detail = [], coreHit = 0, coreTot = 0, flexHit = 0, flexTot = 0, missPoints = [];
    contentPts.forEach(function (p) {
      var m = matchPoint(p.text, ans);
      var isCore = p.tag === "核心";
      if (isCore) { coreTot++; if (m.status === "hit") coreHit++; }
      else { flexTot++; if (m.status === "hit" || m.status === "partial") flexHit++; }
      detail.push({ text: p.text, tag: p.tag, status: m.status, cov: m.cov });
      if (m.status === "miss") missPoints.push(p.text);
      else if (m.status === "partial") missPoints.push("（部分）" + p.text);
    });
    var num = coreHit + 0.5 * flexHit;
    var den = coreTot + 0.5 * flexTot;
    var ratio = den > 0 ? num / den : 0;

    var isGw = classify(q.qtype) === "公文" || fmtPts.length > 0;
    var fmtPresent = 0, fmtMiss = false;
    if (isGw) {
      fmtPresent = checkFormat(ans);
      fmtMiss = fmtPresent < 2;
    }
    var fmtPortion = fmtPts.length > 0 ? Math.min(0.2, fmtPts.length * 0.06)
      : (classify(q.qtype) === "公文" ? 0.15 : 0);
    if (fmtMiss && fmtPortion > 0) ratio *= (1 - fmtPortion);
    ratio = Math.max(0, Math.min(1, ratio));
    var score = Math.round(base * ratio);

    // 冗余 / 跑题
    var userKeys = meaningful(keysOf(ans));
    var totalMatched = new Set();
    detail.forEach(function (d) {
      if (d.status !== "miss") {
        meaningful(keysOf(d.text)).forEach(function (g) { if (norm(ans).indexOf(g) >= 0) totalMatched.add(g); });
      }
    });
    var coverage = userKeys.size > 0 ? totalMatched.size / userKeys.size : 1;
    var redund = coverage < 0.3 && norm(ans).length >= 30;
    var limit = parseLimit(q.words);
    var overWord = limit > 0 && norm(ans).length > limit * 1.1;

    return {
      base: base, score: score, ratio: ratio, coreHit: coreHit, coreTot: coreTot,
      flexHit: flexHit, flexTot: flexTot, fmtMiss: fmtMiss, fmtPresent: fmtPresent,
      missPoints: missPoints, detail: detail, coverage: coverage, redund: redund,
      overWord: overWord, limit: limit, ansLen: norm(ans).length
    };
  }

  /* ---------------- 记录存取（按 pid#pno 去重 upsert） ---------------- */
  function recKey(pid, pno) { return pid + "#" + pno; }
  function loadRecords() { try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch (e) { return []; } }
  function saveRecord(rec) {
    var a = loadRecords();
    var k = recKey(rec.pid, rec.pno);
    var found = false;
    for (var i = 0; i < a.length; i++) {
      if (recKey(a[i].pid, a[i].pno) === k) { a[i] = rec; found = true; break; }
    }
    if (!found) a.push(rec);
    try { localStorage.setItem(LS_KEY, JSON.stringify(a)); } catch (e) {}
  }

  function findQ(pid, pno) {
    var p = DATA.papers.find(function (x) { return x.id === pid; });
    if (!p) return null;
    return { p: p, q: (p.questions || []).find(function (x) { return x.no === pno; }) };
  }

  /* ===================================================================
     渲染入口（EXT 路由）
     =================================================================== */
  window.renderXiaotiPiGai = function () {
    var box = $("content");
    if (!box) return;
    var st = $("stats");
    if (st) st.textContent = "小题 AI 即时批改 + 弱项诊断 — 写完即判 · 弱项可视化（聚焦归纳/分析/对策/公文）";
    renderTabs();
  };

  function renderTabs() {
    var box = $("content");
    var h = '<div class="b25-wrap">';
    h += '<div class="b25-tabs">' +
      '<span class="b25-tab ' + (B.tab === "grade" ? "on" : "") + '" onclick="b25SetTab(\'grade\')">✍️ 即时批改</span>' +
      '<span class="b25-tab ' + (B.tab === "diag" ? "on" : "") + '" onclick="b25SetTab(\'diag\')">📊 弱项诊断</span>' +
      '</div>';
    if (B.tab === "grade") h += renderGradeInner();
    else h += renderDiagInner();
    h += '</div>';
    box.innerHTML = h;
    if (B.tab === "grade" && B.pid) bindGrade();
  }
  window.b25SetTab = function (t) { B.tab = t; if (t === "grade" && !B.pid) B.pid = ""; renderTabs(); };

  /* ---------------- 批改页 ---------------- */
  function renderGradeInner() {
    var h = '<div class="b25-ctrl">';
    // 省份
    h += '<select onchange="b25SetProv(this.value)"><option value="国考"' + (B.prov === "国考" ? " selected" : "") + '>国考</option>';
    var provs = [];
    if (typeof skProvStats === "function") {
      skProvStats().forEach(function (x) { provs.push(x.prov); });
    }
    provs.forEach(function (pv) {
      h += '<option value="' + esc(pv) + '"' + (B.prov === pv ? " selected" : "") + '>' + esc(pv) + '省考</option>';
    });
    h += '</select>';
    // 年份
    h += '<div class="b25-chips">';
    h += '<span class="b25-chip ' + (B.year === "全部" ? "on" : "") + '" onclick="b25SetYear(\'全部\')">全部年份</span>';
    poolYears(B.prov).forEach(function (y) {
      h += '<span class="b25-chip ' + (String(B.year) === String(y) ? "on" : "") + '" onclick="b25SetYear(\'' + y + '\')">' + y + '</span>';
    });
    h += '</div>';
    // 题型
    h += '<div class="b25-chips">';
    ["全部", "概括", "分析", "对策", "公文"].forEach(function (qt) {
      h += '<span class="b25-chip ' + (B.qt === qt ? "on" : "") + '" onclick="b25SetQt(\'' + qt + '\')">' + qt + '</span>';
    });
    h += '</div></div>';

    var ps = pickablePapers(B.prov);
    if (!B.pid) {
      h += '<div class="b25-grid">';
      ps.forEach(function (p) {
        h += '<div class="b25-pcard" onclick="b25PickPaper(\'' + esc(p.id) + '\')"><b>' +
          (p.year || "") + ' · ' + esc(p.paper || p.id) + '</b><div class="sk-m">' +
          (p._meta ? "点击加载…" : ((p.questions || []).length + " 题")) + '</div></div>';
      });
      if (!ps.length) h += '<div class="b25-empty">该筛选下暂无小题卷</div>';
      h += '</div>';
      return h;
    }
    // 已选卷 -> 小题列表
    var f = findQ(B.pid, -1);
    var paper = f ? f.p : null;
    h += '<div class="b25-qhead" style="cursor:pointer;font-weight:700;color:var(--accent)" onclick="b25BackPapers()">← 返回选卷（' +
      (paper ? esc(paper.year + " " + paper.paper) : esc(B.pid)) + '）</div>';
    h += '<div class="b25-ql">';
    var qs = paper ? (paper.questions || []) : [];
    var shown = 0;
    qs.forEach(function (q) {
      var bk = classify(q.qtype);
      if (bk === "大作文" || bk === "其他") return;
      if (B.qt !== "全部" && B.qt !== bk) return;
      shown++;
      var open = (q.no === B.pno);
      h += '<div class="b25-qitem"><div class="b25-qhead" onclick="b25PickQ(' + q.no + ')">' +
        '<span class="tag">题' + q.no + '</span><span class="tag lib">' + esc(q.qtype) + '</span>' +
        (q.score ? '<span class="tag gr">' + esc(q.score) + '</span>' : '') +
        (q.words ? '<span class="tag gr">' + esc(q.words) + '</span>' : '') +
        '<span style="font-size:13px;color:var(--sub)">' + esc((q.stem || []).join(" ").slice(0, 40)) + '…</span></div>';
      h += '<div class="b25-qbody ' + (open ? "open" : "") + '" id="b25body_' + B.pid + '_' + q.no + '">' + qPanel(paper, q) + '</div></div>';
    });
    if (!shown) h += '<div class="b25-empty">该题型下暂无小题</div>';
    h += '</div>';
    return h;
  }

  function qPanel(paper, q) {
    var key = B.pid + "_" + q.no;
    var html = '';
    html += '<div class="b25-stem">' + esc((q.stem || []).join("\n")) + '</div>';
    if (paper && paper.materials && paper.materials.length) {
      var mh = paper.materials.map(function (l) {
        return l.startsWith("### ") ? "【" + l.slice(4) + "】" : l;
      }).join("\n");
      html += '<details class="b25-mat"><summary>📜 给定资料（' + paper.materials.length + ' 段，点击展开）</summary><div class="inner">' + esc(mh) + '</div></details>';
    }
    html += '<textarea class="b25-ta" id="b25ans_' + key + '" placeholder="在此作答（可先自测，再点「即时批改」）。支持边写边存，切换题目不丢失。">' +
      esc(B.ansMap[key] || "") + '</textarea>';
    html += '<div class="b25-acts">' +
      '<button class="b25-btn primary" onclick="b25Grade(' + q.no + ')">📊 即时批改</button>' +
      '<button class="b25-btn" onclick="b25Save(' + q.no + ')">💾 保存记录</button>' +
      '<button class="b25-btn" onclick="b25ToggleStd(' + q.no + ')">👁 看标准答案</button>' +
      '<button class="b25-btn" onclick="b25Ai(' + q.no + ')">🤖 AI精批(可选)</button>' +
      '</div>';
    html += '<div id="b25res_' + key + '"></div>';
    html += '<div id="b25std_' + key + '" style="display:none">' + stdAnswerHtml(q) + '</div>';
    return html;
  }

  function stdAnswerHtml(q) {
    var h = '<div class="b25-std"><b>🏫 机构答案要点</b><br>';
    (q.orgs || []).forEach(function (o) {
      h += '<div style="margin-top:6px;color:#4338ca;font-weight:700">' + esc(o.name) + '</div>';
      h += o.lines.map(function (l) { return esc(l); }).join("<br>");
    });
    if (!(q.orgs || []).length) h += '（本题暂无机构答案，参考下方 AI 综合答案）';
    h += '</div>';
    if ((q.ai || []).length) {
      h += '<div class="b25-std"><b>🤖 AI 综合答案</b><br>' + (q.ai || []).map(function (l) { return esc(l); }).join("<br>") + '</div>';
    }
    return h;
  }

  function bindGrade() {
    var key = B.pid + "_" + B.pno;
    var ta = $("b25ans_" + key);
    if (ta) {
      ta.addEventListener("input", function () {
        B.ansMap[key] = ta.value;
        // 轻量即时预览（去抖）：仅重算结果区，不重渲整页
        clearTimeout(B._t);
        B._t = setTimeout(function () { b25Grade(B.pno, true); }, 450);
      });
    }
  }

  window.b25SetProv = function (v) {
    B.prov = v; B.year = "全部"; B.qt = "全部"; B.pid = "";
    if (v !== "国考" && typeof loadSKProv === "function" && typeof skEntry === "function" && skEntry(v) && !(window.skLoaded && window.skLoaded[v])) {
      if (typeof skBusy === "function") skBusy("正在加载「" + v + "」省考真题…");
      loadSKProv(v, function (ok) { renderTabs(); });
      return;
    }
    renderTabs();
  };
  window.b25SetYear = function (y) { B.year = y; B.pid = ""; renderTabs(); };
  window.b25SetQt = function (qt) { B.qt = qt; renderTabs(); };
  window.b25PickPaper = function (pid) {
    B.pid = pid; B.pno = -1;
    // 省考占位触发加载
    var pv = (typeof skProvOfId === "function") ? skProvOfId(pid) : "";
    if (pv && typeof loadSKProv === "function" && !(window.skLoaded && window.skLoaded[pv])) {
      if (typeof skBusy === "function") skBusy("正在加载「" + pv + "」省考真题…");
      loadSKProv(pv, function () { B.pno = -1; renderTabs(); });
      return;
    }
    renderTabs();
  };
  window.b25BackPapers = function () { B.pid = ""; B.pno = -1; renderTabs(); };
  window.b25PickQ = function (pno) {
    B.pno = pno;
    renderTabs();
    var key = B.pid + "_" + pno;
    if (B.resMap[key]) $("b25res_" + key).innerHTML = B.resMap[key];
  };
  window.b25ToggleStd = function (pno) {
    var key = B.pid + "_" + pno;
    var el = $("b25std_" + key);
    if (el) el.style.display = el.style.display === "none" ? "block" : "none";
  };

  /* ---------------- 批改计算 + 结果渲染 ---------------- */
  window.b25Grade = function (pno, silent) {
    var key = B.pid + "_" + pno;
    var ta = $("b25ans_" + key);
    var ans = ta ? ta.value : (B.ansMap[key] || "");
    B.ansMap[key] = ans;
    var f = findQ(B.pid, pno);
    if (!f || !f.q) return;
    var res = grade(f.q, ans);
    B.resMap[key] = renderResult(f.q, res);
    var box = $("b25res_" + key);
    if (box) box.innerHTML = B.resMap[key];
    if (!silent && ans.trim().length >= 10) b25Save(pno, true);
  };

  function renderResult(q, r) {
    var h = '<div class="b25-res">';
    var color = r.ratio >= 0.7 ? "var(--green)" : (r.ratio >= 0.4 ? "#d97706" : "#dc2626");
    h += '<div class="b25-score"><span class="big" style="color:' + color + '">' + r.score + '</span>' +
      '<span style="font-size:15px;color:var(--sub)">/ ' + r.base + ' 分</span>' +
      '<span class="pct">命中率 ' + Math.round(r.ratio * 100) + '% · 核心 ' + r.coreHit + '/' + r.coreTot +
      (r.flexTot ? ' · 弹性 ' + r.flexHit + '/' + r.flexTot : '') + '</span></div>';

    // 失分预警
    if (r.overWord) h += '<div class="b25-warn red">⚠️ 超字数：本题要求' + r.limit + '字以内，你已写约 ' + (r.ansLen || 0) + ' 字（按字符计）。建议精简。</div>';
    if (r.fmtMiss) h += '<div class="b25-warn red">⚠️ 公文格式缺项：检测到标题/称谓/落款不完整（命中 ' + r.fmtPresent + '/3）。公文题格式分不可丢。</div>';
    if (r.redund) h += '<div class="b25-warn">⚠️ 冗余/跑题预警：你的作答中约 ' + Math.round((1 - r.coverage) * 100) + '% 的内容未命中任何标准采分点，建议紧扣材料要点、少写空话。</div>';
    if (!r.overWord && !r.fmtMiss && !r.redund) h += '<div class="b25-warn ok">✅ 字数 / 格式 / 冗余 检测通过</div>';

    // 采分点逐条
    h += '<div style="font-weight:700;color:var(--accent);margin:8px 0 4px">✅ 采分点逐条判定</div>';
    r.detail.forEach(function (d) {
      var ico = d.status === "hit" ? "✅" : (d.status === "partial" ? "⚠️" : "❌");
      var cls = d.status === "hit" ? "hit" : (d.status === "partial" ? "part" : "miss");
      var tg = d.tag === "核心" ? '<span class="b25-tg core">核心</span>' : (d.tag === "弹性" ? '<span class="b25-tg flex">弹性</span>' : '<span class="b25-tg fmt">格式</span>');
      var statusTxt = d.status === "hit" ? "命中" : (d.status === "partial" ? "部分" : "遗漏");
      h += '<div class="b25-ptrow"><span class="b25-ico ' + cls + '">' + ico + '</span>' + tg +
        '<span>' + esc(d.text) + ' <span style="color:var(--sub);font-size:11px">[' + statusTxt + ']</span></span></div>';
    });

    // 规范提示：遗漏/偏弱的标准要点
    if (r.missPoints.length) {
      h += '<div class="b25-std"><b>📌 你遗漏/偏弱的标准要点（建议背诵）</b><br>' +
        r.missPoints.map(function (t) { return esc(t); }).join("<br>") + '</div>';
    }
    h += '</div>';
    return h;
  }

  /* ---------------- 保存记录（去重 upsert） ---------------- */
  window.b25Save = function (pno, fromGrade) {
    var key = B.pid + "_" + pno;
    var ans = B.ansMap[key] || "";
    if (ans.trim().length < 10) { if (!fromGrade) alert("先写点答案再保存～"); return; }
    var f = findQ(B.pid, pno);
    if (!f || !f.q) return;
    var r = grade(f.q, ans);
    var rec = {
      pid: B.pid, pno: pno, province: f.p.province, paper: f.p.paper, year: f.p.year,
      qtype: f.q.qtype, bucket: classify(f.q.qtype), base: r.base, score: r.score, ratio: r.ratio,
      missPoints: r.missPoints, redund: r.redund, overWord: r.overWord, fmtMiss: r.fmtMiss, ts: Date.now()
    };
    saveRecord(rec);
    if (!fromGrade) alert("已保存并计入学情 ✅（去「弱项诊断」查看）");
  };

  /* ---------------- AI 精批（可选，本地队列/剪贴板兜底，复用 _b24 模式） ---------------- */
  window.b25Ai = function (pno) {
    var key = B.pid + "_" + pno;
    var ans = B.ansMap[key] || "";
    var f = findQ(B.pid, pno);
    if (!f || !f.q) return;
    var prompt = "【小题 AI 精批任务】\n请对下面这道申论小题做语义级精批（比关键词匹配更准，能识别同义改写）：\n\n" +
      "试卷：" + f.p.year + " " + f.p.paper + " · 题" + pno + "\n题型：" + f.q.qtype + " · 分值：" + f.q.score + " · 字数：" + f.q.words + "\n" +
      "题干：" + (f.q.stem || []).join("\n") + "\n\n" +
      "我的答案：\n" + ans + "\n\n" +
      "标准采分点（参考）：\n" + (f.q.points || []).map(function (p) { return "[" + p.tag + "] " + p.text; }).join("\n") + "\n\n" +
      "请输出：①逐条采分点是否命中（命中/部分/遗漏）及理由；②失分原因（漏点/表述不规范/冗余/格式/超字数）；③一句修改建议；④给一个 0-1 的更精确命中率。";
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(prompt).then(function () { alert("AI 精批任务已复制 ✅\n粘贴给 WorkBuddy（同会话）即可获得语义级精批，结果可回写本题。"); },
        function () { fallbackCopy(prompt); });
    } else fallbackCopy(prompt);
  };
  function fallbackCopy(txt) {
    var ta = document.createElement("textarea"); ta.value = txt;
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); alert("AI 精批任务已复制 ✅"); } catch (e) { alert("请手动复制任务文本"); }
    document.body.removeChild(ta);
  }

  /* ===================================================================
     诊断页
     =================================================================== */
  function renderDiagInner() {
    var recs = loadRecords();
    if (!recs.length) {
      return '<div class="b25-empty">还没有批改记录。<br>去「即时批改」写完答案点「保存记录」，这里会自动生成你的弱项画像。</div>';
    }
    var h = '';
    // KPI
    var avg = recs.reduce(function (s, r) { return s + r.ratio; }, 0) / recs.length;
    var avgScore = recs.reduce(function (s, r) { return s + r.score; }, 0) / recs.length;
    h += '<div class="b25-kpis">' +
      kpi(recs.length, "已批改小题") +
      kpi(Math.round(avg * 100) + "%", "平均命中率") +
      kpi(Math.round(avgScore * 10) / 10, "平均得分") +
      kpi(bucketLowest(recs), "最弱题型") +
      '</div>';

    // 题型雷达
    var radarData = BUCKETS.map(function (b) {
      var rs = recs.filter(function (r) { return r.bucket === b; });
      return { name: b, val: rs.length ? rs.reduce(function (s, r) { return s + r.ratio; }, 0) / rs.length : 0, n: rs.length };
    });
    h += '<div class="b25-radar"><div class="b25-sec-h" style="border:none;margin:0 0 4px;padding:0">题型命中率雷达</div>' + radarSvg(radarData) + '</div>';

    // 失分类型分布
    var loss = { 漏点: 0, 表述不规范: 0, 冗余跑题: 0, 超字数: 0, 格式缺项: 0 };
    recs.forEach(function (r) {
      if (r.missPoints && r.missPoints.length) loss["漏点"]++;
      if ((r.missPoints || []).some(function (t) { return t.indexOf("（部分）") >= 0; })) loss["表述不规范"]++;
      if (r.redund) loss["冗余跑题"]++;
      if (r.overWord) loss["超字数"]++;
      if (r.fmtMiss) loss["格式缺项"]++;
    });
    h += '<div class="b25-sec-h">失分类型分布</div><div class="b25-list">';
    Object.keys(loss).forEach(function (k) {
      var c = loss[k], pct = recs.length ? Math.round(c / recs.length * 100) : 0;
      h += '<div class="b25-li"><span>' + k + ' <span style="color:var(--sub)">(' + c + ' 次)</span></span>' +
        '<span style="display:flex;gap:8px;align-items:center;flex:1;max-width:260px"><span class="b25-bar"><i style="width:' + pct + '%"></i></span><span class="cnt">' + pct + '%</span></span></div>';
    });
    h += '</div>';

    // 高频遗漏采分点 TOP10
    var cnt = {};
    recs.forEach(function (r) { (r.missPoints || []).forEach(function (t) { t = t.replace(/^（部分）/g, ""); cnt[t] = (cnt[t] || 0) + 1; }); });
    var top = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; }).slice(0, 10);
    if (top.length) {
      h += '<div class="b25-sec-h">高频遗漏采分点 TOP10（重点补弱）</div><div class="b25-list">';
      top.forEach(function (t) {
        h += '<div class="b25-li"><span>' + esc(t) + '</span><span class="cnt">遗漏 ' + cnt[t] + ' 次</span></div>';
      });
      h += '</div>';
    }

    // 补弱路径
    var weak = radarData.slice().sort(function (a, b) { return a.val - b.val; })[0];
    var tip = weak && weak.n > 0
      ? '你最弱的题型是 <b>' + weak.name + '</b>（' + weak.n + ' 次批改，平均命中率 ' + Math.round(weak.val * 100) + '%）。建议：①优先练 ' + weak.name + ' 类真题（「即时批改」里按题型筛选）；②对照「方法论」卡片看该类题踩分结构；③背熟上方高频遗漏的标准要点。'
      : '样本还太少，多批改几道就能给出精准补弱路径。';
    h += '<div class="b25-sec-h">补弱路径建议</div><div class="b25-list"><div class="b25-tip">' + tip + '</div>' +
      '<div class="b25-tip">通用提分：每次批改后看「你遗漏/偏弱的标准要点」并背诵；公文题务必补齐标题/称谓/落款；控制字数不超 1.1 倍。</div></div>';

    return h;
  }
  function kpi(v, l) { return '<div class="b25-kpi"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>'; }
  function bucketLowest(recs) {
    var best = { b: "—", v: 2 };
    BUCKETS.forEach(function (b) {
      var rs = recs.filter(function (r) { return r.bucket === b; });
      if (rs.length) { var v = rs.reduce(function (s, r) { return s + r.ratio; }, 0) / rs.length; if (v < best.v) best = { b: b, v: v }; }
    });
    return best.b;
  }

  /* ---------------- 雷达图（内联 SVG，离线） ---------------- */
  function radarSvg(data) {
    var n = data.length, cx = 160, cy = 150, R = 100;
    var ang = function (i) { return -Math.PI / 2 + i * 2 * Math.PI / n; };
    var pt = function (i, r) { return [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))]; };
    var s = '<svg viewBox="0 0 320 320" width="320" height="320">';
    // 网格
    [0.25, 0.5, 0.75, 1].forEach(function (g) {
      var pts = [];
      for (var i = 0; i < n; i++) { var p = pt(i, R * g); pts.push(p[0].toFixed(1) + "," + p[1].toFixed(1)); }
      s += '<polygon points="' + pts.join(" ") + '" fill="none" stroke="#eee"/>';
    });
    // 轴 + 标签
    for (var i = 0; i < n; i++) {
      var e = pt(i, R); s += '<line x1="' + cx + '" y1="' + cy + '" x2="' + e[0].toFixed(1) + '" y2="' + e[1].toFixed(1) + '" stroke="#eee"/>';
      var lp = pt(i, R + 22);
      s += '<text x="' + lp[0].toFixed(1) + '" y="' + lp[1].toFixed(1) + '" font-size="13" fill="#8e2f22" text-anchor="middle">' + data[i].name + '</text>';
      var vp = pt(i, R + 22 - 16);
      s += '<text x="' + vp[0].toFixed(1) + '" y="' + vp[1].toFixed(1) + '" font-size="11" fill="#6b7280" text-anchor="middle">' + Math.round(data[i].val * 100) + '%</text>';
    }
    // 数据多边形
    var dpts = [];
    for (var j = 0; j < n; j++) { var dp = pt(j, R * Math.max(0.02, data[j].val)); dpts.push(dp[0].toFixed(1) + "," + dp[1].toFixed(1)); }
    s += '<polygon points="' + dpts.join(" ") + '" fill="rgba(142,47,34,.25)" stroke="#8e2f22" stroke-width="2"/>';
    data.forEach(function (d, i) { var dp = pt(i, R * Math.max(0.02, d.val)); s += '<circle cx="' + dp[0].toFixed(1) + '" cy="' + dp[1].toFixed(1) + '" r="3" fill="#8e2f22"/>'; });
    s += '</svg>';
    return s;
  }

  /* 调试/测试句柄（无害，便于离线验证评分引擎） */
  window.__B25 = {
    grade: grade, matchPoint: matchPoint, classify: classify, parseScore: parseScore,
    parseLimit: parseLimit, buildWordbank: buildWordbank, keysOf: keysOf, meaningful: meaningful,
    checkFormat: checkFormat, gradeDemo: function () { return "ok"; }
  };
})();
