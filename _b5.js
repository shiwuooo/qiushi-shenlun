/* =====================================================================
   第五批：学习激励与坚持系统  (_b5.js)
   依赖：全局 DATA / state / render() / esc() / hi()（由主站提供）
   存储：localStorage —— shenlun_motiv_v1（考试日期 + 周目标，本模块可写）
         只读引用（绝不写入）：
           shenlun_morning_v1    晨读打卡
           shenlun_answers_v2    作答记录
           shenlun_revisions_v1  作答修订史
           shenlun_recite_v1     背诵卡
   全程离线、纯前端、数据不出本机
   四大板块：① 考试倒计时 ② 全年贡献热力图 ③ 每周目标进度环 ④ 成就勋章
   ===================================================================== */
var PLAN_KEY = "shenlun_planlog_v1";  /* 全局：学习激励与过程画像共用的「本周微计划打卡」存储键（_b5/_b10 共用） */
(function(){
"use strict";

/* ---------------- 存储键 ---------------- */
var MOTIV_KEY   = "shenlun_motiv_v1";     /* 本模块可写：{examDate, goals} */
var MORNING_KEY = "shenlun_morning_v1";   /* 只读 */
var ANS_KEY     = "shenlun_answers_v2";   /* 只读 */
var REV_KEY     = "shenlun_revisions_v1"; /* 只读 */
var RECITE_KEY  = "shenlun_recite_v1";    /* 只读 */

var MASTER_LVL  = 5;                       /* 背诵卡等级≥5 视为已掌握 */
var DEFAULT_EXAM = "2026-11-29";          /* 常见国考笔试参考日期（仅作提示默认值） */
var GOAL_DEFAULT = {recite:20, morning:7, answer:5, mock:1, plan:3};

/* ---------------- 存储层（读写失败一律降级，永不抛出） ---------------- */
function jload(k, d){
  try{ var v = JSON.parse(localStorage.getItem(k)); return (v===null||v===undefined)?d:v; }
  catch(e){ return d; }
}
function jsave(k, o){
  try{ localStorage.setItem(k, JSON.stringify(o)); return true; }
  catch(e){ console.warn("存储失败", e); return false; }
}
function loadMotiv(){ var o = jload(MOTIV_KEY, {}); return (o && typeof o==="object" && !Array.isArray(o)) ? o : {}; }
function saveMotiv(o){ return jsave(MOTIV_KEY, o); }

/* ---------------- HTML 转义（优先复用站点 esc） ---------------- */
function E(s){
  var v = (s===null||s===undefined) ? "" : String(s);
  if(typeof esc === "function") return esc(v);
  return v.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function EA(s){ return E(s).replace(/"/g,"&quot;"); }

/* ---------------- 公共小工具：状态行 / 侧栏（本模块自备） ---------------- */
function setStats(t){ var el = document.getElementById("stats"); if(el) el.textContent = t; }
function sideNav(title, items){
  var nav = document.getElementById("nav");
  if(!nav) return;
  var h = "<h3>" + E(title) + "</h3>";
  (items || []).forEach(function(it){
    h += '<div class="tlink" onclick="var e=document.getElementById(\'' + it.id +
         '\');if(e)e.scrollIntoView({behavior:\'smooth\'})"><span>' + E(it.label) + '</span></div>';
  });
  nav.innerHTML = h;
}

/* ---------------- 日期工具（一律使用本地日期） ---------------- */
function pad2(n){ return String(n).length < 2 ? "0" + n : String(n); }
function dkey(d){ return d.getFullYear() + "-" + pad2(d.getMonth()+1) + "-" + pad2(d.getDate()); }
function todayDate(){ var t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
function parseISO(s){
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s||""));
  if(!m) return null;
  var d = new Date(+m[1], +m[2]-1, +m[3]);
  return isNaN(d.getTime()) ? null : d;
}
function tsDay(ts){ var d = new Date(ts); return isNaN(d.getTime()) ? null : dkey(d); }
function dayGap(a, b){
  var x = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  var y = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((y - x) / 86400000);
}
/* 本周窗口（周一为起点 ~ 周日） */
function weekRange(){
  var t = todayDate();
  var dow = t.getDay();                    /* 0=周日 … 6=周六 */
  var diff = (dow === 0) ? -6 : (1 - dow); /* 回退到本周一 */
  var mon = new Date(t.getFullYear(), t.getMonth(), t.getDate() + diff);
  var sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
  return {start: mon, end: sun};
}
var _WK = weekRange();
function inWeekDate(d){
  if(!d) return false;
  var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return x >= _WK.start && x <= _WK.end;
}
function inWeekTs(ts){
  if(ts===null||ts===undefined) return false;
  var d = new Date(ts);
  return isNaN(d.getTime()) ? false : inWeekDate(d);
}

/* ---------------- 参数与默认值 ---------------- */
function goalsOf(m){
  var g = (m && m.goals && typeof m.goals === "object") ? m.goals : {};
  return {
    recite:  toInt(g.recite,  GOAL_DEFAULT.recite),
    morning: toInt(g.morning, GOAL_DEFAULT.morning),
    answer:  toInt(g.answer,  GOAL_DEFAULT.answer),
    mock:    toInt(g.mock,    GOAL_DEFAULT.mock),
    plan:    toInt(g.plan,    GOAL_DEFAULT.plan)
  };
}
function toInt(v, d){ var n = parseInt(v, 10); return (isNaN(n) || n < 0) ? d : n; }

/* =====================================================================
   一、活动聚合：date(YYYY-MM-DD) → 活跃度计数
   晨读 +1 / 作答 +2 / 修订 +1 / 背诵日志 +1
   ===================================================================== */
function activityMap(){
  var map = {};
  function add(day, n){ if(!day) return; map[day] = (map[day] || 0) + n; }

  var mor = jload(MORNING_KEY, {});
  (Array.isArray(mor.days) ? mor.days : []).forEach(function(s){
    if(/^\d{4}-\d{2}-\d{2}$/.test(s)) add(s, 1);
  });

  var ans = jload(ANS_KEY, {});
  Object.keys(ans).forEach(function(k){
    var r = ans[k];
    if(r && r.ts) add(tsDay(r.ts), 2);
  });

  var rev = jload(REV_KEY, {});
  Object.keys(rev).forEach(function(k){
    var arr = rev[k];
    if(Array.isArray(arr)) arr.forEach(function(e){ if(e && e.ts) add(tsDay(e.ts), 1); });
  });

  var rec = jload(RECITE_KEY, {});
  (Array.isArray(rec.log) ? rec.log : []).forEach(function(e){
    if(e && e.ts) add(tsDay(e.ts), 1);
  });

  /* 微计划打卡（过程教练写入，本课只读聚合进热力图） */
  var plan = jload(PLAN_KEY, []);
  (Array.isArray(plan) ? plan : []).forEach(function(e){
    if(e && e.ts) add(tsDay(e.ts), 1);
  });

  return map;
}

/* =====================================================================
   二、各 store 统计（只读）
   ===================================================================== */
function calcStreak(days){
  if(!days.length) return 0;
  var set = {}; days.forEach(function(s){ set[s] = 1; });
  var t = new Date(), cur = null;
  if(set[dkey(t)]) cur = t;
  else { var y = new Date(t); y.setDate(y.getDate() - 1); if(set[dkey(y)]) cur = y; }
  if(!cur) return 0;
  var n = 0, c = new Date(cur);
  while(set[dkey(c)]){ n++; c.setDate(c.getDate() - 1); }
  return n;
}
function morningStat(){
  var raw = jload(MORNING_KEY, {});
  var days = (Array.isArray(raw.days) ? raw.days : []).filter(function(s){ return /^\d{4}-\d{2}-\d{2}$/.test(s); });
  var uniq = [];
  var seen = {};
  days.forEach(function(s){ if(!seen[s]){ seen[s] = 1; uniq.push(s); } });
  uniq.sort();
  var wk = 0;
  uniq.forEach(function(s){ if(inWeekDate(parseISO(s))) wk++; });
  return {days: uniq, total: uniq.length, streak: calcStreak(uniq), week: wk};
}
function answersStat(){
  var a = jload(ANS_KEY, {});
  var count = 0, week = 0;
  Object.keys(a).forEach(function(k){
    var r = a[k];
    if(!r) return;
    count++;
    if(r.ts && inWeekTs(r.ts)) week++;
  });
  return {count: count, week: week};
}
function reciteStat(){
  var raw = jload(RECITE_KEY, {});
  var cards = (raw.cards && typeof raw.cards === "object") ? raw.cards : {};
  var keys = Object.keys(cards);
  var mastered = 0;
  keys.forEach(function(k){ if((cards[k].lvl || 0) >= MASTER_LVL) mastered++; });
  var week = 0;
  (Array.isArray(raw.log) ? raw.log : []).forEach(function(e){
    if(e && inWeekTs(e.ts)) week += (e.n || 0);
  });
  return {total: keys.length, mastered: mastered, week: week};
}
function revisionStat(){
  var o = jload(REV_KEY, {});
  var versions = 0;
  Object.keys(o).forEach(function(k){
    var arr = o[k];
    if(Array.isArray(arr)) versions += arr.length;
  });
  return {versions: versions};
}
/* 模考完成识别：某套真题全部小题均已作答，视为完成一套模考 */
function paperStats(){
  var a = jload(ANS_KEY, {});
  var byPaper = {};
  Object.keys(a).forEach(function(k){
    var r = a[k];
    if(!r) return;
    var idx = k.lastIndexOf("#");
    var pid = (r.pid !== undefined && r.pid !== null) ? r.pid : (idx > 0 ? k.slice(0, idx) : k);
    var qno = (r.qno !== undefined && r.qno !== null) ? r.qno : (idx > 0 ? k.slice(idx + 1) : "");
    var bp = byPaper[pid] || (byPaper[pid] = {ans: {}, lastTs: 0});
    bp.ans[qno] = 1;
    if((r.ts || 0) > bp.lastTs) bp.lastTs = r.ts || 0;
  });
  var papers = (typeof DATA !== "undefined" ? (DATA.papers || []) : []);
  var done = 0, completed = [];
  papers.forEach(function(p){
    var total = (p.questions || []).length;
    if(!total) return;
    var bp = byPaper[p.id];
    if(!bp) return;
    var answered = (p.questions || []).filter(function(q){ return bp.ans[q.no] !== undefined; }).length;
    if(answered >= total){ done++; completed.push({pid: p.id, lastTs: bp.lastTs}); }
  });
  return {done: done, completed: completed};
}
function mockWeek(ps){
  var n = 0;
  ps.completed.forEach(function(c){ if(inWeekTs(c.lastTs)) n++; });
  return n;
}
function planWeek(){
  var a = jload(PLAN_KEY, []);
  var n = 0;
  (Array.isArray(a) ? a : []).forEach(function(e){ if(e && e.ts && inWeekTs(e.ts)) n++; });
  return n;
}

/* =====================================================================
   三、考试倒计时
   ===================================================================== */
function countdown(m){
  var d = parseISO(m.examDate);
  if(!d) return null;
  return dayGap(todayDate(), d);   /* >0 未到 / 0 今天 / <0 已过 */
}
function countdownCard(m){
  var cd = countdown(m);
  var h = '<div class="b5-card" id="b5-countdown"><div class="b5-title">🎯 考试倒计时</div>';
  if(cd === null){
    h += '<div class="b5-empty2">尚未设置考试日期。设置后可查看距考天数与周数，并解锁「距考百日」冲刺勋章。</div>';
    h += '<div class="b5-actbar"><button class="b5-btn b5-primary" onclick="b5SetExam()">📅 设置考试日期</button>' +
         '<span class="b5-dim">参考：国考笔试通常在 11 月下旬（如 ' + E(DEFAULT_EXAM) + '），以官方公告为准。</span></div>';
    return h + '</div>';
  }
  var dateStr = E(m.examDate);
  if(cd < 0){
    h += '<div class="b5-cdrow"><div class="b5-count"><b class="b5-cbig b5-past">考试已结束</b>' +
         '<span class="b5-cunit">目标日期 ' + dateStr + '，已过去 ' + (-cd) + ' 天</span></div></div>';
  }else{
    var weeks = cd / 7;
    var fullW = Math.floor(cd / 7), remD = cd % 7;
    var big = cd === 0 ? "就是今天" : (cd + " 天");
    var sub = cd === 0
      ? ("目标日期 " + dateStr + " · 沉着应考，祝旗开得胜")
      : ("目标日期 " + dateStr + " · 约 " + weeks.toFixed(1) + " 周（" + fullW + " 周 " + remD + " 天）");
    h += '<div class="b5-cdrow"><div class="b5-count"><b class="b5-cbig' + (cd <= 30 ? " b5-hot" : "") + '">' + E(big) + '</b>' +
         '<span class="b5-cunit">' + E(sub) + '</span></div>';
    h += '<div class="b5-cweeks"><div class="b5-cw"><b>' + Math.max(0, fullW) + '</b><span>整周</span></div>' +
         '<div class="b5-cw"><b>' + weeks.toFixed(1) + '</b><span>周（约）</span></div></div></div>';
  }
  h += '<div class="b5-actbar"><button class="b5-btn" onclick="b5SetExam()">✎ 修改考试日期</button>' +
       '<span class="b5-dim">距考天数按本地日期计算；日期仅存本机。</span></div>';
  return h + '</div>';
}

/* =====================================================================
   四、全年贡献热力图（GitHub 风格，53 周 × 7 天）
   ===================================================================== */
function heatLevel(c){
  if(!c) return 0;
  if(c <= 2) return 1;
  if(c <= 4) return 2;
  return 3;
}
function heatmapCard(map){
  var t = todayDate();
  var dow = t.getDay();
  var diff = (dow === 0) ? -6 : (1 - dow);
  var thisMon = new Date(t.getFullYear(), t.getMonth(), t.getDate() + diff);
  var startMon = new Date(thisMon.getFullYear(), thisMon.getMonth(), thisMon.getDate() - 52 * 7); /* 共 53 列 */

  var cells = "";
  var monthMark = "";
  var lastMonth = -1;
  for(var w = 0; w < 53; w++){
    var colFirst = new Date(startMon.getFullYear(), startMon.getMonth(), startMon.getDate() + w * 7);
    var mo = colFirst.getMonth();
    if(mo !== lastMonth && colFirst.getDate() <= 7){
      monthMark += '<span class="b5-mo" style="grid-column:' + (w + 1) + '">' + (mo + 1) + '月</span>';
      lastMonth = mo;
    }
    for(var d = 0; d < 7; d++){
      var cur = new Date(startMon.getFullYear(), startMon.getMonth(), startMon.getDate() + w * 7 + d);
      if(dayGap(cur, t) < 0){                       /* 未来日期：占位空格 */
        cells += '<span class="b5-cell b5-future"></span>';
        continue;
      }
      var key = dkey(cur);
      var c = map[key] || 0;
      var lv = heatLevel(c);
      var tip = key + "（周" + "日一二三四五六".charAt(cur.getDay()) + "）· 活跃度 " + c;
      cells += '<span class="b5-cell b5-h' + lv + '" title="' + EA(tip) + '"></span>';
    }
  }

  var yr = new Date().getFullYear();
  var totalDays = Object.keys(map).filter(function(k){ return k.indexOf(yr + "-") === 0 && map[k] > 0; }).length;
  var totalActs = 0;
  Object.keys(map).forEach(function(k){ if(k.indexOf(yr + "-") === 0) totalActs += map[k]; });

  var h = '<div class="b5-card" id="b5-heat"><div class="b5-title">🌱 全年贡献热力图 <span class="b5-dim">（近 53 周 · 越深表示当天学习越多）</span></div>';
  if(!totalDays){
    h += '<div class="b5-empty2">本年还没有学习记录。晨读打卡、提交作答、背诵与修订都会在这里点亮方格。</div>';
  }
  h += '<div class="b5-heatscroll"><div class="b5-heatinner">' +
       '<div class="b5-months">' + monthMark + '</div>' +
       '<div class="b5-heat">' + cells + '</div></div></div>';
  h += '<div class="b5-heatfoot">' +
       '<div class="b5-legend"><span>少</span>' +
       '<span class="b5-cell b5-h0"></span><span class="b5-cell b5-h1"></span>' +
       '<span class="b5-cell b5-h2"></span><span class="b5-cell b5-h3"></span>' +
       '<span>多</span></div>' +
       '<div class="b5-htotal">本年累计学习 <b>' + totalDays + '</b> 天 · 活跃度合计 <b>' + totalActs + '</b></div>' +
       '</div>';
  return h + '</div>';
}

/* =====================================================================
   五、每周目标进度环
   ===================================================================== */
function ringSVG(actual, target){
  var pct = target > 0 ? Math.min(100, Math.round(actual / target * 100)) : 0;
  var cls = pct >= 100 ? "done" : (pct < 60 ? "low" : "mid");
  var R = 42, C = 2 * Math.PI * R;
  var off = C * (1 - pct / 100);
  return '<svg class="b5-ringsvg" viewBox="0 0 100 100" width="104" height="104" aria-hidden="true">' +
    '<circle class="b5-rtrack" cx="50" cy="50" r="' + R + '" fill="none" stroke-width="10"></circle>' +
    '<circle class="b5-rbar ' + cls + '" cx="50" cy="50" r="' + R + '" fill="none" stroke-width="10" ' +
    'stroke-linecap="round" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) +
    '" transform="rotate(-90 50 50)"></circle>' +
    '<text class="b5-rpct ' + cls + '" x="50" y="52" text-anchor="middle" dominant-baseline="middle">' + pct + '%</text>' +
    '</svg>';
}
function ringItem(icon, label, actual, target, unit){
  return '<div class="b5-ring">' + ringSVG(actual, target) +
    '<div class="b5-rlabel">' + E(icon) + ' ' + E(label) + '</div>' +
    '<div class="b5-rcount">' + E(unit) + ' <b>' + actual + '</b>/' + target + '</div></div>';
}
function goalsCard(goals, week){
  var h = '<div class="b5-card" id="b5-goals"><div class="b5-title">🎯 每周目标进度环 ' +
          '<span class="b5-dim">（' + E(dkey(_WK.start)) + ' ~ ' + E(dkey(_WK.end)) + ' · 周一至周日）</span></div>';
  h += '<div class="b5-rings">';
  h += ringItem("🧠", "背诵卡", week.recite,  goals.recite,  "已背");
  h += ringItem("🌅", "晨读打卡", week.morning, goals.morning, "已打卡");
  h += ringItem("✍️", "真题作答", week.answer,  goals.answer,  "已作答");
  h += ringItem("📝", "整套模考", week.mock,    goals.mock,    "已模考");
  h += ringItem("📌", "微计划",   week.plan,    goals.plan,    "已打卡");
  h += '</div>';
  h += '<div class="b5-actbar"><button class="b5-btn" onclick="b5EditGoals()">✎ 编辑周目标</button>' +
       '<span class="b5-dim">红色＝进度不足 60%，达标 100% 转为绿色；每周一自动归零重新计。</span></div>';
  return h + '</div>';
}

/* =====================================================================
   六、成就勋章
   ===================================================================== */
function computeBadges(s){
  var cd = s.cd;
  return [
    {ab:"晨读", name:"晨读新手",  cond:"连续晨读打卡 ≥ 3 天",   ok: s.mor.streak   >= 3,   now: s.mor.streak + " 天"},
    {ab:"达人", name:"晨读达人",  cond:"累计晨读打卡 ≥ 30 天",  ok: s.mor.total    >= 30,  now: s.mor.total + " 天"},
    {ab:"百日", name:"百日打卡",  cond:"累计晨读打卡 ≥ 100 天", ok: s.mor.total    >= 100, now: s.mor.total + " 天"},
    {ab:"首战", name:"首战作答",  cond:"完成作答 ≥ 1 题",       ok: s.ans.count    >= 1,   now: s.ans.count + " 题"},
    {ab:"题海", name:"题海遨游",  cond:"完成作答 ≥ 50 题",      ok: s.ans.count    >= 50,  now: s.ans.count + " 题"},
    {ab:"千锤", name:"千锤百炼",  cond:"完成作答 ≥ 200 题",     ok: s.ans.count    >= 200, now: s.ans.count + " 题"},
    {ab:"背诵", name:"背诵入门",  cond:"背诵卡 ≥ 10 张",        ok: s.rec.total    >= 10,  now: s.rec.total + " 张"},
    {ab:"成诵", name:"过目成诵",  cond:"已掌握背诵卡 ≥ 100 张",  ok: s.rec.mastered >= 100, now: s.rec.mastered + " 张"},
    {ab:"修订", name:"修订狂人",  cond:"作答修订史 ≥ 10 版",    ok: s.revs.versions>= 10,  now: s.revs.versions + " 版"},
    {ab:"模考", name:"模考战士",  cond:"完成整套模考 ≥ 1 套",   ok: s.papers.done  >= 1,   now: s.papers.done + " 套"},
    {ab:"冲刺", name:"距考百日",  cond:"考试倒计时 ≤ 100 天",   ok: cd !== null && cd >= 0 && cd <= 100,
       now: cd === null ? "未设日期" : (cd < 0 ? "已结束" : cd + " 天")}
  ];
}
function badgesCard(badges){
  var unlocked = badges.filter(function(b){ return b.ok; }).length;
  var h = '<div class="b5-card" id="b5-badges"><div class="b5-title">🏅 成就勋章 ' +
          '<span class="b5-dim">（已解锁 ' + unlocked + ' / ' + badges.length + '）</span></div>';
  h += '<div class="b5-badges">';
  badges.forEach(function(b){
    var cls = b.ok ? "b5-on" : "b5-off";
    h += '<div class="b5-badge ' + cls + '" title="' + EA(b.name + "：" + b.cond) + '">' +
         '<span class="b5-bcircle">' + E(b.ab) + '</span>' +
         '<span class="b5-bname">' + E(b.name) + '</span>' +
         '<span class="b5-bcond">' + (b.ok ? "已解锁 · " : "未解锁 · ") + E(b.cond) + '</span>' +
         '<span class="b5-bnow">当前：' + E(b.now) + '</span>' +
         '</div>';
  });
  h += '</div></div>';
  return h;
}

/* =====================================================================
   总渲染入口
   ===================================================================== */
function renderMotivation(){
  var box = document.getElementById("content");
  if(!box) return;

  var m = loadMotiv();
  var goals = goalsOf(m);
  var map = activityMap();
  var mor = morningStat();
  var ans = answersStat();
  var rec = reciteStat();
  var revs = revisionStat();
  var papers = paperStats();
  var cd = countdown(m);

  var week = {recite: rec.week, morning: mor.week, answer: ans.week, mock: mockWeek(papers), plan: planWeek()};
  var badges = computeBadges({mor: mor, ans: ans, rec: rec, revs: revs, papers: papers, cd: cd});
  var unlocked = badges.filter(function(b){ return b.ok; }).length;

  var yr = new Date().getFullYear();
  var totalDays = Object.keys(map).filter(function(k){ return k.indexOf(yr + "-") === 0 && map[k] > 0; }).length;
  var hasData = totalDays > 0 || ans.count > 0 || rec.total > 0 || mor.total > 0;

  sideNav("学习激励", [
    {id: "b5-countdown", label: "🎯 考试倒计时"},
    {id: "b5-heat",      label: "🌱 全年热力图"},
    {id: "b5-goals",     label: "🎯 每周目标环"},
    {id: "b5-badges",    label: "🏅 成就勋章"}
  ]);
  setStats("学习激励与坚持 · " +
    (cd === null ? "未设考试日期" : (cd >= 0 ? "距考 " + cd + " 天" : "考试已结束")) +
    " · 本年学习 " + totalDays + " 天 · 连续晨读 " + mor.streak + " 天 · 勋章 " + unlocked + "/" + badges.length +
    " · 数据仅存本机");

  var h = '<div class="b5-wrap">';
  h += '<h2 class="b5-h2">📊 学习激励与坚持</h2>';
  h += '<div class="b5-note">汇总你的晨读、作答、背诵、修订记录，自动生成倒计时、全年热力图、每周目标进度与成就勋章。所有数据仅存于本机浏览器（localStorage），离线可用、绝不上传。</div>';

  if(!hasData){
    h += '<div class="b5-empty">还没有学习记录，去真题库做几道题吧 —— 完成作答、晨读打卡或背诵后，这里会自动点亮各项数据与勋章。</div>';
  }

  /* 概览统计块 */
  h += '<div class="b5-card"><div class="b5-stats">' +
    '<div class="b5-stat"><b class="' + (cd !== null && cd >= 0 && cd <= 30 ? "b5-hot" : "") + '">' +
      (cd === null ? "—" : (cd >= 0 ? cd : "已过")) + '</b><span>距考天数</span></div>' +
    '<div class="b5-stat"><b>' + totalDays + '</b><span>本年学习（天）</span></div>' +
    '<div class="b5-stat"><b class="b5-hot">' + mor.streak + '</b><span>连续晨读（天）</span></div>' +
    '<div class="b5-stat"><b class="b5-ok">' + unlocked + '</b><span>已解锁勋章（个）</span></div>' +
    '</div></div>';

  h += countdownCard(m);
  h += heatmapCard(map);
  h += goalsCard(goals, week);
  h += badgesCard(badges);

  h += '</div>';
  box.innerHTML = h;
}

/* =====================================================================
   交互动作
   ===================================================================== */
function b5SetExam(){
  var m = loadMotiv();
  var cur = m.examDate || DEFAULT_EXAM;
  var v = prompt("请输入考试日期（格式 YYYY-MM-DD，例如国考笔试 " + DEFAULT_EXAM + "）：", cur);
  if(v === null) return;
  v = v.trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(v)){ alert("日期格式不正确，请使用 YYYY-MM-DD，例如 2026-11-29。"); return; }
  if(!parseISO(v)){ alert("这不是一个有效的日期，请重新输入。"); return; }
  m.examDate = v;
  if(!saveMotiv(m)) alert("保存失败：浏览器存储空间可能已满。");
  renderMotivation();
}
function b5EditGoals(){
  var m = loadMotiv();
  var g = goalsOf(m);
  var r1 = prompt("每周【背诵卡】目标（张）：", String(g.recite));
  if(r1 === null) return;
  var r2 = prompt("每周【晨读打卡】目标（天，建议 ≤ 7）：", String(g.morning));
  if(r2 === null) return;
  var r3 = prompt("每周【真题作答】目标（题）：", String(g.answer));
  if(r3 === null) return;
  var r4 = prompt("每周【整套模考】目标（套）：", String(g.mock));
  if(r4 === null) return;
  m.goals = {
    recite:  toInt(r1, g.recite),
    morning: toInt(r2, g.morning),
    answer:  toInt(r3, g.answer),
    mock:    toInt(r4, g.mock)
  };
  if(!saveMotiv(m)) alert("保存失败：浏览器存储空间可能已满。");
  renderMotivation();
}

/* =====================================================================
   暴露入口（供主程序路由 / innerHTML 内 onclick 调用）
   ===================================================================== */
window.renderMotivation = renderMotivation;
window.b5SetExam        = b5SetExam;
window.b5EditGoals      = b5EditGoals;

})();
