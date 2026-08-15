/* =====================================================================
   第二十四批：求是时评 (_b24.js)
   展示 _qs_collect.py 采集的求是网公开文章（含正文），
   每篇带「AI拆解」按钮：复制全文 + 结构化拆解任务到剪贴板，
   用户粘贴到 WorkBuddy（同会话）即可当场拆解，AI 回写
   data/qs_articles.json 该篇的 analysis 字段，刷新本页即见。
   依赖：window.esc / window.QS_ARTICLES（主站提供）
   ===================================================================== */
(function () {
  "use strict";
  var openId = null;

  function esc(s) {
    var f = (typeof window !== "undefined" && typeof window.esc === "function") ? window.esc : null;
    return f ? f(s) : String(s == null ? "" : s);
  }
  function arts() {
    return (window.QS_ARTICLES && window.QS_ARTICLES.length) ? window.QS_ARTICLES : [];
  }
  function hasAnalysis(a) {
    var x = a && a.analysis;
    if (!x) return false;
    if (typeof x === "string") return x.trim().length > 0;
    return Object.keys(x).some(function (k) { return x[k] && (Array.isArray(x[k]) ? x[k].length : String(x[k]).length) > 0; });
  }

  function analysisHtml(a) {
    var x = a.analysis;
    if (!hasAnalysis(a)) return "";
    if (typeof x === "string") {
      return '<div class="qs-an"><h4>AI 拆解</h4><p>' + esc(x) + "</p></div>";
    }
    var sec = [
      ["summary", "一句话主旨"],
      ["viewpoint", "核心立意 / 观点"],
      ["structure", "文章结构脉络"],
      ["real_essay_link", "可关联真题方向"]
    ];
    var arrSec = [
      ["usable_themes", "可映射申论母题"],
      ["standard_phrases", "可借用规范表述 / 金句"],
      ["score_points", "可借鉴踩分点 / 论证手法"]
    ];
    var h = '<div class="qs-an"><h4>🤖 AI 拆解</h4>';
    sec.forEach(function (kv) {
      if (x[kv[0]] && String(x[kv[0]]).trim()) {
        h += "<h4>" + kv[1] + "</h4><p>" + esc(x[kv[0]]) + "</p>";
      }
    });
    arrSec.forEach(function (kv) {
      if (x[kv[0]] && x[kv[0]].length) {
        h += "<h4>" + kv[1] + "</h4><ul>" +
          x[kv[0]].map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>";
      }
    });
    h += "</div>";
    return h;
  }

  function buildPrompt(a) {
    var p = "【求是时评 · AI 拆解任务】\n";
    p += "请把下面这篇求是网文章拆解成申论可用素材，并直接回写到文件：\n";
    p += "  " + "D:/workbuddy/国考申论/求是申论素材库/data/qs_articles.json\n";
    p += "目标文章 id: " + a.id + "\n";
    p += "标题: " + a.title + "\n\n";
    p += "=== 文章全文 ===\n" + a.content + "\n\n";
    p += "=== 拆解要求 ===\n";
    p += "把分析结果写回该 id 的 analysis 字段（JSON 对象）：\n";
    p += '{\n  "summary": "一句话主旨",\n  "viewpoint": "核心立意/观点",\n';
    p += '  "structure": "文章结构脉络",\n  "usable_themes": ["可映射申论母题, 如 科技创新/乡村振兴/基层治理"],\n';
    p += '  "standard_phrases": ["可借用规范表述/金句"],\n  "score_points": ["可借鉴踩分点/论证手法"],\n';
    p += '  "real_essay_link": "可关联真题方向(可选)"\n}\n';
    p += "要求：只改这一篇的 analysis，不要动其他字段；写完后告诉我已回写，用户刷新页面即可看到。";
    return p;
  }

  function copyText(txt) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { showMsg("已复制到剪贴板 ✅"); },
          function () { showBox(txt); });
        return;
      }
    } catch (e) {}
    showBox(txt);
  }

  function showBox(txt) {
    var box = document.getElementById("qsMsg");
    if (!box) {
      box = document.createElement("div");
      box.id = "qsMsg";
      box.className = "qs-msg";
      document.body.appendChild(box);
    }
    box.innerHTML = '<span class="qs-msg-x" onclick="document.getElementById(\'qsMsg\').remove()">✕</span>' +
      '已生成拆解任务，请手动复制下方内容，切到 WorkBuddy 粘贴发给我：<br>' +
      '<textarea id="qsMsgTa" readonly>' + esc(txt) + '</textarea>';
    var ta = box.querySelector("#qsMsgTa");
    ta.focus(); ta.select();
  }

  function showMsg(txt) {
    var box = document.getElementById("qsMsg");
    if (!box) {
      box = document.createElement("div");
      box.id = "qsMsg";
      box.className = "qs-msg";
      document.body.appendChild(box);
    }
    box.innerHTML = '<span class="qs-msg-x" onclick="document.getElementById(\'qsMsg\').remove()">✕</span>' + esc(txt);
    setTimeout(function () { if (box && box.parentNode) box.remove(); }, 2600);
  }

  window.qsToggle = function (id) { openId = (openId === id) ? null : id; window.renderQsReviews(); };
  window.qsCopy = function (id) {
    var a = arts().filter(function (x) { return x.id === id; })[0];
    if (a) copyText(a.title + "\n\n" + a.content);
  };
  // 方案 D：优先把文章 id 入队到本地队列服务（shenlun_server.py，默认 8766，
  // 被占用时自动顺延到 8767/8768），由「求是时评·AI自动拆解」自动化每日用免费
  // hy3 析并回写。若服务未启动 / fetch 失败 → 兜底复制全文+任务到剪贴板（现状 C）。
  var QS_QUEUE_PORTS = [8766, 8767, 8768];

  function tryEnqueue(ports, i, id, a) {
    if (i >= ports.length) { copyText(buildPrompt(a)); return; }   // 全失败 → 手动兜底
    var url = "http://127.0.0.1:" + ports[i] + "/api/qs_queue";
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: id })
    }).then(function (r) {
      return r.json().then(function (j) {
        if (r.ok && j && j.ok) {
          showMsg("已入队 ✅ 自动拆解将在每日定时任务完成（手动兜底：「复制全文」随时可用）");
        } else {
          throw new Error("bad");
        }
      }, function () { throw new Error("not json"); });
    }).catch(function () {
      tryEnqueue(ports, i + 1, id, a);   // 换下一个端口重试
    });
  }

  function enqueue(id, a) {
    if (typeof fetch !== "function") { copyText(buildPrompt(a)); return; }
    tryEnqueue(QS_QUEUE_PORTS, 0, id, a);
  }

  window.qsAichai = function (id) {
    var a = arts().filter(function (x) { return x.id === id; })[0];
    if (a) enqueue(id, a);
  };
  window.qsExportPending = function () {
    var pend = arts().filter(function (a) { return !hasAnalysis(a); });
    if (!pend.length) { showMsg("没有待拆解的文章 🎉"); return; }
    var txt = "【求是时评 · 批量 AI 拆解任务】\n请依次拆解以下 " + pend.length + " 篇文章，并回写到\n" +
      "  D:/workbuddy/国考申论/求是申论素材库/data/qs_articles.json\n" +
      "每篇按其 id 写入 analysis 字段（summary/viewpoint/structure/usable_themes/standard_phrases/score_points/real_essay_link）。\n\n";
    pend.forEach(function (a, i) {
      txt += "——— 第" + (i + 1) + "篇 id=" + a.id + " ———\n标题: " + a.title + "\n" + a.content + "\n\n";
    });
    copyText(txt);
  };

  window.renderQsReviews = function () {
    var box = document.getElementById("content");
    if (!box) return;
    var list = arts().slice().sort(function (a, b) {
      return (b.date || "").localeCompare(a.date || "");
    });
    var done = list.filter(hasAnalysis).length;
    var pend = list.length - done;
    var st = document.getElementById("stats");
    if (st) st.textContent = "求是时评 — " + list.length + " 篇 · 已拆解 " + done + " · 待拆解 " + pend;

    var kw = (state.q || "").trim().toLowerCase();
    if (kw) {
      list = list.filter(function (a) {
        return (a.title + " " + (a.content || "") + " " + (a.source || "")).toLowerCase().indexOf(kw) >= 0;
      });
    }

    var html = '<div class="qs-wrap">';
    html += '<div class="qs-head"><span class="qs-badge">求是时评</span>' +
      '<span class="qs-exp">共 ' + list.length + ' 篇 · 已拆解 ' + done + ' · 待拆解 ' + pend + '</span>' +
      '<span class="qs-acts">' +
      '<button class="qs-btn primary" onclick="qsExportPending()">📥 一键导出待析全文(' + pend + ')</button>' +
      '<button class="qs-btn" onclick="qsAichaiTips()">❓ 怎么用</button>' +
      '</span></div>';
    html += '<div class="qs-filters"><input type="text" placeholder="搜索标题 / 正文 / 来源…" value="' + esc(state.q || "") +
      '" oninput="state.q=this.value;window.renderQsReviews()">' +
      '<select onchange="state.q=this.value;window.renderQsReviews()"><option value="">全部来源</option>' +
      uniqOpts(list.map(function (a) { return a.source || ""; })) + '</select></div>';

    if (!list.length) {
      html += '<div class="qs-empty">暂无文章。运行 <code>python _qs_collect.py</code> 采集求是网最新文章后刷新本页。</div></div>';
      box.innerHTML = html;
      return;
    }

    list.forEach(function (a) {
      var on = (a.id === openId);
      var tag = hasAnalysis(a) ? '<span class="qs-tag done">已拆解</span>' : '<span class="qs-tag todo">待拆解</span>';
      var src = a.source ? '<span class="qs-tag src">' + esc(a.source) + '</span>' : '';
      var col = a.column ? '<span class="qs-tag">' + esc(a.column) + '</span>' : '';
      html += '<div class="qs-card' + (on ? " on" : "") + '">';
      html += '<div class="qs-row" onclick="qsToggle(\'' + a.id + '\')">' +
        '<span class="qs-date">' + esc(a.date || "") + '</span>' + src + col + tag +
        '<span class="qs-title">' + esc(a.title) + '</span></div>';
      if (on) {
        html += '<div class="qs-body">';
        html += '<div class="qs-content">' + esc(a.content || "（暂无正文）") + '</div>';
        html += analysisHtml(a);
        html += '<div class="qs-acts" style="margin:0">' +
          '<button class="qs-btn" onclick="qsCopy(\'' + a.id + '\')">📋 复制全文（手动兜底）</button>' +
          '<button class="qs-btn primary" onclick="qsAichai(\'' + a.id + '\')">🤖 AI 拆解（自动入队）</button>' +
          (hasAnalysis(a) ? '<button class="qs-btn" onclick="qsAichai(\'' + a.id + '\')">🔄 重新入队</button>' : '') +
          '</div>';
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
    box.innerHTML = html;
  };

  function uniqOpts(arr) {
    var seen = {}, out = "";
    arr.forEach(function (v) {
      if (v && !seen[v]) { seen[v] = 1; out += '<option value="' + esc(v) + '">' + esc(v) + "</option>"; }
    });
    return out;
  }

  window.qsAichaiTips = function () {
    showMsg("两种拆解方式任选：①自动（推荐）——先启动「申论同步服务器」(python shenlun_server.py)，点「🤖 AI 拆解（自动入队）」即把文章放入待析队列，每日定时任务用免费 hy3 自动拆解并回写，你次日刷新即见；②手动兜底——点「📋 复制全文」复制文章，回 WorkBuddy 粘贴发我，我当场析并回写。两种方式结果都写入同一 analysis 字段。");
  };
})();
