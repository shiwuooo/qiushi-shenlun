/* =====================================================================
   第九批：专用搜题页（跨国考/省考全库聚合 + 题型/年份/机构筛选 + 一键作答/对照）  (_b9.js)
   依赖：全局 DATA / state / render() / esc() / hi()（由主站提供）
   特性：纯前端、离线可用、只读查询、不写任何 localStorage
   说明：
     - 主站 qBlob 不在全局契约内，本模块自带 b9Blob(q) 做全文拼接
     - openAnswerModal / addToWrongBook / b8OpenCompare 为主站暴露的全局函数，可直接调用
     - 本地筛选状态 ss 独立于主站 state.q，避免与顶部全局检索框冲突
   ===================================================================== */
(function(){
  "use strict";

  // 本地筛选状态（不污染主站 state）
  const ss = { q:"", qtype:"全部", year:"全部", org:"全部", prov:"全部" };
  let _deb = null;

  // 安全取主站全局函数
  function G(fn){ return (typeof window!=="undefined" && typeof window[fn]==="function") ? window[fn] : null; }
  function esc2(s){ const f=G("esc"); return f ? f(s) : String(s==null?"":s); }
  function hi2(t,terms){ const f=G("hi"); return f ? f(t,terms) : esc2(t); }
  function provLabel(p){ return (!p || p==="国考") ? (p||"") : (p + "省考"); }

  // 把一道题拼成可检索文本（题型/题干/材料/各机构答案/采分点/复盘/AI）
  function b9Blob(q){
    try{
      return [
        q.qtype||"",
        (q.stem||[]).join(" "),
        (q.material||[]).join(" "),
        (q.orgs||[]).map(o=>(o.name||"")+" "+(o.lines||[]).join(" ")).join(" "),
        (q.points||[]).map(p=>p.text||"").join(" "),
        (q.review||[]).join(" "),
        (q.ai||[]).join(" ")
      ].join(" ").toLowerCase();
    }catch(e){ return ""; }
  }

  function uniq(a){ return Array.from(new Set(a)).filter(Boolean); }

  // 跨库聚合：国考 + 省考 全部题目
  function allQuestions(){
    const out=[];
    const DATA = (typeof window!=="undefined") ? window.DATA : null;
    (DATA && DATA.papers || []).forEach(p=>{
      (p.questions||[]).forEach(q=>{ out.push({p,q}); });
    });
    return out;
  }

  function runFilter(){
    const terms = ss.q ? ss.q.toLowerCase().split(/\s+/).filter(Boolean) : [];
    return allQuestions().filter(({p,q})=>{
      if(ss.prov!=="全部" && p.province!==ss.prov) return false;
      if(ss.year!=="全部" && String(p.year)!==ss.year) return false;
      if(ss.qtype!=="全部" && (q.qtype||"")!==ss.qtype) return false;
      if(ss.org!=="全部"){
        const hit = (q.orgs||[]).some(o=>(o.name||"")===ss.org);
        if(!hit) return false;
      }
      if(terms.length){
        const blob=b9Blob(q);
        if(!terms.every(t=>blob.indexOf(t)>=0)) return false;
      }
      return true;
    });
  }

  function chip(field,label,vals,cur){
    let h='<div class="b9-chips"><span class="b9-clabel">'+esc2(label)+'</span>';
    h+='<span class="b9-chip '+(cur==="全部"?"on":"")+'" onclick="b9Filter(\''+field+'\',\'全部\')">全部</span>';
    vals.forEach(v=>{
      h+='<span class="b9-chip '+(cur===v?"on":"")+'" onclick="b9Filter(\''+field+'\',\''+esc2(v)+'\')">'+esc2(v)+'</span>';
    });
    h+='</div>';
    return h;
  }

  function select(field,label,vals,cur){
    let h='<label class="b9-sel"><span>'+esc2(label)+'</span><select onchange="b9Filter(\''+field+'\',this.value)">';
    vals.forEach(v=>{ h+='<option value="'+esc2(v)+'"'+(cur===v?" selected":"")+'>'+esc2(v)+'</option>'; });
    h+='</select></label>';
    return h;
  }

  function buildResults(items,terms){
    if(!items.length){
      return '<div class="empty">没有匹配的题，换个关键词或放宽筛选</div>';
    }
    let h='<div class="b9-list">';
    items.forEach(({p,q})=>{
      const stem=(q.stem||[]).join(" ");
      const ex = stem.length>140 ? stem.slice(0,140)+"…" : stem;
      h+='<div class="b9-card">';
      h+='<div class="b9-ch">'+esc2(p.year)+' '+esc2(provLabel(p.province))+' · '+esc2(p.paper||"")+' · 题'+(q.no||"?")+' ';
      if(q.qtype) h+='<span class="b9-tag">'+esc2(q.qtype)+'</span>';
      if(q.score)  h+='<span class="b9-tag">'+esc2(q.score)+'</span>';
      if(q.words)  h+='<span class="b9-tag">'+esc2(q.words)+'</span>';
      h+='</div>';
      h+='<div class="b9-stem">'+hi2(ex,terms)+'</div>';
      const orgs=(q.orgs||[]).map(o=>o.name).filter(Boolean);
      if(orgs.length){
        h+='<div class="b9-orgs">'+orgs.map(o=>'<span class="b9-otag">'+esc2(o)+'</span>').join("")+'</div>';
      }
      const pid=esc2(p.id), no=(q.no||0);
      h+='<div class="b9-acts">';
      h+='<button class="ans-btn" onclick="openAnswerModal(\''+pid+'\','+no+')">✍️ 作答</button>';
      h+='<button class="ans-btn" onclick="if(window.b8OpenCompare)b8OpenCompare(\''+pid+'\','+no+')">🔍 答案对照</button>';
      h+='<button class="ans-btn" onclick="if(window.addToWrongBook)addToWrongBook(\''+pid+'\','+no+')">➕ 错题本</button>';
      h+='</div>';
      h+='</div>';
    });
    h+='</div>';
    return h;
  }

  function renderSearch(){
    if(!DATA || !DATA.papers){
      const c=document.getElementById('content');
      if(c) c.innerHTML='<div class="empty">题库数据未加载</div>';
      return;
    }
    const all=allQuestions();
    const qtSet = uniq(all.map(({q})=>q.qtype)).sort();
    const yrSet = uniq(DATA.papers.map(p=>String(p.year))).sort().reverse();
    const orgSet= uniq(all.flatMap(({q})=>(q.orgs||[]).map(o=>o.name))).sort();
    const provSet=uniq(DATA.papers.map(p=>p.province));

    const terms = ss.q ? ss.q.toLowerCase().split(/\s+/).filter(Boolean) : [];
    const total = runFilter().length;
    const shown = runFilter().slice(0,200);

    let h='<div class="b9-wrap">';
    h+='<div class="b9-h2">🔎 搜题 <span class="b9-sub">跨库聚合 · 按题型 / 年份 / 机构筛选 · 一键作答与对照</span></div>';
    h+='<div class="b9-toolbar">';
    h+='<input id="b9q" class="b9-search" type="search" placeholder="搜题干 / 材料 / 答案 / 采分点…（空格分词=同时包含）" value="'+esc2(ss.q)+'" oninput="b9SetQ(this.value)">';
    h+='<div class="b9-row">';
    h+=select("year","年份",["全部"].concat(yrSet),ss.year);
    h+=chip("prov","题库",provSet,ss.prov);
    h+=chip("org","机构",orgSet,ss.org);
    h+='</div>';
    h+=chip("qtype","题型",qtSet,ss.qtype);
    h+='</div>';
    h+='<div class="b9-stat">命中 <b>'+total+'</b> 道题'+(total>200?'（仅显示前 200）':'')+'</div>';
    h+=buildResults(shown,terms);
    h+='</div>';

    const c=document.getElementById('content');
    if(c) c.innerHTML=h;
    const s=document.getElementById('stats');
    if(s) s.textContent='搜题 · 命中 '+total+' 道题';
  }

  // 全局处理器（供 innerHTML 内 onclick 调用）
  window.b9SetQ=function(v){
    ss.q=v;
    clearTimeout(_deb);
    _deb=setTimeout(function(){
      renderSearch();
      const inp=document.getElementById('b9q');
      if(inp){ inp.focus(); const n=inp.value.length; try{ inp.setSelectionRange(n,n); }catch(_){} }
    },200);
  };
  window.b9Filter=function(field,v){ ss[field]=v; renderSearch(); };
  window.renderSearch=renderSearch;

})();
