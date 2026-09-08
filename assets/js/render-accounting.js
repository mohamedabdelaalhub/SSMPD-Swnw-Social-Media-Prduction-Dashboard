/* SSMPD — الحسابات (Accounting): تسعير الخدمات + الباكجز */
(function () {
  "use strict";

  var state = { subTab: "pricing", supplies: [], services: [], packages: [], loaded: false };
  var me = null;

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function fmt(n) { return num(n).toLocaleString("en-US", { maximumFractionDigits: 2 }); }
  function numSpan(n) { return '<span class="acc-num">' + fmt(n) + '</span>'; }
  function pill(cls, text) { return '<span class="acc-pill ' + cls + '">' + text + '</span>'; }

  function unitCost(supply) {
    var units = num(supply.units_per_package);
    if (!units) return 0;
    return num(supply.package_price) / units;
  }

  function supplyById(id) {
    return state.supplies.filter(function (s) { return s.id === id; })[0];
  }
  function serviceById(id) {
    return state.services.filter(function (s) { return s.id === id; })[0];
  }

  // تكلفة المستلزمات المستخدمة في خدمة معينة
  function serviceMaterialsCost(service) {
    var used = Array.isArray(service.supplies_used) ? service.supplies_used : [];
    return used.reduce(function (sum, u) {
      var s = supplyById(u.supply_id);
      if (!s) return sum;
      return sum + unitCost(s) * num(u.quantity);
    }, 0);
  }
  function serviceTotals(service) {
    var materialsCost = serviceMaterialsCost(service);
    var totalCost = num(service.base_price) + materialsCost;
    var margin = num(service.profit_margin_percent);
    var profitValue = totalCost * margin / 100;
    var finalPrice = totalCost + profitValue;
    return { materialsCost: materialsCost, totalCost: totalCost, margin: margin, profitValue: profitValue, finalPrice: finalPrice };
  }

  function packageSubtotal(pkg) {
    var included = Array.isArray(pkg.services_included) ? pkg.services_included : [];
    return included.reduce(function (sum, it) {
      var s = serviceById(it.service_id);
      if (!s) return sum;
      return sum + serviceTotals(s).finalPrice * num(it.quantity || 1);
    }, 0);
  }
  function packageTotals(pkg) {
    var subtotal = packageSubtotal(pkg);
    var margin = num(pkg.profit_margin_percent);
    var profitValue = subtotal * margin / 100;
    var finalTotal = subtotal + profitValue;
    return { subtotal: subtotal, margin: margin, profitValue: profitValue, finalTotal: finalTotal };
  }

  function loadAll(cb) {
    Promise.all([
      window.SSMPDDb.listPricingSupplies(),
      window.SSMPDDb.listPricingServices(),
      window.SSMPDDb.listPricingPackages()
    ]).then(function (res) {
      state.supplies = res[0].data || res[0] || [];
      state.services = res[1].data || res[1] || [];
      state.packages = res[2].data || res[2] || [];
      state.loaded = true;
      cb();
    }).catch(function (e) {
      state.loaded = true;
      window.SSMPDToast && window.SSMPDToast.error ? window.SSMPDToast.error("تعذر تحميل بيانات الحسابات") : null;
      cb();
    });
  }

  function render(container) {
    me = window.SSMPDAuth.currentAdmin;
    var subs = [
      { key: "pricing", label: "تسعير الخدمات" },
      { key: "packages", label: "الباكجز" }
    ];
    var html = '<div class="tabs" style="margin-bottom:16px;">' +
      subs.map(function (s) {
        return '<button class="tab-btn ' + (state.subTab === s.key ? "active" : "") + '" data-sub="' + s.key + '">' + s.label + '</button>';
      }).join("") + '</div>' +
      '<div id="acc-sub-view"></div>';
    container.innerHTML = html;
    container.querySelectorAll("[data-sub]").forEach(function (btn) {
      btn.onclick = function () {
        state.subTab = btn.getAttribute("data-sub");
        render(container);
      };
    });
    var subView = document.getElementById("acc-sub-view");
    if (!state.loaded) {
      subView.innerHTML = '<p>جاري التحميل...</p>';
      loadAll(function () { renderSub(subView, container); });
    } else {
      renderSub(subView, container);
    }
  }

  function renderSub(subView, container) {
    if (state.subTab === "packages") renderPackagesScreen(subView, container);
    else renderPricingScreen(subView, container);
  }

  // ============ ١) تسعير الخدمات ============
  function renderPricingScreen(subView, container) {
    var avgMargin = state.services.length ? state.services.reduce(function (s, x) { return s + num(x.profit_margin_percent); }, 0) / state.services.length : 0;

    var html = '<div class="kpi-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:18px;">' +
      '<div class="kpi-card"><div class="label">مستلزمات مسجّلة</div><div class="value">' + state.supplies.length + '</div></div>' +
      '<div class="kpi-card"><div class="label">خدمات مسعّرة</div><div class="value">' + state.services.length + '</div></div>' +
      '<div class="kpi-card"><div class="label">متوسط هامش الربح</div><div class="value small acc-num">' + fmt(avgMargin) + '%</div></div>' +
      '</div>';

    html += '<div class="acc-card acc-cost">' +
      '<div class="acc-card-head"><div><span class="acc-eyebrow">ضلع التكلفة</span><h3>مستلزمات وإضافات طبية</h3></div>' +
      '<div class="acc-actions"><button class="btn" id="acc-print-supplies">🖨 طباعة</button> ' +
      '<button class="btn" id="acc-export-supplies">⬇ Excel</button> ' +
      '<button class="btn btn-primary" id="acc-add-supply">+ إضافة مستلزم</button></div></div>' +
      (state.supplies.length ?
        '<div style="overflow-x:auto;"><table class="simple acc-table"><thead><tr>' +
        '<th>الاسم</th><th>نوع الوحدة</th><th>عدد الوحدات/عبوة</th><th>سعر العبوة</th>' +
        '<th>تكلفة الوحدة</th><th>استهلاك افتراضي/مريض</th><th></th></tr></thead><tbody>' +
        state.supplies.map(function (s) {
          return '<tr><td>' + s.name + '</td><td>' + (s.unit_type || "—") + '</td>' +
            '<td class="acc-col-num">' + numSpan(s.units_per_package) + '</td><td class="acc-col-num">' + numSpan(s.package_price) + '</td>' +
            '<td class="acc-col-num">' + pill("acc-margin", fmt(unitCost(s))) + '</td><td class="acc-col-num">' + numSpan(s.consumption_per_patient) + '</td>' +
            '<td><button class="btn-link" data-edit-supply="' + s.id + '">تعديل</button> ' +
            '<button class="btn-link" data-del-supply="' + s.id + '">حذف</button></td></tr>';
        }).join("") + '</tbody></table></div>'
        : '<div class="acc-empty"><span class="acc-empty-icon">🧾</span>لسه مفيش مستلزمات مضافة — ابدأ بإضافة أول مستلزم عشان تقدر تربطه بالخدمات</div>') +
      '</div>';

    html += '<div class="acc-card acc-revenue">' +
      '<div class="acc-card-head"><div><span class="acc-eyebrow">ضلع التسعير</span><h3>الخدمات والتسعير</h3></div>' +
      '<div class="acc-actions"><button class="btn" id="acc-print-services">🖨 طباعة</button> ' +
      '<button class="btn" id="acc-export-services">⬇ Excel</button> ' +
      '<button class="btn btn-primary" id="acc-add-service">+ إضافة خدمة</button></div></div>' +
      (state.services.length ?
        '<div style="overflow-x:auto;"><table class="simple acc-table"><thead><tr>' +
        '<th>الخدمة</th><th>سعر الخدمة</th><th>تكلفة المستلزمات</th><th>إجمالي التكلفة</th>' +
        '<th>هامش الربح</th><th>قيمة الربح</th><th>السعر النهائي</th><th></th></tr></thead><tbody>' +
        state.services.map(function (s) {
          var t = serviceTotals(s);
          return '<tr><td>' + s.name + '</td><td class="acc-col-num">' + numSpan(s.base_price) + '</td><td class="acc-col-num">' + numSpan(t.materialsCost) + '</td>' +
            '<td class="acc-col-num">' + numSpan(t.totalCost) + '</td><td class="acc-col-num">' + pill("acc-margin", fmt(t.margin) + "%") + '</td>' +
            '<td class="acc-col-num">' + pill("acc-profit", fmt(t.profitValue)) + '</td>' +
            '<td class="acc-col-num">' + pill("acc-final", fmt(t.finalPrice)) + '</td>' +
            '<td><button class="btn-link" data-edit-service="' + s.id + '">تعديل</button> ' +
            '<button class="btn-link" data-del-service="' + s.id + '">حذف</button></td></tr>';
        }).join("") + '</tbody></table></div>'
        : '<div class="acc-empty"><span class="acc-empty-icon">💊</span>لسه مفيش خدمات مسعّرة — ضيف الخدمة الأولى وحدد سعرها الأساسي وهامش الربح</div>') +
      '</div>';

    subView.innerHTML = html;
    wirePricingScreen(subView, container);
  }

  function wirePricingScreen(subView, container) {
    var reload = function () { render(container); };
    document.getElementById("acc-add-supply").onclick = function () { openSupplyModal(null, reload); };
    subView.querySelectorAll("[data-edit-supply]").forEach(function (b) {
      b.onclick = function () { openSupplyModal(supplyById(b.getAttribute("data-edit-supply")), reload); };
    });
    subView.querySelectorAll("[data-del-supply]").forEach(function (b) {
      b.onclick = function () {
        if (!window.confirm("تأكيد حذف المستلزم؟")) return;
        window.SSMPDDb.deletePricingSupply(b.getAttribute("data-del-supply")).then(function () {
          state.loaded = false; render(container);
        });
      };
    });
    document.getElementById("acc-add-service").onclick = function () { openServiceModal(null, reload); };
    subView.querySelectorAll("[data-edit-service]").forEach(function (b) {
      b.onclick = function () { openServiceModal(serviceById(b.getAttribute("data-edit-service")), reload); };
    });
    subView.querySelectorAll("[data-del-service]").forEach(function (b) {
      b.onclick = function () {
        if (!window.confirm("تأكيد حذف الخدمة؟")) return;
        window.SSMPDDb.deletePricingService(b.getAttribute("data-del-service")).then(function () {
          state.loaded = false; render(container);
        });
      };
    });
    document.getElementById("acc-print-supplies").onclick = function () { printTable("مستلزمات/إضافات طبية", supTableRows()); };
    document.getElementById("acc-print-services").onclick = function () { printTable("الخدمات والتسعير", svcTableRows()); };
    document.getElementById("acc-export-supplies").onclick = function () { exportExcel("مستلزمات", supTableRows()); };
    document.getElementById("acc-export-services").onclick = function () { exportExcel("الخدمات", svcTableRows()); };
  }

  function supTableRows() {
    var rows = [["الاسم", "نوع الوحدة", "عدد الوحدات/عبوة", "سعر العبوة", "تكلفة الوحدة", "استهلاك افتراضي/مريض"]];
    state.supplies.forEach(function (s) {
      rows.push([s.name, s.unit_type || "", num(s.units_per_package), num(s.package_price), unitCost(s), num(s.consumption_per_patient)]);
    });
    return rows;
  }
  function svcTableRows() {
    var rows = [["الخدمة", "سعر الخدمة", "تكلفة المستلزمات", "إجمالي التكلفة", "هامش الربح %", "قيمة الربح", "السعر النهائي"]];
    state.services.forEach(function (s) {
      var t = serviceTotals(s);
      rows.push([s.name, num(s.base_price), t.materialsCost, t.totalCost, t.margin, t.profitValue, t.finalPrice]);
    });
    return rows;
  }
  function pkgTableRows() {
    var rows = [["الباكج", "عدد الخدمات", "الإجمالي الفرعي", "نسبة الربح %", "قيمة الربح", "الإجمالي النهائي"]];
    state.packages.forEach(function (p) {
      var t = packageTotals(p);
      rows.push([p.name, (p.services_included || []).length, t.subtotal, t.margin, t.profitValue, t.finalTotal]);
    });
    return rows;
  }

  function printTable(title, rows) {
    var w = window.open("", "_blank");
    var html = '<html dir="rtl"><head><meta charset="utf-8"><title>' + title + '</title>' +
      '<style>body{font-family:Tahoma,sans-serif;padding:16px;}table{border-collapse:collapse;width:100%;}' +
      'td,th{border:1px solid #ccc;padding:6px 10px;text-align:right;font-size:13px;}th{background:#f0f0f0;}</style></head><body>' +
      '<h2>' + title + '</h2><table>' +
      rows.map(function (r, i) {
        return '<tr>' + r.map(function (c) { return (i === 0 ? '<th>' : '<td>') + c + (i === 0 ? '</th>' : '</td>'); }).join("") + '</tr>';
      }).join("") + '</table></body></html>';
    w.document.write(html);
    w.document.close();
    setTimeout(function () { w.print(); }, 300);
  }

  function exportExcel(name, rows) {
    if (!window.XLSX) { window.SSMPDToast && window.SSMPDToast.error && window.SSMPDToast.error("مكتبة Excel غير متاحة"); return; }
    var ws = window.XLSX.utils.aoa_to_sheet(rows);
    var wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, name.substring(0, 30));
    window.XLSX.writeFile(wb, name + ".xlsx");
  }

  // ---- مودال مستلزم ----
  function openSupplyModal(supply, onSaved) {
    supply = supply || {};
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal">' +
      '<h3>' + (supply.id ? "تعديل مستلزم" : "إضافة مستلزم") + '</h3>' +
      '<div class="field"><label>الاسم</label><input id="sp-name" value="' + (supply.name || "") + '"></div>' +
      '<div class="field"><label>نوع الوحدة (علبة/زجاجة/عبوة...)</label><input id="sp-unit" value="' + (supply.unit_type || "") + '"></div>' +
      '<div class="field"><label>عدد الوحدات في العبوة</label><input id="sp-units" type="number" step="any" value="' + (supply.units_per_package != null ? supply.units_per_package : "") + '"></div>' +
      '<div class="field"><label>سعر العبوة</label><input id="sp-price" type="number" step="any" value="' + (supply.package_price != null ? supply.package_price : "") + '"></div>' +
      '<div class="field"><label>كمية الاستهلاك الافتراضية للمريض الواحد</label><input id="sp-consume" type="number" step="any" value="' + (supply.consumption_per_patient != null ? supply.consumption_per_patient : "") + '"></div>' +
      '<div style="margin-top:12px;"><button class="btn btn-primary" id="sp-save">حفظ</button> <button class="btn" id="sp-cancel">إلغاء</button></div>' +
      '</div>';
    document.body.appendChild(backdrop);
    document.getElementById("sp-cancel").onclick = function () { backdrop.remove(); };
    document.getElementById("sp-save").onclick = function () {
      var name = document.getElementById("sp-name").value.trim();
      if (!name) { window.SSMPDToast && window.SSMPDToast.error && window.SSMPDToast.error("اكتب اسم المستلزم"); return; }
      var patch = {
        id: supply.id,
        name: name,
        unit_type: document.getElementById("sp-unit").value.trim(),
        units_per_package: num(document.getElementById("sp-units").value),
        package_price: num(document.getElementById("sp-price").value),
        consumption_per_patient: num(document.getElementById("sp-consume").value)
      };
      window.SSMPDDb.savePricingSupply(patch, me && me.id).then(function () {
        backdrop.remove();
        state.loaded = false;
        onSaved();
      }).catch(function () { window.SSMPDToast && window.SSMPDToast.error && window.SSMPDToast.error("تعذر الحفظ"); });
    };
  }

  // ---- مودال خدمة (مع إضافات غير محدودة) ----
  function openServiceModal(service, onSaved) {
    service = service || {};
    var lines = (service.supplies_used || []).slice();
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal" style="max-width:560px;">' +
      '<h3>' + (service.id ? "تعديل خدمة" : "إضافة خدمة") + '</h3>' +
      '<div class="field"><label>اسم الخدمة</label><input id="sv-name" value="' + (service.name || "") + '"></div>' +
      '<div class="field"><label>سعر الخدمة (بدون مستلزمات)</label><input id="sv-price" type="number" step="any" value="' + (service.base_price != null ? service.base_price : "") + '"></div>' +
      '<div class="field"><label>هامش الربح %</label><input id="sv-margin" type="number" step="any" value="' + (service.profit_margin_percent != null ? service.profit_margin_percent : "") + '"></div>' +
      '<h4>المستلزمات المستخدمة (غير محدودة)</h4>' +
      '<div id="sv-lines"></div>' +
      '<button class="btn" id="sv-add-line" type="button">+ إضافة مستلزم للخدمة</button>' +
      '<div id="sv-totals" style="margin-top:10px;font-size:13px;"></div>' +
      '<div style="margin-top:12px;"><button class="btn btn-primary" id="sv-save">حفظ</button> <button class="btn" id="sv-cancel">إلغاء</button></div>' +
      '</div>';
    document.body.appendChild(backdrop);

    function supplyOptions(selected) {
      return '<option value="">— اختر —</option>' + state.supplies.map(function (s) {
        return '<option value="' + s.id + '"' + (selected === s.id ? " selected" : "") + '>' + s.name + '</option>';
      }).join("");
    }
    function renderLines() {
      var el = document.getElementById("sv-lines");
      el.innerHTML = lines.map(function (l, i) {
        return '<div class="acc-line-row" data-line="' + i + '">' +
          '<select data-line-supply style="flex:2;">' + supplyOptions(l.supply_id) + '</select>' +
          '<input data-line-qty type="number" step="any" placeholder="الكمية" value="' + (l.quantity != null ? l.quantity : "") + '" style="flex:1;">' +
          '<button class="btn-link" data-line-del type="button">حذف</button></div>';
      }).join("") || '<div class="acc-line-empty">لا يوجد مستلزمات مضافة لهذه الخدمة</div>';
      el.querySelectorAll("[data-line]").forEach(function (row) {
        var idx = Number(row.getAttribute("data-line"));
        row.querySelector("[data-line-supply]").onchange = function (e) { lines[idx].supply_id = e.target.value; updateTotals(); };
        row.querySelector("[data-line-qty]").oninput = function (e) { lines[idx].quantity = num(e.target.value); updateTotals(); };
        row.querySelector("[data-line-del]").onclick = function () { lines.splice(idx, 1); renderLines(); updateTotals(); };
      });
      updateTotals();
    }
    function updateTotals() {
      var tmp = { base_price: document.getElementById("sv-price").value, supplies_used: lines, profit_margin_percent: document.getElementById("sv-margin").value };
      var t = serviceTotals(tmp);
      document.getElementById("sv-totals").innerHTML = '<div class="acc-totals-strip">' +
        '<span>تكلفة المستلزمات: ' + numSpan(t.materialsCost) + '</span>' +
        '<span>إجمالي التكلفة: ' + numSpan(t.totalCost) + '</span>' +
        '<span>قيمة الربح: ' + numSpan(t.profitValue) + '</span>' +
        '<span class="acc-final-line">السعر النهائي: ' + numSpan(t.finalPrice) + '</span></div>';
    }
    document.getElementById("sv-add-line").onclick = function () { lines.push({ supply_id: "", quantity: 1 }); renderLines(); };
    document.getElementById("sv-price").oninput = updateTotals;
    document.getElementById("sv-margin").oninput = updateTotals;
    renderLines();

    document.getElementById("sv-cancel").onclick = function () { backdrop.remove(); };
    document.getElementById("sv-save").onclick = function () {
      var name = document.getElementById("sv-name").value.trim();
      if (!name) { window.SSMPDToast && window.SSMPDToast.error && window.SSMPDToast.error("اكتب اسم الخدمة"); return; }
      var cleanLines = lines.filter(function (l) { return l.supply_id; });
      var patch = {
        id: service.id,
        name: name,
        base_price: num(document.getElementById("sv-price").value),
        profit_margin_percent: num(document.getElementById("sv-margin").value),
        supplies_used: cleanLines
      };
      window.SSMPDDb.savePricingService(patch, me && me.id).then(function () {
        backdrop.remove();
        state.loaded = false;
        onSaved();
      }).catch(function () { window.SSMPDToast && window.SSMPDToast.error && window.SSMPDToast.error("تعذر الحفظ"); });
    };
  }

  // ============ ٢) الباكجز ============
  function renderPackagesScreen(subView, container) {
    var totalValue = state.packages.reduce(function (s, p) { return s + packageTotals(p).finalTotal; }, 0);
    var avgMargin = state.packages.length ? state.packages.reduce(function (s, p) { return s + num(p.profit_margin_percent); }, 0) / state.packages.length : 0;

    var html = '<div class="kpi-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:18px;">' +
      '<div class="kpi-card"><div class="label">باكجات مُجهّزة</div><div class="value">' + state.packages.length + '</div></div>' +
      '<div class="kpi-card"><div class="label">متوسط نسبة الربح</div><div class="value small acc-num">' + fmt(avgMargin) + '%</div></div>' +
      '<div class="kpi-card"><div class="label">إجمالي قيمة الباكجات</div><div class="value small acc-num">' + fmt(totalValue) + '</div></div>' +
      '</div>';

    html += '<div class="acc-card acc-revenue">' +
      '<div class="acc-card-head"><div><span class="acc-eyebrow">تجميع خدمات</span><h3>الباكجز</h3></div>' +
      '<div class="acc-actions"><button class="btn" id="acc-print-packages">🖨 طباعة</button> ' +
      '<button class="btn" id="acc-export-packages">⬇ Excel</button> ' +
      '<button class="btn btn-primary" id="acc-add-package">+ إضافة باكج</button></div></div>' +
      (state.packages.length ?
        '<div style="overflow-x:auto;"><table class="simple acc-table"><thead><tr>' +
        '<th>الباكج</th><th>عدد الخدمات</th><th>الإجمالي الفرعي</th><th>نسبة الربح</th>' +
        '<th>قيمة الربح</th><th>الإجمالي النهائي</th><th></th></tr></thead><tbody>' +
        state.packages.map(function (p) {
          var t = packageTotals(p);
          return '<tr><td>' + p.name + '</td><td class="acc-col-num">' + (p.services_included || []).length + '</td>' +
            '<td class="acc-col-num">' + numSpan(t.subtotal) + '</td><td class="acc-col-num">' + pill("acc-margin", fmt(t.margin) + "%") + '</td>' +
            '<td class="acc-col-num">' + pill("acc-profit", fmt(t.profitValue)) + '</td>' +
            '<td class="acc-col-num">' + pill("acc-final", fmt(t.finalTotal)) + '</td>' +
            '<td><button class="btn-link" data-edit-package="' + p.id + '">تعديل</button> ' +
            '<button class="btn-link" data-del-package="' + p.id + '">حذف</button></td></tr>';
        }).join("") + '</tbody></table></div>'
        : '<div class="acc-empty"><span class="acc-empty-icon">📦</span>لسه مفيش باكجات — جمّع أي مجموعة خدمات وحدد نسبة ربح الباكج نفسه</div>') +
      '</div>';
    subView.innerHTML = html;

    var reload = function () { render(container); };
    document.getElementById("acc-add-package").onclick = function () { openPackageModal(null, reload); };
    subView.querySelectorAll("[data-edit-package]").forEach(function (b) {
      b.onclick = function () { openPackageModal(packageById(b.getAttribute("data-edit-package")), reload); };
    });
    subView.querySelectorAll("[data-del-package]").forEach(function (b) {
      b.onclick = function () {
        if (!window.confirm("تأكيد حذف الباكج؟")) return;
        window.SSMPDDb.deletePricingPackage(b.getAttribute("data-del-package")).then(function () {
          state.loaded = false; render(container);
        });
      };
    });
    document.getElementById("acc-print-packages").onclick = function () { printTable("الباكجز", pkgTableRows()); };
    document.getElementById("acc-export-packages").onclick = function () { exportExcel("الباكجز", pkgTableRows()); };
  }

  function packageById(id) {
    return state.packages.filter(function (p) { return p.id === id; })[0];
  }

  function openPackageModal(pkg, onSaved) {
    pkg = pkg || {};
    var lines = (pkg.services_included || []).slice();
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal" style="max-width:560px;">' +
      '<h3>' + (pkg.id ? "تعديل باكج" : "إضافة باكج") + '</h3>' +
      '<div class="field"><label>اسم الباكج</label><input id="pk-name" value="' + (pkg.name || "") + '"></div>' +
      '<div class="field"><label>نسبة الربح % (على إجمالي الباكج)</label><input id="pk-margin" type="number" step="any" value="' + (pkg.profit_margin_percent != null ? pkg.profit_margin_percent : "") + '"></div>' +
      '<h4>الخدمات المضمومة (غير محدودة)</h4>' +
      '<div id="pk-lines"></div>' +
      '<button class="btn" id="pk-add-line" type="button">+ إضافة خدمة للباكج</button>' +
      '<div id="pk-totals" style="margin-top:10px;font-size:13px;"></div>' +
      '<div style="margin-top:12px;"><button class="btn btn-primary" id="pk-save">حفظ</button> <button class="btn" id="pk-cancel">إلغاء</button></div>' +
      '</div>';
    document.body.appendChild(backdrop);

    function serviceOptions(selected) {
      return '<option value="">— اختر —</option>' + state.services.map(function (s) {
        return '<option value="' + s.id + '"' + (selected === s.id ? " selected" : "") + '>' + s.name + ' (' + fmt(serviceTotals(s).finalPrice) + ')</option>';
      }).join("");
    }
    function renderLines() {
      var el = document.getElementById("pk-lines");
      el.innerHTML = lines.map(function (l, i) {
        return '<div class="acc-line-row" data-line="' + i + '">' +
          '<select data-line-service style="flex:2;">' + serviceOptions(l.service_id) + '</select>' +
          '<input data-line-qty type="number" step="any" placeholder="الكمية" value="' + (l.quantity != null ? l.quantity : 1) + '" style="flex:1;">' +
          '<button class="btn-link" data-line-del type="button">حذف</button></div>';
      }).join("") || '<div class="acc-line-empty">لا يوجد خدمات مضافة لهذا الباكج</div>';
      el.querySelectorAll("[data-line]").forEach(function (row) {
        var idx = Number(row.getAttribute("data-line"));
        row.querySelector("[data-line-service]").onchange = function (e) { lines[idx].service_id = e.target.value; updateTotals(); };
        row.querySelector("[data-line-qty]").oninput = function (e) { lines[idx].quantity = num(e.target.value) || 1; updateTotals(); };
        row.querySelector("[data-line-del]").onclick = function () { lines.splice(idx, 1); renderLines(); updateTotals(); };
      });
      updateTotals();
    }
    function updateTotals() {
      var tmp = { services_included: lines, profit_margin_percent: document.getElementById("pk-margin").value };
      var t = packageTotals(tmp);
      document.getElementById("pk-totals").innerHTML = '<div class="acc-totals-strip">' +
        '<span>الإجمالي الفرعي: ' + numSpan(t.subtotal) + '</span>' +
        '<span>قيمة الربح: ' + numSpan(t.profitValue) + '</span>' +
        '<span class="acc-final-line">الإجمالي النهائي: ' + numSpan(t.finalTotal) + '</span></div>';
    }
    document.getElementById("pk-add-line").onclick = function () { lines.push({ service_id: "", quantity: 1 }); renderLines(); };
    document.getElementById("pk-margin").oninput = updateTotals;
    renderLines();

    document.getElementById("pk-cancel").onclick = function () { backdrop.remove(); };
    document.getElementById("pk-save").onclick = function () {
      var name = document.getElementById("pk-name").value.trim();
      if (!name) { window.SSMPDToast && window.SSMPDToast.error && window.SSMPDToast.error("اكتب اسم الباكج"); return; }
      var cleanLines = lines.filter(function (l) { return l.service_id; });
      var patch = {
        id: pkg.id,
        name: name,
        profit_margin_percent: num(document.getElementById("pk-margin").value),
        services_included: cleanLines
      };
      window.SSMPDDb.savePricingPackage(patch, me && me.id).then(function () {
        backdrop.remove();
        state.loaded = false;
        onSaved();
      }).catch(function () { window.SSMPDToast && window.SSMPDToast.error && window.SSMPDToast.error("تعذر الحفظ"); });
    };
  }

  window.SSMPDRenderAccounting = { render: render };
})();
