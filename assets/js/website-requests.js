/* «طلبات الموقع» (owner 2026-11-27): the website forms «اتصل بنا» / الوظايف / الشراكات, received by website-request-ingest, shown to reception.
 * Mockup: docs/ui-references/mockups/website-requests.html. One card under the reception header with 3 tiles (اتصل بنا / وظايف وتدريب / شراكات);
 * a tile opens a popup list (search + status chips, last 5 with «عرض الكل»); a row opens a detail popup. Every popup has a ✕ (and Esc).
 * Reads public.website_requests_list, marks with public.website_requests_mark (reception / admin only, checked in the database). Nothing is sent from here. */
(function (w, d) {
  "use strict";
  var GROUPS = [["contact", "اتصل بنا", ["contact"]], ["job", "وظايف وتدريب", ["job", "internship"]], ["partner", "شراكات", ["partner"]]];
  var KIND = { contact: "اتصل بنا", job: "طلب وظيفة", internship: "طلب تدريب", partner: "طلب شراكة" };
  var ST = { new: "جديد", reviewed: "اتراجع", done: "تم" };
  var FIELD = { name: "الاسم", phone: "الموبايل", email: "الإيميل", subject: "الموضوع", position: "الوظيفة المطلوبة", experience: "الخبرة", university: "الجامعة", company: "الجهة", city: "المدينة", age: "السن" };
  var state = { ws: null, rows: null, error: "", group: "", status: "all", q: "", all: false, detail: null };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function client() { return w.SSMPDDb && w.SSMPDDb.client; }
  function when(iso) { try { return new Intl.DateTimeFormat("ar-EG-u-nu-latn", { timeZone: "Africa/Cairo", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)); } catch (e) { return String(iso || ""); } }
  function waLink(phone) { var p = String(phone || "").replace(/\D/g, ""); if (/^01\d{9}$/.test(p)) p = "2" + p; return /^201\d{9}$/.test(p) ? "https://wa.me/" + p : ""; }
  function inGroup(r, key) { var g = GROUPS.filter(function (x) { return x[0] === key; })[0]; return !!g && g[2].indexOf(r.kind) !== -1; }
  function rowsOf(key) { return (state.rows || []).filter(function (r) { return inGroup(r, key); }); }
  function count(list, st) { return list.filter(function (r) { return st === "all" || r.status === st; }).length; }
  function who(r) { var f = r.fields || {}; return f.name || f.company || f.email || f.phone || "بدون اسم"; }
  function line(r) { var f = r.fields || {}; var t = f.message || f.subject || f.position || ""; return t.length > 90 ? t.slice(0, 90) + "…" : t; }
  function load() {
    var c = client(); if (!c || !state.ws) return Promise.resolve();
    return Promise.resolve(c.rpc("website_requests_list", { p_workspace: state.ws, p_status: null, p_limit: 500 })).then(function (r) {
      if (r && r.error) { state.error = "مش قادر أجيب طلبات الموقع دلوقتي."; state.rows = state.rows || []; } else { state.error = ""; state.rows = (r && r.data) || []; }
    }, function () { state.error = "مش قادر أجيب طلبات الموقع دلوقتي."; state.rows = state.rows || []; });
  }
  function mark(id, status) {
    var c = client(); if (!c) return Promise.resolve(false);
    return Promise.resolve(c.rpc("website_requests_mark", { p_workspace: state.ws, p_id: id, p_status: status })).then(function (r) {
      if (r && r.error) return false;
      (state.rows || []).forEach(function (x) { if (x.id === id) x.status = status; }); return true;
    }, function () { return false; });
  }
  function close(box) { state.group = ""; state.detail = null; state.all = false; state.q = ""; state.status = "all"; paint(box); }
  function pop(box, title, body, onClose) {
    return '<div class="wr-backdrop" data-wr-backdrop><div class="wr-pop" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><header><h3>' + esc(title) + '</h3><button type="button" class="wr-x" data-wr-close aria-label="إغلاق">✕</button></header>' + body + '</div></div>';
  }
  function listHtml(box) {
    var list = rowsOf(state.group), all = list.length, q = state.q.trim().toLowerCase();
    var shown = list.filter(function (r) {
      if (state.status !== "all" && r.status !== state.status) return false;
      if (!q) return true; return JSON.stringify(r.fields || {}).toLowerCase().indexOf(q) !== -1;
    });
    var cut = state.all || q ? shown : shown.slice(0, 5);
    var chips = [["all", "الكل"], ["new", "جديد"], ["reviewed", "اتراجع"], ["done", "تم"]].map(function (c) {
      return '<button type="button" class="wr-chip' + (state.status === c[0] ? " on" : "") + '" data-wr-status="' + c[0] + '">' + c[1] + " " + count(list, c[0]) + "</button>";
    }).join("");
    var rows = cut.map(function (r) {
      return '<button type="button" class="wr-item ' + esc(r.status) + '" data-wr-id="' + esc(r.id) + '"><span class="wr-top"><b>' + esc(who(r)) + '</b><span class="wr-badge wr-' + esc(r.status) + '">' + esc(ST[r.status] || r.status) + "</span><small>" + esc(when(r.created_at)) + "</small></span><small>" + esc(line(r)) + "</small></button>";
    }).join("") || '<p class="wr-empty">مفيش طلبات بالشكل ده.</p>';
    var more = !state.all && !q && shown.length > 5 ? '<button type="button" class="wr-more" data-wr-all>عرض الكل (' + shown.length + ")</button>" : "";
    var g = GROUPS.filter(function (x) { return x[0] === state.group; })[0];
    return pop(box, "طلبات «" + g[1] + "»", '<input type="search" class="wr-search" data-wr-q placeholder="ابحث بالاسم أو الموبايل أو الرسالة" value="' + esc(state.q) + '" aria-label="بحث"><div class="wr-chips">' + chips + "</div>" + rows + more);
  }
  function detailHtml(box) {
    var r = (state.rows || []).filter(function (x) { return x.id === state.detail; })[0]; if (!r) return "";
    var f = r.fields || {}, dl = "", wa = waLink(f.phone);
    dl += "<dt>النوع</dt><dd>" + esc(KIND[r.kind] || r.kind) + "</dd>";
    Object.keys(FIELD).forEach(function (k) { if (f[k]) dl += "<dt>" + FIELD[k] + '</dt><dd' + (k === "phone" || k === "email" ? ' dir="ltr" class="wr-ltr"' : "") + ">" + esc(f[k]) + "</dd>"; });
    dl += "<dt>وصل</dt><dd>" + esc(when(r.created_at)) + "</dd>";
    var main = r.status === "new" ? '<button type="button" class="btn pri" data-wr-set="reviewed">تم التواصل</button>' : r.status === "reviewed" ? '<button type="button" class="btn pri" data-wr-set="done">خلص</button>' : "";
    var menu = '<div class="wr-menu" data-wr-menu hidden>' + (r.status !== "new" ? '<button type="button" class="btn" data-wr-set="new">رجّعه جديد</button>' : "") + (r.status !== "done" && r.status !== "new" ? "" : "") + (r.status === "new" ? '<button type="button" class="btn" data-wr-set="done">تم من غير تواصل</button>' : "") + (f.phone ? '<button type="button" class="btn" data-wr-copy="' + esc(f.phone) + '">نسخ الرقم</button>' : "") + "</div>";
    return pop(box, who(r), '<p><span class="wr-badge wr-' + esc(r.status) + '">' + esc(ST[r.status] || r.status) + "</span></p><dl>" + dl + '</dl><div class="wr-msg">' + esc(f.message || "") + '</div><div class="wr-actions">' + main + (wa ? '<a class="btn" href="' + wa + '" target="_blank" rel="noopener">واتساب</a>' : "") + '<button type="button" class="btn" data-wr-more aria-label="خيارات">⋯</button></div>' + menu);
  }
  function paint(box) {
    var rows = state.rows, tiles = GROUPS.map(function (g) {
      var list = rows ? rowsOf(g[0]) : null, n = list ? count(list, "new") : 0;
      return '<button type="button" class="wr-tile" data-wr-open="' + g[0] + '"><b>' + g[1] + '</b><span class="wr-n">' + (list ? list.length : "…") + '</span><small>' + (list ? (n ? '<span class="wr-badge wr-new">' + n + " جديد</span>" : '<span class="wr-badge wr-zero">مفيش جديد</span>') : "بيحمّل…") + "</small></button>";
    }).join("");
    box.innerHTML = '<section class="wr-card" aria-labelledby="wr-title"><header><h3 id="wr-title">طلبات الموقع</h3><button type="button" class="btn ghost sm" data-wr-refresh>تحديث</button></header>' +
      (state.error ? '<p class="wr-err">' + esc(state.error) + "</p>" : "") + '<div class="wr-tiles">' + tiles + "</div></section>" + (state.detail ? detailHtml(box) : state.group ? listHtml(box) : "");
    wire(box);
  }
  function wire(box) {
    var q = function (s) { return box.querySelector(s); }, all = function (s) { return box.querySelectorAll(s); };
    q("[data-wr-refresh]").onclick = function () { refresh(box); };
    all("[data-wr-open]").forEach(function (b) { b.onclick = function () { state.group = b.getAttribute("data-wr-open"); state.status = "all"; state.q = ""; state.all = false; paint(box); }; });
    var x = q("[data-wr-close]"); if (x) x.onclick = function () { if (state.detail) { state.detail = null; paint(box); } else close(box); };
    var bd = q("[data-wr-backdrop]"); if (bd) bd.onclick = function (e) { if (e.target === bd) { if (state.detail) { state.detail = null; paint(box); } else close(box); } };
    all("[data-wr-status]").forEach(function (b) { b.onclick = function () { state.status = b.getAttribute("data-wr-status"); state.all = false; paint(box); }; });
    var s = q("[data-wr-q]"); if (s) { s.oninput = function () { state.q = s.value; var pos = s.selectionStart; paint(box); var n = q("[data-wr-q]"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* not supported */ } } }; }
    var ma = q("[data-wr-all]"); if (ma) ma.onclick = function () { state.all = true; paint(box); };
    all("[data-wr-id]").forEach(function (b) { b.onclick = function () { state.detail = b.getAttribute("data-wr-id"); paint(box); }; });
    var mm = q("[data-wr-more]"); if (mm) mm.onclick = function () { var m = q("[data-wr-menu]"); if (m) m.hidden = !m.hidden; };
    all("[data-wr-set]").forEach(function (b) { b.onclick = function () { b.disabled = true; mark(state.detail, b.getAttribute("data-wr-set")).then(function (ok) { if (!ok) state.error = "ما قدرتش أغيّر الحالة. جرّب تاني."; else state.error = ""; paint(box); }); }; });
    all("[data-wr-copy]").forEach(function (b) { b.onclick = function () { try { w.navigator.clipboard.writeText(b.getAttribute("data-wr-copy")); b.textContent = "اتنسخ"; } catch (e) { b.textContent = "انسخه يدوي"; } }; });
  }
  function refresh(box) { paint(box); return load().then(function () { if (box.isConnected) paint(box); }); }
  function mayView() { var a = w.SSMPDAuth && w.SSMPDAuth.currentAdmin, R = w.SSMPDRoles; return !!(a && R && R.hasAnyRole && R.hasAnyRole(a, ["reception", "customer_service", "general_manager", "super_admin"])); }
  d.addEventListener("keydown", function (e) { if (e.key !== "Escape") return; var box = d.getElementById("website-requests-rx"); if (!box || !(state.group || state.detail)) return; if (state.detail) { state.detail = null; paint(box); } else close(box); });
  // Called by reception-workspace.js after every draw, with its context (same hook as «طلبات الحجز الآلية»).
  function decorate(ctx) {
    if (!ctx || !ctx.data || !ctx.data.workspace || ctx.data.workspace.mode !== "live" || !mayView()) return;
    var shell = d.querySelector(".rx-shell") || (ctx.host && ctx.host.parentNode); if (!shell) return;
    var box = d.getElementById("website-requests-rx"), created = !box, fresh = state.ws !== ctx.workspace || !state.rows;
    if (!box) {
      box = d.createElement("div"); box.id = "website-requests-rx";
      var after = d.getElementById("auto-booking-requests-rx") || shell.querySelector(".rx-header");
      if (after && after.parentNode === shell) after.insertAdjacentElement("afterend", box); else shell.insertBefore(box, shell.firstChild);
    }
    state.ws = ctx.workspace;
    if (fresh) refresh(box); else if (created) paint(box);
  }
  w.SSMPDWebsiteRequests = { decorate: decorate, state: state, refresh: refresh };
})(window, document);
