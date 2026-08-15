(function(){
  "use strict";
  // ============================================================
  //  _b10 过程教练：把"你答题时卡在哪"数据化，
  //  生成一人专属的薄弱项画像 + 人性化提升方案。
  //  与主站隔离：只读 shenlun_answers_v2，暴露 window.renderCoach。
  // ============================================================

  // 答题过程难点标签（作答弹窗里勾选用，主站 openAnswerModal 会读取 window.PROC_TAGS）
  window.PROC_TAGS = ["找不到材料","不会归纳概括","原词还是提炼","不知格式规范","不知写什么","看不懂题干","时间不够"];

  // 作答弹窗里切换难点标签（on 态会被 submitAnswer 读取）
  window.b10Toggle = function(el){
    if(!el) return;
    el.classList.toggle("on");
  };

  function loadAnswers(){
    try{ return JSON.parse(localStorage.getItem("shenlun_answers_v2")||"{}"); }
    catch(e){ return {}; }
  }
  function esc(s){
    s = s==null ? "" : String(s);
    return s.replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; });
  }

  // 每个难点标签 → 一人专属教练话术（现象 / 为什么 / 怎么破 / 去练）
  var COACH = {
    "找不到材料": {
      cap:"材料定位力",
      why:"申论 80% 的要点就藏在材料里。找不到，往往不是你不会写，而是没把材料“读进去”——只看了字面，没画出逻辑线。",
      fix:[
        "读题先圈三要素：主体 / 问题 / 要求，带着问题回材料找",
        "材料分层：用铅笔在边上标 问题—原因—做法—成效 的逻辑线",
        "优先抄“动词+名词”原词，再归纳，绝不凭空编"
      ],
      go:[["框架卡·审题","window.renderFrames&&window.renderFrames()"],["热点专题","window.renderTopics&&window.renderTopics()"]]
    },
    "不会归纳概括": {
      cap:"归纳提炼力",
      why:"你找得到信息，但写出来的像“搬运”而不是“答案”。概括的本质是：去例子、留观点、合并同类项。",
      fix:[
        "同义合并：意思一样的点坚决并成一条",
        "去例子留观点：材料里的故事/数据只是证据，写答案只留结论",
        "用“总-分”：先一句话总括，再分点，别直接堆材料"
      ],
      go:[["框架卡·概括","window.renderFrames&&window.renderFrames()"],["背诵卡","window.renderRecite&&window.renderRecite()"]]
    },
    "原词还是提炼": {
      cap:"转化判断力",
      why:"这是最容易丢分的犹豫：到底照抄材料原词，还是自己提炼成规范词？判断错了就偏题或啰嗦。",
      fix:[
        "名次、数据、政策表述 → 原词照抄，不要改",
        "口语、事例、现象 → 提炼为规范词（用 _b6 框架卡里的规范词库）",
        "看分值定字数：1 分≈1 个要点≈15-20 字，分少就别展开"
      ],
      go:[["框架卡·转化","window.renderFrames&&window.renderFrames()"],["规范词库","if(window.b2Go)window.b2Go('规范词库');else if(state){(state.scope='规范词库');render();}"]]
    },
    "不知格式规范": {
      cap:"格式规范力",
      why:"公文题丢分常常不是内容错，而是格式（标题/称谓/落款/分段）不对，评委一眼就扣分。",
      fix:[
        "公文先背格式模板：标题 / 称谓 / 正文 / 落款，缺一不可",
        "对策题用“总括句+分条”，每条“主体+动作+对象+结果”",
        "看题干关键词定格式：提纲/汇报/短评/讲话稿各有套路"
      ],
      go:[["框架卡·公文","window.renderFrames&&window.renderFrames()"],["大作文","window.renderEssay&&window.renderEssay()"]]
    },
    "不知写什么": {
      cap:"要点完整度",
      why:"你不是不会写，是不敢写满。申论“宁多勿漏”，要点覆盖度直接决定基础分。",
      fix:[
        "对照采分点反推：每少一点就补一个角度",
        "每点套“主体+动作+对象+结果”四件套，确保不空",
        "时间允许就多写1-2条边缘要点，评委按点给分"
      ],
      go:[["答案对照","window.b8OpenCompare&&window.b8OpenCompare()"],["智能组卷","window.renderGenPaper&&window.renderGenPaper()"]]
    },
    "看不懂题干": {
      cap:"审题力",
      why:"题干是地图。审错对象/范围/题型，后面全白写。很多“跑题”其实是一开始就没拆题。",
      fix:[
        "拆题干五要素：作答对象 / 范围 / 题型 / 字数 / 特殊要求",
        "用框架卡里的“审题口诀”逐条过",
        "下笔前先列 30 秒提纲，确认对象没错再写"
      ],
      go:[["框架卡·审题","window.renderFrames&&window.renderFrames()"],["方法论","if(state){(state.scope='方法论');render();}"]]
    },
    "时间不够": {
      cap:"节奏管理",
      why:"申论是“限时战”。不是你不会，是前面磨蹭、后面慌乱，导致会做的题没写完。",
      fix:[
        "单题限时：概括15' / 对策20' / 分析25' / 作文留60'",
        "先骨架后填充：每题先写要点关键词，再扩写",
        "用“限时模考”练整套节奏，把时间感刻进肌肉记忆"
      ],
      go:[["限时模考","if(state){(state.scope='限时模考');render();}"],["学习激励","window.renderMotivation&&window.renderMotivation()"]]
    }
  };

  // 聚合所有作答里的过程难点标签
  function aggregateTags(){
    var data = loadAnswers();
    var count = {};       // tag -> 次数
    var notes = [];       // 带自由反思的记录
    var total = 0, withProc = 0;
    Object.keys(data).forEach(function(k){
      var rec = data[k];
      if(!rec || typeof rec!=="object") return;
      total++;
      var p = rec.process;
      if(p && ((p.tags&&p.tags.length) || p.note)){
        withProc++;
        (p.tags||[]).forEach(function(t){ count[t]=(count[t]||0)+1; });
        if(p.note){
          notes.push({ key:k, tags:(p.tags||[]), note:p.note, score:rec.score, qtype:rec.qtype });
        }
      }
    });
    var sorted = Object.keys(count).map(function(t){ return [t, count[t]]; })
                    .sort(function(a,b){ return b[1]-a[1]; });
    return { total:total, withProc:withProc, sorted:sorted, count:count, notes:notes };
  }

  function tagBar(t, c, max){
    var pct = max? Math.round(c/max*100):0;
    return '<div class="b10-bar"><span class="b10-name">'+esc(t)+'</span>'+
           '<span class="b10-track"><span class="b10-fill" style="width:'+pct+'%"></span></span>'+
           '<span class="b10-cnt">'+c+' 次</span></div>';
  }

  function coachCard(tag){
    var c = COACH[tag];
    if(!c) return "";
    var fixHtml = (c.fix||[]).map(function(s){ return "<li>"+esc(s)+"</li>"; }).join("");
    var goHtml = (c.go||[]).map(function(g){
      return '<button class="b10-go" onclick="('+g[1]+')">➡️ '+esc(g[0])+'</button>';
    }).join("");
    return '<div class="b10-coach">'+
      '<div class="b10-coach-h">🎯 你的最大薄弱项：<b>'+esc(c.cap)+'</b>（'+esc(tag)+'）</div>'+
      '<div class="b10-sec"><b>现象</b>：你多次在作答时卡在「'+esc(tag)+'」。</div>'+
      '<div class="b10-sec"><b>为什么</b>：'+esc(c.why)+'</div>'+
      '<div class="b10-sec"><b>怎么破（3 步）</b><ul class="b10-fix">'+fixHtml+'</ul></div>'+
      '<div class="b10-sec b10-goblock">'+goHtml+'</div>'+
      '</div>';
  }

  // 主入口：渲染"过程教练"页
  window.renderCoach = function(){
    var box = document.getElementById("content");
    if(!box) return;
    var ag = aggregateTags();

    if(ag.total===0){
      box.innerHTML = '<div class="b10-wrap"><h2>🧭 过程教练</h2>'+
        '<p class="muted">还没有作答记录。去「真题库 / 省考库」点「✍️ 作答」，<b>提交时勾选你卡在哪、写下当时怎么想</b>，这里就会生成你一人专属的薄弱项画像与提升方案。</p></div>';
      return;
    }
    if(ag.withProc===0){
      box.innerHTML = '<div class="b10-wrap"><h2>🧭 过程教练</h2>'+
        '<p class="muted">你已经作答 '+ag.total+' 次，但<b>还没记录过"答题过程笔记"</b>。下次作答提交时，勾选难点标签 + 写一句反思，我才能精准定位你"卡在哪一环"，而不只是告诉你"漏了哪几点"。</p></div>';
      return;
    }

    var max = ag.sorted.length? ag.sorted[0][1] : 1;
    var barsHtml = ag.sorted.map(function(r){ return tagBar(r[0], r[1], max); }).join("");
    var topTag = ag.sorted.length? ag.sorted[0][0] : null;
    var recent = ag.notes.slice(-6).reverse();
    var notesHtml = recent.length? recent.map(function(n){
      var tags = (n.tags||[]).map(function(t){ return '<span class="b10-chip on">'+esc(t)+'</span>'; }).join("");
      return '<div class="b10-note-item"><div class="b10-note-tags">'+tags+'</div>'+
             '<div class="b10-note-text">'+esc(n.note)+'</div>'+
             '<div class="b10-note-meta muted">'+esc(n.qtype||"")+(n.score!=null?" · 当次 "+n.score+"%":"")+'</div></div>';
    }).join("") : '<div class="muted">你勾选了难点标签，但还没写自由反思。下次补一句"当时怎么想的"，诊断会更准。</div>';

    box.innerHTML = '<div class="b10-wrap">'+
      '<h2>🧭 过程教练 <span class="muted">（基于 '+ag.withProc+' 次带过程笔记的作答）</span></h2>'+
      '<div class="b10-grid">'+
        '<div class="b10-card"><div class="b10-h2">📊 你卡在哪一环（过程难点频次）</div>'+barsHtml+
          (topTag?'<div class="b10-tip">你最常卡在 <b>'+esc(topTag)+'</b>。这往往才是你失分的真正根因，而非"不会写"。</div>':'')+
        '</div>'+
        (topTag? '<div class="b10-card">'+coachCard(topTag)+'</div>' : '')+
      '</div>'+
      '<div class="b10-card"><div class="b10-h2">📝 你的答题过程反思（最新）</div><div class="b10-notes">'+notesHtml+'</div></div>'+
      '<div class="b10-card b10-plan"><div class="b10-h2">🚀 为你定制的本周微计划</div>'+weeklyPlan(ag)+'</div>'+
      '</div>';
  };

  // 基于过程画像生成一人专属微计划（结合考试倒计时由 _b5 提供，缺失则给通用版）
  var PLAN_KEY = "shenlun_planlog_v1";
  function planLog(){ try{ return JSON.parse(localStorage.getItem(PLAN_KEY)||"[]")||[]; }catch(e){ return []; } }
  function isTodayTs(ts){ try{ var d=new Date(ts), t=new Date(); return d.getFullYear()===t.getFullYear()&&d.getMonth()===t.getMonth()&&d.getDate()===t.getDate(); }catch(e){ return false; } }
  window.b10PlanDone = function(idx){
    try{
      var log = planLog();
      log.push({ts: Date.now(), idx: idx});
      localStorage.setItem(PLAN_KEY, JSON.stringify(log));
      if(typeof window.renderCoach==="function") window.renderCoach();
      if(typeof flash==="function") flash("已打卡，学习激励热力图已点亮 ✅");
    }catch(e){ console.warn("计划打卡失败", e); }
  };
  function weeklyPlan(ag){
    if(!ag.sorted.length) return '<div class="muted">先记录过程笔记，我再为你排计划。</div>';
    var todayDone = {};
    try{ planLog().forEach(function(e){ if(e && e.idx!=null && isTodayTs(e.ts)) todayDone[e.idx]=1; }); }catch(e){}
    var items = [];
    ag.sorted.slice(0,3).forEach(function(r, i){
      var c = COACH[r[0]];
      if(!c) return;
      var btn = todayDone[i] ? '<span class="b10-plan-ok">✅ 今日已打卡</span>'
                              : '<button type="button" class="b10-plan-done" onclick="b10PlanDone('+i+')">✅ 完成打卡</button>';
      items.push('<div class="b10-plan-row"><span class="b10-plan-no">'+(i+1)+'</span>'+
        '<div class="b10-plan-body"><b>主攻 '+esc(c.cap)+'</b>（你卡了 '+r[1]+' 次）<br><span class="muted">'+esc((c.fix||[]).slice(0,2).join("；"))+'</span></div>'+ btn +'</div>');
    });
    // 倒计时信息（若 _b5 已记录）
    var examTip = "";
    try{
      var m = JSON.parse(localStorage.getItem("shenlun_motiv_v1")||"{}");
      if(m && m.examDate){
        var d = Math.max(0, Math.ceil((new Date(m.examDate)-new Date())/86400000));
        examTip = '<div class="b10-exam">⏰ 距你设定的考试还有 <b>'+d+'</b> 天，建议每天只攻 1 个薄弱项，小步快跑。完成打卡的每天都会在学习激励热力图点亮。</div>';
      }
    }catch(e){}
    return examTip + (items.join("")||'<div class="muted">—</div>');
  }

  // ============ 多模态提交辅助（图片预览 / 文本·Word 载入） ============
  // 数据暂存：ansImg=手写答案照片, noteImg=思路照片
  window.__b10 = window.__b10 || {ansImg:null,noteImg:null};
  window.b10ImgPreview = function(input, prevId, kind){
    var prev=document.getElementById(prevId); if(!prev) return;
    var f=input.files&&input.files[0]; if(!f) return;
    if(!/^image\//.test(f.type)){ alert("请选择图片文件"); input.value=""; return; }
    var r=new FileReader();
    r.onload=function(){
      var url=r.result;
      if(kind==="ans") window.__b10.ansImg=url; else window.__b10.noteImg=url;
      prev.innerHTML='<div class="ans-thumb"><img src="'+url+'" alt="preview">'+
        '<button type="button" class="ans-thumbx" onclick="b10RemoveImg(\''+kind+'\',\''+prevId+'\',\''+input.id+'\')">✕</button></div>';
    };
    r.readAsDataURL(f);
  };
  window.b10RemoveImg = function(kind, prevId, inputId){
    if(kind==="ans") window.__b10.ansImg=null; else window.__b10.noteImg=null;
    var prev=document.getElementById(prevId); if(prev) prev.innerHTML="";
    var inp=document.getElementById(inputId); if(inp) inp.value="";
  };
  window.b10FileLoad = function(input){
    var f=input.files&&input.files[0]; if(!f) return;
    var ta=document.getElementById("ansText");
    var name=(f.name||"").toLowerCase();
    if(name.endsWith(".txt")||name.endsWith(".md")||f.type==="text/plain"){
      var r=new FileReader();
      r.onload=function(){ if(ta){ ta.value=r.result; ta.dispatchEvent(new Event("input")); } if(typeof flash==="function") flash("已载入文本，可直接修改后提交"); };
      r.readAsText(f,"utf-8");
    } else if(name.endsWith(".docx")){
      alert("离线版暂不支持直接解析 Word(.docx)。两个办法：\n① 在 Word 里 Ctrl+A 全选 → Ctrl+C 复制 → 此处 Ctrl+V 粘贴；\n② 另存为 .txt 后再上传。");
      input.value="";
    } else {
      alert("仅支持 .txt / .md / .docx，或用 Ctrl+V 粘贴 Word 内容");
      input.value="";
    }
  };

})();
