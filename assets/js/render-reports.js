/* SSMPD — تاب «التقارير» (الموجة الأولى): خمس تقارير قراءة فقط من دوال القاعدة report_*.
   الصلاحية بتتقرر من السيرفر (report_catalog) — الواجهة بس بتعرض. المرضى بيظهروا برقم الملف بس.
   جزء «صلاحيات التقارير» (للمالك) بيتركّب في لوحة التحكم عن طريق mountAccess. */
(function () {
  "use strict";

  var AREAS = [["operations", "التشغيل"], ["cash", "الخزنة والإيرادات"], ["doctors", "الدكاترة"]];
  var ACCESS_ROLES = ["general_manager", "financial_manager", "accountant", "reception", "customer_service", "page_manager", "nursing", "head_nursing", "sono_doctor"];
  var SHIFT_STATUS = { open: "مفتوحة", closed: "مقفولة", reviewed: "اتراجعت", approved: "اتراجعت" };
  var SOURCE_LABELS = { doctor_fee: "استحقاق خدمة", doctor_payout: "صرف", doctor_contractual: "تسوية", doctor_credit_note: "تسوية" };
  var EMPTY = "لسه مفيش بيانات في الفترة دي";
  var state = null;

  function db() { return window.SSMPDDb.client; }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function q(c, s) { return c.querySelector(s); }
  function qa(c, s) { return Array.prototype.slice.call(c.querySelectorAll(s)); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function today() { return new Date(); }
  function yesterday() { var d = today(); d.setDate(d.getDate() - 1); return iso(d); }
  function monthStart() { var d = today(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-01"; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function fmtNum(v) { return num(v).toLocaleString("en-US", { maximumFractionDigits: 2 }); }
  function money(v) { return fmtNum(v) + " ج.م"; }
  function fmtDate(v) { return v ? String(v).slice(0, 10) : "—"; }
  function fmtDT(v) {
    if (!v) return "—";
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return iso(d) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function res(r) { if (r && r.error) throw r.error; return r ? r.data : null; }
  function rpc(name, args) { return Promise.resolve(db().rpc(name, args || {})).then(res); }
  function errMsg(e) { return (e && e.message) || "حصل خطأ، جرّب تاني"; }

  // ── تعريف التقارير ────────────────────────────────────────────────────────────────────────────
  var C = function (k, l, t) { return { k: k, l: l, t: t || "text" }; };
  var DEFS = {
    cash_closing: {
      sub: "الورديات اللي اتقفلت على خزنة الاستقبال، وفرق العد عن المتوقع.",
      range: true,
      cols: [C("branch", "الفرع"), C("register", "الخزنة"), C("cashier", "الكاشير"), C("opened_at", "فتح", "dt"), C("closed_at", "قفل", "dt"), C("status", "الحالة", "status"),
        C("cash", "كاش", "money"), C("pos", "فيزا", "money"), C("instapay", "إنستاباي/محفظة", "money"), C("bank", "تحويل بنكي", "money"),
        C("expected", "المتوقع", "money"), C("counted", "المعدود", "money"), C("difference", "الفرق", "diff"), C("reviewer", "المراجع")],
      totalKeys: { cash: 1, pos: 1, instapay: 1, bank: 1, expected: 1, counted: 1, difference: 1 },
      load: function (f) { return rpc("report_cash_closing", { p_from: f.from, p_to: f.to, p_branch: f.branch || null }); },
      tiles: function (d) {
        var t = d.totals || {};
        return [{ l: "المتوقع في الخزنة", v: money(t.expected), hero: true, sub: fmtNum(t.shifts) + " وردية" },
          { l: "كاش", v: money(t.cash) }, { l: "فيزا + إنستاباي + بنك", v: money(num(t.pos) + num(t.instapay) + num(t.bank)) },
          { l: "فرق العد", v: money(t.difference), neg: num(t.difference) < 0, sub: fmtNum(t.short_shifts) + " وردية فيها عجز" }];
      }
    },
    revenue_by_doctor: {
      sub: "الإيراد المكتمل لكل تخصص ودكتور، قبل وبعد الخصم.",
      range: true,
      cols: [C("specialty", "التخصص"), C("doctor", "الدكتور"), C("visits", "زيارات", "int"), C("services", "خدمات", "int"), C("gross", "الإجمالي", "money"),
        C("discount", "الخصم", "money"), C("net", "الصافي", "money"), C("insurance", "حصة التأمين", "money"), C("patient", "حصة المريض", "money")],
      totalKeys: { visits: 1, services: 1, gross: 1, discount: 1, net: 1, insurance: 1 },
      load: function (f) {
        var pf = {};
        if (f.specialty) pf.specialty = f.specialty;
        if (f.provider) pf.provider_id = f.provider;
        if (f.payer) pf.payer = f.payer;
        return rpc("report_revenue_by_doctor", { p_from: f.from, p_to: f.to, p_branch: f.branch || null, p_filters: pf });
      },
      tiles: function (d) {
        var t = d.totals || {};
        return [{ l: "صافي الإيراد", v: money(t.net), hero: true, sub: fmtNum(t.visits) + " زيارة" },
          { l: "الإجمالي قبل الخصم", v: money(t.gross) }, { l: "الخصومات", v: money(t.discount) }, { l: "حصة التأمين", v: money(t.insurance) }];
      }
    },
    unbilled_services: {
      sub: "خدمات اتنفذت ومفيهاش فاتورة ومش مغطاة بباقة — لازم تتراجع.",
      range: true,
      cols: [C("branch", "الفرع"), C("day", "اليوم", "date"), C("patient_file", "رقم الملف"), C("service", "الخدمة"), C("specialty", "التخصص"),
        C("doctor", "الدكتور"), C("value", "القيمة", "money"), C("age_days", "عمرها (يوم)", "int")],
      totalKeys: { value: 1 },
      totalOverride: function (d) { return { value: (d.totals || {}).value }; },
      load: function (f) { return rpc("report_unbilled_services", { p_from: f.from, p_to: f.to, p_branch: f.branch || null }); },
      tiles: function (d) {
        var t = d.totals || {}, oldest = 0;
        (d.rows || []).forEach(function (r) { oldest = Math.max(oldest, num(r.age_days)); });
        return [{ l: "قيمة غير مفوترة", v: money(t.value), hero: true, sub: fmtNum(t.count) + " خدمة" },
          { l: "عدد الخدمات", v: fmtNum(t.count) }, { l: "أقدم خدمة", v: fmtNum(oldest), u: "يوم" }];
      }
    },
    doctor_dues: {
      sub: "استحقاقات الدكاترة (حساب 2120) والمصروف والتسويات والرصيد.",
      range: true,
      sensitive: true,
      cols: [C("doctor", "الدكتور"), C("accrued", "المستحق", "money"), C("adjustments", "التسويات", "money"), C("paid", "المصروف", "money"), C("balance", "الرصيد", "money")],
      totalKeys: { accrued: 1, adjustments: 1, paid: 1, balance: 1 },
      load: function (f) { return rpc("report_doctor_dues", { p_from: f.from, p_to: f.to, p_branch: f.branch || null, p_provider: f.provider || null }); },
      tiles: function (d) {
        var t = d.totals || {};
        return [{ l: "الرصيد المستحق", v: money(t.balance), hero: true }, { l: "المستحق في الفترة", v: money(t.accrued) },
          { l: "التسويات", v: money(t.adjustments) }, { l: "المصروف", v: money(t.paid) }];
      }
    },
    daily_flash: {
      sub: "ملخص يوم واحد: إيراد، تحصيل، مواعيد، ليدز، وتنبيهات.",
      range: false,
      cols: [C("l", "البند"), C("v", "القيمة")],
      load: function (f) { return rpc("report_daily_flash", { p_day: f.day && f.day !== yesterday() ? f.day : null, p_branch: f.branch || null }); },
      tiles: function (d) {
        var u = d.unbilled || {};
        return [{ l: "إيراد اليوم", v: money(d.revenue), hero: true, spark: (d.revenue_week || []).map(function (x) { return num(x.net); }), sub: d.day ? fmtDate(d.day) : "" },
          { l: "التحصيل", v: money(d.collections) }, { l: "الزيارات", v: fmtNum(d.visits), sub: fmtNum(d.appointments) + " موعد" },
          { l: "فرق الخزنة", v: money(d.cash_difference), neg: num(d.cash_difference) < 0 }];
      },
      flatten: function (d) {
        var u = d.unbilled || {};
        return [["إيراد اليوم", money(d.revenue)], ["التحصيل", money(d.collections)], ["الزيارات", fmtNum(d.visits)], ["المواعيد", fmtNum(d.appointments)],
          ["لم يحضر", fmtNum(d.no_show)], ["ملغي", fmtNum(d.cancelled)], ["ليدز جديدة", fmtNum(d.leads_new)], ["ليدز اتحجزت", fmtNum(d.leads_booked)],
          ["أصناف مخزن قليلة", fmtNum(d.low_stock)], ["خدمات غير مفوترة", fmtNum(u.count) + " — " + money(u.value)], ["فرق الخزنة", money(d.cash_difference)]];
      }
    }
  };

  // ── الجدول (نموذج واحد للعرض والتصدير) ──────────────────────────────────────────────────────────
  function cellText(col, row) {
    var v = row[col.k];
    switch (col.t) {
      case "money": return fmtNum(v);
      case "diff": return fmtNum(v);
      case "int": return fmtNum(v);
      case "dt": return fmtDT(v);
      case "date": return fmtDate(v);
      case "status": return SHIFT_STATUS[v] || (v == null ? "—" : String(v));
      default: return v == null || v === "" ? "—" : String(v);
    }
  }
  function buildTable(code, d) {
    var def = DEFS[code], cols = def.cols, head = cols.map(function (c) { return c.l; }), rows, foot = null;
    if (code === "daily_flash") {
      rows = def.flatten(d);
      return { head: head, rows: rows, foot: null, cols: cols, raw: rows.length };
    }
    var data = d.rows || [];
    rows = data.map(function (r) { return cols.map(function (c) { return cellText(c, r); }); });
    var tot = def.totalOverride ? def.totalOverride(d) : (d.totals || {});
    foot = cols.map(function (c, i) { return i === 0 ? "الإجمالي" : def.totalKeys[c.k] && tot[c.k] != null ? fmtNum(tot[c.k]) : ""; });
    return { head: head, rows: rows, foot: data.length ? foot : null, cols: cols, raw: data.length, data: data, totals: tot };
  }
  function csvCell(v) { var s = String(v == null ? "" : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function buildCsv(t) {
    var lines = [t.head.map(csvCell).join(",")];
    t.rows.forEach(function (r) { lines.push(r.map(function (v) { return csvCell(String(v).replace(/,/g, "")); }).join(",")); });
    if (t.foot) lines.push(t.foot.map(function (v) { return csvCell(String(v).replace(/,/g, "")); }).join(","));
    return "﻿" + lines.join("\r\n");
  }
  function download(name, text) {
    var blob = new Blob([text], { type: "text/csv;charset=utf-8" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ── HTML ──────────────────────────────────────────────────────────────────────────────────────
  function header(crumb, title, sub) {
    return '<div class="rc-ph"><div class="rc-crumb">' + esc(crumb) + '</div><h1>' + esc(title) + '</h1>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div>';
  }
  var ICON = { lock: '<svg class="rc-ic" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    chev: '<svg class="rc-ic" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
    bars: '<svg class="rc-ic" viewBox="0 0 24 24"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>' };

  function homeHtml() {
    var cat = state.catalog, html = header("التقارير", "التقارير", "تقارير قراءة فقط — مبنية على اللي حصل فعلاً في الاستقبال والحسابات.");
    AREAS.forEach(function (a) {
      var list = (cat.reports || []).filter(function (r) { return r.area === a[0]; });
      if (!list.length) return;
      html += '<div class="rc-gh"><h2>' + a[1] + '</h2><span>' + list.length + '</span></div><div class="rc-grid">';
      list.forEach(function (r) {
        var d = DEFS[r.code] || {};
        var inner = '<div class="rc-card-ic">' + ICON.bars + '</div><div class="rc-card-t"><b>' + esc(r.title) + '</b><span>' + esc(d.sub || "") + '</span></div>' +
          (r.allowed ? ICON.chev : '<span class="rc-chips-col"><span class="rc-chip rc-lock">' + ICON.lock + 'مقفول عليك</span>' + (r.sensitive ? '<span class="rc-chip rc-warn">حساس</span>' : "") + "</span>");
        html += r.allowed ? '<button type="button" class="rc-card rc-open" data-code="' + esc(r.code) + '">' + inner + '</button>'
          : '<div class="rc-card rc-locked" aria-disabled="true">' + inner + '</div>';
      });
      html += '</div>';
    });
    if (!(cat.reports || []).length) html += '<div class="rc-empty">مفيش تقارير متاحة</div>';
    return html;
  }

  function filterHtml(code) {
    var def = DEFS[code], f = state.f, h = '<div class="rc-card rc-filters">';
    if (def.range) {
      h += '<label class="rc-f"><span>من</span><input type="date" data-f="from" value="' + esc(f.from) + '"></label><label class="rc-f"><span>إلى</span><input type="date" data-f="to" value="' + esc(f.to) + '"></label>';
    } else {
      h += '<label class="rc-f"><span>اليوم</span><input type="date" data-f="day" value="' + esc(f.day) + '"></label>';
    }
    var br = '<option value="">كل الفروع</option>' + (state.catalog.branches || []).map(function (b) { return '<option value="' + esc(b.id) + '"' + (f.branch === b.id ? " selected" : "") + ">" + esc(b.name) + "</option>"; }).join("");
    h += '<label class="rc-f"><span>الفرع</span><select data-f="branch">' + br + '</select></label>';
    var o = (state.data && state.data.options) || {};
    if (code === "revenue_by_doctor") {
      h += '<label class="rc-f"><span>التخصص</span><select data-f="specialty"><option value="">كل التخصصات</option>' + (o.specialties || []).map(function (s) { return '<option' + (f.specialty === s ? " selected" : "") + ">" + esc(s) + "</option>"; }).join("") + '</select></label>';
      h += '<label class="rc-f"><span>الدكتور</span><select data-f="provider"><option value="">كل الدكاترة</option>' + (o.doctors || []).map(function (x) { return '<option value="' + esc(x.id) + '"' + (f.provider === x.id ? " selected" : "") + ">" + esc(x.name) + "</option>"; }).join("") + '</select></label>';
      h += '<label class="rc-f"><span>الدفع</span><select data-f="payer"><option value="">الكل</option><option value="cash"' + (f.payer === "cash" ? " selected" : "") + '>كاش</option><option value="insurance"' + (f.payer === "insurance" ? " selected" : "") + '>تأمين</option></select></label>';
    }
    return h + "</div>";
  }

  function spark(vals) {
    if (!vals || vals.length < 2) return "";
    var w = 120, h = 28, max = Math.max.apply(null, vals), min = Math.min.apply(null, vals), span = max - min || 1;
    var pts = vals.map(function (v, i) { return [(i * (w - 8) / (vals.length - 1)) + 4, h - 4 - ((v - min) / span) * (h - 8)]; });
    var last = pts[pts.length - 1];
    return '<svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="' +
      pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ") + '"/><circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="3.5"/></svg>';
  }
  function tilesHtml(tiles) {
    return '<div class="rc-tiles">' + tiles.map(function (t) {
      return '<div class="rc-card rc-tile' + (t.hero ? " rc-hero" : "") + (t.neg ? " rc-neg" : "") + '"><div class="rc-l">' + esc(t.l) + '</div><div class="rc-v">' + esc(t.v) + (t.u ? "<small>" + esc(t.u) + "</small>" : "") + '</div>' +
        (t.sub ? '<div class="rc-sub">' + esc(t.sub) + "</div>" : "") + (t.spark ? '<div class="rc-sp">' + spark(t.spark) + "</div>" : "") + "</div>";
    }).join("") + "</div>";
  }
  function chartHtml(d) {
    var rows = (d.by_specialty || []).filter(function (r) { return num(r.net) > 0; });
    if (!rows.length) return "";
    var max = Math.max.apply(null, rows.map(function (r) { return num(r.net); }));
    return '<div class="rc-card"><div class="rc-ch"><h3>الصافي حسب التخصص<small>بالجنيه</small></h3></div><div class="rc-hb">' + rows.map(function (r) {
      return '<div class="rc-r"><span>' + esc(r.specialty || "—") + '</span><div class="rc-tr"><i style="width:' + Math.max(2, num(r.net) / max * 100).toFixed(1) + '%"></i></div><span>' + fmtNum(r.net) + "</span></div>";
    }).join("") + "</div></div>";
  }
  function tableHtml(code, t) {
    var cols = t.cols, h = '<div class="rc-tw"><table><thead><tr>' + cols.map(function (c) { return '<th class="' + (c.t === "money" || c.t === "diff" || c.t === "int" ? "rc-n" : "") + '">' + esc(c.l) + "</th>"; }).join("") + "</tr></thead><tbody>";
    if (code === "daily_flash") {
      t.rows.forEach(function (r) { h += "<tr><td>" + esc(r[0]) + '</td><td class="rc-n">' + esc(r[1]) + "</td></tr>"; });
    } else {
      (t.data || []).forEach(function (r, i) {
        var click = code === "doctor_dues" && r.provider_id ? ' class="rc-click" data-prov="' + esc(r.provider_id) + '"' : "";
        h += "<tr" + click + ">" + cols.map(function (c, j) {
          var v = t.rows[i][j], cls = c.t === "money" || c.t === "diff" || c.t === "int" ? "rc-n" : "";
          if (c.t === "diff" && num(r[c.k]) < 0) cls += " rc-negc";
          if (c.t === "dt" || c.t === "date") cls += " rc-ltr";
          return '<td class="' + cls + '">' + esc(v) + "</td>";
        }).join("") + "</tr>";
      });
    }
    h += "</tbody>";
    if (t.foot) h += "<tfoot><tr>" + t.foot.map(function (v, j) { var c = cols[j]; return '<td class="' + (c.t === "money" || c.t === "diff" || c.t === "int" ? "rc-n" : "") + (c.t === "diff" && num(t.totals[c.k]) < 0 ? " rc-negc" : "") + '">' + esc(v) + "</td>"; }).join("") + "</tr></tfoot>";
    return h + "</table></div>";
  }
  function linesHtml(d) {
    var lines = d.lines || [];
    if (!lines.length) return "";
    return '<div class="rc-card"><div class="rc-ch"><h3>كشف حساب الدكتور<small>' + esc(state.provName || "") + '</small></h3><div class="rc-acts"><button type="button" class="rc-btn rc-sec" data-act="clear-prov">رجوع لكل الدكاترة</button></div></div><div class="rc-tw"><table><thead><tr><th>اليوم</th><th>النوع</th><th>البيان</th><th>الخدمة</th><th class="rc-n">صافي الإيراد</th><th class="rc-n">دائن</th><th class="rc-n">مدين</th></tr></thead><tbody>' +
      lines.map(function (l) { return "<tr><td>" + esc(fmtDate(l.day)) + "</td><td>" + esc(SOURCE_LABELS[l.source] || l.source || "—") + "</td><td>" + esc(l.description || "—") + "</td><td>" + esc(l.service || "—") + '</td><td class="rc-n">' + fmtNum(l.net_revenue) + '</td><td class="rc-n">' + fmtNum(l.credit) + '</td><td class="rc-n">' + fmtNum(l.debit) + "</td></tr>"; }).join("") + "</tbody></table></div></div>";
  }

  function bd(d) { return '<bdi dir="ltr">' + esc(fmtDate(d)) + "</bdi>"; }
  function periodText(code) { var f = state.f; return DEFS[code].range ? bd(f.from) + " ← " + bd(f.to) : bd(f.day); }
  function branchName() {
    var b = (state.catalog.branches || []).filter(function (x) { return x.id === state.f.branch; })[0];
    return b ? b.name : "كل الفروع";
  }
  function reportHtml(code) {
    var def = DEFS[code], meta = (state.catalog.reports || []).filter(function (r) { return r.code === code; })[0] || { title: code };
    var h = '<button type="button" class="rc-back" data-act="home">' + ICON.chev + 'كل التقارير</button>' +
      header("التقارير", meta.title, def.sub) + (def.sensitive ? '<div class="rc-badge">للإدارة والمدير المالي فقط</div>' : "") + filterHtml(code);
    h += '<div id="rc-body">' + bodyHtml(code) + "</div>";
    return h;
  }
  function bodyHtml(code) {
    var def = DEFS[code], meta = (state.catalog.reports || []).filter(function (r) { return r.code === code; })[0] || { title: code };
    if (state.loading) return '<div class="rc-empty">بيحمّل…</div>';
    if (state.error) return '<div class="rc-error" role="alert">' + esc(state.error) + "</div>";
    var d = state.data;
    if (!d) return "";
    var t = state.table = buildTable(code, d), h = '<div class="rc-printable"><div class="rc-print-head"><b>' + esc(meta.title) + "</b><span>الفرع: " + esc(branchName()) + " — الفترة: " + periodText(code) + "</span></div>";
    h += tilesHtml(def.tiles(d));
    if (code === "revenue_by_doctor") h += chartHtml(d);
    if (code === "doctor_dues") h += linesHtml(d);
    var empty = code !== "daily_flash" && !t.raw;
    h += '<div class="rc-card"><div class="rc-ch"><h3>التفاصيل<small>' + esc(branchName()) + " — " + periodText(code) + '</small></h3><div class="rc-acts no-print"><button type="button" class="rc-btn rc-sec" data-act="csv">تصدير Excel</button><button type="button" class="rc-btn rc-sec" data-act="pdf">PDF</button></div></div>';
    h += empty ? '<div class="rc-empty">' + EMPTY + "</div>" : tableHtml(code, t);
    if (code === "doctor_dues" && !empty) h += '<p class="rc-hint no-print">دوس على اسم دكتور علشان تشوف كشف حسابه.</p>';
    return h + "</div></div>";
  }

  // ── تحميل وربط ─────────────────────────────────────────────────────────────────────────────────
  function paintBody(root, code) {
    var host = q(root, "#rc-body"); if (!host) return;
    host.innerHTML = bodyHtml(code);
    // الفلاتر المعتمدة على بيانات التقرير (تخصصات/دكاترة) بتتحدّث بعد أول تحميل
    var o = (state.data && state.data.options) || {};
    if (code === "revenue_by_doctor" && state.data && !state.optsPainted) {
      state.optsPainted = true; var fcard = q(root, ".rc-filters"); if (fcard) { fcard.outerHTML = filterHtml(code); bindFilters(root, code); }
    }
    if (code === "doctor_dues" && o.doctors && state.f.provider) { var m = o.doctors.filter(function (x) { return x.id === state.f.provider; })[0]; state.provName = m ? m.name : state.provName; }
  }
  function bindFilters(root, code) {
    qa(root, "[data-f]").forEach(function (el) {
      el.onchange = function () { state.f[el.getAttribute("data-f")] = el.value; load(root, code); };
    });
  }
  function load(root, code) {
    var def = DEFS[code], seq = ++state.seq;
    state.loading = true; state.error = ""; paintBody(root, code);
    def.load(state.f).then(function (d) {
      if (seq !== state.seq) return;
      state.data = d || {}; state.loading = false; paintBody(root, code);
    }).catch(function (e) {
      if (seq !== state.seq) return;
      state.loading = false; state.error = errMsg(e); state.data = null; paintBody(root, code);
    });
  }
  function openReport(root, code) {
    var firstBranch = (state.catalog.branches || [])[0];
    state.code = code; state.data = null; state.error = ""; state.optsPainted = false; state.provName = "";
    state.f = { from: monthStart(), to: iso(today()), day: yesterday(), branch: firstBranch ? firstBranch.id : "", specialty: "", provider: "", payer: "" };
    root.innerHTML = reportHtml(code); bindFilters(root, code); wire(root); load(root, code);
  }
  function showHome(root) {
    state.code = null; state.seq++;
    root.innerHTML = homeHtml();
    qa(root, ".rc-open").forEach(function (b) { b.onclick = function () { openReport(root, b.getAttribute("data-code")); }; });
  }
  function wire(root) {
    root.onclick = function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-act],[data-prov]") : null;
      if (!t || !state.code) return;
      var act = t.getAttribute("data-act");
      if (act === "home") return showHome(root);
      if (act === "csv" && state.table) {
        return download(state.code + "-" + (state.f.from || state.f.day) + "-" + (state.f.to || state.f.day) + ".csv", buildCsv(state.table));
      }
      if (act === "pdf") return window.print();
      if (act === "clear-prov") { state.f.provider = ""; return load(root, state.code); }
      var pid = t.getAttribute("data-prov");
      if (pid) {
        var row = ((state.data && state.data.rows) || []).filter(function (r) { return r.provider_id === pid; })[0];
        state.provName = row ? row.doctor : ""; state.f.provider = pid; load(root, state.code);
      }
    };
  }

  function render(container) {
    state = { seq: 0, catalog: null };
    container.innerHTML = '<div class="rc-root" dir="rtl"><div class="rc-empty">بيحمّل…</div></div>';
    var root = q(container, ".rc-root");
    rpc("report_catalog").then(function (cat) {
      state.catalog = cat && cat.reports ? cat : { reports: [], branches: [] };
      showHome(root); wire(root);
    }).catch(function (e) { root.innerHTML = '<div class="rc-error" role="alert">' + esc(errMsg(e)) + "</div>"; });
  }

  // ── صلاحيات التقارير (للمالك — داخل لوحة التحكم) ───────────────────────────────────────────────
  function roleLabel(r) { return window.SSMPDRoles && window.SSMPDRoles.label ? window.SSMPDRoles.label(r) : r; }
  function accessHtml(data) {
    var people = data.people || [];
    var h = '<div class="rc-root rc-access"><h3>صلاحيات التقارير</h3><p class="rc-hint">اختار مين يشوف كل تقرير: بالدور، أو بالاسم لأشخاص معينين. التغيير بيتسجّل في سجل مراجعة.</p><div class="rc-tw"><table><thead><tr><th>التقرير</th>' +
      ACCESS_ROLES.map(function (r) { return "<th class=\"rc-c\">" + esc(roleLabel(r)) + "</th>"; }).join("") + "<th>أشخاص بالاسم</th><th></th></tr></thead><tbody>";
    (data.reports || []).forEach(function (r) {
      h += '<tr data-code="' + esc(r.code) + '"><td><b>' + esc(r.title) + "</b>" + (r.sensitive ? '<div class="rc-note">مستحقات الدكاترة بتفتح للمدير العام والمدير المالي بس حتى لو اديتها لحد تاني</div>' : "") + "</td>" +
        ACCESS_ROLES.map(function (ro) { return '<td class="rc-c"><input type="checkbox" data-role="' + ro + '"' + ((r.roles || []).indexOf(ro) !== -1 ? " checked" : "") + ' aria-label="' + esc(roleLabel(ro)) + '"></td>'; }).join("") +
        '<td><div class="rc-chips" data-chips>' + (r.admins || []).map(function (a) { return chip(a); }).join("") + '</div><select class="rc-pick" data-pick><option value="">+ إضافة شخص</option>' +
        people.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + " — " + esc(roleLabel(p.role)) + "</option>"; }).join("") + '</select></td><td><button type="button" class="rc-btn" data-save>حفظ</button></td></tr>';
    });
    return h + "</tbody></table></div><div class=\"rc-msg\" data-msg></div></div>";
  }
  function chip(a) { return '<span class="rc-chip rc-person" data-id="' + esc(a.id) + '">' + esc(a.name) + ' <button type="button" class="rc-x" data-rm aria-label="شيل">×</button></span>'; }
  function mountAccess(host) {
    if (!host) return Promise.resolve();
    return rpc("report_access_admin", { p_action: "list" }).then(function (data) {
      if (!data || !data.reports) { host.innerHTML = ""; return; }
      host.innerHTML = accessHtml(data);
      var msg = q(host, "[data-msg]");
      host.onclick = function (ev) {
        var rm = ev.target.closest && ev.target.closest("[data-rm]");
        if (rm) { rm.parentNode.remove(); return; }
        var sv = ev.target.closest && ev.target.closest("[data-save]");
        if (!sv) return;
        var tr = sv.closest("tr"), code = tr.getAttribute("data-code");
        var roles = qa(tr, "[data-role]").filter(function (c) { return c.checked; }).map(function (c) { return c.getAttribute("data-role"); });
        var ids = qa(tr, ".rc-person").map(function (c) { return c.getAttribute("data-id"); });
        sv.disabled = true; msg.textContent = ""; msg.className = "rc-msg";
        rpc("report_access_admin", { p_action: "set", p_payload: { code: code, roles: roles, admin_ids: ids } }).then(function () {
          msg.textContent = "اتحفظت صلاحيات التقرير"; msg.className = "rc-msg rc-ok";
        }).catch(function (e) { msg.textContent = errMsg(e); msg.className = "rc-msg rc-bad"; }).then(function () { sv.disabled = false; });
      };
      host.onchange = function (ev) {
        var p = ev.target.closest && ev.target.closest("[data-pick]");
        if (!p || !p.value) return;
        var tr = p.closest("tr"), box = q(tr, "[data-chips]");
        if (!qa(box, ".rc-person").some(function (c) { return c.getAttribute("data-id") === p.value; })) {
          var name = p.options[p.selectedIndex].text.split(" — ")[0];
          box.insertAdjacentHTML("beforeend", chip({ id: p.value, name: name }));
        }
        p.value = "";
      };
    }).catch(function () { host.innerHTML = ""; });
  }

  window.SSMPDRenderReports = { render: render, mountAccess: mountAccess, buildCsv: buildCsv, _defs: DEFS };
})();
