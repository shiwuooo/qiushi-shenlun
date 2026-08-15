/* =====================================================================
   第八批：增强离线评分引擎 + 答案对照（我的作答 vs 名师答案）  (_b8.js)
   依赖：全局 DATA / state / render() / esc() / hi()（由主站提供）
   存储：只读引用 shenlun_answers_v2（现有作答，绝不写入）
   特性：纯前端、离线可用、无任何联网上报
   导出：window.scoreEnhance(answer,q)  —— 增强版离线评分（兼容主站 scoreAnswer 返回形状）
         window.renderCompare()         —— 答案对照视图（供导航路由调用）
   ===================================================================== */
(function(){
"use strict";

/* ---------------- 常量 ---------------- */
const ANS_KEY = "shenlun_answers_v2";   /* 只读，绝不写入 */

/* 停用词：与主站 STOP 对齐（用于 2~4gram 关键词抽取时过滤空泛词） */
const B8STOP = new Set(["可以","应该","我们","他们","这个","那个","以及","通过","由于","对于",
  "进行","问题","方面","需要","必须","一个","没有","这样","就是","因此","所以","但是","并且",
  "而且","如果","因为","为了","能够","实现","提供","建立","加强","完善","提高","在于","成为",
  "工作","开展","推动","促进","发挥","作用","重要","不断","进一步","切实","有效","结合","给定"]);

/* 同义词组（申论高频规范动词/表述近义组，用于软匹配与规范表述建议）
   同组内任意两词互为同义词；共 42 组，覆盖约 160 个规范词。 */
const SYN_GROUPS = [
  ["加强","强化","夯实","巩固","增强"],
  ["完善","健全","优化","改进"],
  ["提升","提高","增进","提振"],
  ["推进","推动","促进","助推"],
  ["落实","落地","贯彻","执行","兑现"],
  ["建立","构建","建设","搭建","组建"],
  ["保障","支撑","护航","保驾护航"],
  ["治理","管理","整治","整顿"],
  ["优化","改善","升级","改良"],
  ["引导","引领","带动","示范"],
  ["创新","革新","变革","更新"],
  ["培育","培养","孵化","造就"],
  ["激发","激活","释放","调动"],
  ["统筹","协调","兼顾","整合"],
  ["规范","标准化","制度化","定型"],
  ["挖掘","发掘","盘活","开发"],
  ["宣传","普及","弘扬","传播"],
  ["监督","监管","督查","问责"],
  ["服务","供给","支持","供应"],
  ["破解","解决","化解","攻克"],
  ["探索","尝试","试点","先行"],
  ["凝聚","汇聚","聚合","团结"],
  ["深化","拓展","延伸","拓宽"],
  ["补齐","弥补","填补","补足"],
  ["打造","塑造","培植","树立"],
  ["保护","守护","维护","呵护"],
  ["增收","致富","富民","增效"],
  ["转型","转变","转化","跃升"],
  ["聚焦","立足","着眼","围绕"],
  ["助力","赋能","加持","支撑"],
  ["精准","精确","精细","精细化"],
  ["高效","优质","提质","高质量"],
  ["协同","联动","配合","衔接"],
  ["引进","引入","吸纳","招引"],
  ["示范","标杆","样板","典型"],
  ["覆盖","普惠","惠及","辐射"],
  ["优先","倾斜","侧重","重点"],
  ["底线","红线","边界","门槛"],
  ["长效","常态","持续","长远"],
  ["短板","弱项","不足","缺口"],
  ["机制","制度","体系","体制"],
  ["责任","担当","职责","使命"]
];
/* 展开为 词 -> [同义词...] 映射 */
const SYN_MAP = (function(){
  const m = {};
  SYN_GROUPS.forEach(function(g){
    g.forEach(function(w){
      const others = g.filter(function(x){ return x !== w; });
      m[w] = (m[w] || []).concat(others);
    });
  });
  Object.keys(m).forEach(function(k){ m[k] = Array.from(new Set(m[k])); });
  return m;
})();

/* ---------------- 存储层（只读、失败降级） ---------------- */
function loadAnswers(){
  try{ const o = JSON.parse(localStorage.getItem(ANS_KEY)); return (o && typeof o === "object") ? o : {}; }
  catch(e){ return {}; }
}
function rk(pid, qno){ return pid + "#" + qno; }

/* ---------------- 通用工具 ---------------- */
function E(s){
  const v = (s===null||s===undefined) ? "" : String(s);
  if(typeof esc === "function") return esc(v);
  return v.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function EA(s){ return E(s).replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
function cn(s){ return String(s||"").replace(/\s/g,"").length; }
function cleanLine(l){ return String(l||"").replace(/^[-•>＞\s]+/,"").trim(); }

/* 中文分句：按 。！？；!?; 及换行切分 */
function splitSent(t){
  const s = String(t||"").replace(/\r/g,"");
  const out = [];
  let cur = "";
  for(let i=0;i<s.length;i++){
    const ch = s[i];
    if(ch === "\n"){ if(cur.trim()) out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
    if("。！？；!?;".indexOf(ch) >= 0){ if(cur.trim()) out.push(cur.trim()); cur = ""; }
  }
  if(cur.trim()) out.push(cur.trim());
  return out;
}

/* 2~4gram 关键词抽取（与主站 extractKeywords 同构，过滤停用词） */
function extractKeywords(text){
  const clean = String(text||"").replace(/[^\u4e00-\u9fa5]/g,"");
  const set = new Set();
  for(let i=0;i<clean.length;i++){
    for(let L=2; L<=4 && i+L<=clean.length; L++){
      const w = clean.substr(i,L);
      if(!B8STOP.has(w)) set.add(w);
    }
  }
  return Array.from(set);
}

/* 中文字符集合（去除标点/字母/数字） */
function charSet(s){
  const set = new Set();
  const clean = String(s||"").replace(/[^\u4e00-\u9fa5]/g,"");
  for(let i=0;i<clean.length;i++) set.add(clean[i]);
  return set;
}
/* a 被 b 覆盖的字符重叠率：|set(a)∩set(b)| / |set(a)| */
function overlapRatio(a, b){
  const sa = charSet(a);
  if(!sa.size) return 0;
  const sb = charSet(b);
  let inter = 0;
  sa.forEach(function(c){ if(sb.has(c)) inter++; });
  return inter / sa.size;
}

/* 同义词命中：采分点里出现某同义组关键词，且作答里出现该组另一同义词 */
function synMatch(ptText, answer){
  for(const key in SYN_MAP){
    if(ptText.indexOf(key) >= 0){
      const syns = SYN_MAP[key];
      for(let i=0;i<syns.length;i++){
        if(answer.indexOf(syns[i]) >= 0) return true;
      }
    }
  }
  return false;
}
/* 为遗漏采分点给出规范表述建议 */
function suggestSyn(ptText){
  for(const key in SYN_MAP){
    if(ptText.indexOf(key) >= 0){
      const syns = SYN_MAP[key];
      if(syns.length) return key + "→" + syns.slice(0,3).join("/");
    }
  }
  return "健全 / 完善 / 统筹 / 落实 等规范动词";
}

/* =====================================================================
   核心（1）：增强离线评分  window.scoreEnhance(answer, q)
   兼容主站 scoreAnswer(answer,q) 返回形状，另附 softHits / suggestions
   ===================================================================== */
function scoreEnhance(answer, q){
  try{
    q = q || {};
    const ans = String(answer||"");
    const pts = (q.points||[]).filter(function(p){ return p && p.text; });
    const hits = [], missed = [], softHits = [];
    const ansSents = splitSent(ans);

    pts.forEach(function(pt){
      const text = String(pt.text||"");
      /* ① 关键词硬命中：pt 的任意 2~4gram 出现在作答中 → 1.0 */
      const kws = extractKeywords(text);
      let hard = false;
      for(let i=0;i<kws.length;i++){ if(ans.indexOf(kws[i]) >= 0){ hard = true; break; } }
      /* ② 同义词命中 → 1.0 */
      if(!hard && synMatch(text, ans)) hard = true;
      if(hard){ hits.push(pt); return; }
      /* ③ 句子字符重叠：任一 pt 句与任一作答句重叠率 ≥ 0.5 → 0.5 */
      const ptSents = splitSent(text);
      let best = 0;
      for(let i=0;i<ptSents.length;i++){
        for(let j=0;j<ansSents.length;j++){
          const r = overlapRatio(ptSents[i], ansSents[j]);
          if(r > best) best = r;
        }
      }
      if(best >= 0.5){ softHits.push(pt); return; }
      /* ④ 未命中 */
      missed.push(pt);
    });

    const total = pts.length;
    const denom = total || 1;
    const eff = hits.length + softHits.length * 0.5;   /* 有效命中数 */
    const rate = eff / denom;
    const reasons = inferReasons(missed, q, ans, pts);
    const suggestions = missed.map(function(pt){
      return "遗漏采分点：" + String(pt.text||"") + "　建议补充规范表述如 " + suggestSyn(String(pt.text||""));
    });

    return {
      hits: hits,           /* 满命中(1.0) 采分点 */
      missed: missed,       /* 未命中(0) 采分点 */
      softHits: softHits,   /* 部分命中(0.5) 采分点 */
      rate: rate,
      score: Math.round(rate * 100),
      total: total,
      hitCount: hits.length,
      reasons: reasons,     /* 数组 */
      suggestions: suggestions
    };
  }catch(e){
    /* 任何异常都不抛出，返回空结果 */
    return { hits:[], missed:[], softHits:[], rate:0, score:0, total:0, hitCount:0, reasons:[], suggestions:[] };
  }
}

/* 失分归因（沿用主站 inferReasons 精神，返回数组而非 Set） */
function inferReasons(missed, q, answer, pts){
  const r = [];
  const add = function(x){ if(r.indexOf(x) < 0) r.push(x); };
  try{
    pts = pts || (q && q.points) || [];
    const qtype = (q && q.qtype) || "";
    const ans = String(answer||"");
    if(!missed || !missed.length) return r;
    const n = pts.length || 1;
    if(missed.length >= Math.max(1, Math.ceil(n * 0.6))) add("找点不全");
    if(ans.length > 600 && missed.length > 0) add("归纳整合弱");
    if(/概括|归纳/.test(qtype) && missed.length) add("归纳整合弱");
    if(/作文|议论|策论|文章/.test(qtype)){ add("分论点弱"); add("论证无力"); }
    if(/公文|应用文|贯彻|信|通知|报告|请示|函|稿|简报|倡议/.test(qtype)) add("规范格式弱");
    if(missed.some(function(p){ return /规范|术语|表述|准确/.test(p.text||""); })) add("规范词缺乏");
    if(missed.length >= 2) add("规范词缺乏");
    const stem = ((q && q.stem) || []).join("");
    if(/审题|对象|范围|针对/.test(stem) && missed.length >= n) add("审题偏题");
    if(missed.length >= 3) add("素材积累少");
  }catch(e){}
  return r;
}

/* =====================================================================
   核心（2）：答案对照视图  window.renderCompare()
   ===================================================================== */
let sel = { pid:"", qno:null };                 /* 当前选择 */
let cur = { p:null, q:null, modelText:"" };     /* 供复制/打开作答等动作引用 */

function papersList(){ return (typeof DATA !== "undefined" && DATA.papers) ? DATA.papers : []; }
function provLabel(p){ const v = (p && p.province) || ""; return (!v || v === "国考") ? "国考" : (v + "省考"); }
function paperLabel(p){ if(!p) return ""; return p.year + " " + provLabel(p) + " · " + (p.paper || ""); }

/* 组装名师答案分组：机构答案 + AI综合答案 */
function buildModel(q){
  const groups = [];
  ((q && q.orgs) || []).forEach(function(o){
    const lines = (o.lines || []).map(cleanLine).filter(Boolean);
    if(lines.length) groups.push({ name: o.name || "机构答案", lines: lines });
  });
  const ai = ((q && q.ai) || []).map(cleanLine).filter(Boolean);
  if(ai.length) groups.push({ name: "AI综合答案", lines: ai });
  return groups;
}
function modelHtml(groups){
  if(!groups.length) return '<div class="b8-muted">（本题暂无机构/AI参考答案）</div>';
  return groups.map(function(g){
    return '<div class="b8-mgroup"><div class="b8-mgname">' + E(g.name) + '</div>' +
      g.lines.map(function(l){ return '<div class="b8-mline">' + E(l) + '</div>'; }).join("") +
      '</div>';
  }).join("");
}
function modelText(groups){
  const arr = [];
  groups.forEach(function(g){ g.lines.forEach(function(l){ arr.push(l); }); });
  return arr.join("\n");
}

function ptStatus(pt, res){
  if(res.hits.indexOf(pt) >= 0) return "hit";
  if(res.softHits.indexOf(pt) >= 0) return "soft";
  return "miss";
}

function renderCompare(){
  const box = document.getElementById("content");
  if(!box) return;
  const papers = papersList();

  sideNav("答案对照", [
    {id:"b8Top",   label:"🔍 选择题目"},
    {id:"b8Cmp",   label:"📑 我的作答 · 名师答案"},
    {id:"b8Chk",   label:"✅ 采分点对照"},
    {id:"b8Align", label:"🧭 句子覆盖分析"}
  ]);

  let h = '<div class="b8-wrap">';
  h += '<h2 class="b8-h2" id="b8Top">🔍 答案对照与增强评分</h2>';
  h += '<div class="b8-note">左侧为你的作答、右侧为名师/AI参考答案，中间给出<b>采分点命中</b>与<b>句子覆盖</b>对照。' +
       '<b class="b8-warn">增强评分为离线语义近似版</b>（关键词＋同义词＋句子字符重叠三重匹配），仅供自查方向；' +
       '深度批改需配置 LLM。全部数据仅读取本机 localStorage（shenlun_answers_v2），不改写、不上传。</div>';

  if(!papers.length){
    h += '<div class="b8-card"><div class="b8-bd"><div class="b8-empty">题库为空（DATA.papers 无数据）。</div></div></div></div>';
    box.innerHTML = h;
    setStats("答案对照 · 题库为空");
    return;
  }

  /* 默认选择 */
  if(!sel.pid || !papers.some(function(x){ return x.id === sel.pid; })) sel.pid = papers[0].id;
  const p = papers.filter(function(x){ return x.id === sel.pid; })[0] || papers[0];
  const qs = (p.questions || []);
  if(sel.qno === null || !qs.some(function(x){ return Number(x.no) === Number(sel.qno); }))
    sel.qno = qs.length ? qs[0].no : null;
  const q = qs.filter(function(x){ return Number(x.no) === Number(sel.qno); })[0] || null;

  /* ---- 选择器 ---- */
  h += '<div class="b8-card"><div class="b8-h">选择套卷与题目</div><div class="b8-bd">';
  h += '<div class="b8-selrow"><label>套卷</label><select class="b8-sel" onchange="b8PickPaper(this.value)">';
  papers.forEach(function(x){
    h += '<option value="' + EA(x.id) + '"' + (x.id === sel.pid ? " selected" : "") + '>' + E(paperLabel(x)) + '</option>';
  });
  h += '</select>';
  h += '<label>题目</label><select class="b8-sel" onchange="b8PickQuestion(this.value)">';
  qs.forEach(function(x){
    const lbl = "题" + x.no + " · " + (x.qtype || "") + (x.score ? (" · " + x.score) : "");
    h += '<option value="' + E(String(x.no)) + '"' + (Number(x.no) === Number(sel.qno) ? " selected" : "") + '>' + E(lbl) + '</option>';
  });
  h += '</select></div>';
  if(q){
    h += '<div class="b8-stem">' + (q.stem || []).map(E).join("<br>") + '</div>';
  }
  h += '</div></div>';

  if(!q){
    h += '<div class="b8-card"><div class="b8-bd"><div class="b8-empty">该套卷暂无题目。</div></div></div></div>';
    box.innerHTML = h;
    setStats("答案对照 · " + paperLabel(p));
    return;
  }

  /* ---- 取数据 + 评分 ---- */
  const rec = loadAnswers()[rk(p.id, q.no)] || null;
  const myText = (rec && rec.text) ? String(rec.text) : "";
  const groups = buildModel(q);
  const mText = modelText(groups);
  cur = { p:p, q:q, modelText:mText };

  const res = scoreEnhance(myText, q);

  /* 句子覆盖分析：我的每句 vs 名师句 */
  const mySents = splitSent(myText);
  const modelSents = splitSent(mText);
  const align = mySents.map(function(s){
    let best = 0;
    for(let j=0;j<modelSents.length;j++){ const r = overlapRatio(s, modelSents[j]); if(r > best) best = r; }
    return { s:s, cov: best >= 0.5, r:best };
  });
  const covered = align.filter(function(a){ return a.cov; }).length;
  const uncovered = align.filter(function(a){ return !a.cov; }).map(function(a){ return a.s; });

  /* ---- 汇总条 ---- */
  h += '<div class="b8-card"><div class="b8-h">评分概览' +
       '<span class="b8-acts"><button class="b8-btn primary" onclick="b8OpenAnswer()">✍️ 打开本题作答</button>' +
       '<button class="b8-btn" onclick="b8CopyModel()">📋 复制名师答案</button></span></div><div class="b8-bd">';
  h += '<div class="b8-sum">' +
       '<span class="b8-sumi"><b>' + res.score + '%</b><i>我的命中率</i></span>' +
       '<span class="b8-sumi"><b>' + res.hitCount + '</b><i>满命中采分点</i></span>' +
       '<span class="b8-sumi"><b>' + res.softHits.length + '</b><i>部分命中</i></span>' +
       '<span class="b8-sumi"><b>' + res.missed.length + '</b><i>遗漏采分点</i></span>' +
       '<span class="b8-sumi"><b>' + res.total + '</b><i>采分点总数</i></span>' +
       '<span class="b8-sumi"><b>' + cn(mText) + '</b><i>名师答案字数</i></span>' +
       '<span class="b8-sumi"><b>' + covered + '/' + mySents.length + '</b><i>我的覆盖句</i></span>' +
       '</div>';
  if(res.reasons.length){
    h += '<div class="b8-pills">失分归因：' +
         res.reasons.map(function(x){ return '<span class="b8-pill mid">' + E(x) + '</span>'; }).join("") + '</div>';
  }
  h += '<div class="b8-tip">提示：「打开本题作答」会调用主站作答弹窗（若已加载）；此处无需跳转即可对照复习。</div>';
  h += '</div></div>';

  /* ---- 双栏：我的作答 / 名师答案 ---- */
  h += '<div class="b8-card" id="b8Cmp"><div class="b8-h">我的作答 · 名师答案对照</div><div class="b8-bd">';
  h += '<div class="b8-cols">';
  h += '<div class="b8-col"><div class="b8-colh">🙋 我的作答' +
       (myText ? ' <span class="b8-mini">' + cn(myText) + ' 字' +
         (rec && typeof rec.score === "number" ? ' · 原评分 ' + rec.score + '%' : '') + '</span>' +
         ' <button class="b8-btn mini" onclick="b8CopyEl(\'b8myAns\')">复制</button>' : '') +
       '</div>';
  h += '<div class="b8-ans" id="b8myAns">' + (myText ? E(myText) : '<span class="b8-muted">（本题还未作答）</span>') + '</div></div>';
  h += '<div class="b8-col"><div class="b8-colh">🎓 名师答案 <span class="b8-mini">' + cn(mText) + ' 字</span></div>';
  h += '<div class="b8-ans b8-model" id="b8modelAns">' + modelHtml(groups) + '</div></div>';
  h += '</div></div></div>';

  /* ---- 采分点对照 ---- */
  h += '<div class="b8-card" id="b8Chk"><div class="b8-h">采分点对照' +
       '<span class="b8-legend"><span class="lg hit">✅ 命中（绿）</span>' +
       '<span class="lg soft">🟡 部分（黄）</span>' +
       '<span class="lg miss">❌ 遗漏（红）</span></span></div><div class="b8-bd">';
  const pts = (q.points || []);
  if(!pts.length){
    h += '<div class="b8-muted">本题未录入采分点，无法逐点对照（可参考右侧名师答案自评）。</div>';
  }else{
    h += '<div class="b8-chk">';
    pts.forEach(function(pt, i){
      const st = ptStatus(pt, res);
      const icon = st === "hit" ? "✅ 命中" : (st === "soft" ? "🟡 部分" : "❌ 遗漏");
      h += '<div class="b8-ck ' + st + '"><span class="b8-icon">' + icon + '</span>' +
           '<span class="b8-cktext">' + E(pt.text || "") + '</span>';
      if(st === "miss"){
        h += '<div class="b8-sugg">建议补充规范表述：' + E(suggestSyn(String(pt.text || ""))) + '</div>';
      }
      h += '</div>';
    });
    h += '</div>';
  }
  h += '</div></div>';

  /* ---- 句子覆盖分析 ---- */
  h += '<div class="b8-card" id="b8Align"><div class="b8-h">句子覆盖分析 <span class="b8-mini">（我的每句与名师答案的字符重叠 ≥ 50% 视为「已覆盖」）</span></div><div class="b8-bd">';
  if(!myText){
    h += '<div class="b8-muted">本题还未作答，可先对照右上「名师答案」与上方「采分点」清单进行学习。</div>';
  }else if(!mySents.length){
    h += '<div class="b8-muted">未能从作答中切分出句子。</div>';
  }else{
    h += '<div class="b8-align">';
    align.forEach(function(a){
      h += '<div class="b8-al ' + (a.cov ? "cov" : "no") + '">' +
           '<span class="b8-alt">' + (a.cov ? "已覆盖" : "未覆盖") + '</span>' +
           '<span class="b8-als">' + E(a.s) + '</span>' +
           '<span class="b8-alr">重叠 ' + Math.round(a.r * 100) + '%</span></div>';
    });
    h += '</div>';
    if(uncovered.length){
      h += '<div class="b8-sect">我的未覆盖要点（名师答案未见强对应，请核对是否偏题或需补充）：</div>';
      h += '<ul class="b8-ul">' + uncovered.slice(0, 20).map(function(s){ return '<li>' + E(s) + '</li>'; }).join("") + '</ul>';
    }else{
      h += '<div class="b8-tip">你的每一句都能在名师答案中找到强对应，方向把握良好。</div>';
    }
  }
  h += '</div></div>';

  h += '</div>';
  box.innerHTML = h;
  setStats("答案对照 · " + paperLabel(p) + " 题" + q.no + " · 命中率 " + res.score + "% · 采分点 " + res.total + " 个");
}

/* ---------------- 视图动作 ---------------- */
function b8PickPaper(v){ sel.pid = v; sel.qno = null; renderCompare(); }
function b8PickQuestion(v){ sel.qno = v; renderCompare(); }
function b8CopyModel(){
  if(!cur.modelText){ b8Flash("本题暂无名师答案可复制"); return; }
  b8Copy(cur.modelText);
}
function b8OpenAnswer(){
  if(cur.p && cur.q && typeof window.openAnswerModal === "function"){
    window.openAnswerModal(cur.p.id, cur.q.no);
  }else{
    b8Flash("主站作答弹窗未加载，请到真题库/省考库对应题目作答");
  }
}
function b8CopyEl(id){
  const el = document.getElementById(id);
  if(!el){ b8Flash("内容不存在"); return; }
  b8Copy(el.innerText || el.textContent || "");
}

/* ---------------- 通用小工具（按契约自带 setStats / sideNav） ---------------- */
function setStats(t){ var el = document.getElementById("stats"); if(el) el.textContent = t; }
function sideNav(title, items){
  var nav = document.getElementById("nav");
  if(!nav) return;
  var h = "<h3>" + E(title) + "</h3>";
  (items || []).forEach(function(it){
    h += '<div class="tlink" onclick="var e=document.getElementById(\'' + it.id + '\');if(e)e.scrollIntoView({behavior:\'smooth\'})"><span>' + E(it.label) + '</span></div>';
  });
  nav.innerHTML = h;
}
function b8Flash(msg){
  var t = document.getElementById("b8Flash");
  if(!t){ t = document.createElement("div"); t.id = "b8Flash"; t.className = "b8-flash"; document.body.appendChild(t); }
  t.textContent = msg;
  t.style.opacity = "1";
  clearTimeout(t._tm);
  t._tm = setTimeout(function(){ t.style.opacity = "0"; }, 1500);
}
function b8Copy(text){
  const t = String(text||"");
  if(!t){ b8Flash("没有可复制的内容"); return; }
  let ok = false;
  try{
    const ta = document.createElement("textarea");
    ta.value = t; ta.setAttribute("readonly","");
    ta.style.position = "fixed"; ta.style.left = "-9999px"; ta.style.top = "0";
    document.body.appendChild(ta);
    ta.select(); ta.setSelectionRange(0, t.length);
    ok = document.execCommand("copy");
    document.body.removeChild(ta);
  }catch(e){ ok = false; }
  if(ok){ b8Flash("已复制到剪贴板"); return; }
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(t).then(function(){ b8Flash("已复制到剪贴板"); },
                                          function(){ b8Flash("复制失败，请手动选中复制"); });
    return;
  }
  b8Flash("复制失败，请手动选中复制");
}

/* =====================================================================
   暴露入口（供导航路由 / onclick 调用）
   ===================================================================== */
window.scoreEnhance  = scoreEnhance;
window.renderCompare = renderCompare;
window.b8OpenCompare  = function(pid, qno){
  try{
    if(typeof state !== "undefined" && state && state.scope !== undefined) state.scope = "答案对照";
    sel.pid = pid; sel.qno = Number(qno);
    if(typeof render === "function") render();
  }catch(e){ console.warn("打开答案对照失败", e); }
};
window.b8PickPaper    = b8PickPaper;
window.b8PickQuestion = b8PickQuestion;
window.b8CopyModel    = b8CopyModel;
window.b8OpenAnswer   = b8OpenAnswer;
window.b8CopyEl       = b8CopyEl;
window.b8Copy         = b8Copy;

})();
