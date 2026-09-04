/* SSMPD — تعريف مراحل سير العمل (مصدر واحد للحقيقة) */
(function () {
  "use strict";

  // ٨ مراحل Kanban بالترتيب — لا تُغيَّر المفاتيح (stage) لأنها مخزّنة في القاعدة
  var STAGES = [
    { key: "idea_selection",   label: "اختيار الفكرة" },
    { key: "initial_approval", label: "اعتماد أولي" },
    { key: "in_design",        label: "قيد التصميم" },
    { key: "final_approval",   label: "في الاعتماد النهائي" },
    { key: "needs_revision",   label: "مطلوب تعديل" },
    { key: "ready_to_publish", label: "جاهز للنشر" },
    { key: "scheduled",        label: "مجدولة للنشر" },
    { key: "published",        label: "تم النشر" }
  ];

  // حالة عرض المصمم (أيقونة) — مشتقة من stage + design_received_at + assigned_designer
  var DESIGN_STATUS = {
    pending:   { label: "في انتظار الاستلام",   pillClass: "draft" },
    received:  { label: "تم الاستلام",        pillClass: "received" },
    approval:  { label: "في الاعتماد",         pillClass: "approval" },
    revision:  { label: "مطلوب التعديل",       pillClass: "revision" },
    approved:  { label: "تم الاعتماد للنشر",    pillClass: "approved" }
  };

  // تمييز المحتوى بين الصفحتين — يحدده منشئ المحتوى، ويظهر لكل الأدوار في كل المراحل
  var BRANDS = {
    sono:    { label: "سونو" },
    dr_dina: { label: "د.دينا" }
  };

  // التخصص/القسم الطبي اللي المادة بتخص — اختياري، لأغراض تصنيف وإحصائيات
  // الداشبورد بس (مش جزء من سير عمل الاعتماد ولا بيأثر فيه)
  // كل تخصص له لون مميز خاص بيه (خلفية البادچ) — النص دايماً أبيض عشان
  // التباين يفضل واضح مهما كان لون التخصص (طلب المستخدم صراحة)
  var SPECIALTIES = {
    neurology:      { label: "المخ والأعصاب",        color: "#6A4FB6" },
    internal:       { label: "الباطنة",              color: "#0F369D" },
    orthopedics:    { label: "العظام",               color: "#8A6D3B" },
    surgery:        { label: "الجراحة",               color: "#D0402A" },
    dermatology:    { label: "الجلدية",               color: "#C2679A" },
    ent:            { label: "الأنف والأذن",           color: "#2E8B8B" },
    obgyn:          { label: "النساء والتوليد",        color: "#E0559C" },
    psychiatry:     { label: "النفسية والإدمان",       color: "#5C5C8A" },
    pediatrics:     { label: "الأطفال",               color: "#3AA6D9" },
    physio_nutrition: { label: "العلاج الطبيعي والتغذية", color: "#2F7D5C" },
    oncology:       { label: "الأورام",               color: "#7A2E8A" },
    cardiology:     { label: "القلب",                 color: "#C0293A" },
    vascular:       { label: "الأوعية الدموية",        color: "#B23A5E" },
    dental:         { label: "الأسنان",               color: "#3E8FB0" },
    cosmetic_laser: { label: "التجميل والليزر",        color: "#B0779A" },
    emergency:      { label: "الطوارئ",               color: "#F15A22" },
    radiology:      { label: "أشعة",                  color: "#546E7A" },
    lab:            { label: "تحاليل",                color: "#4C6B3A" },
    nursing_services: { label: "خدمات التمريض",        color: "#1F8A70" },
    internal_services: { label: "خدمات داخل المركز",   color: "#4A5568" }
  };

  // منصة النشر — تُختار عند النشر (زي ما يُختار البراند تاني في نفس اللحظة)
  var PLATFORMS = {
    facebook:  { label: "فيسبوك" },
    instagram: { label: "انستجرام" },
    tiktok:    { label: "تيكتوك" },
    youtube:   { label: "قناة يوتيوب" },
    website:   { label: "الموقع الإلكتروني" }
  };

  function stageLabel(key) {
    var s = STAGES.filter(function (x) { return x.key === key; })[0];
    return s ? s.label : key;
  }

  function stageIndex(key) {
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i].key === key) return i;
    return -1;
  }

  // يحدد حالة الأيقونة في شاشة المصمم بناءً على stage + هل المصمم دوس "استلام" ولا لسه
  function designStatusFor(item) {
    switch (item.stage) {
      case "in_design": return item.design_received_at ? "received" : "pending";
      case "final_approval": return "approval";
      case "needs_revision": return "revision";
      case "ready_to_publish":
      case "published": return "approved";
      default: return "pending";
    }
  }

  // بادچ صغير يظهر جنب العنوان في كل الشاشات — فاضي لو المادة لسه بلا براند محدد
  function brandBadgeHtml(brand) {
    if (!brand || !BRANDS[brand]) return "";
    return '<span class="brand-badge ' + brand + '">' + BRANDS[brand].label + "</span>";
  }

  // دروب داون اختيار البراند — بيُستخدم عند إنشاء المحتوى وعند إعادة الاختيار وقت النشر
  function brandSelectHtml(id, selected) {
    var opts = Object.keys(BRANDS).map(function (k) {
      return '<option value="' + k + '"' + (selected === k ? " selected" : "") + '>' + BRANDS[k].label + "</option>";
    }).join("");
    return '<select id="' + id + '"><option value="">— اختر —</option>' + opts + "</select>";
  }

  // بادچ صغير للتخصص — فاضي لو مفيش تخصص محدد
  function specialtyBadgeHtml(specialty) {
    if (!specialty || !SPECIALTIES[specialty]) return "";
    var color = SPECIALTIES[specialty].color || "#0F369D";
    return '<span class="brand-badge" style="background:' + color + ';color:#fff;">' + SPECIALTIES[specialty].label + "</span>";
  }

  // دروب داون اختيار التخصص — اختياري (فيه "بدون تخصص")
  function specialtySelectHtml(id, selected) {
    var opts = Object.keys(SPECIALTIES).map(function (k) {
      return '<option value="' + k + '"' + (selected === k ? " selected" : "") + '>' + SPECIALTIES[k].label + "</option>";
    }).join("");
    return '<select id="' + id + '"><option value="">— بدون تخصص —</option>' + opts + "</select>";
  }

  // دروب داون اختيار منصة النشر
  function platformSelectHtml(id, selected) {
    var opts = Object.keys(PLATFORMS).map(function (k) {
      return '<option value="' + k + '"' + (selected === k ? " selected" : "") + '>' + PLATFORMS[k].label + "</option>";
    }).join("");
    return '<select id="' + id + '"><option value="">— اختر —</option>' + opts + "</select>";
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;");
  }

  // مين يقدر يعدّل المادة: السوبر أدمن والمدير العام دايماً، أو منشئ المادة نفسه
  function canEditItem(me, item) {
    if (!me || !item) return false;
    if (window.SSMPDRoles.hasAnyRole(me, ["super_admin", "general_manager"])) return true;
    return item.created_by === me.id;
  }

  // الحذف مقصور على السوبر أدمن والمدير العام (زي ما هو محدد في صلاحيات القاعدة RLS)
  function canDeleteItem(me) {
    return !!(me && window.SSMPDRoles.hasAnyRole(me, ["super_admin", "general_manager"]));
  }

  // زراير تعديل/حذف — بتظهر حسب صلاحية الشخص الحالي، تُستخدم في كل شاشات عرض المادة
  function itemActionsHtml(item, me) {
    var html = "";
    if (canEditItem(me, item)) html += '<button class="btn ghost sm" data-edit-item="' + item.id + '">تعديل</button> ';
    if (canDeleteItem(me)) html += '<button class="btn danger sm" data-delete-item="' + item.id + '">حذف</button>';
    return html;
  }

  // مودال تعديل عنوان/نص/صفحة المادة — بيتفتح فوق أي مودال تاني مفتوح
  function openEditContentModal(item, onSaved) {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal"><div class="modal-head"><h3>تعديل المادة</h3>' +
      '<button class="modal-close">×</button></div>' +
      '<div class="field"><label>العنوان</label><input id="ed-title" value="' + escapeAttr(item.title) + '"></div>' +
      '<div class="field"><label>المادة دي لصفحة</label>' + brandSelectHtml("ed-brand", item.brand || "") + '</div>' +
      '<div class="field"><label>التخصص</label>' + specialtySelectHtml("ed-specialty", item.specialty || "") + '</div>' +
      '<div class="field"><label>نص المحتوى</label><textarea id="ed-body">' + escapeHtml(item.body || "") + '</textarea></div>' +
      '<div style="text-align:left;margin-top:10px;"><button class="btn" id="ed-save">حفظ التعديلات</button></div></div>';
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    document.getElementById("ed-save").onclick = function () {
      var title = document.getElementById("ed-title").value.trim();
      var body = document.getElementById("ed-body").value.trim();
      var brand = document.getElementById("ed-brand").value;
      var specialty = document.getElementById("ed-specialty").value;
      if (!title) { alert("اكتب عنوان"); return; }
      if (!brand) { alert("اختر المادة دي لصفحة سونو ولا د.دينا"); return; }
      window.SSMPDDb.updateContentItem(item.id, { title: title, body: body, brand: brand, specialty: specialty || null })
        .then(function (updated) {
          backdrop.remove();
          if (onSaved) onSaved(updated);
        }).catch(function (e) { alert("خطأ: " + e.message); });
    };
  }

  // حذف نهائي بعد تأكيد — الإجراء ده لا يمكن التراجع عنه
  function deleteContentItemWithConfirm(item, onDeleted) {
    if (!confirm('متأكد إنك عايز تحذف "' + item.title + '"؟ الإجراء ده نهائي ومش هيترجع.')) return;
    window.SSMPDDb.deleteContentItem(item.id).then(function () {
      if (onDeleted) onDeleted();
    }).catch(function (e) { alert("خطأ: " + e.message); });
  }

  // ربط زراير تعديل/حذف داخل أي مودال — استدعيها بعد إضافة المودال للصفحة
  function wireItemActions(backdrop, item, onChanged) {
    var editBtn = backdrop.querySelector("[data-edit-item]");
    if (editBtn) editBtn.onclick = function () {
      openEditContentModal(item, function (updated) {
        backdrop.remove();
        if (onChanged) onChanged(updated);
      });
    };
    var delBtn = backdrop.querySelector("[data-delete-item]");
    if (delBtn) delBtn.onclick = function () {
      deleteContentItemWithConfirm(item, function () {
        backdrop.remove();
        if (onChanged) onChanged(null);
      });
    };
  }

  // ---------- ربط المحتوى بإعلانات Meta (قسم ٣٦) — يدوي بالكامل، مفيش auto-link ----------
  // نفس صلاحية RLS لجدول content_meta_links بالظبط (page_manager/approver/can_manage_all_content)
  function canManageMetaLinks(me) {
    return !!(me && (window.SSMPDRoles.hasAnyRole(me, ["page_manager", "approver", "super_admin", "general_manager"])));
  }

  function fmtMoneyW(n) { return n == null || isNaN(n) ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " ج.م"; }
  function fmtNumW(n) { return n == null || isNaN(n) ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 }); }

  // مكان الحجز في المودال — بيتملى async بعد ما المودال يتضاف للصفحة
  function metaLinksSectionHtml(item) {
    return '<div class="section" style="margin-top:10px;"><h4 style="font-size:13px;margin-bottom:8px;">أداء إعلانات Meta</h4>' +
      '<div id="meta-links-' + item.id + '"><div class="loading">بيحمّل…</div></div></div>';
  }

  // بيتنادى بعد إضافة المودال للـDOM — بيحمّل الروابط الحالية ويرسم الملخص
  function wireMetaLinksSection(container, item, me) {
    var box = container.querySelector("#meta-links-" + item.id);
    if (!box) return;
    window.SSMPDDb.listContentMetaPerformance(item.id).then(function (rows) {
      renderMetaLinksBox(box, item, me, rows || []);
    }).catch(function (e) {
      box.innerHTML = '<p style="font-size:12px;color:var(--c-negative);">تعذّر تحميل روابط Meta: ' + escapeHtml(e.message || e) + '</p>';
    });
  }

  function renderMetaLinksBox(box, item, me, rows) {
    var canManage = canManageMetaLinks(me);
    var linkBtnHtml = canManage ? '<button class="btn ghost sm" data-link-meta-ad="' + item.id + '">ربط إعلان Meta</button>' : "";

    if (!rows.length) {
      box.innerHTML = '<p style="font-size:12px;color:var(--c-muted);">مفيش إعلان Meta مرتبط بالمادة دي.</p>' + linkBtnHtml;
      wireLinkButton(box, item, me);
      return;
    }

    // تجميع الروابط المحفوظة (content_meta_links) بمعرّفها — كل رابط ممكن يفنّح لأكتر من إعلان لو كان رابط مجموعة كرييتف
    var linksById = {};
    rows.forEach(function (r) {
      if (!linksById[r.link_id]) linksById[r.link_id] = { link_id: r.link_id, creative_group_id: r.creative_group_id, ads: [], linked_at: r.linked_at, confidence: r.confidence };
      if (r.meta_ad_id) linksById[r.link_id].ads.push(r);
    });

    // تجميع الأداء: dedup حسب meta_ad_id عشان إعلان اترتبط بيه مباشرة وبرضه جوه مجموعة كرييتف ما يتحسبش مرتين
    var uniqueAds = {};
    rows.forEach(function (r) { if (r.meta_ad_id && !uniqueAds[r.meta_ad_id]) uniqueAds[r.meta_ad_id] = r; });
    var adsList = Object.keys(uniqueAds).map(function (k) { return uniqueAds[k]; });

    var sum = function (k) { return adsList.reduce(function (s, r) { return s + (Number(r[k]) || 0); }, 0); };
    var spend = sum("spend"), msgConv = sum("msg_conv"), leads = sum("leads"), clicks = sum("clicks"), impressions = sum("impressions"), reach = sum("reach");
    var costPerMsg = msgConv ? spend / msgConv : null;
    var costPerLead = leads ? spend / leads : null;
    var ctrPct = impressions ? (clicks / impressions * 100) : null;
    var cpc = clicks ? spend / clicks : null;
    var statuses = {}; adsList.forEach(function (r) { if (r.status) statuses[r.status] = true; });
    var statusStr = Object.keys(statuses).join("، ") || "—";

    var html = '<div class="kpi-grid">' +
      '<div class="kpi-card"><div class="label">الإنفاق</div><div class="value small">' + fmtMoneyW(spend) + '</div></div>' +
      '<div class="kpi-card"><div class="label">محادثات</div><div class="value small">' + fmtNumW(msgConv) + '</div></div>' +
      '<div class="kpi-card"><div class="label">تكلفة المحادثة</div><div class="value small">' + (costPerMsg == null ? "—" : fmtMoneyW(costPerMsg)) + '</div></div>' +
      '<div class="kpi-card"><div class="label">Leads</div><div class="value small">' + fmtNumW(leads) + '</div></div>' +
      '<div class="kpi-card"><div class="label">CPL</div><div class="value small">' + (costPerLead == null ? "—" : fmtMoneyW(costPerLead)) + '</div></div>' +
      '<div class="kpi-card"><div class="label">الوصول</div><div class="value small">' + fmtNumW(reach) + '</div></div>' +
      '<div class="kpi-card"><div class="label">CTR</div><div class="value small">' + (ctrPct == null ? "—" : ctrPct.toFixed(2) + "%") + '</div></div>' +
      '<div class="kpi-card"><div class="label">CPC</div><div class="value small">' + (cpc == null ? "—" : fmtMoneyW(cpc)) + '</div></div>' +
      '<div class="kpi-card"><div class="label">الحالة</div><div class="value small">' + escapeHtml(statusStr) + '</div></div>' +
      '</div>';

    if (adsList.length > 1) {
      html += '<div style="max-height:200px;overflow:auto;margin-top:8px;"><table class="simple"><thead><tr><th>الإعلان</th><th>مجموعة الكرييتف</th><th>الحالة</th><th>الإنفاق</th><th>Leads</th></tr></thead><tbody>' +
        adsList.map(function (r) {
          return '<tr><td style="font-size:11px;">' + escapeHtml(r.ad_name) + '</td><td style="font-size:11px;">' + escapeHtml(r.creative_group_id) + '</td>' +
            '<td>' + escapeHtml(r.status) + '</td><td>' + fmtMoneyW(r.spend) + '</td><td>' + fmtNumW(r.leads) + '</td></tr>';
        }).join("") + '</tbody></table></div>';
    }

    html += '<div style="margin-top:8px;">' + Object.keys(linksById).map(function (k) {
      var l = linksById[k];
      var desc = l.ads.length && !l.creative_group_id ? "إعلان: " + escapeHtml(l.ads[0].ad_name)
        : l.creative_group_id ? "مجموعة كرييتف: " + escapeHtml(l.creative_group_id) + " (" + l.ads.length + " إعلان)"
        : "رابط";
      return '<span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;background:var(--c-card);border:1px solid var(--c-border);border-radius:8px;padding:3px 8px;margin:2px;">' +
        desc + (canManage ? ' <button class="btn ghost sm" data-unlink-meta="' + l.link_id + '" style="padding:1px 6px;">فك الربط</button>' : '') + '</span>';
    }).join("") + '</div>';

    html += '<div style="margin-top:8px;">' + linkBtnHtml + '</div>';
    box.innerHTML = html;
    wireLinkButton(box, item, me);
    box.querySelectorAll("[data-unlink-meta]").forEach(function (btn) {
      btn.onclick = function () {
        if (!confirm("فك ربط الإعلان ده عن المادة؟")) return;
        window.SSMPDDb.deleteContentMetaLink(btn.getAttribute("data-unlink-meta")).then(function () {
          wireMetaLinksSection(box.parentElement, item, me);
        }).catch(function (e) { alert("خطأ: " + e.message); });
      };
    });
  }

  function wireLinkButton(box, item, me) {
    var btn = box.querySelector("[data-link-meta-ad]");
    if (btn) btn.onclick = function () {
      openLinkMetaAdModal(item, me, function () { wireMetaLinksSection(box.parentElement, item, me); });
    };
  }

  // مودال البحث عن إعلان Meta وربطه — اختيار يدوي صريح دايمًا، مفيش auto-match
  function openLinkMetaAdModal(item, me, onLinked) {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal"><div class="modal-head"><h3>ربط إعلان Meta بـ«' + escapeHtml(item.title) + '»</h3>' +
      '<button class="modal-close">×</button></div>' +
      '<input id="lma-search" placeholder="دوّر بالاسم / اسم الحملة / رقم الإعلان / مجموعة الكرييتف / التخصص" style="width:100%;padding:9px 12px;border-radius:10px;border:1px solid var(--c-border);margin-bottom:10px;">' +
      '<div id="lma-results" style="max-height:360px;overflow:auto;"><div class="loading">بيحمّل الإعلانات…</div></div></div>';
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    window.SSMPDDb.listMetaAdPerformance().then(function (ads) {
      var resultsBox = document.getElementById("lma-results");
      function renderResults(term) {
        term = (term || "").toLowerCase();
        var filtered = !term ? ads : ads.filter(function (a) {
          return [a.ad_name, a.campaign_name, a.platform_ad_id, a.creative_group_id, a.specialty].some(function (v) {
            return v && String(v).toLowerCase().indexOf(term) !== -1;
          });
        });
        if (!filtered.length) { resultsBox.innerHTML = '<p style="font-size:12px;color:var(--c-muted);">مفيش نتائج.</p>'; return; }
        resultsBox.innerHTML = '<table class="simple"><thead><tr><th>الإعلان</th><th>الحملة</th><th>التخصص</th><th>الحالة</th><th>الإنفاق</th><th></th></tr></thead><tbody>' +
          filtered.slice(0, 100).map(function (a) {
            return '<tr><td style="font-size:11px;">' + escapeHtml(a.ad_name) + '<div style="color:var(--c-muted);font-size:10px;">' + escapeHtml(a.platform_ad_id) + ' — ' + escapeHtml(a.creative_group_id) + '</div></td>' +
              '<td style="font-size:11px;">' + escapeHtml(a.campaign_name) + '</td><td>' + escapeHtml(a.specialty) + '</td>' +
              '<td>' + escapeHtml(a.status) + '</td><td>' + fmtMoneyW(a.spend) + '</td>' +
              '<td><button class="btn ghost sm" data-pick-ad="' + a.ad_id + '">ربط هذا الإعلان</button>' +
              (a.creative_group_id ? ' <button class="btn ghost sm" data-pick-group="' + escapeAttr(a.creative_group_id) + '">ربط كل المجموعة</button>' : '') + '</td></tr>';
          }).join("") + '</tbody></table>';
        resultsBox.querySelectorAll("[data-pick-ad]").forEach(function (btn) {
          btn.onclick = function () { doLink({ content_id: item.id, meta_ad_id: btn.getAttribute("data-pick-ad"), linked_by: me.id }); };
        });
        resultsBox.querySelectorAll("[data-pick-group]").forEach(function (btn) {
          btn.onclick = function () { doLink({ content_id: item.id, creative_group_id: btn.getAttribute("data-pick-group"), linked_by: me.id }); };
        });
      }
      function doLink(row) {
        window.SSMPDDb.createContentMetaLink(row).then(function () {
          backdrop.remove();
          if (onLinked) onLinked();
        }).catch(function (e) {
          if (e && e.code === "23505") alert("الإعلان/المجموعة دي مرتبطة بالفعل بالمادة دي.");
          else alert("خطأ: " + e.message);
        });
      }
      renderResults("");
      document.getElementById("lma-search").oninput = function (e) { renderResults(e.target.value); };
    }).catch(function (e) {
      document.getElementById("lma-results").innerHTML = '<p style="color:var(--c-negative);font-size:12px;">تعذّر تحميل الإعلانات: ' + escapeHtml(e.message || e) + '</p>';
    });
  }

  window.SSMPDWorkflow = {
    STAGES: STAGES,
    metaLinksSectionHtml: metaLinksSectionHtml,
    wireMetaLinksSection: wireMetaLinksSection,
    DESIGN_STATUS: DESIGN_STATUS,
    BRANDS: BRANDS,
    SPECIALTIES: SPECIALTIES,
    PLATFORMS: PLATFORMS,
    stageLabel: stageLabel,
    stageIndex: stageIndex,
    designStatusFor: designStatusFor,
    brandBadgeHtml: brandBadgeHtml,
    brandSelectHtml: brandSelectHtml,
    specialtyBadgeHtml: specialtyBadgeHtml,
    specialtySelectHtml: specialtySelectHtml,
    platformSelectHtml: platformSelectHtml,
    canEditItem: canEditItem,
    canDeleteItem: canDeleteItem,
    itemActionsHtml: itemActionsHtml,
    openEditContentModal: openEditContentModal,
    deleteContentItemWithConfirm: deleteContentItemWithConfirm,
    wireItemActions: wireItemActions
  };
})();
