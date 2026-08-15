(function(){
  "use strict";
  /* ==================================================================
     _b18 错词 → 规范词 实时标红（ErrMark）
     A. 内置 40+ 组申论口语词 → 规范词，支持用户自定义补充
     B. 独立页：粘贴文本 → 实时高亮 + 逐条替换 + 一键全部替换
     C. 作答弹窗钩子：b18MountTextarea / b18OnInput（挂载由集成进程负责）
     纯前端离线、零依赖；只写 localStorage:
       shenlun_errlog_v1   自检记录
       shenlun_errwords_v1 我的常用替换
     暴露 window.renderErrMark，全部类名 b18- 前缀。
     ================================================================== */

  var LOG_KEY  = 'shenlun_errlog_v1';
  var WORD_KEY = 'shenlun_errwords_v1';
  var MAXLOG   = 60;

  /* 自带 HTML 转义（优先复用主站 esc） */
  var esc = window.esc || function(s){
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };

  /* ---------- 内置错词表：口语 / 随意表达 → 申论规范词 ---------- */
  var BAD_TO_GOOD = [
    ['搞',       '推进/开展/落实'],
    ['弄',       '推进/完善/规范'],
    ['做好',     '落实/推进'],
    ['弄好',     '推进/落实'],
    ['弄出',     '建立/形成'],
    ['弄个',     '建立/构建'],
    ['搞一下',   '开展/推进'],
    ['搞出来',   '形成/构建'],
    ['做',       '开展/推进/实施'],
    ['大家',     '广大干部群众/各方/相关部门'],
    ['咱们',     '我们/工作人员'],
    ['我觉得',   '我认为/分析认为'],
    ['我个人认为', '分析认为/研究认为'],
    ['很重要',   '至关重要/具有重要意义'],
    ['特别重要', '尤为关键/具有重要意义'],
    ['想办法',   '采取有效措施'],
    ['出点子',   '建言献策'],
    ['人多',     '力量/队伍'],
    ['没钱',     '资金保障不足'],
    ['没人',     '人员力量薄弱'],
    ['不行',     '有待完善/存在短板'],
    ['好的',     '积极/有效'],
    ['差的',     '薄弱/有待提升'],
    ['差不多就行', '尚需提升'],
    ['差不多',   '基本到位'],
    ['弄明白',   '厘清/明确'],
    ['说清楚',   '阐明/说明'],
    ['弄清',     '厘清/摸清'],
    ['说',       '指出/强调/认为'],
    ['看到',     '发现/识别'],
    ['看',       '审视/研判'],
    ['找到',     '识别/查找'],
    ['给',       '提供/予以'],
    ['用',       '运用/采用'],
    ['问题很多', '问题较为突出'],
    ['乱',       '无序/失范'],
    ['管一管',   '加强监管'],
    ['抓一抓',   '强化抓实'],
    ['多亏',     '得益于'],
    ['老百姓',   '人民群众/居民群众'],
    ['一堆',     '大量/若干'],
    ['很多人',   '多数群众/相当一部分群体'],
    ['非常好',   '成效显著'],
    ['马马虎虎', '流于形式/落实不到位'],
    ['听说',     '据反映/据了解'],
    ['大概',     '约/初步统计'],
    ['也许',     '或将/有可能'],
    ['得',       '应/须'],
    ['应该要',   '应当'],
    ['必须要',   '必须'],
    ['尽快弄',   '抓紧推进'],
    ['天天',     '日常/常态化'],
    ['到处',     '各地/普遍'],
    ['而且还',   '同时'],
    ['所以说',   '因此'],
    ['但是呢',   '但'],
    ['这样子',   '此类做法'],
    ['东西',     '内容/事物'],
    ['事儿',     '事项/事务'],
    ['干活',     '履职/开展工作']
  ];

  /* ---------- 模块内状态（不碰主站 state） ---------- */
  var S = {
    text: '',
    flash: '',
    nb: '',   /* 新增错词输入缓存 */
    ng: ''    /* 新增规范词输入缓存 */
  };

  /* 作答弹窗挂载点引用 */
  var BAR = null;
  var BAR_TA = null;

  /* ---------- 小工具 ---------- */
  function isArr(x){ return Object.prototype.toString.call(x) === '[object Array]'; }
  function pad2(n){ n = Math.floor(Math.abs(n)); return (n < 10 ? '0' : '') + n; }
  function fmtDay(ts){
    try{
      var d = new Date(ts || 0);
      if(!ts || isNaN(d.getTime())) return '—';
      return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }catch(e){ return '—'; }
  }
  function $(id){ try{ return document.getElementById(id); }catch(e){ return null; } }

  /* ---------- 样式自挂载（主站未 link _b18.css 时兜底，不改任何文件） ---------- */
  function ensureCss(){
    try{
      var ls = document.getElementsByTagName('link'), i;
      for(i = 0; i < ls.length; i++){
        if(String(ls[i].getAttribute('href') || '').indexOf('_b18.css') >= 0) return;
      }
      var el = document.createElement('link');
      el.rel = 'stylesheet'; el.href = '_b18.css';
      (document.head || document.documentElement).appendChild(el);
    }catch(e){}
  }

  /* ---------- localStorage 安全读写 ---------- */
  function lsGet(key, dft){
    try{
      if(typeof localStorage === 'undefined' || !localStorage) return dft;
      var raw = localStorage.getItem(key);
      if(!raw) return dft;
      var v = JSON.parse(raw);
      return (v == null) ? dft : v;
    }catch(e){ return dft; }
  }
  function lsSet(key, val){
    try{
      if(typeof localStorage === 'undefined' || !localStorage) return false;
      localStorage.setItem(key, JSON.stringify(val));
      return true;
    }catch(e){ return false; }
  }

  /* ---------- 我的常用替换 ---------- */
  function myPairs(){
    var raw = lsGet(WORD_KEY, []);
    if(!isArr(raw)) return [];
    var out = [], i, it, b, g;
    for(i = 0; i < raw.length; i++){
      it = raw[i];
      if(isArr(it)){ b = it[0]; g = it[1]; }
      else if(it && typeof it === 'object'){ b = it.bad; g = it.good; }
      else continue;
      b = String(b == null ? '' : b).trim();
      g = String(g == null ? '' : g).trim();
      if(b && g) out.push([b, g]);
    }
    return out;
  }
  function saveMy(list){ return lsSet(WORD_KEY, list); }

  /* 全表 = 自定义（优先）+ 内置，按 bad 去重 */
  function allPairs(){
    var seen = {}, out = [], i, p, k;
    var mine = myPairs();
    for(i = 0; i < mine.length; i++){
      k = mine[i][0];
      if(seen[k]) continue;
      seen[k] = 1; out.push([k, mine[i][1], 1]);
    }
    for(i = 0; i < BAD_TO_GOOD.length; i++){
      p = BAD_TO_GOOD[i]; k = p[0];
      if(seen[k]) continue;
      seen[k] = 1; out.push([k, p[1], 0]);
    }
    return out;
  }

  /* ---------- 规范词库「正字」对照（来自主站 DATA） ---------- */
  function libTitles(){
    try{
      var d = (typeof DATA !== 'undefined' && DATA) ? DATA : (window.DATA || null);
      if(!d || !isArr(d.entries)) return [];
      var out = [], i, e;
      for(i = 0; i < d.entries.length; i++){
        e = d.entries[i];
        if(!e || e.lib !== '规范词库') continue;
        var t = String(e.title == null ? '' : e.title).trim();
        if(t) out.push(t);
      }
      return out;
    }catch(e){ return []; }
  }
  function inLib(word){
    try{
      var ts = libTitles(), i, w = String(word || '').trim();
      if(!w) return false;
      for(i = 0; i < ts.length; i++){
        if(ts[i] === w || ts[i].indexOf(w) >= 0 || w.indexOf(ts[i]) >= 0) return true;
      }
      return false;
    }catch(e){ return false; }
  }

  /* ---------- 核心：扫描 ---------- */
  function opts(good){
    var arr = String(good == null ? '' : good).split('/'), out = [], i, s;
    for(i = 0; i < arr.length; i++){
      s = arr[i].replace(/^\s+|\s+$/g, '');
      if(s) out.push(s);
    }
    return out.length ? out : ['—'];
  }

  function scan(text){
    var out = [];
    try{
      text = String(text == null ? '' : text);
      if(!text) return out;
      var pairs = allPairs().slice().sort(function(a, b){ return b[0].length - a[0].length; });
      var used = [], i, j, k, from, idx, bad, free;
      for(i = 0; i < text.length; i++) used.push(0);
      for(i = 0; i < pairs.length; i++){
        bad = pairs[i][0];
        if(!bad) continue;
        from = 0;
        while(from <= text.length - bad.length){
          idx = text.indexOf(bad, from);
          if(idx < 0) break;
          free = true;
          for(j = idx; j < idx + bad.length; j++){ if(used[j]){ free = false; break; } }
          if(free){
            for(k = idx; k < idx + bad.length; k++) used[k] = 1;
            out.push({
              idx: idx, len: bad.length, bad: bad,
              good: pairs[i][1], mine: pairs[i][2] ? 1 : 0,
              opts: opts(pairs[i][1])
            });
          }
          from = idx + 1;
        }
      }
      out.sort(function(a, b){ return a.idx - b.idx; });
    }catch(e){ return out; }
    return out;
  }

  /* 用第 n 个建议替换第 i 处 */
  function applyOne(text, finds, i, word){
    try{
      var f = finds[i];
      if(!f) return text;
      var w = String(word || f.opts[0] || '');
      if(!w || w === '—') return text;
      return text.slice(0, f.idx) + w + text.slice(f.idx + f.len);
    }catch(e){ return text; }
  }
  /* 全部替换（从后往前，避免位移） */
  function applyAll(text, finds){
    try{
      var i, f, w, t = String(text == null ? '' : text);
      for(i = finds.length - 1; i >= 0; i--){
        f = finds[i];
        w = f.opts[0];
        if(!w || w === '—') continue;
        t = t.slice(0, f.idx) + w + t.slice(f.idx + f.len);
      }
      return t;
    }catch(e){ return text; }
  }

  /* ---------- 高亮预览 HTML ---------- */
  function markHtml(text, finds){
    try{
      text = String(text == null ? '' : text);
      if(!text) return '<span class="b18-dim">（此处实时显示标红预览）</span>';
      var html = '', cur = 0, i, f;
      for(i = 0; i < finds.length; i++){
        f = finds[i];
        if(f.idx < cur) continue;
        html += esc(text.slice(cur, f.idx));
        html += '<span class="b18-bad" title="建议：' + esc(f.good) + '">' + esc(f.bad) + '</span>';
        html += '<span class="b18-good">→' + esc(f.opts[0]) + '</span>';
        cur = f.idx + f.len;
      }
      html += esc(text.slice(cur));
      return html.replace(/\n/g, '<br>');
    }catch(e){ return '<span class="b18-dim">预览生成失败</span>'; }
  }

  /* ---------- 自检记录 ---------- */
  function logs(){ var v = lsGet(LOG_KEY, []); return isArr(v) ? v : []; }
  function pushLog(text, finds){
    try{
      var arr = logs(), i, brief = [];
      for(i = 0; i < finds.length && i < 20; i++){
        brief.push({ i: finds[i].idx, bad: finds[i].bad, good: finds[i].opts[0] });
      }
      arr.unshift({
        ts: (new Date()).getTime(),
        len: String(text || '').length,
        text: String(text || '').slice(0, 300),
        n: finds.length,
        finds: brief
      });
      while(arr.length > MAXLOG) arr.pop();
      return lsSet(LOG_KEY, arr);
    }catch(e){ return false; }
  }

  /* ================= 独立页渲染 ================= */
  function host(){
    var box = $('content');
    if(box) return box;
    try{
      box = $('b18-root');
      if(box) return box;
      box = document.createElement('div');
      box.id = 'b18-root';
      (document.body || document.documentElement).appendChild(box);
      return box;
    }catch(e){ return null; }
  }

  function listHtml(finds){
    if(!finds.length){
      return '<div class="b18-empty">暂未发现口语化表达。若刚粘贴文本，请在左侧输入后自动检测。</div>';
    }
    var h = '', i, j, f, o;
    for(i = 0; i < finds.length; i++){
      f = finds[i];
      h += '<div class="b18-item">' +
             '<div class="b18-item-h">' +
               '<span class="b18-pos">第 ' + (f.idx + 1) + ' 字</span>' +
               '<span class="b18-bad">' + esc(f.bad) + '</span>' +
               (f.mine ? '<span class="b18-tag b18-tag-blue">我的</span>' : '') +
               (inLib(f.opts[0]) ? '<span class="b18-tag b18-tag-green">规范词库</span>' : '') +
               '<button class="b18-btn b18-btn-sm b18-btn-red" data-act="fix" data-i="' + i + '">替换</button>' +
             '</div>' +
             '<div class="b18-opts">';
      o = f.opts;
      for(j = 0; j < o.length; j++){
        h += '<button class="b18-chip" data-act="pick" data-i="' + i + '" data-w="' + esc(o[j]) + '">' +
               esc(o[j]) + '</button>';
      }
      h += '</div></div>';
    }
    return h;
  }

  function mineHtml(){
    var m = myPairs();
    if(!m.length) return '<div class="b18-empty">还没有自定义替换。加一条你老写错的口头禅吧。</div>';
    var h = '', i;
    for(i = 0; i < m.length; i++){
      h += '<div class="b18-mine-row">' +
             '<span class="b18-bad">' + esc(m[i][0]) + '</span>' +
             '<span class="b18-arrow">→</span>' +
             '<span class="b18-good">' + esc(m[i][1]) + '</span>' +
             '<button class="b18-btn b18-btn-sm" data-act="delmine" data-i="' + i + '">删除</button>' +
           '</div>';
    }
    return h;
  }

  function logHtml(){
    var L = logs();
    if(!L.length) return '<div class="b18-empty">暂无自检记录。点「保存本次记录」可留档。</div>';
    var h = '', i, r;
    for(i = 0; i < L.length && i < 12; i++){
      r = L[i] || {};
      h += '<div class="b18-log-row">' +
             '<span class="b18-log-t">' + esc(fmtDay(r.ts)) + '</span>' +
             '<span class="b18-log-n">' + esc(String(r.n || 0)) + ' 处</span>' +
             '<span class="b18-log-x">' + esc(String(r.len || 0)) + ' 字</span>' +
             '<span class="b18-log-p">' + esc(String(r.text || '').slice(0, 40)) + '</span>' +
           '</div>';
    }
    return h;
  }

  function draw(){
    ensureCss();
    var box = host();
    if(!box) return;
    var finds = scan(S.text);
    var html = '' +
      '<div class="b18-wrap">' +
        '<div class="b18-head">' +
          '<div class="b18-title">错词 → 规范词 实时标红</div>' +
          '<div class="b18-sub">口语词不算错字，却是申论最隐蔽的失分点。粘贴文本即时识别，逐条或一键换成规范表述。</div>' +
        '</div>' +
        (S.flash ? '<div class="b18-flash">' + esc(S.flash) + '</div>' : '') +
        '<div class="b18-grid">' +
          '<div class="b18-col">' +
            '<div class="b18-card">' +
              '<div class="b18-card-h">① 待检文本</div>' +
              '<textarea id="b18-input" class="b18-ta" placeholder="把你的作答或段落粘到这里，边打边检测……"></textarea>' +
              '<div class="b18-row">' +
                '<button class="b18-btn b18-btn-red" data-act="fixall">一键全部替换</button>' +
                '<button class="b18-btn" data-act="save">保存本次记录</button>' +
                '<button class="b18-btn" data-act="pull">读入作答框</button>' +
                '<button class="b18-btn" data-act="clear">清空</button>' +
                '<span class="b18-stat">共 <b>' + String(S.text.length) + '</b> 字 · 口语词 <b class="b18-hot">' +
                  String(finds.length) + '</b> 处</span>' +
              '</div>' +
            '</div>' +
            '<div class="b18-card">' +
              '<div class="b18-card-h">② 高亮预览</div>' +
              '<div class="b18-prev">' + markHtml(S.text, finds) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="b18-col">' +
            '<div class="b18-card">' +
              '<div class="b18-card-h">③ 替换建议（点词条直接换）</div>' +
              '<div class="b18-list">' + listHtml(finds) + '</div>' +
            '</div>' +
            '<div class="b18-card">' +
              '<div class="b18-card-h">④ 我的常用替换</div>' +
              '<div class="b18-form">' +
                '<input id="b18-nb" class="b18-in" placeholder="错词，如：搞好" value="' + esc(S.nb) + '">' +
                '<span class="b18-arrow">→</span>' +
                '<input id="b18-ng" class="b18-in" placeholder="规范词，多个用 / 隔开" value="' + esc(S.ng) + '">' +
                '<button class="b18-btn b18-btn-blue" data-act="addmine">➕ 添加</button>' +
              '</div>' +
              '<div class="b18-mine">' + mineHtml() + '</div>' +
            '</div>' +
            '<div class="b18-card">' +
              '<div class="b18-card-h">⑤ 自检记录' +
                '<button class="b18-btn b18-btn-sm b18-right" data-act="clearlog">清空</button>' +
              '</div>' +
              '<div class="b18-log">' + logHtml() + '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    try{ box.innerHTML = html; }catch(e){ return; }
    S.flash = '';

    /* 回填并绑定实时输入 */
    try{
      var ta = $('b18-input');
      if(ta){
        ta.value = S.text;
        ta.oninput = function(){
          S.text = String(ta.value || '');
          refreshLive();
        };
      }
      var nb = $('b18-nb'), ng = $('b18-ng');
      if(nb) nb.oninput = function(){ S.nb = String(nb.value || ''); };
      if(ng) ng.oninput = function(){ S.ng = String(ng.value || ''); };
      box.onclick = onClick;
    }catch(e){}
  }

  /* 输入时只刷新预览/建议/计数，不整页重绘（避免光标跳走） */
  function refreshLive(){
    try{
      var finds = scan(S.text);
      var box = host();
      if(!box) return;
      var prev = box.getElementsByClassName('b18-prev')[0];
      if(prev) prev.innerHTML = markHtml(S.text, finds);
      var list = box.getElementsByClassName('b18-list')[0];
      if(list) list.innerHTML = listHtml(finds);
      var stat = box.getElementsByClassName('b18-stat')[0];
      if(stat){
        stat.innerHTML = '共 <b>' + String(S.text.length) + '</b> 字 · 口语词 <b class="b18-hot">' +
          String(finds.length) + '</b> 处';
      }
    }catch(e){}
  }

  /* ---------- 独立页事件 ---------- */
  function onClick(ev){
    try{
      var t = (ev && (ev.target || ev.srcElement)) || null;
      var act = '';
      while(t && t !== document){
        act = t.getAttribute ? (t.getAttribute('data-act') || '') : '';
        if(act) break;
        t = t.parentNode;
      }
      if(!act) return;

      var i = parseInt((t.getAttribute('data-i') || '-1'), 10);
      var finds = scan(S.text);

      if(act === 'fix' || act === 'pick'){
        if(i < 0 || !finds[i]) return;
        var w = (act === 'pick') ? (t.getAttribute('data-w') || '') : finds[i].opts[0];
        S.text = applyOne(S.text, finds, i, w);
        var ta = $('b18-input');
        if(ta) ta.value = S.text;
        refreshLive();
        return;
      }

      if(act === 'fixall'){
        if(!finds.length){ S.flash = '没有可替换的口语词。'; draw(); return; }
        var ok = true;
        try{ ok = window.confirm('将把 ' + finds.length + ' 处口语词替换为第一个规范词，并覆盖当前文本。确定继续？'); }catch(e){ ok = true; }
        if(!ok) return;
        pushLog(S.text, finds);
        S.text = applyAll(S.text, finds);
        S.flash = '已替换 ' + finds.length + ' 处，并留档一条自检记录。';
        draw(); return;
      }

      if(act === 'save'){
        S.flash = pushLog(S.text, finds) ? ('已保存记录：' + finds.length + ' 处口语词。') : '保存失败，浏览器拒绝写入本地存储。';
        draw(); return;
      }

      if(act === 'pull'){
        var src = $('ansText');
        if(!src){ S.flash = '当前页面没有作答框（#ansText），请直接粘贴文本。'; draw(); return; }
        S.text = String(src.value || '');
        S.flash = '已读入作答框文本。';
        draw(); return;
      }

      if(act === 'clear'){
        S.text = ''; S.flash = '已清空文本。'; draw(); return;
      }

      if(act === 'addmine'){
        var b = String(S.nb || '').replace(/^\s+|\s+$/g, '');
        var g = String(S.ng || '').replace(/^\s+|\s+$/g, '');
        if(!b || !g){ S.flash = '错词与规范词都要填写。'; draw(); return; }
        var m = myPairs(), k;
        for(k = 0; k < m.length; k++){ if(m[k][0] === b){ m.splice(k, 1); break; } }
        m.unshift([b, g]);
        S.flash = saveMy(m) ? ('已添加：' + b + ' → ' + g) : '添加失败，浏览器拒绝写入本地存储。';
        S.nb = ''; S.ng = '';
        draw(); return;
      }

      if(act === 'delmine'){
        var mm = myPairs();
        if(i < 0 || !mm[i]) return;
        var dn = mm[i][0];
        mm.splice(i, 1);
        S.flash = saveMy(mm) ? ('已删除自定义替换：' + dn) : '删除失败。';
        draw(); return;
      }

      if(act === 'clearlog'){
        var ok2 = true;
        try{ ok2 = window.confirm('确定清空全部自检记录？'); }catch(e){ ok2 = true; }
        if(!ok2) return;
        S.flash = lsSet(LOG_KEY, []) ? '已清空自检记录。' : '清空失败。';
        draw(); return;
      }
    }catch(err){
      try{ console.error('[_b18]', err); }catch(e){}
    }
  }

  /* ================= 作答弹窗钩子（挂载由集成进程调用） ================= */
  function fireInput(el){
    try{
      var ev;
      if(typeof Event === 'function'){ ev = new Event('input', { bubbles: true }); }
      else { ev = document.createEvent('HTMLEvents'); ev.initEvent('input', true, false); }
      el.dispatchEvent(ev);
    }catch(e){}
  }

  function barHtml(finds){
    if(!finds.length){
      return '<span class="b18-bar-ok">✓ 未发现口语化表达</span>';
    }
    var h = '<span class="b18-bar-t">口语词 <b class="b18-hot">' + finds.length + '</b> 处</span>';
    var i, n = finds.length > 8 ? 8 : finds.length;
    for(i = 0; i < n; i++){
      h += '<button class="b18-chip b18-chip-bad" data-b18fix="' + i + '">' +
             esc(finds[i].bad) + '<span class="b18-arrow">→</span>' +
             '<span class="b18-good">' + esc(finds[i].opts[0]) + '</span></button>';
    }
    if(finds.length > n) h += '<span class="b18-dim">…另有 ' + (finds.length - n) + ' 处</span>';
    h += '<button class="b18-btn b18-btn-sm b18-btn-red" data-b18fix="all">全部替换</button>';
    return h;
  }

  function paintBar(finds){
    try{
      if(!BAR) return;
      BAR.innerHTML = barHtml(finds);
    }catch(e){}
  }

  function barFix(which){
    try{
      var ta = BAR_TA || $('ansText');
      if(!ta) return;
      var text = String(ta.value || '');
      var finds = scan(text);
      if(!finds.length) return;

      if(which === 'all'){
        var ok = true;
        try{ ok = window.confirm('将把 ' + finds.length + ' 处口语词替换为规范词，并覆盖作答内容。确定继续？'); }catch(e){ ok = true; }
        if(!ok) return;
        pushLog(text, finds);
        ta.value = applyAll(text, finds);
      }else{
        /* 优先处理当前选区命中的错词，否则处理点击的那一处 */
        var i = parseInt(which, 10);
        var sel = -1, k;
        try{
          if(typeof ta.selectionStart === 'number' && ta.selectionStart !== ta.selectionEnd){
            for(k = 0; k < finds.length; k++){
              if(finds[k].idx >= ta.selectionStart && (finds[k].idx + finds[k].len) <= ta.selectionEnd){ sel = k; break; }
            }
          }
        }catch(e){}
        if(sel >= 0) i = sel;
        if(i < 0 || !finds[i]) return;
        ta.value = applyOne(text, finds, i, finds[i].opts[0]);
      }
      fireInput(ta);
      paintBar(scan(String(ta.value || '')));
    }catch(e){}
  }

  /* 在 #ansText 下方挂一条实时提示条；集成进程负责在弹窗打开时调用 */
  window.b18MountTextarea = function(pid, qno){
    try{
      ensureCss();
      var ta = $('ansText');
      if(!ta) { BAR = null; BAR_TA = null; return false; }
      BAR_TA = ta;
      var old = $('b18-bar');
      if(old && old.parentNode) old.parentNode.removeChild(old);
      var bar = document.createElement('div');
      bar.id = 'b18-bar';
      bar.className = 'b18-bar';
      bar.setAttribute('data-pid', String(pid == null ? '' : pid));
      bar.setAttribute('data-qno', String(qno == null ? '' : qno));
      if(ta.parentNode){
        if(ta.nextSibling) ta.parentNode.insertBefore(bar, ta.nextSibling);
        else ta.parentNode.appendChild(bar);
      }else{ return false; }
      BAR = bar;
      bar.onclick = function(ev){
        try{
          var t = (ev && (ev.target || ev.srcElement)) || null, v = '';
          while(t && t !== document){
            v = t.getAttribute ? (t.getAttribute('data-b18fix') || '') : '';
            if(v) break;
            t = t.parentNode;
          }
          if(v) barFix(v);
        }catch(e){}
      };
      paintBar(scan(String(ta.value || '')));
      return true;
    }catch(e){ return false; }
  };

  /* 输入回调：集成进程在 #ansText 的 input 里调用，传入当前文本 */
  window.b18OnInput = function(text){
    var finds = [];
    try{
      if(text == null){
        var ta = BAR_TA || $('ansText');
        text = ta ? String(ta.value || '') : '';
      }
      finds = scan(String(text || ''));
      paintBar(finds);
    }catch(e){}
    return finds;
  };

  /* 供其它模块复用的纯函数 */
  window.b18Scan = function(text){ return scan(text); };
  window.b18Unmount = function(){
    try{
      var old = $('b18-bar');
      if(old && old.parentNode) old.parentNode.removeChild(old);
    }catch(e){}
    BAR = null; BAR_TA = null;
  };

  /* ================= 路由入口 ================= */
  window.renderErrMark = function(){
    try{
      if(!S.text){
        var src = $('ansText');
        if(src && src.value) S.text = String(src.value || '');
      }
      draw();
    }catch(err){
      try{
        var box = $('content');
        if(box) box.innerHTML = '<div class="b18-empty">错词标红模块运行出错：' +
          esc(String((err && err.message) || err)) + '</div>';
      }catch(e){}
      try{ console.error('[_b18]', err); }catch(e){}
    }
  };

})();
