/* SWNW — standalone read-only access to Leads Archive + admin grant control */
(function () {
  "use strict";
  if (window.__SWNWLeadsArchiveAccess) return;
  window.__SWNWLeadsArchiveAccess = true;

  var STATUS = {
    new: "جديد", in_progress: "قيد المتابعة", booked: "تم الحجز",
    booked_on_system: "تم الحجز على سيستم المركز", service_done: "تم إجراء الخدمة",
    interested_undecided: "مهتم لسه مقررش", rejected: "مرفوض",
    no_response: "لا يوجد رد", invalid_number: "رقم غير صحيح", missing_data: "ناقص بيانات"
  };
  var SOURCE = { whatsapp: "واتساب", messenger: "ماسنجر", phone: "تليفون", clinic: "عيادة", doctor_referral: "تحويل من طبيب العيادة" };
  var SERVICE = {
    checkup: "كشف", consultation: "استشارة", radiology: "أشعة", lab: "تحاليل", nursing: "تمريض",
    physiotherapy: "علاج طبيعي", treatment: "علاج", dental: "أسنان", speech_therapy: "تخاطب",
    psychiatry: "نفسية", cosmetic_laser: "ليزر تجميل", emergency: "طوارئ", other: "أخرى"
  };
  var adminBusy = false;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmt(v) {
    if (!v) return "—";
    var d = new Date(v);
    return isNaN(d) ? "—" : d.toLocaleString("ar-EG-u-nu-latn", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function roles() { return window.SSMPDRoles; }
  function current() { return window.SSMPDAuth && window.SSMPDAuth.currentAdmin; }
  function inherited(a) { return !!(a && roles() && roles().hasAnyRole(a, ["super_admin", "general_manager"])); }
  function allowed(a) { return !!(a && a.active !== false && (inherited(a) || a.has_leads_archive_access === true)); }
  function toast(message, type) {
    if (window.SSMPDToast) window.SSMPDToast.show(message, type || "info");
  }

  function style() {
    if (document.getElementById("swnw-leads-archive-access-style")) return;
    var s = document.createElement("style");
    s.id = "swnw-leads-archive-access-style";
    s.textContent =
      ".laa-backdrop{position:fixed;inset:0;z-index:1300;background:rgba(18,31,48,.58);padding:18px;display:grid;place-items:center}" +
      ".laa-panel{width:min(1120px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(12,28,48,.28);color:#263a52}" +
      ".laa-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;background:#fff;border-bottom:1px solid #e5eaf1}.laa-head h2{margin:0;font-size:21px}.laa-head p{margin:3px 0 0;font-size:12px;color:#718096}.laa-close{border:0;background:#f2f5f9;width:38px;height:38px;border-radius:50%;font-size:25px;cursor:pointer;color:#42556c}" +
      ".laa-body{padding:16px 18px 22px}.laa-filters{display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:14px}.laa-filters label{font-size:11px;color:#718096}.laa-filters input,.laa-filters select{display:block;margin-top:4px;border:1px solid #d8e0ea;border-radius:10px;padding:9px 10px;font:inherit;background:#fff;color:#263a52}.laa-search{flex:1 1 240px}.laa-search input{width:100%;box-sizing:border-box}.laa-btn{border:1px solid #d8e0ea;border-radius:10px;background:#fff;color:#29445f;font:inherit;font-weight:700;padding:9px 13px;cursor:pointer}.laa-btn.primary{background:#0f369d;border-color:#0f369d;color:#fff}" +
      ".laa-info{font-size:12px;color:#718096;margin:8px 0 12px}.laa-table-wrap{overflow:auto;border:1px solid #e5eaf1;border-radius:13px}.laa-table{width:100%;border-collapse:collapse;min-width:800px}.laa-table th,.laa-table td{text-align:right;padding:11px 10px;border-bottom:1px solid #edf1f5;font-size:12px;vertical-align:middle}.laa-table th{background:#f7f9fc;color:#53677f;position:sticky;top:70px}.laa-pill{display:inline-block;border-radius:999px;padding:4px 9px;background:#eef2f7;font-weight:700;font-size:11px}.laa-open{border:0;background:#edf3ff;color:#0f369d;border-radius:8px;padding:6px 10px;font:inherit;font-weight:700;cursor:pointer}" +
      ".laa-pager{display:flex;justify-content:center;align-items:center;gap:8px;margin-top:14px}.laa-pager button{min-width:42px}.laa-empty,.laa-error{text-align:center;padding:30px 12px;color:#718096}.laa-error{color:#a64032}.laa-detail{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:4px}.laa-detail div{background:#f7f9fc;border-radius:10px;padding:10px}.laa-detail small{display:block;color:#718096;margin-bottom:4px}.laa-detail b{font-size:13px}.laa-readonly{background:#eef5ff;border:1px solid #dbe8fb;color:#315f9f;padding:9px 11px;border-radius:10px;font-size:12px;margin-bottom:12px}" +
      ".laa-home-tile{position:relative}.laa-home-tile::after{content:'قراءة فقط';position:absolute;top:5px;left:6px;font-size:9px;background:#e9f5ef;color:#247052;border-radius:8px;padding:2px 5px}" +
      "@media(max-width:650px){.laa-backdrop{padding:0;place-items:stretch}.laa-panel{width:100%;max-height:100vh;border-radius:0}.laa-body{padding:12px}.laa-head{padding:13px}.laa-filters>*{flex:1 1 45%}.laa-search{flex-basis:100%}.laa-detail{grid-template-columns:1fr}.laa-table th{top:65px}}";
    document.head.appendChild(s);
  }

  function detail(lead) {
    var old = document.querySelector(".laa-detail-backdrop");
    if (old) old.remove();
    var b = document.createElement("div");
    b.className = "laa-backdrop laa-detail-backdrop";
    b.innerHTML = '<section class="laa-panel" style="width:min(620px,100%);"><header class="laa-head"><div><h2>' + esc(lead.customer_name || "ليد") + '</h2><p>بيانات من أرشيف الليدز</p></div><button class="laa-close" type="button" aria-label="إغلاق">×</button></header><div class="laa-body"><div class="laa-readonly">هذه الصلاحية للعرض فقط. لا يوجد تعديل أو حذف من هذه الشاشة.</div><div class="laa-detail">' +
      '<div><small>الهاتف</small><b>' + esc(lead.phone_raw || lead.phone_normalized || "—") + '</b></div>' +
      '<div><small>الحالة</small><b>' + esc(STATUS[lead.current_status] || lead.current_status || "—") + '</b></div>' +
      '<div><small>المصدر</small><b>' + esc(SOURCE[lead.source] || lead.source || "—") + '</b></div>' +
      '<div><small>الخدمة</small><b>' + esc(SERVICE[lead.interested_service] || lead.requested_department || lead.interested_service || "—") + '</b></div>' +
      '<div><small>رقم الحجز</small><b>' + esc(lead.booking_reference || "—") + '</b></div>' +
      '<div><small>تاريخ الحجز</small><b>' + esc(fmt(lead.booking_date)) + '</b></div>' +
      '<div><small>تاريخ الإضافة</small><b>' + esc(fmt(lead.created_at)) + '</b></div>' +
      '<div><small>تاريخ الإغلاق</small><b>' + esc(fmt(lead.closed_at)) + '</b></div>' +
      '</div></div></section>';
    document.body.appendChild(b);
    b.querySelector(".laa-close").onclick = function () { b.remove(); };
    b.onclick = function (e) { if (e.target === b) b.remove(); };
  }

  function openArchive() {
    var a = current();
    if (!allowed(a)) { toast("ليس لديك صلاحية فتح أرشيف الليدز", "error"); return; }
    var old = document.querySelector(".laa-archive-backdrop");
    if (old) old.remove();
    var state = { page: 1, pageSize: 20, search: "", status: "", dateFrom: "", dateTo: "", total: 0, leads: [] };
    var wrap = document.createElement("div");
    wrap.className = "laa-backdrop laa-archive-backdrop";
    wrap.innerHTML = '<section class="laa-panel"><header class="laa-head"><div><h2>أرشيف الليدز</h2><p>بحث وعرض بيانات الليدز — صلاحية قراءة فقط</p></div><button class="laa-close" type="button" aria-label="إغلاق">×</button></header><div class="laa-body"><div class="laa-filters"><label class="laa-search">بحث<input data-laa-search placeholder="الاسم أو رقم الهاتف"></label><label>الحالة<select data-laa-status><option value="">كل الحالات</option>' + Object.keys(STATUS).map(function (k) { return '<option value="' + k + '">' + esc(STATUS[k]) + '</option>'; }).join("") + '</select></label><label>من<input type="date" data-laa-from></label><label>إلى<input type="date" data-laa-to></label><button type="button" class="laa-btn primary" data-laa-apply>بحث</button><button type="button" class="laa-btn" data-laa-clear>مسح</button></div><div data-laa-results><div class="laa-empty">جاري تحميل الأرشيف…</div></div></div></section>';
    document.body.appendChild(wrap);

    function close() { wrap.remove(); }
    wrap.querySelector(".laa-close").onclick = close;
    wrap.onclick = function (e) { if (e.target === wrap) close(); };

    function load() {
      var out = wrap.querySelector("[data-laa-results]");
      out.innerHTML = '<div class="laa-empty">جاري تحميل الأرشيف…</div>';
      window.SSMPDDb.listLeadArchive({
        search: state.search || undefined,
        status: state.status || undefined,
        date_from: state.dateFrom || undefined,
        date_to: state.dateTo || undefined,
        page: state.page,
        page_size: state.pageSize
      }).then(function (res) {
        if (!wrap.isConnected) return;
        state.leads = res.leads || [];
        state.total = res.total || 0;
        var pages = Math.max(1, Math.ceil(state.total / state.pageSize));
        if (state.page > pages) { state.page = pages; load(); return; }
        var html = '<p class="laa-info">إجمالي النتائج: <b>' + state.total.toLocaleString("en-US") + '</b> · صفحة ' + state.page + ' من ' + pages + '</p>';
        if (!state.leads.length) html += '<div class="laa-empty">لا توجد ليدز مطابقة.</div>';
        else {
          html += '<div class="laa-table-wrap"><table class="laa-table"><thead><tr><th>العميل</th><th>الهاتف</th><th>المصدر</th><th>الحالة</th><th>الخدمة</th><th>تاريخ الإضافة</th><th></th></tr></thead><tbody>' + state.leads.map(function (lead, i) {
            return '<tr><td><b>' + esc(lead.customer_name || "—") + '</b></td><td>' + esc(lead.phone_raw || lead.phone_normalized || "—") + '</td><td>' + esc(SOURCE[lead.source] || lead.source || "—") + '</td><td><span class="laa-pill">' + esc(STATUS[lead.current_status] || lead.current_status || "—") + '</span></td><td>' + esc(SERVICE[lead.interested_service] || lead.requested_department || lead.interested_service || "—") + '</td><td>' + esc(fmt(lead.created_at)) + '</td><td><button class="laa-open" type="button" data-laa-open="' + i + '">عرض</button></td></tr>';
          }).join("") + '</tbody></table></div>';
        }
        html += '<div class="laa-pager"><button class="laa-btn" type="button" data-laa-prev ' + (state.page <= 1 ? "disabled" : "") + '>السابق</button><span>' + state.page + ' / ' + pages + '</span><button class="laa-btn" type="button" data-laa-next ' + (state.page >= pages ? "disabled" : "") + '>التالي</button></div>';
        out.innerHTML = html;
        out.querySelectorAll("[data-laa-open]").forEach(function (btn) { btn.onclick = function () { detail(state.leads[Number(btn.dataset.laaOpen)]); }; });
        var prev = out.querySelector("[data-laa-prev]"), next = out.querySelector("[data-laa-next]");
        if (prev) prev.onclick = function () { if (state.page > 1) { state.page--; load(); } };
        if (next) next.onclick = function () { if (state.page < pages) { state.page++; load(); } };
      }).catch(function (e) {
        if (wrap.isConnected) out.innerHTML = '<div class="laa-error">تعذر تحميل أرشيف الليدز: ' + esc(e && e.message || "خطأ غير معروف") + '</div>';
      });
    }

    function apply() {
      state.search = wrap.querySelector("[data-laa-search]").value.trim();
      state.status = wrap.querySelector("[data-laa-status]").value;
      state.dateFrom = wrap.querySelector("[data-laa-from]").value;
      state.dateTo = wrap.querySelector("[data-laa-to]").value;
      state.page = 1;
      load();
    }
    wrap.querySelector("[data-laa-apply]").onclick = apply;
    wrap.querySelector("[data-laa-search]").onkeydown = function (e) { if (e.key === "Enter") apply(); };
    wrap.querySelector("[data-laa-status]").onchange = apply;
    wrap.querySelector("[data-laa-from]").onchange = apply;
    wrap.querySelector("[data-laa-to]").onchange = apply;
    wrap.querySelector("[data-laa-clear]").onclick = function () {
      wrap.querySelector("[data-laa-search]").value = "";
      wrap.querySelector("[data-laa-status]").value = "";
      wrap.querySelector("[data-laa-from]").value = "";
      wrap.querySelector("[data-laa-to]").value = "";
      state.search = state.status = state.dateFrom = state.dateTo = ""; state.page = 1; load();
    };
    load();
  }

  function injectHome() {
    var a = current();
    if (!allowed(a)) return;
    var root = document.querySelector(".personal-home");
    if (!root || root.querySelector("[data-leads-archive-shortcut]")) return;
    var groups = Array.prototype.slice.call(root.querySelectorAll(".ph-sg"));
    var group = groups.find(function (g) { var h = g.querySelector("h3"); return h && /التواصل|المرضى/.test(h.textContent || ""); });
    if (!group) {
      var host = root.querySelector(".ph-shortcuts");
      if (!host) return;
      group = document.createElement("div");
      group.className = "ph-sg";
      group.innerHTML = '<h3>التواصل والمرضى</h3><div class="ph-tiles"></div>';
      host.appendChild(group);
    }
    var tiles = group.querySelector(".ph-tiles");
    if (!tiles) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ph-tile laa-home-tile";
    btn.dataset.leadsArchiveShortcut = "1";
    btn.dataset.ic = "🗃️";
    btn.textContent = "أرشيف الليدز";
    btn.onclick = openArchive;
    tiles.appendChild(btn);
  }

  function injectAdmin() {
    var table = document.querySelector("#admin-users table.simple");
    if (!table || table.dataset.leadsArchiveAccessReady === "1" || adminBusy || !window.SSMPDDb) return;
    adminBusy = true;
    window.SSMPDDb.listAdmins().then(function (admins) {
      if (!table.isConnected) return;
      var map = {};
      (admins || []).forEach(function (a) { map[a.id] = a; });
      var deleteHead = Array.prototype.slice.call(table.querySelectorAll("thead th")).find(function (th) { return /حذف الليدز/.test(th.textContent || ""); });
      var th = document.createElement("th");
      th.textContent = "أرشيف الليدز";
      if (deleteHead) deleteHead.parentNode.insertBefore(th, deleteHead); else table.querySelector("thead tr").appendChild(th);
      table.querySelectorAll("tbody tr").forEach(function (tr) {
        var idBox = tr.querySelector("[data-delete-leads]") || tr.querySelector("[data-archive]");
        if (!idBox) return;
        var id = idBox.getAttribute("data-delete-leads") || idBox.getAttribute("data-archive");
        var a = map[id] || {};
        var inheritedAccess = inherited(a);
        var td = document.createElement("td");
        td.style.textAlign = "center";
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = inheritedAccess || a.has_leads_archive_access === true;
        cb.disabled = inheritedAccess;
        cb.title = inheritedAccess ? "متاحة تلقائيًا من دور المدير" : "السماح بقراءة أرشيف الليدز فقط";
        cb.dataset.leadsArchiveAccess = id;
        td.appendChild(cb);
        var targetTd = idBox.closest("td");
        if (targetTd) targetTd.parentNode.insertBefore(td, targetTd); else tr.appendChild(td);
        if (!inheritedAccess) cb.onchange = function () {
          var wanted = cb.checked;
          cb.disabled = true;
          window.SSMPDDb.updateAdmin(id, { has_leads_archive_access: wanted }).then(function () {
            cb.disabled = false;
            toast(wanted ? "تم منح صلاحية أرشيف الليدز" : "تم إلغاء صلاحية أرشيف الليدز");
          }).catch(function (e) {
            cb.checked = !wanted; cb.disabled = false;
            toast("تعذر تحديث الصلاحية: " + (e && e.message || "خطأ"), "error");
          });
        };
      });
      table.dataset.leadsArchiveAccessReady = "1";
    }).catch(function () {}).finally(function () { adminBusy = false; });
  }

  function scan() { injectHome(); injectAdmin(); }
  style();
  var observer = new MutationObserver(function () { scan(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.SWNNLeadsArchiveAccess = { open: openArchive, canOpen: allowed };
  scan();
})();
