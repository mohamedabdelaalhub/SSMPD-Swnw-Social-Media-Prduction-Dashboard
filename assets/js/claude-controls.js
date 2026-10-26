/* لوحة «تحكّم Claude» — حدود الصرف الإعلاني (يومي/أسبوعي/شهري/من تاريخ لتاريخ) + مفاتيح وحدود صلاحيات Claude.
   بتظهر للسوبر أدمن بس جوه «لوحة التحكم». الحماية الفعلية في القاعدة (RLS + حراسة اعتماد الخطط):
   ads_spend_limits (قراءة للإدارة، كتابة للسوبر أدمن)، claude_capabilities، claude_action_log، rpc ads_limits_status. */
(function () {
  "use strict";
  var DB = function () { return window.SSMPDDb.client; };
  var BRANDS = { sono: "سونو", dr_dina: "د. دينا" };
  var PERIODS = [["day", "يومي"], ["week", "أسبوعي"], ["month", "شهري"], ["custom", "من تاريخ لتاريخ"]];
  var NOTES = {
    tasks_create: "للأعضاء الموجودين في المشروع بس",
    tasks_edit: "من غير المهام المتكررة",
    tasks_return: "بملاحظة واضحة للموظف",
    internal_messages: "داخل السيستم بس",
    ads_propose: "اقتراح بس، وانت اللي تعتمد"
  };

  function allowed() {
    var a = window.SSMPDAuth && window.SSMPDAuth.currentAdmin;
    return !!a && (a.role === "super_admin" || (a.roles || []).indexOf("super_admin") >= 0);
  }
  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function money(n) { return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 }); }
  function dm(iso) { var p = String(iso || "").split("-"); return p.length === 3 ? Number(p[2]) + "/" + Number(p[1]) : ""; }
  function periodLabel(l) {
    if (l.period === "custom") return "من " + dm(l.starts_on) + " إلى " + dm(l.ends_on);
    if (l.period === "week") return "أسبوعي (من السبت)";
    return l.period === "day" ? "يومي" : "شهري";
  }
  function cairoDay(d) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(d); }

  function mount(slot) {
    if (!slot || !allowed() || slot.querySelector("[data-claude-controls]")) return;
    var root = h("div", "cc"); root.dataset.claudeControls = "";
    var msg = h("p", "cc-msg"); msg.setAttribute("role", "status");
    var limitsHost = h("section", "cc-card"), capsHost = h("section", "cc-card");
    root.append(msg, limitsHost, capsHost);
    slot.appendChild(root);
    limitsHost.appendChild(h("p", "cc-hint", "بيحمّل…"));

    function say(text, bad) { msg.textContent = text || ""; msg.className = "cc-msg" + (text ? (bad ? " bad" : " ok") : ""); }
    function fail(e) { say("تعذر الحفظ: " + ((e && e.message) || e), true); }
    var me = function () { return window.SSMPDAuth.currentAdmin.id; };

    async function load() {
      var since = new Date(Date.now() - 36 * 3600e3).toISOString();
      var r = await Promise.all([
        DB().from("ads_spend_limits").select("*").order("created_at", { ascending: true }),
        DB().rpc("ads_limits_status"),
        DB().from("claude_capabilities").select("*").order("key", { ascending: true }),
        DB().from("claude_action_log").select("action,at").gte("at", since)
      ]);
      r.forEach(function (x) { if (x.error) throw x.error; });
      var status = {}; (r[1].data || []).forEach(function (s) { status[s.id] = s; });
      var today = cairoDay(new Date()), used = {};
      (r[3].data || []).forEach(function (l) { if (cairoDay(new Date(l.at)) === today) used[l.action] = (used[l.action] || 0) + 1; });
      return { limits: r[0].data || [], status: status, caps: r[2].data || [], used: used };
    }

    function limitCard(l, st) {
      var card = h("div", "cc-lim" + (l.active ? "" : " off"));
      var top = h("div", "cc-lim-top");
      top.append(h("b", "", l.label), h("span", "cc-chip", periodLabel(l)));
      if (l.brand) top.append(h("span", "cc-chip pg", BRANDS[l.brand] || l.brand));
      var amt = h("div", "cc-amt"); amt.append(document.createTextNode(money(l.amount) + " "), h("small", "", "ج")); top.append(amt);
      var tg = toggle(l.active, "تشغيل الحد: " + l.label, async function (on) {
        var r = await DB().from("ads_spend_limits").update({ active: on, updated_at: new Date().toISOString() }).eq("id", l.id);
        if (r.error) throw r.error; say(on ? "الحد اتفعّل" : "الحد اتوقف", false); refresh();
      });
      top.append(tg); card.append(top);
      if (l.active && st) {
        var pct = Math.min(100, st.pct), bar = h("div", "cc-bar"), fill = h("i", pct >= 100 ? "r" : (pct >= 70 ? "o" : "g"));
        fill.style.width = pct + "%"; bar.appendChild(fill);
        var meta = h("div", "cc-meta"), left = h("span", "", "المخطط: " + money(st.committed) + " ج");
        var right = h("span", "", st.remaining > 0 ? "باقي " + money(st.remaining) + " ج" : "وصل للحد — أي زيادة هتتمنع");
        if (st.remaining <= 0) { right.className = "cc-over"; }
        meta.append(left, right); card.append(bar, meta);
      } else if (!l.active) { card.append(h("div", "cc-meta", "موقوف — مش بيتفحص")); }
      var acts = h("div", "cc-acts");
      var edit = h("button", "cc-link", "تعديل المبلغ"); edit.type = "button";
      edit.onclick = function () {
        var v = window.prompt("الحد الجديد بالجنيه:", l.amount); if (v == null) return;
        var n = Number(String(v).replace(/,/g, "")); if (!Number.isFinite(n) || n < 0 || n > 10000000) { say("اكتب مبلغ صحيح بالجنيه", true); return; }
        DB().from("ads_spend_limits").update({ amount: n, updated_at: new Date().toISOString() }).eq("id", l.id).then(function (r) { if (r.error) throw r.error; say("المبلغ اتعدّل", false); refresh(); }).catch(fail);
      };
      var del = h("button", "cc-link danger", "حذف"); del.type = "button";
      del.onclick = function () {
        if (!window.confirm("حذف الحد «" + l.label + "»؟ الخطط المعتمدة مش هتتأثر، بس الحد مش هيتفحص تاني.")) return;
        DB().from("ads_spend_limits").delete().eq("id", l.id).then(function (r) { if (r.error) throw r.error; say("الحد اتحذف", false); refresh(); }).catch(fail);
      };
      acts.append(edit, del); card.append(acts);
      return card;
    }

    function toggle(on, label, onChange) {
      var b = h("button", "cc-tg" + (on ? " on" : "")); b.type = "button"; b.setAttribute("role", "switch");
      b.setAttribute("aria-checked", on ? "true" : "false"); b.setAttribute("aria-label", label);
      b.onclick = function () { b.disabled = true; Promise.resolve(onChange(!on)).catch(function (e) { b.disabled = false; fail(e); }); };
      return b;
    }

    function addForm() {
      var box = h("div", "cc-add"); box.append(h("h3", "", "＋ إضافة حد جديد"));
      var state = { period: "week" };
      var seg = h("div", "cc-seg"), segBtns = {};
      PERIODS.forEach(function (p) {
        var b = h("button", p[0] === state.period ? "on" : "", p[1]); b.type = "button"; segBtns[p[0]] = b;
        b.onclick = function () { state.period = p[0]; Object.keys(segBtns).forEach(function (k) { segBtns[k].className = k === p[0] ? "on" : ""; }); dates.hidden = p[0] !== "custom"; };
        seg.appendChild(b);
      });
      function field(label, input) { var w = h("div", "cc-field"), l = h("label", "", label); w.append(l, input); return w; }
      var amount = h("input", "cc-in"); amount.type = "number"; amount.min = "0"; amount.step = "50"; amount.inputMode = "decimal"; amount.placeholder = "1500";
      var page = h("select", "cc-in"); [["", "كل الصفحات"], ["sono", BRANDS.sono], ["dr_dina", BRANDS.dr_dina]].forEach(function (o) { var op = h("option", "", o[1]); op.value = o[0]; page.appendChild(op); });
      var name = h("input", "cc-in"); name.type = "text"; name.maxLength = 80; name.placeholder = "الاسم (اختياري)";
      var from = h("input", "cc-in"); from.type = "date"; var to = h("input", "cc-in"); to.type = "date";
      var dates = h("div", "cc-row"); dates.hidden = true; dates.append(field("من", from), field("إلى", to));
      var save = h("button", "cc-btn", "حفظ الحد"); save.type = "button";
      save.onclick = async function () {
        var n = Number(amount.value);
        if (!amount.value || !Number.isFinite(n) || n < 0 || n > 10000000) { say("اكتب الحد بالجنيه (رقم صحيح)", true); return; }
        if (state.period === "custom" && (!from.value || !to.value || to.value < from.value)) { say("حدّد تاريخ البداية والنهاية (النهاية بعد البداية)", true); return; }
        var brand = page.value || null;
        var label = name.value.trim() || (periodLabel({ period: state.period, starts_on: from.value, ends_on: to.value }) + " — " + (brand ? BRANDS[brand] : "كل الصفحات"));
        save.disabled = true;
        try {
          var row = { label: label, brand: brand, period: state.period, amount: n, created_by: me() };
          if (state.period === "custom") { row.starts_on = from.value; row.ends_on = to.value; }
          var r = await DB().from("ads_spend_limits").insert(row);
          if (r.error) throw r.error;
          say("الحد اتحفظ", false); refresh();
        } catch (e) { fail(e); } finally { save.disabled = false; }
      };
      var row1 = h("div", "cc-row"); row1.append(field("الحد (جنيه)", amount), field("على أي صفحة", page));
      box.append(field("نوع الفترة", seg), row1, dates, field("الاسم", name), save);
      return box;
    }

    function paintLimits(d) {
      limitsHost.textContent = "";
      limitsHost.append(h("h2", "", "💰 حدود الصرف الإعلاني"),
        h("p", "cc-hint", "أي خطة حملة بتتعدّى أي حد من دول، اعتمادها بيتمنع برسالة واضحة. ومن غير حد مفعّل، Claude مبيقترحش حملات بفلوس."));
      var activeCount = d.limits.filter(function (l) { return l.active; }).length;
      if (!activeCount) limitsHost.append(h("div", "cc-warn", "مفيش حدود مفعّلة دلوقتي. Claude مبيقترحش حملات بفلوس، واعتماد الخطط من غير فحص."));
      d.limits.forEach(function (l) { limitsHost.appendChild(limitCard(l, d.status[l.id])); });
      limitsHost.appendChild(addForm());
    }

    function paintCaps(d) {
      capsHost.textContent = "";
      capsHost.append(h("h2", "", "🤖 صلاحيات Claude"),
        h("p", "cc-hint", "مفتاح تشغيل وحد يومي لكل صلاحية. لو قفلت صلاحية، Claude بيبطّل يستخدمها فورًا. الاعتماد والحذف ممنوعين عليه دايمًا."));
      d.caps.forEach(function (c) {
        var row = h("div", "cc-cap"), t = h("div", "cc-cap-t"); t.append(h("b", "", c.label), h("small", "", NOTES[c.key] || ""));
        var usedN = d.used[c.key] || 0;
        var u = h("span", "cc-used", "استخدم " + usedN);
        var num = h("input", "cc-num"); num.type = "number"; num.min = "0"; num.max = "1000"; num.step = "1"; num.value = c.daily_limit == null ? "" : c.daily_limit;
        num.setAttribute("aria-label", "الحد اليومي: " + c.label);
        num.onchange = function () {
          var n = Number(num.value);
          if (num.value === "" || !Number.isInteger(n) || n < 0 || n > 1000) { say("اكتب عدد صحيح من 0 لـ 1000", true); num.value = c.daily_limit == null ? "" : c.daily_limit; return; }
          DB().from("claude_capabilities").update({ daily_limit: n, updated_by: me(), updated_at: new Date().toISOString() }).eq("key", c.key)
            .then(function (r) { if (r.error) throw r.error; c.daily_limit = n; say("الحد اليومي اتعدّل", false); }).catch(fail);
        };
        var tg = toggle(c.enabled, "تشغيل: " + c.label, async function (on) {
          var r = await DB().from("claude_capabilities").update({ enabled: on, updated_by: me(), updated_at: new Date().toISOString() }).eq("key", c.key);
          if (r.error) throw r.error; say(on ? "الصلاحية اشتغلت" : "الصلاحية اتقفلت", false); refresh();
        });
        row.append(t, u, num, tg); capsHost.appendChild(row);
      });
    }

    function refresh() {
      return load().then(function (d) { paintLimits(d); paintCaps(d); }).catch(function (e) {
        limitsHost.textContent = ""; limitsHost.append(h("p", "cc-msg bad", "تعذر تحميل اللوحة: " + ((e && e.message) || e)));
      });
    }
    refresh();
  }

  window.SSMPDClaudeControls = { mount: mount };
})();
