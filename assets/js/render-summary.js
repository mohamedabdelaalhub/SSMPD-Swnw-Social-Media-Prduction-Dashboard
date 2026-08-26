/* SSMPD — شاشة الملخص العام */
(function () {
  "use strict";

  function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // بالإنجليزي دايماً (حتى لو الصفحة عربي) — طلب صريح من المستخدم لأرقام سكشن الإعلانات المدفوعة
  function fmtNum(n) {
    return Number(n || 0).toLocaleString("en-US");
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleDateString("en-US", { day: "2-digit", month: "2-digit", year: "numeric" }); }
    catch (e) { return iso; }
  }

  // نص عربي مبسّط لمؤشر النتيجة الخام من تقرير Meta Ads (زي "reach" أو
  // "actions:onsite_conversion.messaging_conversation_started_7d")
  function resultLabel(indicator) {
    var s = String(indicator || "").toLowerCase();
    if (!s) return "نتائج";
    if (s.indexOf("reach") !== -1) return "وصول";
    if (s.indexOf("thruplay") !== -1 || s.indexOf("video") !== -1) return "مشاهدات فيديو";
    if (s.indexOf("messaging") !== -1) return "محادثات ماسنجر";
    if (s.indexOf("link_click") !== -1) return "نقرات على الرابط";
    if (s.indexOf("purchase") !== -1) return "عمليات شراء";
    if (s.indexOf("lead") !== -1) return "بيانات تواصل (Leads)";
    return "نتائج";
  }

  function kpiCard(label, value, extra) {
    return '<div class="kpi-card"><div class="label">' + label + '</div>' +
      '<div class="value' + (extra && extra.small ? ' small' : '') + '">' + value + '</div>' +
      (extra && extra.delta ? '<div class="delta ' + extra.deltaClass + '">' + extra.delta + '</div>' : '') +
      '</div>';
  }

  // اختيارات مقارنة الأرشيف (أسابيع المؤشرات / دفعات تقارير الإعلانات) — محفوظة
  // على مستوى الموديول عشان تفضل زي ما هي بين كل إعادة رسم للشاشة
  var cmp = { weekA: null, weekB: null, batchA: null, batchB: null };

  function render(container) {
    container.innerHTML = '<div class="loading">بيحمّل المؤشرات…</div>';

    Promise.all([
      window.SSMPDDb.listContentItems({}),
      window.SSMPDDb.listWeeklyMetrics(500),
      window.SSMPDDb.listAdCampaigns()
    ]).then(function (res) {
      var items = res[0], metrics = res[1], ads = res[2];

      var total = items.length;
      var planned = items.filter(function (i) { return i.stage === "idea_selection" || i.stage === "initial_approval"; }).length;
      var inDesign = items.filter(function (i) { return ["in_design", "final_approval", "needs_revision"].indexOf(i.stage) !== -1; }).length;
      var readyOrPublished = items.filter(function (i) { return i.stage === "ready_to_publish"; }).length;
      var published = items.filter(function (i) { return i.stage === "published"; }).length;
      var completion = pct(published, total);

      var current = metrics[0], prev = metrics[1];

      function deltaHtml(cur, prv) {
        if (cur == null || prv == null) return { delta: "", deltaClass: "" };
        var diff = cur - prv;
        if (diff === 0) return { delta: "بدون تغيير", deltaClass: "" };
        return { delta: (diff > 0 ? "▲ " : "▼ ") + Math.abs(diff), deltaClass: diff > 0 ? "up" : "down" };
      }

      var html = '<h2 style="margin-bottom:16px;">الملخص العام</h2>';

      html += '<div class="section"><h3>إنتاج المحتوى</h3><div class="kpi-grid">';
      html += kpiCard("إجمالي المحتوى", total);
      html += kpiCard("مخطط له", planned);
      html += kpiCard("قيد التصميم", inDesign);
      html += kpiCard("جاهز للنشر", readyOrPublished);
      html += kpiCard("تم النشر", published);
      html += kpiCard("نسبة الإنجاز", completion + "%");
      html += '</div></div>';

      html += '<div class="section"><h3>مؤشرات السوشيال ميديا (آخر تحديث أسبوعي)</h3>';
      if (!current) {
        html += '<div class="empty-state">لسه مفيش بيانات مُدخَلة — مسؤول الاعتماد يقدر يضيفها من هنا لاحقاً.</div>';
      } else {
        html += '<div class="kpi-grid">';
        var dR = deltaHtml(current.reach, prev && prev.reach);
        var dE = deltaHtml(current.engagement_rate, prev && prev.engagement_rate);
        var dF = deltaHtml(current.new_followers, prev && prev.new_followers);
        html += kpiCard("الوصول (Reach)", current.reach || 0, dR);
        html += kpiCard("نسبة التفاعل", (current.engagement_rate || 0) + "%", dE);
        html += kpiCard("متابعين جدد", current.new_followers || 0, dF);
        html += '</div><p style="font-size:11px;color:var(--c-muted);margin-top:8px;">آخر أسبوع مُدخَل: ' + current.week_start + '</p>';
      }
      var me = window.SSMPDAuth.currentAdmin;
      var canManageMetrics = window.SSMPDRoles.hasAnyRole(me, ["approver", "general_manager", "super_admin"]);
      if (canManageMetrics) {
        html += '<div style="text-align:left;margin-top:10px;"><button class="btn ghost sm" id="add-week-metrics-btn">+ إدخال بيانات أسبوع جديد</button></div>';
      }
      html += '</div>';

      // ---------- أرشيف + مقارنة + إجماليات مؤشرات السوشيال ميديا الأسبوعية ----------
      html += '<div class="section"><h3>أرشيف مؤشرات السوشيال ميديا</h3>';
      if (metrics.length < 2) {
        html += '<div class="empty-state">محتاج بيانات أسبوعين على الأقل عشان يظهر أرشيف/مقارنة.</div>';
      } else {
        var wTotalReach = 0, wTotalFollowers = 0, wEngSum = 0, wEngCount = 0;
        metrics.forEach(function (m) {
          wTotalReach += Number(m.reach || 0);
          wTotalFollowers += Number(m.new_followers || 0);
          if (m.engagement_rate != null) { wEngSum += Number(m.engagement_rate); wEngCount++; }
        });
        html += '<div class="kpi-grid">';
        html += kpiCard("إجمالي الوصول (كل الأسابيع)", fmtNum(wTotalReach));
        html += kpiCard("إجمالي متابعين جدد (كل الأسابيع)", fmtNum(wTotalFollowers));
        html += kpiCard("متوسط نسبة التفاعل", (wEngCount ? Math.round((wEngSum / wEngCount) * 10) / 10 : 0) + "%");
        html += kpiCard("عدد الأسابيع المُدخَلة", metrics.length);
        html += '</div>';

        if (!cmp.weekA) cmp.weekA = metrics[1].week_start;
        if (!cmp.weekB) cmp.weekB = metrics[0].week_start;
        var wOptions = metrics.map(function (m) { return '<option value="' + m.week_start + '">' + m.week_start + '</option>'; }).join("");
        html += '<h4 style="margin-top:16px;font-size:13px;">مقارنة بين أسبوعين</h4>' +
          '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">' +
          '<select id="wcmp-a">' + wOptions + '</select><span style="font-size:12px;color:var(--c-muted);">مقابل</span>' +
          '<select id="wcmp-b">' + wOptions + '</select></div>';
        var mA = metrics.filter(function (m) { return m.week_start === cmp.weekA; })[0];
        var mB = metrics.filter(function (m) { return m.week_start === cmp.weekB; })[0];
        if (mA && mB) {
          html += '<table class="simple"><thead><tr><th>المؤشر</th><th>' + mA.week_start + '</th><th>' + mB.week_start + '</th><th>الفرق</th></tr></thead><tbody>';
          [
            { k: "reach", label: "الوصول" },
            { k: "engagement_rate", label: "نسبة التفاعل %" },
            { k: "new_followers", label: "متابعين جدد" }
          ].forEach(function (f) {
            var va = Number(mA[f.k] || 0), vb = Number(mB[f.k] || 0), diff = vb - va;
            html += '<tr><td>' + f.label + '</td><td>' + fmtNum(va) + '</td><td>' + fmtNum(vb) + '</td>' +
              '<td class="' + (diff > 0 ? "up" : diff < 0 ? "down" : "") + '">' + (diff > 0 ? "▲ " : diff < 0 ? "▼ " : "") + fmtNum(Math.abs(diff)) + '</td></tr>';
          });
          html += '</tbody></table>';
        }

        html += '<h4 style="margin-top:16px;font-size:13px;">كل الأسابيع</h4>' +
          '<div style="max-height:260px;overflow:auto;"><table class="simple"><thead><tr><th>الأسبوع</th><th>الوصول</th><th>نسبة التفاعل</th><th>متابعين جدد</th></tr></thead><tbody>' +
          metrics.map(function (m) {
            return '<tr><td>' + m.week_start + '</td><td>' + fmtNum(m.reach) + '</td><td>' + (m.engagement_rate || 0) + '%</td><td>' + fmtNum(m.new_followers) + '</td></tr>';
          }).join("") + '</tbody></table></div>';
      }
      html += '</div>';

      // ---------- الإعلانات المدفوعة (Meta Ads) — دفعة حالية + أرشيف دفعات + مقارنة ----------
      var batchesMap = {};
      var batchOrder = [];
      ads.forEach(function (a) {
        var bid = a.report_batch_id || "بدون دفعة";
        if (!batchesMap[bid]) { batchesMap[bid] = { id: bid, rows: [], createdAt: a.created_at }; batchOrder.push(bid); }
        batchesMap[bid].rows.push(a);
        if (a.created_at && a.created_at > batchesMap[bid].createdAt) batchesMap[bid].createdAt = a.created_at;
      });
      var batches = batchOrder.map(function (id) { return batchesMap[id]; })
        .sort(function (x, y) { return (y.createdAt || "").localeCompare(x.createdAt || ""); });

      function batchTotals(rows) {
        var t = { spent: 0, reach: 0, clicks: 0, impressions: 0, ctrSum: 0, ctrCount: 0, minStart: null, maxEnd: null };
        rows.forEach(function (a) {
          t.spent += Number(a.amount_spent || 0);
          t.reach += Number(a.reach || 0);
          t.clicks += Number(a.link_clicks || 0);
          t.impressions += Number(a.impressions || 0);
          if (a.ctr != null) { t.ctrSum += Number(a.ctr); t.ctrCount++; }
          if (a.reporting_start && (!t.minStart || a.reporting_start < t.minStart)) t.minStart = a.reporting_start;
          if (a.reporting_end && (!t.maxEnd || a.reporting_end > t.maxEnd)) t.maxEnd = a.reporting_end;
        });
        t.avgCtr = t.ctrCount ? Math.round((t.ctrSum / t.ctrCount) * 100) / 100 : 0;
        return t;
      }

      html += '<div class="section"><h3>الإعلانات المدفوعة (Meta Ads)</h3>';
      if (!batches.length) {
        html += '<div class="empty-state">لسه مفيش تقرير حملات إعلانات مستورد.</div>';
      } else {
        var latest = batches[0];
        var lt = batchTotals(latest.rows);
        html += '<p style="font-size:12px;color:var(--c-muted);">آخر تقرير مستورد — ' + fmtDate(latest.createdAt) + '</p>';
        html += '<div class="kpi-grid">';
        html += kpiCard("إجمالي المبلغ المُنفق", fmtNum(lt.spent) + " ج.م", { small: true });
        html += kpiCard("إجمالي الوصول", fmtNum(lt.reach));
        html += kpiCard("إجمالي النقرات", fmtNum(lt.clicks));
        html += kpiCard("متوسط نسبة النقر", lt.avgCtr + "%");
        html += '</div>';

        html += '<table class="simple" style="margin-top:12px;"><thead><tr>' +
          '<th>الحملة</th><th>المبلغ المُنفق</th><th>النتائج</th><th>تكلفة النتيجة</th><th>الوصول</th><th>النقرات</th><th>نسبة النقر</th>' +
          '</tr></thead><tbody>';
        latest.rows.forEach(function (a) {
          html += '<tr><td>' + escapeHtml(a.campaign_name) + '</td>' +
            '<td>' + fmtNum(a.amount_spent) + ' ج.م</td>' +
            '<td>' + fmtNum(a.results) + ' ' + resultLabel(a.result_indicator) + '</td>' +
            '<td>' + (a.cost_per_result != null ? fmtNum(a.cost_per_result) + ' ج.م' : '—') + '</td>' +
            '<td>' + fmtNum(a.reach) + '</td>' +
            '<td>' + fmtNum(a.link_clicks) + '</td>' +
            '<td>' + (a.ctr != null ? a.ctr + '%' : '—') + '</td></tr>';
        });
        html += '</tbody></table>';
        if (lt.minStart && lt.maxEnd) {
          html += '<p style="font-size:11px;color:var(--c-muted);margin-top:8px;">بيانات التقرير من ' + lt.minStart + ' لحد ' + lt.maxEnd + '</p>';
        }

        // إجمالي كل التقارير من أول استيراد لحد دلوقتي (كل الدفعات مع بعض)
        var allTotals = batchTotals(ads);
        html += '<h4 style="margin-top:16px;font-size:13px;">إجمالي كل التقارير (' + batches.length + ' تقرير)</h4><div class="kpi-grid">';
        html += kpiCard("إجمالي الإنفاق الكلي", fmtNum(allTotals.spent) + " ج.م", { small: true });
        html += kpiCard("إجمالي الوصول الكلي", fmtNum(allTotals.reach));
        html += kpiCard("إجمالي النقرات الكلي", fmtNum(allTotals.clicks));
        html += '</div>';

        if (batches.length >= 2) {
          if (!cmp.batchA) cmp.batchA = batches[1].id;
          if (!cmp.batchB) cmp.batchB = batches[0].id;
          var bOptions = batches.map(function (b) {
            return '<option value="' + escapeHtml(b.id) + '">' + fmtDate(b.createdAt) + ' (' + b.rows.length + ' حملة)</option>';
          }).join("");
          html += '<h4 style="margin-top:16px;font-size:13px;">مقارنة بين تقريرين</h4>' +
            '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">' +
            '<select id="acmp-a">' + bOptions + '</select><span style="font-size:12px;color:var(--c-muted);">مقابل</span>' +
            '<select id="acmp-b">' + bOptions + '</select></div>';
          var bA = batchesMap[cmp.batchA], bB = batchesMap[cmp.batchB];
          if (bA && bB) {
            var tA = batchTotals(bA.rows), tB = batchTotals(bB.rows);
            html += '<table class="simple"><thead><tr><th>المؤشر</th><th>' + fmtDate(bA.createdAt) + '</th><th>' + fmtDate(bB.createdAt) + '</th><th>الفرق</th></tr></thead><tbody>';
            [
              { a: tA.spent, b: tB.spent, label: "المبلغ المُنفق (ج.م)" },
              { a: tA.reach, b: tB.reach, label: "الوصول" },
              { a: tA.clicks, b: tB.clicks, label: "النقرات" }
            ].forEach(function (f) {
              var diff = f.b - f.a;
              html += '<tr><td>' + f.label + '</td><td>' + fmtNum(f.a) + '</td><td>' + fmtNum(f.b) + '</td>' +
                '<td class="' + (diff > 0 ? "up" : diff < 0 ? "down" : "") + '">' + (diff > 0 ? "▲ " : diff < 0 ? "▼ " : "") + fmtNum(Math.abs(diff)) + '</td></tr>';
            });
            html += '</tbody></table>';
          }
        }

        html += '<h4 style="margin-top:16px;font-size:13px;">أرشيف التقارير</h4>' +
          '<table class="simple"><thead><tr><th>تاريخ الاستيراد</th><th>عدد الحملات</th><th>الإنفاق</th><th>الوصول</th></tr></thead><tbody>' +
          batches.map(function (b) {
            var t = batchTotals(b.rows);
            return '<tr><td>' + fmtDate(b.createdAt) + '</td><td>' + b.rows.length + '</td><td>' + fmtNum(t.spent) + ' ج.م</td><td>' + fmtNum(t.reach) + '</td></tr>';
          }).join("") + '</tbody></table>';
      }
      if (canManageMetrics) {
        html += '<div style="text-align:left;margin-top:10px;"><button class="btn ghost sm" id="import-ads-btn">+ استيراد تقرير حملات إعلانات</button></div>';
      }
      html += '</div>';

      container.innerHTML = html;
      var btn = document.getElementById("add-week-metrics-btn");
      if (btn) btn.onclick = openMetricsModal;
      var adsBtn = document.getElementById("import-ads-btn");
      if (adsBtn) adsBtn.onclick = openAdImportModal;

      var wcmpA = document.getElementById("wcmp-a"), wcmpB = document.getElementById("wcmp-b");
      if (wcmpA) { wcmpA.value = cmp.weekA; wcmpA.onchange = function () { cmp.weekA = wcmpA.value; render(container); }; }
      if (wcmpB) { wcmpB.value = cmp.weekB; wcmpB.onchange = function () { cmp.weekB = wcmpB.value; render(container); }; }
      var acmpA = document.getElementById("acmp-a"), acmpB = document.getElementById("acmp-b");
      if (acmpA) { acmpA.value = cmp.batchA; acmpA.onchange = function () { cmp.batchA = acmpA.value; render(container); }; }
      if (acmpB) { acmpB.value = cmp.batchB; acmpB.onchange = function () { cmp.batchB = acmpB.value; render(container); }; }
    }).catch(function (e) {
      container.innerHTML = '<div class="err-msg">تعذّر تحميل الملخص: ' + e.message + '</div>';
    });
  }

  // ---------- استيراد CSV من Meta Business Suite / Meta Ads / Google Ads ----------
  // أعمدة الملفات دي بتختلف بحسب المصدر، فبنعمل مطابقة بالكلمات المفتاحية (عربي/إنجليزي)
  // بدل الاعتماد على شكل ملف واحد بعينه.
  var REACH_KEYS = ["reach", "الوصول", "impressions", "ظهور"];
  var ENGAGE_KEYS = ["engagement rate", "engagement", "نسبة التفاعل", "تفاعل"];
  var FOLLOWERS_KEYS = ["new followers", "followers", "متابعين جدد", "متابعين"];

  function splitCsvLine(line) {
    var out = [], cur = "", inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === "," && !inQ) { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  }

  function toNumber(s) {
    if (s == null) return null;
    var n = Number(String(s).replace(/[,%\s]/g, ""));
    return isNaN(n) ? null : n;
  }

  function matchCol(header, keys) {
    var h = String(header || "").toLowerCase();
    for (var i = 0; i < keys.length; i++) {
      if (h.indexOf(keys[i].toLowerCase()) !== -1) return true;
    }
    return false;
  }

  // بيرجع { reach, engagement, followers } — أي قيمة معرفناش نلاقيها بترجع null وتفضل الخانة يدوية
  function parseMetricsCsv(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim().length; });
    if (lines.length < 2) throw new Error("الملف فاضي أو مش بصيغة CSV مفهومة");
    var headers = splitCsvLine(lines[0]);
    var reachIdx = -1, engageIdx = -1, followersIdx = -1;
    headers.forEach(function (h, idx) {
      if (reachIdx === -1 && matchCol(h, REACH_KEYS)) reachIdx = idx;
      if (engageIdx === -1 && matchCol(h, ENGAGE_KEYS)) engageIdx = idx;
      if (followersIdx === -1 && matchCol(h, FOLLOWERS_KEYS)) followersIdx = idx;
    });
    var dataLines = lines.slice(1).map(splitCsvLine);
    var result = { reach: null, engagement: null, followers: null };

    if (reachIdx !== -1) {
      var sumReach = 0, gotReach = false;
      dataLines.forEach(function (r) { var n = toNumber(r[reachIdx]); if (n != null) { sumReach += n; gotReach = true; } });
      if (gotReach) result.reach = sumReach;
    }
    if (followersIdx !== -1) {
      var sumF = 0, gotF = false;
      dataLines.forEach(function (r) { var n = toNumber(r[followersIdx]); if (n != null) { sumF += n; gotF = true; } });
      if (gotF) result.followers = sumF;
    }
    if (engageIdx !== -1) {
      var vals = dataLines.map(function (r) { return toNumber(r[engageIdx]); }).filter(function (n) { return n != null; });
      if (vals.length) result.engagement = Math.round((vals.reduce(function (a, b) { return a + b; }, 0) / vals.length) * 10) / 10;
    }
    return result;
  }

  // ---------- استيراد تقرير حملات إعلانات مدفوعة (Meta Ads Manager — Campaigns export) ----------
  // مختلف عن استيراد المؤشرات الأسبوعية فوق: أعمدة ثابتة معروفة (تصدير Meta Ads نفسه)،
  // فبنعتمد على تطابق تام لاسم العمود (مش كلمات مفتاحية) لتفادي أي لخبطة.
  // بيدوّر على أول candidate (بالترتيب — الأولوية للأول) له تطابق تام مع عمود في الهيدر.
  // مهم إن الدور يبقى على الـ candidates مش على أعمدة الهيدر، عشان مثلاً "CTR (all)"
  // ظاهر في الملف قبل "CTR (link click-through rate)" بس إحنا عايزين التاني بالأولوية.
  function findExactCol(headers, candidates) {
    var lowerHeaders = headers.map(function (h) { return String(h || "").trim().toLowerCase(); });
    for (var c = 0; c < candidates.length; c++) {
      var i = lowerHeaders.indexOf(candidates[c]);
      if (i !== -1) return i;
    }
    return -1;
  }

  // بيرجع مصفوفة صفوف — صف واحد لكل حملة (campaign_name)، الأرقام مجمّعة (sum) لو
  // نفس الحملة ظهرت أكتر من مرة في الملف (بيحصل لأن التصدير بيبقى على مستوى مجموعة الإعلان)
  function parseAdCampaignsCsv(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim().length; });
    if (lines.length < 2) throw new Error("الملف فاضي أو مش بصيغة CSV مفهومة");
    var headers = splitCsvLine(lines[0]);
    var idx = {
      name: findExactCol(headers, ["campaign name"]),
      spent: findExactCol(headers, ["amount spent (egp)", "amount spent"]),
      impressions: findExactCol(headers, ["impressions"]),
      reach: findExactCol(headers, ["reach"]),
      results: findExactCol(headers, ["results"]),
      resultIndicator: findExactCol(headers, ["result indicator"]),
      linkClicks: findExactCol(headers, ["link clicks"]),
      ctr: findExactCol(headers, ["ctr (link click-through rate)", "ctr (all)"]),
      reportStart: findExactCol(headers, ["reporting starts"]),
      reportEnd: findExactCol(headers, ["reporting ends"])
    };
    if (idx.name === -1) throw new Error('معرفناش نلاقي عمود "Campaign name" في الملف — تأكد إنه تصدير حملات من Meta Ads Manager');

    var byName = {}, order = [];
    lines.slice(1).map(splitCsvLine).forEach(function (r) {
      var name = (r[idx.name] || "").trim();
      if (!name) return;
      var spent = idx.spent !== -1 ? (toNumber(r[idx.spent]) || 0) : 0;
      var impressions = idx.impressions !== -1 ? (toNumber(r[idx.impressions]) || 0) : 0;
      var reach = idx.reach !== -1 ? (toNumber(r[idx.reach]) || 0) : 0;
      if (!spent && !impressions && !reach) return; // تجاهل صفوف إعلانات مش شغالة (كل الأرقام صفر)

      if (!byName[name]) {
        byName[name] = {
          campaign_name: name, amount_spent: 0, impressions: 0, reach: 0, results: 0,
          result_indicator: idx.resultIndicator !== -1 ? (r[idx.resultIndicator] || null) : null,
          link_clicks: 0, ctrSum: 0, ctrCount: 0, reporting_start: null, reporting_end: null
        };
        order.push(name);
      }
      var row = byName[name];
      row.amount_spent += spent;
      row.impressions += impressions;
      row.reach += reach;
      if (idx.results !== -1) row.results += (toNumber(r[idx.results]) || 0);
      if (idx.linkClicks !== -1) row.link_clicks += (toNumber(r[idx.linkClicks]) || 0);
      if (idx.ctr !== -1) { var c = toNumber(r[idx.ctr]); if (c != null) { row.ctrSum += c; row.ctrCount++; } }
      if (idx.reportStart !== -1 && r[idx.reportStart] && (!row.reporting_start || r[idx.reportStart] < row.reporting_start)) row.reporting_start = r[idx.reportStart];
      if (idx.reportEnd !== -1 && r[idx.reportEnd] && (!row.reporting_end || r[idx.reportEnd] > row.reporting_end)) row.reporting_end = r[idx.reportEnd];
    });

    return order.map(function (name) {
      var row = byName[name];
      return {
        campaign_name: row.campaign_name,
        amount_spent: Math.round(row.amount_spent * 100) / 100,
        impressions: row.impressions,
        reach: row.reach,
        results: row.results,
        result_indicator: row.result_indicator,
        cost_per_result: row.results > 0 ? Math.round((row.amount_spent / row.results) * 100) / 100 : null,
        link_clicks: row.link_clicks,
        ctr: row.ctrCount ? Math.round((row.ctrSum / row.ctrCount) * 1000) / 1000 : null,
        reporting_start: row.reporting_start,
        reporting_end: row.reporting_end
      };
    });
  }

  function openAdImportModal() {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal" style="max-width:460px;"><div class="modal-head"><h3>استيراد تقرير حملات إعلانات</h3>' +
      '<button class="modal-close">×</button></div>' +
      '<p style="font-size:12px;color:var(--c-muted);">ارفع ملف CSV تصدير الحملات من Meta Ads Manager — هيتحفظ كتقرير جديد في الأرشيف من غير ما يمسح التقارير القديمة.</p>' +
      '<div class="field"><input type="file" id="ad-csv-file" accept=".csv,text/csv"></div>' +
      '<div id="ad-csv-status" style="font-size:11px;color:var(--c-muted);margin-bottom:10px;"></div>' +
      '<div style="text-align:left;"><button class="btn" id="ad-csv-save" disabled>حفظ كتقرير جديد</button></div></div>';
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    var parsedRows = null;
    var fileInput = document.getElementById("ad-csv-file");
    var status = document.getElementById("ad-csv-status");
    var saveBtn = document.getElementById("ad-csv-save");

    fileInput.onchange = function () {
      var file = fileInput.files[0];
      if (!file) return;
      status.textContent = "بيقرأ الملف…";
      saveBtn.disabled = true;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          parsedRows = parseAdCampaignsCsv(String(reader.result));
          if (!parsedRows.length) {
            status.textContent = "معرفناش نلاقي بيانات حملات شغالة في الملف";
            return;
          }
          status.textContent = "لقينا " + parsedRows.length + " حملة — اضغط حفظ عشان يتضاف كتقرير جديد في الأرشيف";
          saveBtn.disabled = false;
        } catch (e) {
          status.textContent = "تعذّر قراءة الملف: " + e.message;
        }
      };
      reader.readAsText(file);
    };

    saveBtn.onclick = function () {
      if (!parsedRows || !parsedRows.length) return;
      var me = window.SSMPDAuth.currentAdmin;
      var batchId = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() :
        "b-" + Date.now() + "-" + Math.random().toString(16).slice(2);
      saveBtn.disabled = true;
      // كل استيراد بقى دفعة (report_batch_id) جديدة منفصلة في الأرشيف — مفيش
      // مسح للتقارير القديمة بعد كده (كانت clearAdCampaigns() بتمسح كل حاجة قبل الحفظ)
      window.SSMPDDb.insertAdCampaigns(parsedRows.map(function (r) {
        return Object.assign({}, r, { imported_by: me.id, report_batch_id: batchId });
      })).then(function () {
        backdrop.remove();
        render(document.getElementById("view-container"));
      }).catch(function (e) { alert("خطأ: " + e.message); saveBtn.disabled = false; });
    };
  }

  function openMetricsModal() {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    var today = new Date();
    var monday = new Date(today); monday.setDate(today.getDate() - today.getDay() + 1);
    var iso = monday.toISOString().slice(0, 10);
    backdrop.innerHTML = '<div class="modal" style="max-width:420px;"><div class="modal-head"><h3>بيانات الأسبوع</h3>' +
      '<button class="modal-close">×</button></div>' +
      '<div class="field"><label>بداية الأسبوع</label><input type="date" id="wm-week" value="' + iso + '"></div>' +
      '<div class="field"><label>أو ارفع تقرير CSV (Meta Business Suite / Meta Ads / Google Ads)</label>' +
      '<input type="file" id="wm-csv-file" accept=".csv,text/csv"></div>' +
      '<div id="wm-csv-status" style="font-size:11px;color:var(--c-muted);margin-bottom:10px;"></div>' +
      '<div class="field"><label>الوصول (Reach)</label><input type="number" id="wm-reach"></div>' +
      '<div class="field"><label>نسبة التفاعل %</label><input type="number" step="0.1" id="wm-eng"></div>' +
      '<div class="field"><label>متابعين جدد</label><input type="number" id="wm-followers"></div>' +
      '<div style="text-align:left;"><button class="btn" id="wm-save">حفظ</button></div></div>';
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    var csvInput = document.getElementById("wm-csv-file");
    var csvStatus = document.getElementById("wm-csv-status");
    csvInput.onchange = function () {
      var file = csvInput.files[0];
      if (!file) return;
      csvStatus.textContent = "بيقرأ الملف…";
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var parsed = parseMetricsCsv(String(reader.result));
          var found = [];
          if (parsed.reach != null) { document.getElementById("wm-reach").value = parsed.reach; found.push("الوصول"); }
          if (parsed.engagement != null) { document.getElementById("wm-eng").value = parsed.engagement; found.push("نسبة التفاعل"); }
          if (parsed.followers != null) { document.getElementById("wm-followers").value = parsed.followers; found.push("متابعين جدد"); }
          csvStatus.textContent = found.length
            ? "اتقرا من الملف: " + found.join("، ") + " — راجع الأرقام تحت قبل الحفظ"
            : "معرفناش نلاقي أعمدة معروفة في الملف — أدخل الأرقام يدوي أو جرّب تصدير تاني";
        } catch (e) {
          csvStatus.textContent = "تعذّر قراءة الملف: " + e.message;
        }
      };
      reader.readAsText(file);
    };

    document.getElementById("wm-save").onclick = function () {
      var me = window.SSMPDAuth.currentAdmin;
      window.SSMPDDb.upsertWeeklyMetrics({
        week_start: document.getElementById("wm-week").value,
        reach: Number(document.getElementById("wm-reach").value) || 0,
        engagement_rate: Number(document.getElementById("wm-eng").value) || 0,
        new_followers: Number(document.getElementById("wm-followers").value) || 0,
        entered_by: me.id
      }).then(function () {
        backdrop.remove();
        render(document.getElementById("view-container"));
      }).catch(function (e) { alert("خطأ: " + e.message); });
    };
  }

  window.SSMPDRenderSummary = { render: render };
})();
