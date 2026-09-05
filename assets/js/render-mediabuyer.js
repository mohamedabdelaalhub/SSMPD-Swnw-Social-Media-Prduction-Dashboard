/* SSMPD — Media Buyer Control Center (قسم ٣٨ — Phase 1)
   لوحة تحكم/اعتماد بشري بس. مفيش أي اتصال بـMeta API هنا خالص، ومفيش أي
   تنفيذ فعلي على Meta — "اعتماد" في المرحلة دي بيغيّر حالة الاعتماد في
   Supabase بس. الوكيل الخارجي (Claude Media Buyer) هو اللي هيضيف خطط/
   actions لاحقًا (عن طريق مفتاح service_role — بيتخطى RLS)، واللوحة هنا
   بتعرضها وتسمح للمدير العام/السوبر أدمن يعتمدوا/يرفضوا بس. */
(function () {
  "use strict";

  var ACTION_LABELS = {
    create_campaign: "إنشاء حملة", create_adset: "إنشاء مجموعة إعلانية", create_ad: "إنشاء إعلان",
    increase_budget: "🟢 زيادة ميزانية", decrease_budget: "🟡 تقليل ميزانية",
    pause_campaign: "🔴 إيقاف حملة", pause_adset: "🔴 إيقاف مجموعة إعلانية", pause_ad: "🔴 إيقاف إعلان",
    resume_campaign: "🟢 استئناف حملة", resume_adset: "🟢 استئناف مجموعة إعلانية", resume_ad: "🟢 استئناف إعلان"
  };
  var RECOMMENDATION_LABELS = {
    scale: "🟢 SCALE — توسيع", hold: "🟡 HOLD — استمرار بدون تغيير",
    retest: "🧪 RETEST — إعادة اختبار", pause: "🔴 PAUSE — إيقاف مقترح", create: "🆕 CREATE — إنشاء"
  };
  var STATUS_LABELS = {
    draft: "مسودة", pending_approval: "بانتظار الاعتماد", approved: "معتمدة", rejected: "مرفوضة",
    executing: "جاري التنفيذ", live: "شغّالة", paused: "متوقفة", completed: "مكتملة", failed: "فشلت",
    proposed: "مقترح", executed: "تم التنفيذ", cancelled: "ملغي"
  };

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function fmtMoney(n) { return n == null || isNaN(n) ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " ج.م"; }
  function fmtNum(n) { return n == null || isNaN(n) ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 }); }
  function fmtDateTime(d) {
    if (!d) return "—";
    try { return new Date(d).toLocaleString("en-US", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return d; }
  }
  function statusLabel(s) { return STATUS_LABELS[s] || s || "—"; }
  function kpiCard(label, value) {
    return '<div class="kpi-card"><div class="label">' + label + '</div><div class="value small">' + value + '</div></div>';
  }

  var plans = [], actions = [], contentItems = [], contentById = {};

  function canApprove() {
    var me = window.SSMPDAuth.currentAdmin;
    return window.SSMPDRoles.canApproveMediaBuyer(me);
  }

  function contentLinkHtml(id) {
    if (!id || !contentById[id]) return "—";
    return '<button class="btn ghost sm" data-goto-content="' + id + '" style="font-size:10px;padding:2px 6px;">' + escapeHtml(contentById[id].title) + '</button>';
  }
  function wireGotoContentButtons(root) {
    if (!window.SSMPDGotoContent) return;
    root.querySelectorAll("[data-goto-content]").forEach(function (btn) {
      btn.onclick = function () { window.SSMPDGotoContent(btn.getAttribute("data-goto-content")); };
    });
  }

  // ---------- (A) ملخص تنفيذي ----------
  function execSummaryHtml() {
    var activePlans = plans.filter(function (p) { return ["approved", "executing", "live"].indexOf(p.status) !== -1; }).length;
    var pendingApprovals = plans.filter(function (p) { return p.status === "pending_approval"; }).length
      + actions.filter(function (a) { return a.status === "proposed"; }).length;
    var approvedWaiting = actions.filter(function (a) { return a.status === "approved"; }).length;
    var live = plans.filter(function (p) { return p.status === "live"; }).length;
    var recommendedPauses = actions.filter(function (a) { return /pause/.test(a.action_type) && a.status === "proposed"; }).length;
    var recommendedScales = actions.filter(function (a) { return /increase_budget|resume/.test(a.action_type) && a.status === "proposed"; }).length;
    var totalSpendPlanned = plans.reduce(function (s, p) { return s + (Number(p.total_budget) || 0); }, 0);
    return '<div class="kpi-grid">' +
      kpiCard("خطط نشطة", fmtNum(activePlans)) +
      kpiCard("بانتظار الاعتماد", fmtNum(pendingApprovals)) +
      kpiCard("actions معتمدة بانتظار التنفيذ", fmtNum(approvedWaiting)) +
      kpiCard("حملات شغّالة", fmtNum(live)) +
      kpiCard("موصى بإيقافها", fmtNum(recommendedPauses)) +
      kpiCard("موصى بتوسيعها", fmtNum(recommendedScales)) +
      kpiCard("إجمالي الميزانيات المخططة", fmtMoney(totalSpendPlanned)) +
      '</div>';
  }

  // ---------- (B) اقتراحات الحملات ----------
  function planCardHtml(p) {
    var canAct = canApprove() && p.status === "pending_approval";
    var actBtns = canAct
      ? '<button class="btn sm" data-approve-plan="' + p.id + '">اعتماد</button> ' +
        '<button class="btn ghost sm" data-reject-plan="' + p.id + '">رفض</button> ' +
        '<button class="btn ghost sm" data-edit-plan="' + p.id + '">تعديل</button>'
      : (canApprove() ? '<button class="btn ghost sm" data-edit-plan="' + p.id + '">تعديل</button>' : "");
    return '<div class="section" style="margin-bottom:10px;">' +
      '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">' +
      '<div><strong>' + escapeHtml(p.title) + '</strong> — <span style="font-size:11px;color:var(--c-muted);">' + statusLabel(p.status) + '</span></div>' +
      '<div>' + actBtns + '</div></div>' +
      '<div style="font-size:12px;color:var(--c-muted);margin-top:4px;">' +
      (p.brand ? escapeHtml(p.brand) + " · " : "") + (p.specialty ? escapeHtml(p.specialty) + " · " : "") + escapeHtml(p.objective) +
      '</div>' +
      '<div style="margin-top:6px;font-size:13px;">' +
      'المحتوى/الكرييتف: ' + (p.content_item_id ? contentLinkHtml(p.content_item_id) : (p.creative_group_id ? escapeHtml(p.creative_group_id) : "—")) +
      '</div>' +
      '<div style="margin-top:6px;font-size:13px;">الميزانية اليومية: ' + fmtMoney(p.daily_budget) + ' — الإجمالية: ' + fmtMoney(p.total_budget) +
      ' (' + escapeHtml(p.currency || "EGP") + ')</div>' +
      '<div style="margin-top:6px;font-size:13px;">الفترة: ' + (p.start_date || "—") + ' → ' + (p.end_date || "—") + '</div>' +
      (p.targeting_summary ? '<div style="margin-top:6px;font-size:13px;"><b>الاستهداف:</b> ' + escapeHtml(p.targeting_summary) + '</div>' : "") +
      (p.strategy_summary ? '<div style="margin-top:6px;font-size:13px;"><b>الاستراتيجية:</b> ' + escapeHtml(p.strategy_summary) + '</div>' : "") +
      (p.rationale ? '<div style="margin-top:6px;font-size:13px;"><b>ليه Claude بيرشحها:</b> ' + escapeHtml(p.rationale) + '</div>' : "") +
      '<div style="margin-top:6px;font-size:12px;color:var(--c-muted);">الثقة: ' + escapeHtml(p.agent_confidence || "—") +
      ' — مقترحة من: ' + escapeHtml(p.proposed_by) + '</div>' +
      (p.status === "rejected" && p.rejection_reason ? '<div style="margin-top:6px;font-size:12px;color:var(--c-negative);">سبب الرفض: ' + escapeHtml(p.rejection_reason) + '</div>' : "") +
      '</div>';
  }
  function planProposalsHtml() {
    if (!plans.length) return '<p style="color:var(--c-muted);font-size:13px;">لا توجد خطط مقترحة حالياً.</p>';
    return plans.map(planCardHtml).join("");
  }

  // ---------- (C) توصيات الوكيل (Agent Recommendations) — actions على حملات/مجموعات/إعلانات قائمة ----------
  function actionCardHtml(a) {
    var canAct = canApprove() && a.status === "proposed";
    var payload = a.proposed_payload || {};
    var budgetChange = (payload.new_budget != null) ? ("الميزانية الجديدة المقترحة: " + fmtMoney(payload.new_budget)) :
      (payload.budget_change_pct != null ? ("نسبة التغيير: " + payload.budget_change_pct + "%") : "");
    // العنوان: recommendation_type (SCALE/HOLD/RETEST/PAUSE/CREATE) لو موجود، وإلا اسم action_type التنفيذي القديم
    var titleHtml = a.recommendation_type
      ? (RECOMMENDATION_LABELS[a.recommendation_type] || escapeHtml(a.recommendation_type))
      : (ACTION_LABELS[a.action_type] || escapeHtml(a.action_type));
    // HOLD/RETEST توصيات استشارية بس (مفيش action_type تنفيذي معاها) — نوضح ده صراحة، الاعتماد هنا معناه "اتفقنا على التوصية" مش تنفيذ فعلي
    var isAdvisoryOnly = !a.action_type && a.recommendation_type;
    return '<div class="section" style="margin-bottom:10px;">' +
      '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">' +
      '<div><strong>' + titleHtml + '</strong>' + (a.action_type ? ' <span style="font-size:11px;color:var(--c-muted);">(' + (ACTION_LABELS[a.action_type] || escapeHtml(a.action_type)) + ')</span>' : '') +
      ' — <span style="font-size:11px;color:var(--c-muted);">' + statusLabel(a.status) + '</span></div>' +
      (canAct ? '<div><button class="btn sm" data-approve-action="' + a.id + '">اعتماد</button> ' +
        '<button class="btn ghost sm" data-reject-action="' + a.id + '">رفض</button></div>' : '') +
      '</div>' +
      (isAdvisoryOnly ? '<div style="font-size:11px;color:var(--c-muted);margin-top:4px;">توصية استشارية بس — مفيش تعديل فعلي على Meta مرتبط بيها.</div>' : '') +
      '<div style="font-size:12px;color:var(--c-muted);margin-top:4px;">الهدف: ' + escapeHtml(a.target_type || "—") +
      (a.target_platform_id ? " (" + escapeHtml(a.target_platform_id) + ")" : "") + '</div>' +
      (budgetChange ? '<div style="margin-top:6px;font-size:13px;">' + escapeHtml(budgetChange) + '</div>' : "") +
      (a.reason ? '<div style="margin-top:6px;font-size:13px;"><b>السبب:</b> ' + escapeHtml(a.reason) + '</div>' : "") +
      '</div>';
  }
  function agentRecommendationsHtml() {
    // actions على حملات/مجموعات/إعلانات قائمة فعلاً (target_type)، أو أي توصية استشارية (recommendation_type — بما فيها HOLD/RETEST من غير target_type)
    var recs = actions.filter(function (a) { return a.target_type || a.recommendation_type; });
    if (!recs.length) return '<p style="color:var(--c-muted);font-size:13px;">لا توجد توصيات حالياً.</p>';
    return recs.map(actionCardHtml).join("");
  }

  // ---------- (D) المراقبة الحية — من vw_meta_ad_performance (بيانات فعلية موجودة بالفعل) ----------
  function liveMonitoringHtml(adRows) {
    if (!adRows.length) return '<p style="color:var(--c-muted);font-size:13px;">لا توجد بيانات أداء حالياً.</p>';
    var html = '<div style="max-height:340px;overflow:auto;"><table class="simple"><thead><tr>' +
      '<th>الحملة</th><th>المجموعة الإعلانية</th><th>الإعلان</th><th>الإنفاق</th><th>الوصول</th><th>الظهور</th>' +
      '<th>محادثات</th><th>Leads</th><th>تكلفة المحادثة</th><th>CPL</th><th>CTR</th><th>CPC</th><th>CPM</th><th>الحالة</th>' +
      '<th>المحتوى المرتبط</th></tr></thead><tbody>';
    adRows.forEach(function (r) {
      html += '<tr><td>' + escapeHtml(r.campaign_name) + '</td><td>' + escapeHtml(r.adset_name) + '</td><td style="font-size:11px;">' + escapeHtml(r.ad_name) + '</td>' +
        '<td>' + fmtMoney(r.spend) + '</td><td>' + fmtNum(r.reach) + '</td><td>' + fmtNum(r.impressions) + '</td>' +
        '<td>' + fmtNum(r.msg_conv) + '</td><td>' + fmtNum(r.leads) + '</td>' +
        '<td>' + (r.cost_per_msg_conv == null ? "—" : fmtMoney(r.cost_per_msg_conv)) + '</td>' +
        '<td>' + (r.cost_per_lead == null ? "—" : fmtMoney(r.cost_per_lead)) + '</td>' +
        '<td>' + (r.ctr == null ? "—" : r.ctr) + '</td><td>' + (r.cpc == null ? "—" : fmtMoney(r.cpc)) + '</td><td>' + (r.cpm == null ? "—" : fmtMoney(r.cpm)) + '</td>' +
        '<td>' + escapeHtml(r.status) + '</td><td>' + (r.content_id ? contentLinkHtml(r.content_id) : "—") + '</td></tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  // ---------- (E) سجل القرارات (Decision History) ----------
  function decisionHistoryHtml() {
    var events = [];
    plans.forEach(function (p) {
      events.push({ t: p.created_at, text: "Claude اقترح خطة «" + p.title + "»" });
      if (p.approved_at) events.push({ t: p.approved_at, text: "تم اعتماد خطة «" + p.title + "»" });
      if (p.rejected_at) events.push({ t: p.rejected_at, text: "تم رفض خطة «" + p.title + "»" + (p.rejection_reason ? (" — " + p.rejection_reason) : "") });
    });
    actions.forEach(function (a) {
      events.push({ t: a.created_at, text: "Claude اقترح: " + (ACTION_LABELS[a.action_type] || a.action_type) });
      if (a.approved_at) events.push({ t: a.approved_at, text: "تم اعتماد: " + (ACTION_LABELS[a.action_type] || a.action_type) });
      if (a.executed_at) events.push({ t: a.executed_at, text: "تم التنفيذ فعليًا على Meta: " + (ACTION_LABELS[a.action_type] || a.action_type) });
    });
    events.sort(function (x, y) { return new Date(y.t) - new Date(x.t); });
    if (!events.length) return '<p style="color:var(--c-muted);font-size:13px;">لا يوجد سجل بعد.</p>';
    return '<div style="max-height:300px;overflow:auto;">' + events.slice(0, 60).map(function (e) {
      return '<div style="padding:6px 0;border-bottom:1px solid var(--c-border);font-size:12px;">' +
        '<span style="color:var(--c-muted);">' + fmtDateTime(e.t) + '</span> — ' + escapeHtml(e.text) + '</div>';
    }).join("") + '</div>';
  }

  // ---------- تعديل خطة (نص/ميزانية/تواريخ) ----------
  function openEditPlanModal(p) {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal"><h3>تعديل خطة</h3>' +
      '<div class="field"><label>العنوان</label><input id="mb-e-title" value="' + escapeHtml(p.title) + '"></div>' +
      '<div class="field"><label>الميزانية اليومية</label><input id="mb-e-daily" type="number" value="' + (p.daily_budget || "") + '"></div>' +
      '<div class="field"><label>الميزانية الإجمالية</label><input id="mb-e-total" type="number" value="' + (p.total_budget || "") + '"></div>' +
      '<div class="field"><label>ملخص الاستهداف</label><textarea id="mb-e-targeting">' + escapeHtml(p.targeting_summary || "") + '</textarea></div>' +
      '<div class="field"><label>ملخص الاستراتيجية</label><textarea id="mb-e-strategy">' + escapeHtml(p.strategy_summary || "") + '</textarea></div>' +
      '<div style="margin-top:12px;"><button class="btn" id="mb-e-save">حفظ</button> <button class="btn ghost" id="mb-e-cancel">إلغاء</button></div>' +
      '</div>';
    document.body.appendChild(backdrop);
    backdrop.querySelector("#mb-e-cancel").onclick = function () { backdrop.remove(); };
    backdrop.querySelector("#mb-e-save").onclick = function () {
      var patch = {
        title: backdrop.querySelector("#mb-e-title").value.trim(),
        daily_budget: backdrop.querySelector("#mb-e-daily").value || null,
        total_budget: backdrop.querySelector("#mb-e-total").value || null,
        targeting_summary: backdrop.querySelector("#mb-e-targeting").value.trim() || null,
        strategy_summary: backdrop.querySelector("#mb-e-strategy").value.trim() || null
      };
      window.SSMPDDb.updateMediaBuyerPlan(p.id, patch).then(function () {
        window.SSMPDToast.show("تم حفظ التعديل");
        backdrop.remove();
        render(document.getElementById("view-container"));
      }).catch(function (e) { window.SSMPDToast.show("تعذّر الحفظ: " + (e.message || e), "error"); });
    };
  }

  function wireActions(el) {
    var me = window.SSMPDAuth.currentAdmin;
    el.querySelectorAll("[data-approve-plan]").forEach(function (btn) {
      btn.onclick = function () {
        window.SSMPDDb.approveMediaBuyerPlan(btn.getAttribute("data-approve-plan"), me.id).then(function () {
          window.SSMPDToast.show("تم اعتماد الخطة (بدون أي تنفيذ فعلي على Meta)");
          render(document.getElementById("view-container"));
        }).catch(function (e) { window.SSMPDToast.show("تعذّر الاعتماد: " + (e.message || e), "error"); });
      };
    });
    el.querySelectorAll("[data-reject-plan]").forEach(function (btn) {
      btn.onclick = function () {
        var reason = window.prompt("سبب الرفض (اختياري):") || "";
        window.SSMPDDb.rejectMediaBuyerPlan(btn.getAttribute("data-reject-plan"), me.id, reason).then(function () {
          window.SSMPDToast.show("تم رفض الخطة");
          render(document.getElementById("view-container"));
        }).catch(function (e) { window.SSMPDToast.show("تعذّر الرفض: " + (e.message || e), "error"); });
      };
    });
    el.querySelectorAll("[data-edit-plan]").forEach(function (btn) {
      btn.onclick = function () {
        var p = plans.filter(function (x) { return x.id === btn.getAttribute("data-edit-plan"); })[0];
        if (p) openEditPlanModal(p);
      };
    });
    el.querySelectorAll("[data-approve-action]").forEach(function (btn) {
      btn.onclick = function () {
        window.SSMPDDb.approveMediaBuyerAction(btn.getAttribute("data-approve-action"), me.id).then(function () {
          window.SSMPDToast.show("تم اعتماد الإجراء — بانتظار التنفيذ من الـexecution backend المستقبلي");
          render(document.getElementById("view-container"));
        }).catch(function (e) { window.SSMPDToast.show("تعذّر الاعتماد: " + (e.message || e), "error"); });
      };
    });
    el.querySelectorAll("[data-reject-action]").forEach(function (btn) {
      btn.onclick = function () {
        window.SSMPDDb.rejectMediaBuyerAction(btn.getAttribute("data-reject-action")).then(function () {
          window.SSMPDToast.show("تم رفض الإجراء");
          render(document.getElementById("view-container"));
        }).catch(function (e) { window.SSMPDToast.show("تعذّر الرفض: " + (e.message || e), "error"); });
      };
    });
    wireGotoContentButtons(el);
  }

  // ---------- Phase 2B: ربط وكيل Meta الخارجي (Ed25519 zero-secret pairing) ----------
  function pairingSectionHtml() {
    if (!canApprove()) return "";
    return '<div class="section"><h3>ربط وكيل Meta</h3>' +
      '<p style="font-size:12px;color:var(--c-muted);">كود ربط لمرة واحدة صالح ١٠ دقايق بس — الوكيل الخارجي بيستخدمه مرة واحدة عشان يسجّل مفتاحه العام (Ed25519). الكود بيظهر هنا مرة واحدة بس ومش متخزن كنص صريح في القاعدة (هاش بس).</p>' +
      '<button class="btn primary sm" data-create-pairing-code>إنشاء كود ربط</button>' +
      '<div id="pairing-code-result" style="margin-top:10px;"></div>' +
      '</div>';
  }
  var lastPairing = null; // {pairing_code, expires_at} — للاستخدام في "نسخ حزمة الربط" بس، مش متخزن

  // الروابط الحقيقية الحية بس — من نفس مصدر إعداد Supabase المستخدم فعليًا في
  // db.js (window.SSMPD_CONFIG.supabase.url)، أبدًا مش مكتوبة/متخمّنة يدويًا
  function realEdgeUrl(fnName) {
    var base = (window.SSMPD_CONFIG && window.SSMPD_CONFIG.supabase && window.SSMPD_CONFIG.supabase.url) || "";
    return base.replace(/\/+$/, "") + "/functions/v1/" + fnName;
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } finally { document.body.removeChild(ta); }
    return Promise.resolve();
  }

  function wirePairingSection(el) {
    var btn = el.querySelector("[data-create-pairing-code]");
    if (!btn) return;
    btn.onclick = function () {
      btn.disabled = true;
      window.SSMPDDb.createMediaBuyerPairingCode().then(function (res) {
        btn.disabled = false;
        lastPairing = res;
        var out = el.querySelector("#pairing-code-result");
        if (!out) return;
        out.innerHTML = '<div style="background:var(--c-bg-soft,#f3f3f3);border:1px solid var(--c-border,#ddd);border-radius:6px;padding:10px;">' +
          '<div style="font-family:monospace;font-size:14px;font-weight:bold;user-select:all;">' + escapeHtml(res.pairing_code) + '</div>' +
          '<div style="font-size:11px;color:var(--c-negative);margin-top:6px;">⚠️ الكود ده بيظهر مرة واحدة بس دلوقتي — انسخه فورًا. صالح ' + (res.expires_in_minutes || 10) + ' دقايق ومرة استخدام واحدة بس.</div>' +
          '<button class="btn ghost sm" data-copy-pairing-package style="margin-top:8px;">نسخ حزمة الربط</button>' +
          '</div>';
        wireCopyPackageButton(el);
      }).catch(function (e) {
        btn.disabled = false;
        window.SSMPDToast.show("تعذّر إنشاء كود الربط: " + (e.message || e), "error");
      });
    };
    wireCopyPackageButton(el);
  }

  function wireCopyPackageButton(el) {
    var copyBtn = el.querySelector("[data-copy-pairing-package]");
    if (!copyBtn) return;
    copyBtn.onclick = function () {
      if (!lastPairing) return;
      // النص بيتضمن بس: كود الربط + انتهاؤه + رابطَي الدالتين الحقيقيَين
      // (مش سرّيين) — أبدًا أي service_role/anon key/MEDIA_BUYER_AGENT_TOKEN/
      // مفتاح خاص
      var pkg = "PAIRING_CODE=" + lastPairing.pairing_code + "\n" +
        "PAIRING_EXPIRES_AT=" + lastPairing.expires_at + "\n" +
        "PAIRING_ENDPOINT=" + realEdgeUrl("media-buyer-pair") + "\n" +
        "PROPOSAL_ENDPOINT=" + realEdgeUrl("media-buyer-propose");
      copyToClipboard(pkg).then(function () {
        window.SSMPDToast.show("تم نسخ حزمة الربط — الصقها في شات Meta Claude");
      }).catch(function () {
        window.SSMPDToast.show("تعذّر النسخ — انسخ الكود يدويًا", "error");
      });
    };
  }

  function renderAll(el, adRows) {
    var html = '<div class="section"><h3>وكيل الإعلانات — ملخص تنفيذي</h3>' + execSummaryHtml() + '</div>' +
      '<div class="section"><h3>اقتراحات الحملات</h3>' + planProposalsHtml() + '</div>' +
      '<div class="section"><h3>توصيات الوكيل (Scale / Hold / Retest / Pause)</h3>' + agentRecommendationsHtml() + '</div>' +
      '<div class="section"><h3>المراقبة الحية</h3>' + liveMonitoringHtml(adRows) + '</div>' +
      '<div class="section"><h3>سجل القرارات</h3>' + decisionHistoryHtml() + '</div>' +
      pairingSectionHtml() +
      '<p style="font-size:11px;color:var(--c-muted);">مرحلة ١: مفيش أي اتصال بـMeta API ولا تنفيذ فعلي هنا — "اعتماد" بيغيّر حالة الاعتماد في Supabase بس، وينتظر تنفيذ لاحق من backend تنفيذي منفصل (مش جزء من الباتش دي).</p>';
    el.innerHTML = html;
    wireActions(el);
    wirePairingSection(el);
  }

  function render(el) {
    el.innerHTML = '<div class="loading">بيحمّل وكيل الإعلانات…</div>';
    Promise.all([
      window.SSMPDDb.listMediaBuyerPlans(),
      window.SSMPDDb.listMediaBuyerActions(),
      window.SSMPDDb.listMetaAdPerformance().catch(function () { return []; }),
      window.SSMPDDb.listContentItems().catch(function () { return []; })
    ]).then(function (res) {
      plans = res[0] || []; actions = res[1] || [];
      contentItems = res[3] || [];
      contentById = {};
      contentItems.forEach(function (c) { contentById[c.id] = c; });
      renderAll(el, res[2] || []);
    }).catch(function (e) {
      el.innerHTML = '<div class="section"><p style="color:var(--c-negative);">تعذّر تحميل وكيل الإعلانات: ' + escapeHtml(e.message || e) + '</p></div>';
    });
  }

  window.SSMPDRenderMediaBuyer = { render: render };
})();
