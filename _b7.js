/* =====================================================================
   第七批：AI 三视角教练（调用你自己的 OpenAI 兼容大模型）  (_b7.js)
   依赖：全局 DATA / state / render() / esc() / hi()（由主站提供）
   存储：localStorage —— 与主站「深度批改」共用同一把配置钥匙
     shenlun_llm_cfg    LLM 配置 {base,key,model}（与主站共享）
     shenlun_aiq_v1     我的 AI 题库 [{id,type,theme,stem,points:[],answer,ts}]
     shenlun_aiplan_v1  个性化派单 {ts, plan}
     只读引用：shenlun_answers_v2（现有作答，绝不写入）
   全程纯前端离线；请求直连你配置的厂商，不经任何第三方，Key 仅存本机。
   ===================================================================== */
(function(){
"use strict";

/* ---------------- 常量 ---------------- */
const LLM_KEY   = "shenlun_llm_cfg";     /* 与主站共用 */
const AIQ_KEY   = "shenlun_aiq_v1";      /* 我的 AI 题库 */
const APLAN_KEY = "shenlun_aiplan_v1";   /* 个性化派单 */
const ANS_KEY   = "shenlun_answers_v2";  /* 只读 */
const TYPES = ["概括归纳","综合分析","提出对策","贯彻执行","文章写作"];

/* 免费 / 低成本 OpenAI 兼容 API 预设（国内用户优先推荐硅基流动） */
const PRESETS = {
  custom: { name: "✏️ 自定义", base: "", model: "", help: "手动填写下方接口地址、Key 与模型名。" },
  siliconflow: { name: "🇨🇳 硅基流动（推荐 · 国内直连）", base: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-7B-Instruct", help: "① 打开 https://cloud.siliconflow.cn 注册；② 控制台 → API 密钥 → 新建 Key；③ 新用户送 2000 万 Token，9B 以下模型永久免费。" },
  groq: { name: "🚀 Groq（免费 · 海外）", base: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", help: "① 打开 https://console.groq.com 注册；② 创建 API Key；③ 免费 tier：大模型 30 req/min / 1000 req/day，小模型最高 14400 req/day。国内访问可能需要梯子。" },
  gemini: { name: "🔮 Google Gemini（免费 · 海外）", base: "https://generativelanguage.googleapis.com/v1beta/openai/", model: "gemini-2.0-flash", help: "① 打开 https://aistudio.google.com；② 获取 API Key；③ 免费 tier：1500 req/day。国内访问可能需要梯子。" },
  ollama: { name: "💻 本地 Ollama（完全免费 · 需本机运行）", base: "http://localhost:11434/v1", model: "qwen2.5", help: "① 安装 Ollama；② 命令行执行 ollama run qwen2.5；③ 用 OLLAMA_ORIGINS=* ollama serve 启动以允许浏览器跨域。" }
};

/* ---------------- 存储层（读写失败一律降级，绝不抛出） ---------------- */
function jload(k, d){
  try{ const v = JSON.parse(localStorage.getItem(k)); return (v===null||v===undefined)?d:v; }
  catch(e){ return d; }
}
function jsave(k, o){
  try{ localStorage.setItem(k, JSON.stringify(o)); return true; }
  catch(e){ console.warn("存储失败", e); return false; }
}
function loadLLM(){ const o = jload(LLM_KEY, {}); return (o && typeof o==="object") ? o : {}; }
function saveLLM(o){ return jsave(LLM_KEY, o); }
function loadAIQ(){ const a = jload(AIQ_KEY, []); return Array.isArray(a) ? a : []; }
function saveAIQ(a){ return jsave(AIQ_KEY, a); }
function loadPlan(){ const o = jload(APLAN_KEY, null); return (o && typeof o==="object") ? o : null; }
function savePlan(o){ return jsave(APLAN_KEY, o); }
function loadAns(){ const o = jload(ANS_KEY, {}); return (o && typeof o==="object") ? o : {}; }

/* ---------------- 通用小工具 ---------------- */
function E(s){
  const v = (s===null||s===undefined) ? "" : String(s);
  if(typeof esc === "function") return esc(v);
  return v.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function nl2br(s){ return E(s).replace(/\n/g,"<br>"); }
function el(id){ return document.getElementById(id); }
function val(id){ const e = el(id); return e ? e.value : ""; }
function uid(pfx){ return (pfx||"") + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function fmtTs(ts){
  const d = new Date(ts||Date.now());
  const p = n => String(n).padStart(2,"0");
  return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+" "+p(d.getHours())+":"+p(d.getMinutes());
}
/* 题型归类（与智能组卷保持一致） */
function typeOf(qt){
  qt = qt || "";
  if(/概括|归纳/.test(qt)) return "概括归纳";
  if(/分析/.test(qt)) return "综合分析";
  if(/对策|建议|措施|做法/.test(qt)) return "提出对策";
  if(/公文|应用文|贯彻|信|通知|报告|请示|函|稿|简报|倡议|方案|讲话/.test(qt)) return "贯彻执行";
  if(/作文|议论|策论|文章/.test(qt)) return "文章写作";
  return "其他";
}

/* setStats / sideNav（按契约自备） */
function setStats(t){ var el=document.getElementById("stats"); if(el) el.textContent=t; }
function sideNav(title,items){
  var nav=document.getElementById("nav"); if(!nav) return;
  var h="<h3>"+E(title)+"</h3>";
  (items||[]).forEach(function(it){
    h+='<div class="tlink" onclick="var e=document.getElementById(\''+it.id+'\');if(e)e.scrollIntoView({behavior:\'smooth\'})"><span>'+E(it.label)+'</span></div>';
  });
  nav.innerHTML=h;
}
/* 轻量 toast */
function b7flash(msg){
  let t = el("b7Flash");
  if(!t){ t = document.createElement("div"); t.id="b7Flash"; t.className="b7-flash"; document.body.appendChild(t); }
  t.textContent = msg;
  t.style.opacity = "1";
  clearTimeout(t._tm);
  t._tm = setTimeout(function(){ t.style.opacity="0"; }, 1500);
}

/* ---------------- LLM 配置 / 调用 ---------------- */
function cfgValid(c){ c = c || loadLLM(); return (c.base && c.key && c.model) ? c : null; }

/* 自备配置 UI：弹窗 + 免费 API 预设，小白也能一键填对 */
function b7Config(){
  const c = loadLLM();
  b7CloseCfg();
  let opts = '';
  Object.keys(PRESETS).forEach(function(k){ opts += '<option value="' + k + '">' + E(PRESETS[k].name) + '</option>'; });
  const html =
    '<div class="b7-modal-overlay" id="b7cfgModal" onclick="if(event.target===this)b7CloseCfg()">' +
      '<div class="b7-modal">' +
        '<div class="b7-modalh">配置 LLM（深度批改 / AI 教练）</div>' +
        '<div class="b7-modalbody">' +
          '<label class="b7-modal-lbl">选择免费 API 预设</label>' +
          '<select class="b7-sel b7-selwide" id="b7cfgPreset" onchange="b7PresetChange()">' + opts + '</select>' +
          '<div class="b7-cfghint" id="b7cfgHint"></div>' +
          '<label class="b7-modal-lbl">接口地址（base_url）</label>' +
          '<input class="b7-in" id="b7cfgBase" value="' + E(c.base || '') + '" placeholder="https://api.siliconflow.cn/v1">' +
          '<label class="b7-modal-lbl">API Key（仅存本机浏览器，请求直连厂商）</label>' +
          '<input class="b7-in" id="b7cfgKey" value="' + E(c.key || '') + '" placeholder="sk-...">' +
          '<label class="b7-modal-lbl">模型名</label>' +
          '<input class="b7-in" id="b7cfgModel" value="' + E(c.model || '') + '" placeholder="qwen-max">' +
        '</div>' +
        '<div class="b7-modalft">' +
          '<button class="b7-btn b7-primary" onclick="b7SaveCfg()">保存配置</button>' +
          '<button class="b7-btn" onclick="b7CloseCfg()">取消</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.insertAdjacentHTML('beforeend', html);
  b7PresetChange();
}
function b7PresetChange(){
  const k = val('b7cfgPreset') || 'custom';
  const p = PRESETS[k];
  const hint = el('b7cfgHint');
  if(hint) hint.textContent = p.help || '';
  if(k !== 'custom'){
    const b = el('b7cfgBase'); if(b) b.value = p.base;
    const m = el('b7cfgModel'); if(m) m.value = p.model;
  }
}
function b7SaveCfg(){
  const cfg = {
    base: val('b7cfgBase').trim().replace(/\/$/,''),
    key: val('b7cfgKey').trim(),
    model: val('b7cfgModel').trim()
  };
  if(!cfg.base || !cfg.key || !cfg.model){ b7flash("请填写完整三项"); return; }
  saveLLM(cfg);
  b7CloseCfg();
  b7flash("已保存 LLM 配置（仅存本机）");
  renderAICoach();   /* 刷新：去掉各视图的「请先配置」提示 */
}
function b7CloseCfg(){ const m = el('b7cfgModal'); if(m) m.remove(); }

/* 统一调用：直连厂商 /chat/completions，返回文本；失败抛出可读错误 */
async function callLLM(sys, user, maxTokens){
  const cfg = cfgValid();
  if(!cfg) throw new Error("NO_CFG");
  const resp = await fetch(cfg.base + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type":"application/json", "Authorization":"Bearer "+cfg.key },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{role:"system",content:sys},{role:"user",content:user}],
      temperature: 0.3,
      max_tokens: maxTokens || 1600
    })
  });
  if(!resp.ok) throw new Error("HTTP "+resp.status+" "+resp.statusText);
  const data = await resp.json();
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "（模型未返回内容）";
}

/* 从模型输出里稳健地抽 JSON（容忍 ```json 围栏与前后废话） */
function extractJSON(txt){
  if(!txt) return null;
  let s = String(txt).replace(/```json/gi, "```");
  const fence = s.match(/```([\s\S]*?)```/);
  if(fence) s = fence[1];
  const i = s.indexOf("{"), j = s.lastIndexOf("}");
  if(i>=0 && j>i){ try{ return JSON.parse(s.slice(i, j+1)); }catch(e){} }
  const k = s.indexOf("["), l = s.lastIndexOf("]");
  if(k>=0 && l>k){ try{ return JSON.parse(s.slice(k, l+1)); }catch(e){} }
  return null;
}

/* ---------------- 复用的状态片段 ---------------- */
function loadingHtml(txt){ return '<div class="b7-loading">⏳ '+E(txt||"正在调用 LLM…（请求直连厂商，不经第三方）")+'</div>'; }
function errHtml(e){
  const m = (e && e.message) || "未知错误";
  if(m === "NO_CFG") return setupHtml();
  return '<div class="b7-err">⚠ 调用失败：'+E(m)+
    '<div class="b7-errhint">请检查：① 接口地址 / Key / 模型是否正确；② 该厂商是否允许浏览器跨域（CORS）——'+
    'OpenAI / DeepSeek / 通义 均支持浏览器直连；本地 Ollama 需自行开启 CORS（OLLAMA_ORIGINS=*）。</div></div>';
}
function setupHtml(){
  return '<div class="b7-setup">🔑 尚未配置你的大模型接口。'+
    '<button class="b7-btn b7-primary b7-mini" onclick="b7Config()">配置 LLM</button>'+
    '<div class="b7-errhint">请求直连厂商，不经第三方，Key 仅存本机浏览器。</div></div>';
}
function warnHtml(t){ return '<div class="b7-warn">'+E(t)+'</div>'; }

/* =====================================================================
   视图一：AI 出题
   ===================================================================== */
let lastGen = null;   /* 最近一次生成的模拟题，供「保存到我的题库」引用 */

function allThemes(){
  const s = [];
  (typeof DATA!=="undefined" ? (DATA.papers||[]) : []).forEach(function(p){
    (p.themes||[]).forEach(function(t){ if(t && s.indexOf(t)<0) s.push(t); });
  });
  return s;
}

function genSectionHtml(hasCfg){
  const themes = allThemes();
  const typeOpts = TYPES.map(function(t){ return '<option value="'+E(t)+'">'+E(t)+'</option>'; }).join("");
  const themeOpts = ['<option value="">— 从题库母题快速选择 —</option>']
    .concat(themes.map(function(t){ return '<option value="'+E(t)+'">'+E(t)+'</option>'; })).join("");
  const first = themes[0] || "";
  let h = '<div class="b7-card" id="b7Gen">';
  h += '<div class="b7-cardh">① AI 出题 <span class="b7-sub">选题型 + 母题/关键词，一键生成模拟题（题干 + 采分点 + 参考答案）</span></div>';
  h += '<div class="b7-form">';
  h += '<label class="b7-fl">题型 <select class="b7-sel" id="b7GenType">'+typeOpts+'</select></label>';
  h += '<label class="b7-fl">母题快选 <select class="b7-sel" onchange="b7PickTheme(this.value)">'+themeOpts+'</select></label>';
  h += '<input class="b7-in" id="b7GenTheme" value="'+E(first)+'" placeholder="母题 / 关键词，如 基层治理、人才、数字乡村">';
  h += '<button class="b7-btn b7-primary" id="b7GenBtn" onclick="b7Gen()">🤖 生成模拟题</button>';
  h += '</div>';
  h += '<div class="b7-box" id="b7GenBox">'+(hasCfg ? '<div class="b7-hint">填写题型与母题后点「生成模拟题」。</div>' : setupHtml())+'</div>';
  h += '<div class="b7-subh">📚 我的 AI 题库</div><div class="b7-list" id="b7GenList"></div>';
  h += '</div>';
  return h;
}

function b7PickTheme(v){ const i = el("b7GenTheme"); if(i && v) i.value = v; }

function genCardHtml(g){
  let h = '<div class="b7-qcard">';
  h += '<div class="b7-qmeta"><span class="b7-tag ty">'+E(g.type)+'</span><span class="b7-tag th">'+E(g.theme)+'</span></div>';
  h += '<div class="b7-qlab">题干</div><div class="b7-qstem">'+nl2br(g.stem)+'</div>';
  if(g.points && g.points.length){
    h += '<div class="b7-qlab">采分点（'+g.points.length+'）</div><ol class="b7-points">'+
         g.points.map(function(p){ return '<li>'+nl2br(typeof p==="string"?p:(p.text||""))+'</li>'; }).join("")+'</ol>';
  }
  if(g.answer){
    h += '<details class="b7-det"><summary>参考答案（点击展开）</summary><div class="b7-answer">'+nl2br(g.answer)+'</div></details>';
  }
  h += '<div class="b7-acts"><button class="b7-btn b7-primary" onclick="b7SaveQ()">💾 保存到我的题库</button>'+
       '<button class="b7-btn" onclick="b7GenAgain()">🔄 再做一道</button></div>';
  h += '</div>';
  return h;
}

async function b7Gen(){
  const cfg = cfgValid();
  const box = el("b7GenBox"), btn = el("b7GenBtn");
  if(!cfg){ if(box) box.innerHTML = setupHtml(); return; }
  const type = val("b7GenType") || TYPES[0];
  const theme = val("b7GenTheme").trim();
  if(!theme){ if(box) box.innerHTML = warnHtml("请先填写母题 / 关键词。"); return; }
  if(btn) btn.disabled = true;
  if(box) box.innerHTML = loadingHtml("正在命制【"+type+"】模拟题…");
  try{
    const sys = "你是命制国考/省考申论真题的资深命题专家。请根据要求命制一道贴近真实命题的申论模拟题。"+
      "严格只输出 JSON，不要输出任何多余文字，格式：{\"stem\":\"完整题干（含材料背景与作答要求、字数限制）\",\"points\":[\"采分点1\",\"采分点2\",\"采分点3\"],\"answer\":\"一份高分参考答案\"}，其中 points 为 3-5 个。";
    const user = "题型："+type+"\n母题/关键词："+theme+"\n请命制一道该题型的申论模拟题。";
    const txt = await callLLM(sys, user, 1600);
    const obj = extractJSON(txt);
    let stem, points, answer;
    if(obj && obj.stem){
      stem = obj.stem;
      points = Array.isArray(obj.points) ? obj.points.map(function(p){ return typeof p==="string"?p:(p&&p.text)||""; }).filter(Boolean) : [];
      answer = obj.answer || "";
    }else{
      stem = txt; points = []; answer = "";   /* 兜底：模型未给规范 JSON 时整体作为题干展示 */
    }
    lastGen = { type:type, theme:theme, stem:stem, points:points, answer:answer, ts:Date.now() };
    if(box) box.innerHTML = genCardHtml(lastGen);
  }catch(e){
    if(box) box.innerHTML = errHtml(e);
  }finally{
    if(btn) btn.disabled = false;
  }
}
function b7GenAgain(){
  lastGen = null;
  const box = el("b7GenBox");
  if(box) box.innerHTML = '<div class="b7-hint">已清空，换个母题或题型再来一道。</div>';
}
function b7SaveQ(){
  if(!lastGen){ b7flash("没有可保存的题目"); return; }
  const arr = loadAIQ();
  arr.unshift(Object.assign({ id: uid("aq") }, lastGen));
  if(!saveAIQ(arr)){ alert("保存失败：浏览器存储空间可能已满。"); return; }
  b7flash("已保存到我的题库（共 "+arr.length+" 道）");
  renderGenList();
}
function b7DelQ(id){
  const arr = loadAIQ();
  const it = arr.filter(function(x){ return x.id===id; })[0];
  if(!it) return;
  if(!confirm("确定删除这道 AI 题？此操作不可恢复。")) return;
  saveAIQ(arr.filter(function(x){ return x.id!==id; }));
  b7flash("已删除");
  renderGenList();
}
function renderGenList(){
  const box = el("b7GenList");
  if(!box) return;
  const arr = loadAIQ();
  if(!arr.length){ box.innerHTML = '<div class="b7-hint">题库为空。生成题目后点「保存到我的题库」即可留存。</div>'; return; }
  box.innerHTML = arr.map(function(q){
    return '<details class="b7-item"><summary>'+
      '<span class="b7-tag ty">'+E(q.type)+'</span><span class="b7-tag th">'+E(q.theme)+'</span>'+
      '<span class="b7-itsum">'+E(String(q.stem||"").slice(0,40))+'…</span>'+
      '<span class="b7-itts">'+E(fmtTs(q.ts))+'</span></summary>'+
      '<div class="b7-itbody">'+
      '<div class="b7-qlab">题干</div><div class="b7-qstem">'+nl2br(q.stem)+'</div>'+
      ((q.points&&q.points.length)?('<div class="b7-qlab">采分点</div><ol class="b7-points">'+q.points.map(function(p){return '<li>'+nl2br(typeof p==="string"?p:(p.text||""))+'</li>';}).join("")+'</ol>'):'')+
      (q.answer?('<details class="b7-det"><summary>参考答案</summary><div class="b7-answer">'+nl2br(q.answer)+'</div></details>'):'')+
      '<div class="b7-acts"><button class="b7-btn b7-danger b7-mini" onclick="b7DelQ(\''+q.id+'\')">删除</button></div>'+
      '</div></details>';
  }).join("");
}

/* =====================================================================
   视图二：选中即讲解
   ===================================================================== */
let EXPQ = [];   /* 扁平题目缓存：[{p,q}]，select 用下标引用 */

function buildExpQ(){
  const out = [];
  (typeof DATA!=="undefined" ? (DATA.papers||[]) : []).forEach(function(p){
    (p.questions||[]).forEach(function(q){ out.push({p:p, q:q}); });
  });
  return out;
}
function expLabel(item){
  const p = item.p, q = item.q;
  return (p.year||"") + " " + (p.province||"") + " 题" + q.no + "（" + (q.qtype||typeOf(q.qtype)) + "）";
}
function explainSectionHtml(hasCfg){
  EXPQ = buildExpQ();
  const opts = EXPQ.length
    ? EXPQ.map(function(it,i){ return '<option value="'+i+'">'+E(expLabel(it))+'</option>'; }).join("")
    : '<option value="">题库为空</option>';
  let h = '<div class="b7-card" id="b7Explain">';
  h += '<div class="b7-cardh">② 选中即讲解 <span class="b7-sub">挑一道真题，让 AI 拆解审题、思路、采分逻辑与陷阱（教学，不批改你的答案）</span></div>';
  h += '<div class="b7-form">';
  h += '<select class="b7-sel b7-selwide" id="b7ExpSel">'+opts+'</select>';
  h += '<button class="b7-btn b7-primary" id="b7ExpBtn" onclick="b7Explain()">让 AI 讲解</button>';
  h += '</div>';
  h += '<div class="b7-box" id="b7ExplainBox">'+(hasCfg ? '<div class="b7-hint">选择一道真题后点「让 AI 讲解」。</div>' : setupHtml())+'</div>';
  h += '</div>';
  return h;
}
function qToPrompt(q){
  const stem = (q.stem||[]).join("\n");
  const points = (q.points||[]).map(function(p,i){ return (i+1)+". "+(p.text||""); }).join("\n");
  const orgs = (q.orgs||[]).map(function(o){ return "【"+o.name+"】\n"+(o.lines||[]).join("\n"); }).join("\n\n");
  return "【题型】"+(q.qtype||"未知")+"\n【题干】\n"+stem+
    "\n\n【采分点（满分参照）】\n"+(points||"（无）")+
    "\n\n【参考机构答案】\n"+(orgs||"（无）");
}
async function b7Explain(){
  const cfg = cfgValid();
  const box = el("b7ExplainBox"), btn = el("b7ExpBtn");
  if(!cfg){ if(box) box.innerHTML = setupHtml(); return; }
  const idx = parseInt(val("b7ExpSel"), 10);
  const item = EXPQ[idx];
  if(!item){ if(box) box.innerHTML = warnHtml("请先选择一道题目。"); return; }
  if(btn) btn.disabled = true;
  if(box) box.innerHTML = loadingHtml("正在生成教学讲解…");
  try{
    const sys = "你是资深申论名师，面向备考考生做教学讲解（不是批改考生答案）。请针对给定真题，严格分为 5 个部分输出，用中文、条理清晰、可操作：\n"+
      "① 审题拆解（题型、对象、范围、字数、隐含要求）\n② 答题思路（从哪找点、怎么归纳、怎么组织成答案）\n"+
      "③ 采分点为什么这么设（每个/每类采分点背后的命题意图）\n④ 易错陷阱（考生常见失分点）\n⑤ 一句口诀（便于记忆的一句话方法论）";
    const user = qToPrompt(item.q);
    const txt = await callLLM(sys, user, 1600);
    if(box) box.innerHTML = '<div class="b7-explhead">🎓 '+E(expLabel(item))+' · AI 讲解</div><div class="b7-body">'+nl2br(txt)+'</div>';
  }catch(e){
    if(box) box.innerHTML = errHtml(e);
  }finally{
    if(btn) btn.disabled = false;
  }
}

/* =====================================================================
   视图三：学情派单（弱项自算 + 7 天派单）
   ===================================================================== */
function ratePct(r){
  if(typeof r.rate === "number") return r.rate<=1 ? Math.round(r.rate*100) : Math.round(r.rate);
  if(typeof r.score === "number" && typeof r.total === "number" && r.total>0) return Math.round(r.score/r.total*100);
  return null;
}
function computeWeak(){
  const ans = loadAns();
  const agg = {}, reasonFreq = {};
  let answered = 0;
  Object.keys(ans).forEach(function(k){
    const r = ans[k];
    if(!r) return;
    const pct = ratePct(r);
    if(pct===null) return;
    const t = typeOf(r.qtype||"");
    answered++;
    const a = agg[t] || (agg[t] = {sum:0, n:0, reasons:{}});
    a.sum += pct; a.n++;
    (r.reasons||[]).forEach(function(rs){
      rs = String(rs||"").trim(); if(!rs) return;
      a.reasons[rs] = (a.reasons[rs]||0)+1;
      reasonFreq[rs] = (reasonFreq[rs]||0)+1;
    });
  });
  const types = Object.keys(agg).map(function(t){
    return { type:t, rate:Math.round(agg[t].sum/agg[t].n), n:agg[t].n, reasons:agg[t].reasons };
  }).sort(function(x,y){ return x.rate - y.rate; });
  const topReasons = Object.keys(reasonFreq)
    .sort(function(a,b){ return reasonFreq[b]-reasonFreq[a]; })
    .slice(0,5).map(function(k){ return {reason:k, n:reasonFreq[k]}; });
  return { types:types, weak:types.slice(0,3), topReasons:topReasons, answered:answered, hasData:answered>0 };
}
/* 弱项摘要文本（既用于页面展示，也作为派单 prompt 输入） */
function weakSummaryText(w){
  if(!w.hasData) return "考生暂无历史作答记录，请按零基础/入门定位，给出通用的 7 天申论入门派单。";
  const parts = w.weak.map(function(t){ return t.type+" "+t.rate+"%（"+t.n+"题）"; });
  const rs = w.topReasons.map(function(x){ return x.reason+"×"+x.n; });
  return "考生弱项题型："+parts.join("、")+"。高频失分根因："+(rs.length?rs.join("、"):"暂无记录")+"。请据此制定针对性 7 天练习派单。";
}
function dispatchSectionHtml(hasCfg){
  const w = computeWeak();
  let sum;
  if(!w.hasData){
    sum = '<div class="b7-weak b7-warn">还没有作答记录，无法识别弱项 —— 将为你生成通用入门派单。先去「真题库」做几道题，学情会更准。</div>';
  }else{
    let chips = w.weak.map(function(t){
      const cls = t.rate>=70 ? "up" : "down";  /* 得分率：高=红(强)、低=绿(弱)，遵循本站升红降绿惯例 */
      return '<span class="b7-wtag '+cls+'">'+E(t.type)+' <b>'+t.rate+'%</b><i>'+t.n+'题</i></span>';
    }).join("");
    let rs = w.topReasons.length
      ? '<div class="b7-wreasons">高频失分根因：'+w.topReasons.map(function(x){ return '<span class="b7-rtag">'+E(x.reason)+' ×'+x.n+'</span>'; }).join("")+'</div>'
      : '';
    sum = '<div class="b7-weak">你的弱项：'+chips+'<span class="b7-wmore">（已作答 '+w.answered+' 题 · 得分率高=红 / 低=绿）</span></div>'+rs;
  }
  let h = '<div class="b7-card" id="b7Dispatch">';
  h += '<div class="b7-cardh">③ 学情派单 <span class="b7-sub">按你的作答自动算弱项，AI 派出可勾选的 7 天练习清单</span></div>';
  h += sum;
  h += '<div class="b7-acts"><button class="b7-btn b7-primary" id="b7DisBtn" onclick="b7Dispatch()">📋 生成个性化练习清单</button></div>';
  h += '<div class="b7-box" id="b7DispatchBox">'+(hasCfg ? planBoxHtml(loadPlan()) : setupHtml())+'</div>';
  h += '</div>';
  return h;
}
function normalizePlan(obj, txt){
  let days = [];
  if(obj && Array.isArray(obj.days) && obj.days.length){
    days = obj.days.map(function(d){
      const title = [ (d.day||""), (d.type||""), (d.count?("×"+d.count+"道"):"") ].filter(Boolean).join(" · ");
      const detail = [ (d.material?("素材方向："+d.material):""), (d.note||"") ].filter(Boolean).join("　");
      return { title: title || "练习", detail: detail, done:false };
    });
  }else{
    days = String(txt||"").split(/\n+/).map(function(s){ return s.replace(/^[-*\d.、\s]+/, "").trim(); })
      .filter(Boolean).map(function(s){ return { title:s, detail:"", done:false }; });
  }
  return days;
}
function planBoxHtml(store){
  if(!store || !store.plan || !store.plan.days || !store.plan.days.length){
    return '<div class="b7-hint">点「生成个性化练习清单」，AI 会按你的弱项派出 7 天任务，可逐项打勾。</div>';
  }
  const days = store.plan.days;
  const done = days.filter(function(d){ return d.done; }).length;
  let h = '<div class="b7-planhead">📋 我的 7 天派单 <span class="b7-sub">'+E(fmtTs(store.ts))+' · 已完成 '+done+'/'+days.length+'</span>'+
          '<button class="b7-btn b7-mini" onclick="b7Dispatch()">🔄 重新生成</button></div>';
  h += '<div class="b7-plan">';
  days.forEach(function(d, i){
    h += '<label class="b7-day'+(d.done?" done":"")+'"><input type="checkbox" '+(d.done?"checked":"")+' onclick="b7PlanToggle('+i+')">'+
         '<span class="b7-dtitle">'+E(d.title)+'</span>'+
         (d.detail?('<span class="b7-ddetail">'+E(d.detail)+'</span>'):'')+'</label>';
  });
  h += '</div>';
  return h;
}
async function b7Dispatch(){
  const cfg = cfgValid();
  const box = el("b7DispatchBox"), btn = el("b7DisBtn");
  if(!cfg){ if(box) box.innerHTML = setupHtml(); return; }
  const w = computeWeak();
  const summary = weakSummaryText(w);
  if(btn) btn.disabled = true;
  if(box) box.innerHTML = loadingHtml("正在按你的学情生成 7 天派单…");
  try{
    const sys = "你是申论备考规划师。请根据考生学情，制定一份为期 7 天的个性化练习派单，循序渐进、可执行。"+
      "严格只输出 JSON，不要多余文字，格式：{\"days\":[{\"day\":\"第1天\",\"type\":\"题型\",\"count\":2,\"material\":\"素材/主题方向\",\"note\":\"当天具体要求\"}]}，共 7 天。";
    const txt = await callLLM(sys, summary, 1600);
    const obj = extractJSON(txt);
    const days = normalizePlan(obj, txt);
    if(!days.length){ if(box) box.innerHTML = warnHtml("模型未返回可用派单，请重试。"); return; }
    const store = { ts: Date.now(), plan: { summary: summary, days: days } };
    savePlan(store);
    if(box) box.innerHTML = planBoxHtml(store);
    b7flash("已生成 7 天派单");
  }catch(e){
    if(box) box.innerHTML = errHtml(e);
  }finally{
    if(btn) btn.disabled = false;
  }
}
function b7PlanToggle(i){
  const store = loadPlan();
  if(!store || !store.plan || !store.plan.days || !store.plan.days[i]) return;
  store.plan.days[i].done = !store.plan.days[i].done;
  savePlan(store);
  const box = el("b7DispatchBox");
  if(box) box.innerHTML = planBoxHtml(store);
}

/* =====================================================================
   总入口
   ===================================================================== */
function renderAICoach(){
  const box = document.getElementById("content");
  if(!box) return;
  const hasCfg = !!cfgValid();
  const cfg = loadLLM();

  sideNav("AI 三视角教练", [
    {id:"b7Gen",      label:"① AI 出题"},
    {id:"b7Explain",  label:"② 选中即讲解"},
    {id:"b7Dispatch", label:"③ 学情派单"}
  ]);
  setStats("AI 三视角教练 · " + (hasCfg ? ("已配置模型 "+ (cfg.model||"") ) : "未配置 LLM") + " · 请求直连厂商，Key 仅存本机");

  let h = '<div class="b7-wrap">';
  h += '<h2 class="b7-h1">🤖 AI 三视角教练</h2>';
  h += '<div class="b7-note">出题官 · 讲解员 · 教务派单员，三视角调用<b>你自己配置的</b>大模型（OpenAI 兼容）。'+
       '<b>请求直连厂商，不经任何第三方，Key 仅存本机浏览器。</b>'+
       '当前：'+(hasCfg ? ('已配置 <code>'+E(cfg.base)+'</code> · <code>'+E(cfg.model)+'</code>') : '<span class="b7-nocfg">未配置</span>')+
       ' <button class="b7-btn b7-mini" onclick="b7Config()">配置 LLM</button></div>';
  h += genSectionHtml(hasCfg);
  h += explainSectionHtml(hasCfg);
  h += dispatchSectionHtml(hasCfg);
  h += '</div>';
  box.innerHTML = h;

  renderGenList();
}

/* ---------------- 暴露入口（供 onclick / 主程序路由调用） ---------------- */
window.renderAICoach = renderAICoach;
window.b7Config      = b7Config;
window.b7PresetChange= b7PresetChange;
window.b7SaveCfg     = b7SaveCfg;
window.b7CloseCfg    = b7CloseCfg;
window.b7Gen         = b7Gen;
window.b7GenAgain    = b7GenAgain;
window.b7SaveQ       = b7SaveQ;
window.b7DelQ        = b7DelQ;
window.b7PickTheme   = b7PickTheme;
window.b7Explain     = b7Explain;
window.b7Dispatch    = b7Dispatch;
window.b7PlanToggle  = b7PlanToggle;

})();
