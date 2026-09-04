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

  // ============================================================
  // Content Intelligence (قسم ٣٧) — بانل استشاري وقت إنشاء محتوى جديد.
  // بيقرا بس من vw_content_intelligence_patterns/content_meta_specialty_map/
  // vw_meta_ad_performance — مفيش أي تعديل على سلوك إنشاء المحتوى الحالي،
  // والبانل اختياري بالكامل (قابل للطي، ومفيش إجبار لاستخدامه).
  // ============================================================

  var CONTENT_OBJECTIVES = {
    messages:        { label: "رسائل واتساب/ماسنجر (Messages)", meta: "MESSAGES" },
    lead_generation: { label: "توليد ليدز (Lead Generation)",   meta: "LEAD_GENERATION" },
    engagement:      { label: "تفاعل (Engagement)",             meta: "OUTCOME_ENGAGEMENT" },
    reach:           { label: "وصول (Reach)",                   meta: "REACH" },
    sales:           { label: "مبيعات (Sales)",                 meta: "OUTCOME_SALES" },
    link_clicks:     { label: "زيارات رابط (Link Clicks)",      meta: "LINK_CLICKS" },
    page_likes:      { label: "إعجاب الصفحة (Page Likes)",      meta: "PAGE_LIKES" }
  };
  var CONTENT_FORMATS = {
    video:      { label: "فيديو",             meta: "Video" },
    image_post: { label: "بوست صورة/نص",       meta: "Existing post (Static image/text)" },
    link_post:  { label: "بوست رابط",          meta: "Existing post (Shared link)" }
  };
  var CONFIDENCE_LABELS = {
    high:   { label: "قوي (High)", cls: "approved" },
    medium: { label: "متوسط (Medium)", cls: "received" },
    low:    { label: "محدود (Low)", cls: "draft" }
  };

  function ciObjectiveSelectHtml(id) {
    var html = '<select id="' + id + '"><option value="">— اختر الهدف —</option>';
    Object.keys(CONTENT_OBJECTIVES).forEach(function (k) {
      html += '<option value="' + k + '">' + escapeHtml(CONTENT_OBJECTIVES[k].label) + '</option>';
    });
    return html + '</select>';
  }
  function ciFormatSelectHtml(id) {
    var html = '<select id="' + id + '"><option value="">— كل الأشكال —</option>';
    Object.keys(CONTENT_FORMATS).forEach(function (k) {
      html += '<option value="' + k + '">' + escapeHtml(CONTENT_FORMATS[k].label) + '</option>';
    });
    return html + '</select>';
  }
  function ciMetricFor(objKey) {
    if (objKey === "messages") return "weighted_cost_per_message";
    if (objKey === "lead_generation") return "weighted_cost_per_lead";
    return "weighted_cpm"; // وعي/تفاعل/وصول/مبيعات/زيارات — نحكم بتكلفة الظهور مش تكلفة نتيجة رسائل/ليدز
  }
  function ciMetricLabel(objKey) {
    if (objKey === "messages") return "تكلفة/محادثة";
    if (objKey === "lead_generation") return "تكلفة/ليد";
    return "CPM (تكلفة الألف ظهور)";
  }

  var _ciDataPromise = null;
  function ciLoadData() {
    if (_ciDataPromise) return _ciDataPromise;
    _ciDataPromise = Promise.all([
      window.SSMPDDb.listContentIntelligencePatterns(),
      window.SSMPDDb.listContentSpecialtyMap(),
      window.SSMPDDb.listMetaAdPerformance()
    ]).then(function (res) {
      return { patterns: res[0] || [], map: res[1] || [], ads: res[2] || [] };
    }).catch(function (e) { _ciDataPromise = null; throw e; });
    return _ciDataPromise;
  }

  function ciSignalHtml(confidence) {
    if (confidence === "high") return '<p style="font-size:12px;color:var(--c-positive);margin:4px 0;">📊 لدينا بيانات قوية لهذا التخصص والهدف.</p>';
    if (confidence === "medium") return '<p style="font-size:12px;color:var(--c-muted);margin:4px 0;">📊 بيانات متوسطة — نتايج مبدئية مفيدة لكن لسه محتاجة تجربة أكتر.</p>';
    return '<p style="font-size:12px;color:var(--c-muted);margin:4px 0;">📊 العينة محدودة — تعامل مع النتائج كتجربة وليست قاعدة مؤكدة.</p>';
  }

  function ciPatternRowHtml(p, metricKey, objKey) {
    var v = p[metricKey];
    var vHtml = metricKey === "weighted_cpm" ? fmtMoneyW(v) : fmtMoneyW(v);
    var conf = CONFIDENCE_LABELS[p.confidence] || CONFIDENCE_LABELS.low;
    return '<div style="border:1px solid var(--c-border,#e3e3e3);border-radius:6px;padding:8px 10px;margin-bottom:6px;font-size:12px;">' +
      '<div><b>Hook:</b> ' + escapeHtml(p.hook_type || "—") + ' &nbsp; <b>Angle:</b> ' + escapeHtml(p.content_angle || "—") + '</div>' +
      '<div><b>Format:</b> ' + escapeHtml(p.creative_type || "—") + ' &nbsp; <b>CTA:</b> ' + escapeHtml(p.cta_type || "—") + '</div>' +
      '<div>' + ciMetricLabel(objKey) + ': <b>' + vHtml + '</b> &nbsp; إعلانات: ' + fmtNumW(p.ads_count) +
      ' &nbsp; <span class="status-pill ' + conf.cls + '" style="font-size:10px;">' + conf.label + '</span></div>' +
      '</div>';
  }

  function ciGroupHtml(title, rows, metricKey, objKey, emptyMsg) {
    var html = '<h4 style="font-size:12px;margin:10px 0 6px;">' + title + '</h4>';
    if (!rows.length) {
      html += '<div class="empty-state" style="font-size:11px;">' + (emptyMsg || "لا يوجد") + '</div>';
      return html;
    }
    rows.forEach(function (p) { html += ciPatternRowHtml(p, metricKey, objKey); });
    return html;
  }

  // أمثلة تاريخية ناجحة — من vw_meta_ad_performance، مرتبة بأفضل مقياس،
  // ومُختصرة (مجموعة كرييتف واحدة = مثال واحد + عدد الإعادات تحته)
  function ciWinningExamples(ads, metaLabel, objMeta, metricKey) {
    var filtered = ads.filter(function (a) { return a.specialty === metaLabel && a.objective === objMeta; });
    var sortKey = metricKey === "weighted_cost_per_message" ? "cost_per_msg_conv" :
      metricKey === "weighted_cost_per_lead" ? "cost_per_lead" : "cpm";
    filtered = filtered.filter(function (a) { return a[sortKey] != null; })
      .sort(function (a, b) { return Number(a[sortKey]) - Number(b[sortKey]); });
    var seenGroups = {}; var out = [];
    filtered.forEach(function (a) {
      var key = a.creative_group_id || a.ad_id;
      if (seenGroups[key]) { seenGroups[key].runs += 1; return; }
      seenGroups[key] = { ad: a, runs: 1 };
      out.push(seenGroups[key]);
    });
    return out.slice(0, 5);
  }

  function ciExamplesHtml(examples) {
    var html = '<h4 style="font-size:12px;margin:10px 0 6px;">🏆 أمثلة ناجحة</h4>';
    if (!examples.length) {
      html += '<div class="empty-state" style="font-size:11px;">لا توجد أمثلة تاريخية مطابقة.</div>';
      return html;
    }
    examples.forEach(function (ex, idx) {
      var a = ex.ad;
      html += '<details style="border:1px solid var(--c-border,#e3e3e3);border-radius:6px;padding:6px 10px;margin-bottom:6px;font-size:12px;">' +
        '<summary style="cursor:pointer;"><b>مثال ' + (idx + 1) + ':</b> ' + escapeHtml(a.ad_name || a.campaign_name || "—") +
        (ex.runs > 1 ? ' <span style="color:var(--c-muted);">(' + ex.runs + ' تكرار)</span>' : '') + '</summary>' +
        '<div style="margin-top:6px;">' +
        (a.creative_title ? '<div><b>العنوان:</b> ' + escapeHtml(a.creative_title) + '</div>' : '') +
        (a.creative_body ? '<div><b>النص:</b> ' + escapeHtml(a.creative_body) + '</div>' : '') +
        '<div><b>Hook:</b> ' + escapeHtml(a.hook_type || "—") + ' | <b>Angle:</b> ' + escapeHtml(a.content_angle || "—") +
        ' | <b>CTA:</b> ' + escapeHtml(a.cta_type || "—") + '</div>' +
        '<div>إنفاق: ' + fmtMoneyW(a.spend) + ' | محادثات: ' + fmtNumW(a.msg_conv) + ' | تكلفة/محادثة: ' + fmtMoneyW(a.cost_per_msg_conv) +
        ' | Leads: ' + fmtNumW(a.leads) + ' | CPL: ' + fmtMoneyW(a.cost_per_lead) + ' | CTR: ' + (a.ctr != null ? Number(a.ctr).toFixed(2) + '%' : '—') + '</div>' +
        (a.preview_url ? '<div><a href="' + a.preview_url + '" target="_blank" rel="noopener noreferrer">معاينة الإعلان الأصلي</a></div>' : '') +
        '</div></details>';
    });
    return html;
  }

  function contentIntelligencePanelHtml() {
    return '<div class="section ci-panel" style="margin-top:14px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" id="ci-toggle-head">' +
      '<h3 style="margin:0;font-size:14px;">✨ ذكاء المحتوى</h3><span id="ci-toggle-arrow">▾</span></div>' +
      '<div id="ci-body" style="margin-top:10px;">' +
      '<div class="field"><label>الهدف الإعلاني</label>' + ciObjectiveSelectHtml("ci-objective") + '</div>' +
      '<div class="field"><label>شكل المحتوى (اختياري)</label>' + ciFormatSelectHtml("ci-format") + '</div>' +
      '<div id="ci-output"><div class="empty-state" style="font-size:12px;">اختر التخصص فوق ثم الهدف الإعلاني لعرض التوصيات</div></div>' +
      '</div></div>';
  }

  function ciCurrentState(container) {
    var objSel = container.querySelector("#ci-objective");
    var fmtSel = container.querySelector("#ci-format");
    return { objKey: objSel ? objSel.value : "", fmtKey: fmtSel ? fmtSel.value : "" };
  }

  function renderCiOutput(container, getSpecialtyKey) {
    var out = container.querySelector("#ci-output");
    if (!out) return;
    var specialtyKey = getSpecialtyKey();
    var st = ciCurrentState(container);
    if (!specialtyKey) { out.innerHTML = '<div class="empty-state" style="font-size:12px;">اختر التخصص فوق الأول</div>'; return; }
    if (!st.objKey) { out.innerHTML = '<div class="empty-state" style="font-size:12px;">اختر الهدف الإعلاني لعرض التوصيات</div>'; return; }
    out.innerHTML = '<div class="loading" style="font-size:12px;">بيحمّل بيانات ذكاء المحتوى…</div>';
    ciLoadData().then(function (data) {
      renderCiResults(out, data, specialtyKey, st.objKey, st.fmtKey);
    }).catch(function (e) {
      out.innerHTML = '<div class="err-msg">تعذّر تحميل بيانات ذكاء المحتوى: ' + escapeHtml(e.message || e) + '</div>';
    });
  }

  function ciGeneralFallbackHtml(patterns, objKey) {
    if (!patterns.length) return '';
    var metricKey = ciMetricFor(objKey);
    var top = patterns.slice().sort(function (a, b) {
      var av = a[metricKey] == null ? Infinity : Number(a[metricKey]);
      var bv = b[metricKey] == null ? Infinity : Number(b[metricKey]);
      return av - bv;
    }).slice(0, 3);
    var html = '<h4 style="font-size:12px;margin:10px 0 6px;color:var(--c-muted);">أفضل الأنماط العامة عبر الحساب (GENERAL ACCOUNT INSIGHTS — مش خاصة بالتخصص ده)</h4>';
    top.forEach(function (p) { html += ciPatternRowHtml(p, metricKey, objKey); });
    return html;
  }

  function renderCiResults(out, data, specialtyKey, objKey, fmtKey) {
    var mapRow = data.map.filter(function (m) { return m.content_specialty_key === specialtyKey; })[0];
    var metaLabel = mapRow ? mapRow.meta_specialty_label : null;
    var objMeta = CONTENT_OBJECTIVES[objKey] ? CONTENT_OBJECTIVES[objKey].meta : null;

    if (!metaLabel) {
      var generalNoMap = data.patterns.filter(function (p) { return p.objective === objMeta && p.confidence !== "low"; });
      out.innerHTML = '<div class="empty-state" style="font-size:12px;">لا توجد بيانات تاريخية كافية لهذا التخصص.</div>' + ciGeneralFallbackHtml(generalNoMap, objKey);
      out.dataset.ciBrief = "";
      return;
    }

    var matched = data.patterns.filter(function (p) { return p.specialty === metaLabel && p.objective === objMeta; });
    if (!matched.length) {
      var general = data.patterns.filter(function (p) { return p.objective === objMeta && p.confidence !== "low"; });
      out.innerHTML = '<div class="empty-state" style="font-size:12px;">لا توجد بيانات تاريخية كافية لهذا التخصص مع الهدف ده.</div>' + ciGeneralFallbackHtml(general, objKey);
      out.dataset.ciBrief = "";
      return;
    }

    var metricKey = ciMetricFor(objKey);
    function metricVal(p) { var v = p[metricKey]; return (v == null) ? Infinity : Number(v); }

    var qualifying = matched.filter(function (p) { return p.confidence !== "low"; })
      .slice().sort(function (a, b) { return metricVal(a) - metricVal(b); });
    var worked = qualifying.slice(0, 3);
    var tested = qualifying.slice(3, 6).filter(function (p) { return p.confidence === "medium"; });
    var avoid = [];
    if (qualifying.length >= 5) {
      avoid = qualifying.slice().sort(function (a, b) { return metricVal(b) - metricVal(a); })
        .slice(0, 2).filter(function (p) { return worked.indexOf(p) === -1; });
    }

    var bestConfidence = matched.reduce(function (acc, p) {
      if (p.confidence === "high") return "high";
      if (p.confidence === "medium" && acc !== "high") return "medium";
      return acc;
    }, "low");

    var html = ciSignalHtml(bestConfidence);
    html += ciGroupHtml("✅ ما نجح", worked, metricKey, objKey, "لسه معندناش نتائج بثقة كافية لهذا التخصص/الهدف.");
    html += ciGroupHtml("🧪 جرّب", tested, metricKey, objKey, "");
    if (avoid.length) html += ciGroupHtml("⚠️ تجنب / أعد الاختبار", avoid, metricKey, objKey, "");

    var examples = ciWinningExamples(data.ads, metaLabel, objMeta, metricKey);
    html += ciExamplesHtml(examples);

    html += '<div style="text-align:left;margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;">' +
      '<button class="btn ghost sm" id="ci-copy-brief">نسخ Brief للوكيل</button>' +
      '<button class="btn ghost sm" id="ci-open-agent">وكيل إنشاء المحتوى ↗</button></div>';

    out.innerHTML = html;

    var briefCopyBtn = out.querySelector("#ci-copy-brief");
    if (briefCopyBtn) {
      briefCopyBtn.onclick = function () {
        ciCopyBrief(out, { specialtyKey: specialtyKey, metaLabel: metaLabel, objKey: objKey, fmtKey: fmtKey, worked: worked, tested: tested, avoid: avoid, examples: examples, metricKey: metricKey });
      };
    }
    var agentBtn = out.querySelector("#ci-open-agent");
    if (agentBtn) { agentBtn.onclick = function () { ciOpenAgent(); }; }
  }

  function ciPatternBriefLine(p, metricKey, objKey) {
    return "- Hook: " + (p.hook_type || "—") + " | Angle: " + (p.content_angle || "—") + " | Format: " + (p.creative_type || "—") +
      " | CTA: " + (p.cta_type || "—") + " | " + ciMetricLabel(objKey) + ": " + fmtMoneyW(p[metricKey]) +
      " | إعلانات: " + fmtNumW(p.ads_count) + " | ثقة: " + (CONFIDENCE_LABELS[p.confidence] || CONFIDENCE_LABELS.low).label;
  }

  function ciCopyBrief(out, ctx) {
    var brand = document.getElementById("cf-brand");
    var lines = [];
    lines.push("=== Brief للوكيل — إنشاء محتوى جديد ===");
    lines.push("Brand: " + (brand && brand.value ? brand.value : "—"));
    lines.push("Specialty: " + (SPECIALTIES[ctx.specialtyKey] ? SPECIALTIES[ctx.specialtyKey].label : ctx.specialtyKey));
    lines.push("Advertising Objective: " + (CONTENT_OBJECTIVES[ctx.objKey] ? CONTENT_OBJECTIVES[ctx.objKey].label : ctx.objKey));
    lines.push("Preferred Format: " + (CONTENT_FORMATS[ctx.fmtKey] ? CONTENT_FORMATS[ctx.fmtKey].label : "أي شكل"));
    lines.push("");
    lines.push("HISTORICAL INSIGHTS:");
    if (ctx.worked.length) {
      lines.push("Best evidence-backed patterns:");
      ctx.worked.forEach(function (p) { lines.push(ciPatternBriefLine(p, ctx.metricKey, ctx.objKey)); });
    } else {
      lines.push("لا توجد أنماط بثقة كافية بعد.");
    }
    if (ctx.tested.length) {
      lines.push("Promising (test more):");
      ctx.tested.forEach(function (p) { lines.push(ciPatternBriefLine(p, ctx.metricKey, ctx.objKey)); });
    }
    lines.push("");
    lines.push("WINNING EXAMPLES:");
    if (ctx.examples.length) {
      ctx.examples.slice(0, 3).forEach(function (ex, i) {
        var a = ex.ad;
        lines.push((i + 1) + ") " + (a.ad_name || a.campaign_name || "—") + " — " +
          ciMetricLabel(ctx.objKey) + ": " + fmtMoneyW(a[ctx.metricKey === "weighted_cost_per_message" ? "cost_per_msg_conv" : ctx.metricKey === "weighted_cost_per_lead" ? "cost_per_lead" : "cpm"]));
      });
    } else {
      lines.push("لا توجد أمثلة تاريخية مطابقة.");
    }
    lines.push("");
    lines.push("AVOID / RETEST:");
    if (ctx.avoid.length) {
      ctx.avoid.forEach(function (p) { lines.push(ciPatternBriefLine(p, ctx.metricKey, ctx.objKey)); });
    } else {
      lines.push("مفيش أنماط ضعيفة بأدلة كافية لسه.");
    }
    lines.push("");
    lines.push("استخدم النتائج كمرجع استراتيجي وليس كنص للنسخ.");
    lines.push("من فضلك رجّعلي:");
    lines.push("1. 3-5 أفكار محتوى جديدة");
    lines.push("2. Hook لكل فكرة");
    lines.push("3. الـAngle المقترح");
    lines.push("4. الشكل المقترح (فيديو/بوست/إلخ)");
    lines.push("5. سكريبت/نص كامل");
    lines.push("6. كابشن للنشر");
    lines.push("7. CTA");
    lines.push("8. ليه كل فكرة مناسبة للبيانات التاريخية دي");
    lines.push("مهم: متنسخش الإعلانات القديمة حرفيًا — استخدمها كمرجع بس.");

    var text = lines.join("\n");
    var done = function () {
      if (window.SSMPDToast) window.SSMPDToast.show("تم نسخ الـBrief — افتح وكيل إنشاء المحتوى", "success");
      else alert("تم نسخ الـBrief");
    };
    var fail = function () {
      if (window.SSMPDToast) window.SSMPDToast.show("تعذّر النسخ التلقائي — انسخ يدويًا من النافذة", "error");
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fail);
    } else {
      try {
        var ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        document.execCommand("copy"); document.body.removeChild(ta);
        done();
      } catch (e) { fail(); }
    }
  }

  function ciOpenAgent() {
    window.SSMPDDb.getAppSettings().then(function (s) {
      var url = s && s.content_agent_gpt_url;
      if (!url) {
        if (window.SSMPDToast) window.SSMPDToast.show("رابط وكيل إنشاء المحتوى غير مُعد بعد", "error");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    }).catch(function () {
      if (window.SSMPDToast) window.SSMPDToast.show("تعذّر تحميل إعدادات وكيل المحتوى", "error");
    });
  }

  function wireContentIntelligence(container, getSpecialtyKey) {
    var head = container.querySelector("#ci-toggle-head");
    var body = container.querySelector("#ci-body");
    var arrow = container.querySelector("#ci-toggle-arrow");
    if (head && body && arrow) {
      head.onclick = function () {
        var collapsed = body.style.display === "none";
        body.style.display = collapsed ? "" : "none";
        arrow.textContent = collapsed ? "▾" : "▸";
      };
    }
    function refresh() { renderCiOutput(container, getSpecialtyKey); }
    var objSel = container.querySelector("#ci-objective");
    var fmtSel = container.querySelector("#ci-format");
    if (objSel) objSel.onchange = refresh;
    if (fmtSel) fmtSel.onchange = refresh;
    refresh();
  }
  function refreshContentIntelligence(container, getSpecialtyKey) {
    renderCiOutput(container, getSpecialtyKey);
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
    wireItemActions: wireItemActions,
    contentIntelligencePanelHtml: contentIntelligencePanelHtml,
    wireContentIntelligence: wireContentIntelligence,
    refreshContentIntelligence: refreshContentIntelligence
  };
})();
