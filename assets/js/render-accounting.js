/* SSMPD — الحسابات (Accounting): تسعير الخدمات + الباكجز */
(function () {
  "use strict";

  var state = { subTab: "pricing", section: null, supplies: [], services: [], packages: [], loaded: false, pendingRepair: null };
  var me = null;

  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
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
      state.pendingRepair = null;
      window.SSMPDToast && window.SSMPDToast.error ? window.SSMPDToast.error("تعذر تحميل بيانات الحسابات") : null;
      cb();
    });
  }

  function applyPermissions(root){
    var R=window.SSMPDRoles,a=window.SSMPDAuth.currentAdmin;
    [['create','[id^="acc-add-"],#acc-import-supplies'],['update','[data-edit-supply],[data-edit-service],[data-edit-package]'],['delete','[data-del-supply],[data-del-service],[data-del-package]']].forEach(function(pair){if(!R.canModuleAction(a,'accounting',pair[0]))root.querySelectorAll(pair[1]).forEach(function(el){el.hidden=true;el.style.display="none";el.disabled=true;el.onclick=null;});});
  }
  function render(container) {
    if(!window.SSMPDRoles.canSeeTab(window.SSMPDAuth.currentAdmin,'accounting')){container.innerHTML='<p>ليس لديك صلاحية عرض الحسابات.</p>';return;}

    me = window.SSMPDAuth.currentAdmin;
    var canFinance = window.SSMPDRoles.canModuleAction(me,"accounting","view");
    var canInventory = window.SSMPDRoles.canSeeTab(me,"inventory") && !(me.inventory_assigned === false && me.inventory_supply_access === true);
    if (!canFinance) state.subTab = "inventory";
    if (state.subTab === "inventory" && !canInventory) state.subTab = "pricing";
    var subs = [
      { key: "pricing", label: "التسعير والخدمات والباكجز" },
      { key: "cash", label: "الخزينة والدورة المالية" },
      { key: "inventory", label: "المخازن والجرد" }
    ].filter(function(s) { return s.key === "inventory" ? canInventory : canFinance; });
    var html = '<div class="tabs acc-catalog-nav" style="margin-bottom:16px;">' +
      subs.map(function (s) {
        return '<button class="tab-btn ' + (state.subTab === s.key ? "active" : "") + '" data-sub="' + s.key + '">' + s.label + '</button>';
      }).join("") + '</div>' +
      '<div id="acc-sub-view"></div>';
    container.innerHTML = html;
    container.querySelectorAll("[data-sub]").forEach(function (btn) {
      btn.onclick = function () {
        state.pendingRepair = null;
        state.subTab = btn.getAttribute("data-sub");
        render(container);
      };
    });
    var subView = document.getElementById("acc-sub-view");
    if (state.subTab === "inventory" && window.SSMPDRenderInventory) { window.SSMPDRenderInventory.render(subView, {embedded:true}); return; }
    if(state.subTab==='cash'&&window.SSMPDFinanceCash){window.SSMPDFinanceCash.render(subView);return;}
    if (!state.loaded) {
      subView.innerHTML = '<p>جاري التحميل...</p>';
      loadAll(function () { if (subView.isConnected && state.subTab === "pricing") renderSub(subView, container); });
    } else {
      renderSub(subView, container);
    }
  }

  var catalogSections = [
    { key: "supplies", title: "المستلزمات والإضافات الطبية", description: "تكلفة العبوة والوحدة واستهلاك المستلزمات.", list: "supplies", unit: "مستلزم مسجل" },
    { key: "services", title: "الخدمات والتسعير", description: "تكلفة الخدمة والمستلزمات وهامش الربح والسعر النهائي.", list: "services", unit: "خدمة مسعرة" },
    { key: "packages", title: "الباكجز", description: "تجميع الخدمات وتسعير الباكج وهامش الربح.", list: "packages", unit: "باكج مجهز" }
  ];

  function renderCatalogIssues(root,container){
    if(!window.SSMPDDb.receptionCatalogIssues)return;
    var panel=document.createElement('section');panel.className='acc-card';root.appendChild(panel);
    window.SSMPDDb.receptionCatalogIssues().then(function(rows){if(!panel.isConnected)return;if(!rows.length){panel.remove();return;}
      panel.innerHTML='<h4>إعدادات خدمات الحجز تحتاج استكمال</h4>'+rows.map(function(x,i){return '<div class="field"><strong>'+esc(x.name)+'</strong><p>'+esc(x.detail)+'</p><button class="btn" type="button" data-catalog-fix="'+i+'">فتح الإعداد الأصلي</button></div>';}).join('');
      panel.querySelectorAll('[data-catalog-fix]').forEach(function(b){if(!window.SSMPDRoles.canModuleAction(me,'accounting','update')){b.hidden=true;return;}b.onclick=function(){var x=rows[+b.dataset.catalogFix],m=x.detail.match(/^اربط مستلزم (.+) بالصنف ووحدة المخزن من نموذج التسعير$/);if(x.kind==='contracts'){var nav=document.querySelector('[data-goto="contracting_entities"]');if(nav)nav.click();return;}window.SSMPDRenderAccounting.openSetupRepair(m?'supplies':x.kind,m?m[1]:x.name);render(container);};});
    }).catch(function(){if(panel.isConnected)panel.textContent='تعذر تحميل مراجعة إعدادات الحجز. أعد فتح القسم للمحاولة.';});
  }
  function renderSub(subView, container) {
    var section = catalogSections.filter(function (s) { return s.key === state.section; })[0];
    if (!section) {
      subView.innerHTML = '<div class="fc-group-intro"><h4>التسعير والخدمات والباكجز</h4><p>اختار القسم لعرض التفاصيل وإدارة الأسعار.</p></div><div class="fc-section-grid acc-catalog-grid">' +
        catalogSections.map(function (s) {
          return '<button type="button" class="fc-section-card" data-acc-section="' + s.key + '"><span class="fc-card-title">' + s.title +
            '</span><span class="fc-card-description">' + s.description + '</span><span class="fc-card-description">' +
            state[s.list].length + ' ' + s.unit + '</span><span class="fc-card-open">فتح القسم <span aria-hidden="true">←</span></span></button>';
        }).join("") + '</div>';
      subView.querySelectorAll("[data-acc-section]").forEach(function (button) {
        button.onclick = function () {
          state.section = button.getAttribute("data-acc-section");
          renderSub(subView, container);
          subView.querySelector("[data-acc-heading]").focus();
        };
      });
      renderCatalogIssues(subView,container);
      return;
    }
    subView.innerHTML = '<div class="fc-section-head"><button type="button" class="btn" data-acc-back>رجوع للأقسام</button><h4 tabindex="-1" data-acc-heading>' + section.title + '</h4></div><div data-acc-detail></div>';
    var detail = subView.querySelector("[data-acc-detail]");
    if (section.key === "packages") renderPackagesScreen(detail, container);
    else renderPricingScreen(detail, container);
    applyPermissions(detail);
    renderCatalogIssues(subView,container);
    var repair=state.pendingRepair;
    if(repair&&repair.section===state.section){
      state.pendingRepair=null;
      var matches=state[section.list].filter(function(row){return row.name===repair.name;});
      if(matches.length===1&&window.SSMPDRoles.canModuleAction(me,'accounting','update')){
        var back=function(){var nav=document.querySelector('[data-goto="reception_services"]');if(nav)nav.click();else render(container);};
        if(section.key==='supplies')openSupplyModal(matches[0],back);
        else if(section.key==='services')openServiceModal(matches[0],back);
        else if(section.key==='packages')openPackageModal(matches[0],back);
      }
    }
    subView.querySelector("[data-acc-back]").onclick = function () {
      state.section = null;
      renderSub(subView, container);
      subView.querySelector('[data-acc-section="' + section.key + '"]').focus();
    };
  }

  // ============ ١) تسعير الخدمات ============
  function renderPricingScreen(subView, container) {
    var html = "";
    if (state.section === "supplies") {
    html += '<div class="acc-card acc-cost">' +
      '<div class="acc-card-head"><div><span class="acc-eyebrow">ضلع التكلفة</span><h3>مستلزمات وإضافات طبية</h3></div>' +
      '<div class="acc-actions"><button class="btn" id="acc-print-supplies">🖨 طباعة</button> ' +
      '<button class="btn" id="acc-export-supplies">⬇ Excel</button> ' +
      '<button class="btn" id="acc-import-supplies">رفع مستلزمات وأدوية Excel</button> '+
      '<button class="btn btn-primary" id="acc-add-supply">+ إضافة مستلزم</button></div></div>' +
      (state.supplies.length ?
        '<div style="overflow-x:auto;"><table class="simple acc-table"><thead><tr>' +
        "<th> <!--ssmpd-i18n:%D8%A7%D9%84%D8%A7%D8%B3%D9%85-->الاسم</th><th>نوع الوحدة</th><th>عدد الوحدات/عبوة</th><th>سعر العبوة</th>" +
        "<th> <!--ssmpd-i18n:%D8%AA%D9%83%D9%84%D9%81%D8%A9%20%D8%A7%D9%84%D9%88%D8%AD%D8%AF%D8%A9-->تكلفة الوحدة</th><th>استهلاك افتراضي/مريض</th><th></th></tr></thead><tbody>" +
        state.supplies.map(function (s) {
          return '<tr><td>' + s.name + '</td><td>' + (s.unit_type || "—") + '</td>' +
            '<td class="acc-col-num">' + numSpan(s.units_per_package) + '</td><td class="acc-col-num">' + numSpan(s.package_price) + '</td>' +
            '<td class="acc-col-num">' + pill("acc-margin", fmt(unitCost(s))) + '</td><td class="acc-col-num">' + numSpan(s.consumption_per_patient) + '</td>' +
            '<td><button class="btn-link" data-edit-supply="' + s.id + "\"> <!--ssmpd-i18n:%D8%AA%D8%B9%D8%AF%D9%8A%D9%84-->تعديل</button> " +
            '<button class="btn-link" data-del-supply="' + s.id + "\"> <!--ssmpd-i18n:%D8%AD%D8%B0%D9%81-->حذف</button></td></tr>";
        }).join("") + '</tbody></table></div>'
        : '<div class="acc-empty"><span class="acc-empty-icon">🧾</span>لسه مفيش مستلزمات مضافة — ابدأ بإضافة أول مستلزم عشان تقدر تربطه بالخدمات</div>') +
      '</div>';

    }
    if (state.section === "services") {
    html += '<div class="acc-card acc-revenue">' +
      '<div class="acc-card-head"><div><span class="acc-eyebrow">ضلع التسعير</span><h3>الخدمات والتسعير</h3></div>' +
      '<div class="acc-actions"><button class="btn" id="acc-print-services">🖨 طباعة</button> ' +
      '<button class="btn" id="acc-export-services">⬇ Excel</button> ' +
      '<button class="btn btn-primary" id="acc-add-service">+ إضافة خدمة</button></div></div>' +
      (state.services.length ?
        '<div style="overflow-x:auto;"><table class="simple acc-table"><thead><tr>' +
        "<th> <!--ssmpd-i18n:%D8%A7%D9%84%D8%AE%D8%AF%D9%85%D8%A9-->الخدمة</th><th>سعر الخدمة</th><th>تكلفة المستلزمات</th><th> <!--ssmpd-i18n:%D8%A5%D8%AC%D9%85%D8%A7%D9%84%D9%8A%20%D8%A7%D9%84%D8%AA%D9%83%D9%84%D9%81%D8%A9-->إجمالي التكلفة</th>" +
        "<th>هامش الربح</th><th> <!--ssmpd-i18n:%D9%82%D9%8A%D9%85%D8%A9%20%D8%A7%D9%84%D8%B1%D8%A8%D8%AD-->قيمة الربح</th><th>السعر النهائي</th><th></th></tr></thead><tbody>" +
        state.services.map(function (s) {
          var t = serviceTotals(s);
          return '<tr><td>' + s.name + '</td><td class="acc-col-num">' + numSpan(s.base_price) + '</td><td class="acc-col-num">' + numSpan(t.materialsCost) + '</td>' +
            '<td class="acc-col-num">' + numSpan(t.totalCost) + '</td><td class="acc-col-num">' + pill("acc-margin", fmt(t.margin) + "%") + '</td>' +
            '<td class="acc-col-num">' + pill("acc-profit", fmt(t.profitValue)) + '</td>' +
            '<td class="acc-col-num">' + pill("acc-final", fmt(t.finalPrice)) + '</td>' +
            '<td><button class="btn-link" data-edit-service="' + s.id + "\"> <!--ssmpd-i18n:%D8%AA%D8%B9%D8%AF%D9%8A%D9%84-->تعديل</button> " +
            '<button class="btn-link" data-del-service="' + s.id + "\"> <!--ssmpd-i18n:%D8%AD%D8%B0%D9%81-->حذف</button></td></tr>";
        }).join("") + '</tbody></table></div>'
        : '<div class="acc-empty"><span class="acc-empty-icon">💊</span>لسه مفيش خدمات مسعّرة — ضيف الخدمة الأولى وحدد سعرها الأساسي وهامش الربح</div>') +
      '</div>';

    }
    subView.innerHTML = html;
    wirePricingScreen(subView, container);
  }

  function wirePricingScreen(subView, container) {
    function bind(id, handler) { var button = subView.querySelector("#" + id); if (button) button.onclick = handler; }
    var reload = function () { render(container); };
    bind("acc-import-supplies", function () { window.SSMPDInventoryCatalog.open({pricing:true,supplies:state.supplies,onSaved:function(){state.loaded=false;reload();}}); });
    bind("acc-add-supply", function () { openSupplyModal(null, reload); });
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
    bind("acc-add-service", function () { openServiceModal(null, reload); });
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
    bind("acc-print-supplies", function () { printTable("مستلزمات/إضافات طبية", supTableRows()); });
    bind("acc-print-services", function () { printTable("الخدمات والتسعير", svcTableRows()); });
    bind("acc-export-supplies", function () { exportExcel("مستلزمات", supTableRows()); });
    bind("acc-export-services", function () { exportExcel("الخدمات", svcTableRows()); });
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
      "<div class=\"field\"><label> <!--ssmpd-i18n:%D8%A7%D9%84%D8%A7%D8%B3%D9%85-->الاسم</label><input id=\"sp-name\" value=\"" + (supply.name || "") + '"></div>' +
      '<div class="field"><label>نوع الوحدة (علبة/زجاجة/عبوة...)</label><input id="sp-unit" value="' + (supply.unit_type || "") + '"></div>' +
      '<div class="field"><label>عدد الوحدات في العبوة</label><input id="sp-units" type="number" step="any" value="' + (supply.units_per_package != null ? supply.units_per_package : "") + '"></div>' +
      '<div class="field"><label>سعر العبوة</label><input id="sp-price" type="number" step="any" value="' + (supply.package_price != null ? supply.package_price : "") + '"></div>' +
      '<fieldset><legend>ربط المخزون</legend><div class="field"><label>الصنف من المخزن</label><select id="sp-inventory"><option value="">بدون ربط</option></select></div><div class="field"><label>كمية وحدة المخزن مقابل وحدة التسعير</label><input id="sp-inventory-quantity" type="number" min="0.0001" step="0.0001" value="'+esc(supply.inventory_quantity_per_unit)+'"></div><p>حدد التحويل حسب وحدة المخزن. لا يفترض النظام أن العبوة تساوي قطعة.</p><p data-inventory-error role="status"></p></fieldset>' +
      '<div class="field"><label>كمية الاستهلاك الافتراضية للمريض الواحد</label><input id="sp-consume" type="number" step="any" value="' + (supply.consumption_per_patient != null ? supply.consumption_per_patient : "") + '"></div>' +
      "<div style=\"margin-top:12px;\"><button class=\"btn btn-primary\" id=\"sp-save\"> <!--ssmpd-i18n:%D8%AD%D9%81%D8%B8-->حفظ</button> <button class=\"btn\" id=\"sp-cancel\"> <!--ssmpd-i18n:%D8%A5%D9%84%D8%BA%D8%A7%D8%A1-->إلغاء</button></div>" +
      '</div>';
    document.body.appendChild(backdrop);
    if(window.SSMPDDb.client){backdrop.querySelector('#sp-save').disabled=true;window.SSMPDDb.client.from('inventory_items').select('id,name,base_unit').eq('active',true).order('name').then(function(res){if(!backdrop.isConnected)return;if(res.error)throw res.error;backdrop.querySelector('#sp-save').disabled=false;backdrop.querySelector('#sp-inventory').innerHTML='<option value="">بدون ربط</option>'+(res.data||[]).map(function(i){return '<option value="'+esc(i.id)+'" '+(supply.inventory_item_id===i.id?'selected':'')+'>'+esc(i.name)+' — '+esc(i.base_unit)+'</option>';}).join('');}).catch(function(err){if(backdrop.isConnected){backdrop.querySelector('[data-inventory-error]').textContent=err.message;backdrop.querySelector('#sp-save').disabled=true;}});}
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
        consumption_per_patient: num(document.getElementById("sp-consume").value),
        inventory_item_id: backdrop.querySelector('#sp-inventory').value||null,
        inventory_quantity_per_unit: Number(backdrop.querySelector('#sp-inventory-quantity').value)||null
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
    var lines = (service.supplies_used || []).map(function(line){return Object.assign({},line);});
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal acc-service-modal" style="max-width:560px;">' +
      '<h3>' + (service.id ? "تعديل خدمة" : "إضافة خدمة") + '</h3>' +
      "<div class=\"field\"><label> <!--ssmpd-i18n:%D8%A7%D8%B3%D9%85%20%D8%A7%D9%84%D8%AE%D8%AF%D9%85%D8%A9-->اسم الخدمة</label><input id=\"sv-name\" value=\"" + esc(service.name) + '"></div>' +
      '<fieldset><legend>بيانات الطبيب من العقد</legend><div class="field"><label for="sv-contract">الطبيب وعقد الخدمة المعتمد</label><select id="sv-contract" disabled><option value="">جاري تحميل العقود</option></select></div><div id="sv-contract-detail" aria-live="polite"></div><button class="btn" id="sv-contract-retry" type="button" hidden>إعادة تحميل العقود</button></fieldset>' +
      '<div class="field"><label>سعر الخدمة (بدون مستلزمات)</label><input id="sv-price" type="number" min="0" step="any" value="' + (service.base_price != null ? service.base_price : "") + '"></div>' +
      '<div class="field"><label>هامش الربح %</label><input id="sv-margin" type="number" min="0" step="any" value="' + (service.profit_margin_percent != null ? service.profit_margin_percent : "") + '"></div>' +
      '<fieldset><legend>الحجز والخدمات</legend><label><input id="sv-booking" type="checkbox" '+(service.booking_enabled?'checked':'')+'> متاحة للحجز</label><div class="field"><label>كود الخدمة في عقد الطبيب</label><small>كود الخدمة مستقل عن كود الطبيب. يجب أن يطابق نطاق الخدمة في العقد.</small><input id="sv-code" value="'+esc(service.booking_code)+'"></div><div class="field"><label>القسم</label><input id="sv-department" value="'+esc(service.booking_department)+'"></div><div class="field"><label>مدة الخدمة بالدقائق</label><input id="sv-minutes" type="number" min="5" max="480" step="1" value="'+esc(service.booking_minutes)+'"></div><label><input id="sv-device" type="checkbox" '+(service.booking_requires_device?'checked':'')+'> تتطلب حجز جهاز</label></fieldset>' +
      '<h4>المستلزمات المستخدمة (غير محدودة)</h4>' +
      '<div id="sv-lines"></div>' +
      '<button class="btn" id="sv-add-line" type="button">+ إضافة مستلزم للخدمة</button>' +
      '<div id="sv-totals" style="margin-top:10px;font-size:13px;"></div><p id="sv-error" role="alert" hidden></p>' +
      "<div style=\"margin-top:12px;\"><button class=\"btn btn-primary\" id=\"sv-save\"> <!--ssmpd-i18n:%D8%AD%D9%81%D8%B8-->حفظ</button> <button class=\"btn\" id=\"sv-cancel\"> <!--ssmpd-i18n:%D8%A5%D9%84%D8%BA%D8%A7%D8%A1-->إلغاء</button></div>" +
      '</div>';
    document.body.appendChild(backdrop);

    var contractSelect = backdrop.querySelector('#sv-contract');
    var contractDetail = backdrop.querySelector('#sv-contract-detail');
    var contracts = [], saving = false, autoContractCode = null;
    function message(text) {
      var error = backdrop.querySelector('#sv-error');
      error.hidden = false; error.textContent = text; error.style.color = '#b42318';
      window.SSMPDToast && window.SSMPDToast.error && window.SSMPDToast.error(text);
    }
    function showContract() {
      var c = contracts.find(function(x){return x.id === contractSelect.value;});
      contractDetail.textContent = '';
      if (!c) return;
      var basis = {performed:'عند تنفيذ الخدمة',collected:'حسب التحصيل'};
      var scopes = {service:'الخدمة دون بنود المستلزمات',invoice:'إجمالي الفاتورة'};
      var deductions = {none:'بدون خصم مستلزمات',cost:'خصم تكلفة المستلزمات',sale:'خصم سعر بيع المستلزمات'};
      var rows = [['الطبيب',c.doctor_name],['كود الطبيب',c.doctor_key],['الخدمة في العقد',c.service_scope],['نسبة الطبيب',fmt(c.rate)+'%'],['أساس الاستحقاق',basis[c.basis]],['وعاء النسبة',scopes[c.base_scope]],['خصم المستلزمات',deductions[c.deduction]],['فترة السريان',c.valid_from+' — '+c.valid_to],['مرجع العقد',c.reference]];
      contractDetail.innerHTML = '<p>بيانات معتمدة للعرض، تتحدث تلقائيًا باختيار العقد. نسبة الطبيب تختلف عن هامش ربح المركز.</p><dl>'+rows.map(function(r){return '<dt>'+esc(r[0])+'</dt><dd style="margin-inline-start:0;overflow-wrap:anywhere">'+esc(r[1])+'</dd>';}).join('')+'</dl>';
      var codeInput=backdrop.querySelector('#sv-code');
      if(!service.id && autoContractCode !== null && codeInput.value === autoContractCode)codeInput.value='';
      autoContractCode=null;
      var matches = state.services.filter(function(x){return x.booking_code === c.service_scope;});
      var nameMatches = state.services.filter(function(x){return x.name === c.service_scope;});
      var linked = matches.length === 1 ? matches[0] : (!matches.length && nameMatches.length === 1 ? nameMatches[0] : null);
      if (linked && linked.id !== service.id) {
        var note = document.createElement('p'); note.textContent = 'الخدمة موجودة بالفعل باسم «'+linked.name+'». افتحها لتعديل سجلها الأصلي بدل إنشاء نسخة أخرى.'; contractDetail.appendChild(note);
        var open = document.createElement('button'); open.type='button'; open.className='btn'; open.textContent='فتح الخدمة الموجودة'; open.onclick=function(){backdrop.remove();openServiceModal(linked,onSaved);}; contractDetail.appendChild(open);
      } else if (!linked && !service.id && !backdrop.querySelector('#sv-code').value.trim()) {
        backdrop.querySelector('#sv-code').value = c.service_scope; autoContractCode=c.service_scope;
      }
      if (linked && linked.booking_code !== c.service_scope) {
        var mismatch = document.createElement('p'); mismatch.textContent='نطاق العقد مسجل باسم الخدمة، بينما كودها هو «'+(linked.booking_code||'غير محدد')+'». يلزم توحيد نطاق العقد مع كود الخدمة من الأطباء والأتعاب وإعادة مراجعته قبل الربط للحجز.';contractDetail.appendChild(mismatch);
      }
      if (c.basis !== 'performed' || c.base_scope !== 'service' || !['none','cost'].includes(c.deduction)) {
        var warning=document.createElement('p');warning.textContent='هذا العقد لا يطابق شروط الحجز الحالية. راجع أساس الاستحقاق ووعاء النسبة وخصم المستلزمات في الأطباء والأتعاب. تظل الشروط المعتمدة كما هي حتى مراجعة عقد مناسب.';contractDetail.appendChild(warning);
      }
      var hint=document.createElement('p');hint.textContent='العقد لا يتضمن سعر الخدمة أو هامش ربح المركز أو مدة الحجز أو القسم. بيانات الخدمة المسجلة تظل مصدر هذه التفاصيل. اختيار العقد هنا لا يخصص الخدمة لطبيب واحد؛ استحقاق الطبيب يرتبط بالزيارة والخدمة المنفذة.';contractDetail.appendChild(hint);
    }
    function loadContracts() {
      var retry=backdrop.querySelector('#sv-contract-retry');retry.hidden=true;contractSelect.disabled=true;
      Promise.resolve().then(function(){return window.SSMPDDb.pricingDoctorContracts();}).then(function(result){
        if(!backdrop.isConnected)return;contracts=result.data||result||[];
        contractSelect.innerHTML='<option value="">اختياري — اختر الطبيب وعقد الخدمة</option>'+contracts.map(function(c){return '<option value="'+esc(c.id)+'">'+esc(c.doctor_name+' — '+c.service_scope+' — '+c.rate+'%')+'</option>';}).join('');
        contractSelect.disabled=false;
        var related=contracts.filter(function(c){return service.id && (c.service_scope===service.booking_code||c.service_scope===service.name);});
        if(related.length===1){contractSelect.value=related[0].id;showContract();}
        else contractDetail.textContent=contracts.length?'اختر العقد لعرض بيانات الطبيب تلقائيًا.':'لا توجد عقود معتمدة وسارية الآن. راجع العقود في الحسابات ← الخزينة والدورة المالية ← الأطباء والأتعاب.';
      }).catch(function(){if(backdrop.isConnected){contractDetail.textContent='تعذر تحميل عقود الطبيب. أعد المحاولة؛ بيانات الخدمة التي أدخلتها ما زالت موجودة.';retry.hidden=false;}});
    }
    contractSelect.onchange=showContract;
    backdrop.querySelector('#sv-contract-retry').onclick=loadContracts;
    loadContracts();

    function supplyOptions(selected) {
      return "<option value=\"\"> <!--ssmpd-i18n:%E2%80%94%20%D8%A7%D8%AE%D8%AA%D8%B1%20%E2%80%94-->— اختر —</option>" + state.supplies.map(function (s) {
        return '<option value="' + s.id + '"' + (selected === s.id ? " selected" : "") + '>' + esc(s.name) + '</option>';
      }).join("");
    }
    function renderLines() {
      var el = document.getElementById("sv-lines");
      el.innerHTML = lines.map(function (l, i) {
        return '<div class="acc-line-row" data-line="' + i + '">' +
          '<select data-line-supply style="flex:2;">' + supplyOptions(l.supply_id) + '</select>' +
          "<input data-line-qty type=\"number\" step=\"any\" placeholder=\"الكمية\" data-i18n-placeholder=\"%D8%A7%D9%84%D9%83%D9%85%D9%8A%D8%A9\" data-i18n-placeholder=\"%D8%A7%D9%84%D9%83%D9%85%D9%8A%D8%A9\" value=\"" + (l.quantity != null ? l.quantity : "") + '" style="flex:1;">' +
          "<button class=\"btn-link\" data-line-del type=\"button\"> <!--ssmpd-i18n:%D8%AD%D8%B0%D9%81-->حذف</button></div>";
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
      if (saving) return;
      backdrop.querySelector('#sv-error').hidden = true;
      var name = document.getElementById("sv-name").value.trim();
      if (!name) { message('اكتب اسم الخدمة'); backdrop.querySelector('#sv-name').focus(); return; }
      var invalid = Array.from(backdrop.querySelectorAll('input[type="number"]')).find(function(el){return !el.checkValidity();});
      if (invalid) { message('راجع القيم الرقمية. مدة الخدمة عدد صحيح من 5 إلى 480 دقيقة، والسعر وهامش الربح لا يقلان عن صفر.'); invalid.reportValidity(); return; }
      var cleanLines = lines.filter(function (l) { return l.supply_id; });
      if (lines.some(function(l){return !l.supply_id || !Number.isFinite(Number(l.quantity)) || Number(l.quantity)<=0;})) {message('اختر الصنف واكتب كمية أكبر من صفر لكل مستلزم، أو احذف السطر غير المستخدم.');return;}
      var patch = {
        id: service.id,
        name: name,
        base_price: num(document.getElementById("sv-price").value),
        profit_margin_percent: num(document.getElementById("sv-margin").value),
        supplies_used: cleanLines,
        booking_enabled: backdrop.querySelector('#sv-booking').checked,
        booking_code: backdrop.querySelector('#sv-code').value.trim()||null,
        booking_department: backdrop.querySelector('#sv-department').value.trim()||null,
        booking_minutes: Number(backdrop.querySelector('#sv-minutes').value)||null,
        booking_requires_device: backdrop.querySelector('#sv-device').checked
      };
      if(patch.booking_enabled&&(!patch.booking_code||!patch.booking_department||!patch.booking_minutes)){message('أكمل كود وقسم ومدة الخدمة للحجز');return;}
      if(patch.booking_code && state.services.some(function(x){return x.id!==service.id && x.booking_code===patch.booking_code;})){message('كود الخدمة مستخدم بالفعل. افتح الخدمة المسجلة وعدّلها أو اختر كودًا مختلفًا للخدمة الجديدة.');return;}
      var saveButton=backdrop.querySelector('#sv-save');saving=true;saveButton.disabled=true;saveButton.textContent='جاري الحفظ…';
      Promise.resolve().then(function(){return window.SSMPDDb.savePricingService(patch, me && me.id);}).then(function () {
        backdrop.remove();
        state.loaded = false;
        onSaved();
      }).catch(function (e) {
        var detail = e && e.message || '';
        if(e && e.code==='23505')detail='كود الخدمة مستخدم بالفعل. افتح الخدمة الأصلية أو اختر كودًا مختلفًا.';
        else if(e && e.code==='42501')detail='حسابك لا يملك صلاحية حفظ الخدمة. راجع صلاحية الإضافة أو التعديل في الحسابات مع مدير النظام.';
        else if(e && (e.code==='23514'||e.code==='22P02'))detail='راجع كود الخدمة والحقول الرقمية، وخاصة مدة الحجز الصحيحة من 5 إلى 480 دقيقة.';
        message('لم يتم حفظ الخدمة. '+(detail||'تعذر الاتصال بالخادم؛ أعد المحاولة.'));
      }).finally(function(){saving=false;saveButton.disabled=false;saveButton.textContent='حفظ';});
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
        "<th> <!--ssmpd-i18n:%D9%82%D9%8A%D9%85%D8%A9%20%D8%A7%D9%84%D8%B1%D8%A8%D8%AD-->قيمة الربح</th><th>الإجمالي النهائي</th><th></th></tr></thead><tbody>" +
        state.packages.map(function (p) {
          var t = packageTotals(p);
          return '<tr><td>' + p.name + '</td><td class="acc-col-num">' + (p.services_included || []).length + '</td>' +
            '<td class="acc-col-num">' + numSpan(t.subtotal) + '</td><td class="acc-col-num">' + pill("acc-margin", fmt(t.margin) + "%") + '</td>' +
            '<td class="acc-col-num">' + pill("acc-profit", fmt(t.profitValue)) + '</td>' +
            '<td class="acc-col-num">' + pill("acc-final", fmt(t.finalTotal)) + '</td>' +
            '<td><button class="btn-link" data-edit-package="' + p.id + "\"> <!--ssmpd-i18n:%D8%AA%D8%B9%D8%AF%D9%8A%D9%84-->تعديل</button> " +
            '<button class="btn-link" data-del-package="' + p.id + "\"> <!--ssmpd-i18n:%D8%AD%D8%B0%D9%81-->حذف</button></td></tr>";
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
      '<fieldset><legend>زيارات الباكج</legend><label><input id="pk-booking" type="checkbox" '+(pkg.booking_enabled?'checked':'')+'> متاح للتعاقد من الحجز</label><div class="field"><label>عدد الزيارات</label><input id="pk-visits" type="number" min="1" max="365" value="'+esc(pkg.booking_visits||1)+'"></div><div class="field"><label>الصلاحية بالأيام</label><input id="pk-validity" type="number" min="1" max="3650" value="'+esc(pkg.booking_validity_days||30)+'"></div><div class="field"><label>شروط التعاقد والمشمولات</label><textarea id="pk-terms">'+esc(pkg.booking_terms)+'</textarea></div></fieldset>' +
      '<h4>الخدمات المضمومة (غير محدودة)</h4>' +
      '<div id="pk-lines"></div>' +
      '<button class="btn" id="pk-add-line" type="button">+ إضافة خدمة للباكج</button>' +
      '<div id="pk-totals" style="margin-top:10px;font-size:13px;"></div>' +
      "<div style=\"margin-top:12px;\"><button class=\"btn btn-primary\" id=\"pk-save\"> <!--ssmpd-i18n:%D8%AD%D9%81%D8%B8-->حفظ</button> <button class=\"btn\" id=\"pk-cancel\"> <!--ssmpd-i18n:%D8%A5%D9%84%D8%BA%D8%A7%D8%A1-->إلغاء</button></div>" +
      '</div>';
    document.body.appendChild(backdrop);

    function serviceOptions(selected) {
      return "<option value=\"\"> <!--ssmpd-i18n:%E2%80%94%20%D8%A7%D8%AE%D8%AA%D8%B1%20%E2%80%94-->— اختر —</option>" + state.services.map(function (s) {
        return '<option value="' + s.id + '"' + (selected === s.id ? " selected" : "") + '>' + s.name + ' (' + fmt(serviceTotals(s).finalPrice) + ')</option>';
      }).join("");
    }
    function renderLines() {
      var el = document.getElementById("pk-lines");
      el.innerHTML = lines.map(function (l, i) {
        return '<div class="acc-line-row" data-line="' + i + '">' +
          '<label>رقم الزيارة<input data-line-visit type="number" min="1" step="1" value="'+esc(l.visit_no||1)+'"></label>'+
          '<select data-line-service style="flex:2;">' + serviceOptions(l.service_id) + '</select>' +
          "<input data-line-qty type=\"number\" step=\"any\" placeholder=\"الكمية\" data-i18n-placeholder=\"%D8%A7%D9%84%D9%83%D9%85%D9%8A%D8%A9\" data-i18n-placeholder=\"%D8%A7%D9%84%D9%83%D9%85%D9%8A%D8%A9\" value=\"" + (l.quantity != null ? l.quantity : 1) + '" style="flex:1;">' +
          "<button class=\"btn-link\" data-line-del type=\"button\"> <!--ssmpd-i18n:%D8%AD%D8%B0%D9%81-->حذف</button></div>";
      }).join("") || '<div class="acc-line-empty">لا يوجد خدمات مضافة لهذا الباكج</div>';
      el.querySelectorAll("[data-line]").forEach(function (row) {
        var idx = Number(row.getAttribute("data-line"));
        row.querySelector("[data-line-visit]").oninput = function(ev){ lines[idx].visit_no=Number(ev.target.value); };
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
        services_included: cleanLines.map(function(l){return Object.assign({},l,{visit_no:l.visit_no||1});}),
        booking_enabled: backdrop.querySelector('#pk-booking').checked,
        booking_visits: Number(backdrop.querySelector('#pk-visits').value)||null,
        booking_validity_days: Number(backdrop.querySelector('#pk-validity').value)||null,
        booking_terms: backdrop.querySelector('#pk-terms').value.trim()
      };
      window.SSMPDDb.savePricingPackage(patch, me && me.id).then(function () {
        backdrop.remove();
        state.loaded = false;
        onSaved();
      }).catch(function () { window.SSMPDToast && window.SSMPDToast.error && window.SSMPDToast.error("تعذر الحفظ"); });
    };
  }

  window.SSMPDRenderAccounting = { render: render, openSetupRepair: function(section,name){if(!['supplies','services','packages'].includes(section))return;state.subTab='pricing';state.section=section;state.loaded=false;state.pendingRepair={section:section,name:name||null};}, selectSection: function(sub,section){state.pendingRepair=null;state.subTab=sub;state.section=section||null;state.loaded=false;}, openCash: function(section,container) { state.subTab = "cash"; if(window.SSMPDFinanceCash.openSection)window.SSMPDFinanceCash.openSection(section);render(container); }, openInventory: function() { state.subTab = "inventory"; } };
})();


