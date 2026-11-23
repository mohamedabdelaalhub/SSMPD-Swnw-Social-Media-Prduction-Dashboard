/* «وردية الخزينة — قفل بعد ساعة» (owner 2026-11-23 «طبقه» + «كل حاجة»; mockup docs/ui-references/mockups/reception-shift-guard.*).
 * Server (20261122370000) is the source of truth: a reception / customer-service account whose HR shift started more than an hour ago
 * with no open cash shift (or with a shift left open from an earlier day) cannot book, register arrival, collect or request services.
 * This layer mirrors it:
 *   - a lock card on top of «الاستقبال والخدمات» and «تشغيل اليوم» with «افتح وردية» (or «سلّم الوردية» for a stale shift);
 *   - the same desk actions are stopped before they reach the server (and a server refusal refreshes the card);
 *   - managers (super admin / general manager / financial manager) see «ورديات محتاجة متابعة» on «تشغيل اليوم».
 * Nothing is opened, closed or handed over without the employee's own click. */
(function (w, d) {
  "use strict";
  if (w.__SSMPDShiftGuard) return; w.__SSMPDShiftGuard = true;
  var DESK = ["book", "walk_in", "overbook", "agent_booking_register", "booking_discount", "arrive", "collect", "collect_multi", "collect_split",
    "credit_apply", "package_sell", "installment_bill", "order_add", "execute"];
  var JOURNEY = ["arrive", "request_service"];
  var LOCK_RE = /افتح وردية الخزينة الأول|ورديتك من يوم قبل كده لسه مفتوحة/;
  var st = { me: "", data: null, watch: null, busy: false, last: 0 };
  function admin() { return w.SSMPDAuth && w.SSMPDAuth.currentAdmin; }
  function roles(a) { return !a ? [] : (w.SSMPDRoles && w.SSMPDRoles.rolesOf ? w.SSMPDRoles.rolesOf(a) : [a.role]); }
  function has(a, r) { return roles(a).indexOf(r) >= 0; }
  function desk(a) { return a && (has(a, "reception") || has(a, "customer_service")) && !has(a, "super_admin") && !has(a, "general_manager"); }
  function manager(a) { return a && (has(a, "super_admin") || has(a, "general_manager") || has(a, "financial_manager")); }
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function time(v) { return v ? new Date(v).toLocaleTimeString("ar-EG-u-nu-latn", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit" }) : ""; }
  function day(v) { return v ? new Date(v).toLocaleDateString("en-GB", { timeZone: "Africa/Cairo", day: "2-digit", month: "2-digit" }) : ""; }
  function money(v) { return Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: 2 }); }
  function locked() { return !!(st.data && st.data.locked); }
  function css() {
    if (d.getElementById("rsg-style")) return;
    var s = d.createElement("style"); s.id = "rsg-style";
    s.textContent = ".rsg-lock{border-radius:14px;padding:14px;background:#FFF1EC;border:1px solid #F3C7BF;display:grid;gap:8px;margin:0 0 12px}" +
      ".rsg-lock h4{margin:0;color:#B4471A;font-size:16px}.rsg-lock p{margin:0;font-size:13px;line-height:1.8;color:#5A2A12}" +
      ".rsg-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.rsg-row .btn{min-height:40px}" +
      ".rsg-dim{opacity:.55;border:1px dashed #E7B9AE;border-radius:12px;padding:8px 10px;font-size:13px;color:#5b6577}" +
      ".rsg-sub{font-size:12px!important;color:#5b6577!important}" +
      ".rsg-watch{border:1px solid #D5DEEE;border-radius:14px;background:#fff;padding:12px 14px;display:grid;gap:8px;margin:0 0 12px}" +
      ".rsg-watch h3{margin:0;font-size:15px;color:#0F369D}.rsg-al{border:1px solid #E3E8F2;border-radius:12px;padding:10px 12px;display:grid;gap:4px}" +
      ".rsg-al.r{border-color:#F3C7BF;background:#FFFBFA}.rsg-al b{font-size:14px}.rsg-al span{font-size:12px;color:#5b6577;line-height:1.7}" +
      ".rsg-chip{display:inline-block;padding:2px 10px;border-radius:99px;font-size:11px;font-weight:700;background:#FBE9E6;color:#D0402A;margin-inline-start:6px}" +
      ".rsg-chip.a{background:#FFF6E5;color:#8A5A00}";
    d.head.appendChild(s);
  }
  function lockHtml(g) {
    if (g.reason === "stale") {
      var y = new Date(Date.now() - 864e5), yesterday = day(y.toISOString()) === day(g.opened_at);
      return '<section class="rsg-lock" data-rsg-lock="stale" role="alert"><h4>' + (yesterday ? "ورديتك من امبارح لسه مفتوحة" : "ورديتك من يوم قبل كده لسه مفتوحة") + "</h4>" +
        "<p>وردية «" + esc(g.register || "الخزينة") + "» اتفتحت يوم " + esc(day(g.opened_at)) + " الساعة " + esc(time(g.opened_at)) + " وفيها " + money(g.expected) +
        " كاش. سلّمها الأول عشان تفتح وردية النهارده.</p><div class=\"rsg-row\">" +
        (w.SSMPDPeerHandover ? '<button type="button" class="btn btn-primary" data-rsg-handover>سلّم الوردية</button>' : "") +
        '<button type="button" class="btn" data-rsg-shifts>روح للورديات</button></div>' +
        '<div class="rsg-dim">حجز موعد · تسجيل وصول · تحصيل · طلب خدمة</div></section>';
    }
    return '<section class="rsg-lock" data-rsg-lock="need_open" role="alert"><h4>افتح وردية الخزينة الأول</h4>' +
      "<p>" + (g.exp_start ? "ورديتك بدأت الساعة " + esc(time(g.exp_start)) + " وعدّى" : "عدّى") +
      " أكتر من ساعة من غير وردية خزينة مفتوحة. الحجز والتحصيل وتسجيل الوصول وطلب الخدمات واقفين لحد ما تفتح ورديتك. المدير بيشوف ده.</p>" +
      '<div class="rsg-row"><button type="button" class="btn btn-primary" data-rsg-open>افتح وردية</button></div>' +
      '<div class="rsg-dim">حجز موعد · تسجيل وصول · تحصيل · طلب خدمة</div>' +
      '<p class="rsg-sub">اللي مفتوح: المواعيد والمرضى للقراية، ورسايل المرضى. أول ما الوردية تتفتح كل حاجة بترجع على طول.</p></section>';
  }
  function watchHtml(list) {
    if (!list || !list.length) return "";
    return '<section class="rsg-watch" data-rsg-watch><h3>ورديات محتاجة متابعة</h3>' + list.map(function (x) {
      if (x.kind === "missing") return '<div class="rsg-al r"><b>' + esc(x.name) + '<span class="rsg-chip">مفتحتش وردية</span></b><span>ورديتها في الموارد البشرية بدأت ' +
        esc(time(x.exp_start)) + (x.first_in ? " — بصمت " + esc(time(x.first_in)) : "") + " — مفيش وردية خزينة لحد دلوقتي. شغلها في الاستقبال واقف.</span></div>";
      if (x.kind === "stale") return '<div class="rsg-al r"><b>' + esc(x.name) + '<span class="rsg-chip">وردية مفتوحة من يوم قبل كده</span></b><span>اتفتحت ' +
        esc(day(x.opened_at)) + " الساعة " + esc(time(x.opened_at)) + " — المتوقع في الدرج: " + money(x.expected) + " — اطلب منه يسلّم.</span></div>";
      return '<div class="rsg-al"><b>' + esc(x.name) + '<span class="rsg-chip a">وردية مفتوحة بعد نهاية الشيفت</span></b><span>الشيفت خلص ' + esc(time(x.exp_end)) +
        " والدرج لسه مفتوح — المتوقع " + money(x.expected) + " — اطلب منه يسلّم.</span></div>";
    }).join("") + "</section>";
  }
  function hosts() {
    var out = [];
    Array.prototype.forEach.call(d.querySelectorAll(".rx-shell"), function (s) { out.push([s, s.querySelector(".rx-header")]); });
    Array.prototype.forEach.call(d.querySelectorAll("[data-journey-root]"), function (r) { if (r.dataset.journeyMode !== "trial") out.push([r, r.querySelector(".journey-top")]); });
    return out;
  }
  function place(attr, html) {
    hosts().forEach(function (h) {
      var host = h[0], old = host.querySelector(":scope > [" + attr + "]");
      if (!html) { if (old) old.remove(); return; }
      if (old && old.__rsg === html) return;
      var t = d.createElement("div"); t.innerHTML = html; var el = t.firstChild; el.__rsg = html;
      if (old) old.replaceWith(el); else if (h[1] && h[1].parentNode === host) host.insertBefore(el, h[1].nextSibling); else host.insertBefore(el, host.firstChild);
    });
  }
  function paint() {
    css();
    place("data-rsg-lock", locked() ? lockHtml(st.data) : "");
    var a = admin(); place("data-rsg-watch", manager(a) && st.watch ? watchHtml(st.watch) : "");
  }
  function openShift() { var api = w.SSMPDReception && w.SSMPDReception.openShiftOpen; return Promise.resolve(api ? api(true) : null).catch(function () {}); }
  function goShifts() { var api = w.SSMPDReception && w.SSMPDReception.openShiftOpen; return Promise.resolve(api ? api(false) : null).catch(function () {}); }
  d.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-rsg-open],[data-rsg-shifts],[data-rsg-handover]"); if (!t) return;
    e.preventDefault();
    if (t.hasAttribute("data-rsg-open")) openShift();
    else if (t.hasAttribute("data-rsg-handover") && w.SSMPDPeerHandover) w.SSMPDPeerHandover.openSend();
    else goShifts();
  });
  function client() { return w.SSMPDDb && w.SSMPDDb.client; }
  function load(force) {
    var a = admin(), c = client(); if (!a || !c || st.busy) return Promise.resolve();
    if (!force && st.me === a.id && Date.now() - st.last < 60000) { paint(); return Promise.resolve(); }
    if (st.me !== a.id) { st.data = null; st.watch = null; }
    st.busy = true; st.last = Date.now(); st.me = a.id;
    var jobs = [];
    if (desk(a)) jobs.push(Promise.resolve(c.__rsgRpc ? c.__rsgRpc("clinic_reception_shift_guard") : c.rpc("clinic_reception_shift_guard")).then(function (r) { st.data = r && !r.error ? r.data : null; }));
    else st.data = null;
    if (manager(a)) jobs.push(Promise.resolve(c.rpc("clinic_reception_shift_watch")).then(function (r) { st.watch = r && !r.error && r.data && r.data.visible ? r.data.items : null; }));
    else st.watch = null;
    return Promise.all(jobs).catch(function () {}).then(function () { st.busy = false; paint(); });
  }
  function refusal() {
    var g = st.data || {}; var msg = g.reason === "stale" ? "ورديتك من يوم قبل كده لسه مفتوحة — سلّمها الأول وافتح وردية النهارده"
      : "افتح وردية الخزينة الأول — الحجز والتحصيل وتسجيل الوصول وطلب الخدمات واقفين لحد ما تفتح ورديتك";
    if (w.SSMPDToast && w.SSMPDToast.show) w.SSMPDToast.show(msg, "error");
    return { data: null, error: { message: msg, hint: "shift_guard:" + (g.reason || "need_open") } };
  }
  /* mirror the server list: stop the desk actions before they are sent, and refresh the card when the server refuses one */
  function wrap() {
    var c = client(); if (!c || c.__rsgWrapped) return !!c;
    var orig = c.rpc.bind(c); c.__rsgWrapped = true; c.__rsgRpc = orig;
    c.rpc = function (name, args) {
      var act = args && args.p_action, guarded = (name === "clinic_reception_command" && DESK.indexOf(act) >= 0) || (name === "clinic_reception_journey_command" && JOURNEY.indexOf(act) >= 0);
      if (guarded && locked()) { paint(); return Promise.resolve(refusal()); }
      var res = orig(name, args);
      if (guarded) return Promise.resolve(res).then(function (r) { if (r && r.error && LOCK_RE.test(r.error.message || "")) load(true); return r; });
      if (name === "clinic_reception_command" && /^shift_(open|close)$/.test(act || "")) return Promise.resolve(res).then(function (r) { load(true); return r; });
      return res;
    };
    return true;
  }
  var obs = null;
  function start() {
    if (!wrap()) { w.setTimeout(start, 400); return; }
    load(true);
    if (!obs && w.MutationObserver) { obs = new MutationObserver(function () { if (st.data || st.watch) paint(); }); obs.observe(d.body, { childList: true, subtree: true }); }
    w.setInterval(function () { load(false); }, 15000);
  }
  w.SSMPDShiftGuard = { refresh: function () { return load(true); }, state: function () { return st.data; }, _paint: paint };
  if (d.body) w.setTimeout(start, 0); else d.addEventListener("DOMContentLoaded", start, { once: true });
})(window, document);
