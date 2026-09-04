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

  // ---------- V2 ranking engine (قسم ٣٧ تحسين — رانك + تصنيف واضح لغير المتخصص) ----------

  function ciBetterConf(a, b) {
    var order = { high: 3, medium: 2, low: 1 };
    if (!a) return b || "low";
    if (!b) return a;
    return order[a] >= order[b] ? a : b;
  }

  // ثقة إجمالية على مجموعة عناصر قابلة للمقارنة — نفس عتبات section 37 SQL
  function ciAggregateConfidence(pool) {
    var count = pool.length, spend = 0, sample = 0;
    pool.forEach(function (x) { spend += x.spend || 0; sample += x.sample || 0; });
    if (count >= 5 && (spend >= 2000 || sample >= 20)) return "high";
    if (count >= 2 && (spend >= 300 || sample >= 5)) return "medium";
    return "low";
  }

  // ترتيب: الأقل تكلفة أولاً، لكن لو الفرق أقل من ٢٠٪ نفضّل الأدلة الأقوى (عدد نتائج/إنفاق/تكرار)
  // — عشان معدل ضعيف بعينة واحدة ميتفضلش على أداء مستقر بعينة كبيرة (بند ١٤).
  function ciSortComparable(arr) {
    return arr.slice().sort(function (a, b) {
      var av = a.metric, bv = b.metric;
      if (Math.abs(av - bv) / Math.max(av, bv, 1) < 0.2) {
        var as = (a.sample || 0) + (a.spend || 0) / 500 + (a.runs || 1) * 2;
        var bs = (b.sample || 0) + (b.spend || 0) / 500 + (b.runs || 1) * 2;
        if (as !== bs) return bs - as;
      }
      return av - bv;
    });
  }

  // تصنيف كل عنصر بعد الترتيب: BEST (مثبت أو متاح حاليًا) / STRONG / PROMISING / WEAK
  function ciClassifyStatus(x, idx, poolConfidence, bestMetric) {
    var ratio = bestMetric > 0 ? x.metric / bestMetric : 1;
    var ownStrong = (x.sample || 0) >= 5 || (x.spend || 0) >= 300 || (x.runs || 1) >= 2;
    if (idx === 0) {
      if (poolConfidence === "high" && ownStrong) return { key: "best_proven", emoji: "⭐", label: "أفضل خيار (BEST OPTION)" };
      return { key: "best_available", emoji: "⭐", label: "أفضل خيار متاح حاليًا" + (poolConfidence === "low" ? " — ثقة منخفضة" : "") };
    }
    if (ratio <= 1.5) return { key: "strong", emoji: "🟢", label: "خيار قوي (STRONG)" };
    if (ratio <= 3) return { key: "promising", emoji: "🟡", label: "واعد — جرّبه أكتر (PROMISING)" };
    return { key: "weak", emoji: "🔴", label: "ضعيف / أعد الاختبار (WEAK)" };
  }

  function ciItemConfidenceLabel(x, poolConfidence) {
    var ownStrong = (x.sample || 0) >= 5 || (x.spend || 0) >= 300 || (x.runs || 1) >= 2;
    var lvl = ownStrong ? poolConfidence : (poolConfidence === "high" ? "medium" : poolConfidence);
    return CONFIDENCE_LABELS[lvl] || CONFIDENCE_LABELS.low;
  }

  function ciWhyText(status, ratio, runs, metricLabel) {
    switch (status.key) {
      case "best_proven": return "أقل " + metricLabel + " بين الخيارات القابلة للمقارنة، مع حجم نتائج/تكرار أفضل من البدائل.";
      case "best_available": return "أفضل " + metricLabel + " متاح حاليًا ضمن بيانات محدودة — يستاهل التجربة، مش دليل نهائي.";
      case "strong": return "قريب من الأفضل بأدلة معقولة" + ((runs || 1) > 1 ? "، وحقق أداء جيدًا عبر أكتر من تشغيل لنفس Creative Group." : ".");
      case "promising": return "النتيجة مقبولة، لكن العينة صغيرة أو الإعلان اتشغّل مرة واحدة بس — محتاج اختبار أكتر.";
      case "weak": return metricLabel + " أعلى بكتير من البدائل التاريخية (~" + (ratio || 1).toFixed(1) + "× الأفضل).";
      default: return "";
    }
  }

  // قيمة "بلا معنى" (UNKNOWN/N/A/فاضي) — أساس تمييز أداء رقمي عن Pattern فعلي قابل للاستخدام (V3)
  function ciIsMeaningful(v) {
    if (v == null) return false;
    var s = String(v).trim();
    if (!s) return false;
    return !/^(unknown|n\/a|na|null|none|--+|—+|-)$/i.test(s);
  }

  // مؤهل كـ"Pattern محتوى" (وليس مجرد رقم أداء) لو عنده أي إشارة إبداعية مفيدة —
  // Hook أو Angle أو CTA أو Format، أو (للإعلانات) عنوان/نص كرييتف حقيقي (بند ٣)
  function ciIsActionable(p, kind) {
    var hasHook = ciIsMeaningful(p.hook_type);
    var hasAngle = ciIsMeaningful(p.content_angle);
    var hasCta = ciIsMeaningful(p.cta_type);
    var hasFormat = ciIsMeaningful(p.creative_type);
    var hasCreative = kind === "ad" && (ciIsMeaningful(p.creative_title) || (p.creative_body && String(p.creative_body).trim().length > 15));
    return hasHook || hasAngle || hasCta || hasFormat || hasCreative;
  }

  function ciHowToUseText(p, status, isTechnical) {
    if (isTechnical) return "استفد بس من أداء الـCTA/الهدف، مش من الـCreative نفسه (ده إعلان تقني/رابط بس).";
    if (status.key === "weak") return "لا تكرر نفس التنفيذ. لو هتختبر الفكرة، غيّر الـHook أو الـAngle.";
    var parts = [];
    if (ciIsMeaningful(p.hook_type)) parts.push("ابدأ بـ" + p.hook_type);
    if (ciIsMeaningful(p.content_angle)) parts.push("عن " + p.content_angle);
    var lead = parts.length ? parts.join(" ") + "، بعدين قدّم معلومة قصيرة" : "قدّم معلومة قصيرة ومباشرة تخص المشكلة/الخدمة";
    var cta = ciIsMeaningful(p.cta_type) ? "، وقفل بـCTA " + p.cta_type + "." : "، وقفل بدعوة واضحة للتواصل.";
    return lead + cta;
  }

  // إعلان تقني/رابط بس (بدون عنوان/نص كرييتف حقيقي) — مش مصدر إلهام إبداعي (بند ٧)
  function ciIsTechnical(a) {
    var title = String(a.creative_title || "").trim();
    var body = String(a.creative_body || "").trim();
    if (title || body.length > 15) return false;
    var name = String(a.ad_name || "") + " " + String(a.campaign_name || "");
    if (/promoting|whatsapp\.com\/send|https?:\/\//i.test(name)) return true;
    return true; // مفيش عنوان ولا نص كرييتف مفيد
  }

  function ciTechnicalSummary(list, metricField) {
    if (!list.length) return null;
    var sum = 0, n = 0, ctas = {};
    list.forEach(function (a) {
      if (a[metricField] != null) { sum += Number(a[metricField]); n++; }
      if (a.cta_type) ctas[a.cta_type] = true;
    });
    return { count: list.length, avgMetric: n ? sum / n : null, ctas: Object.keys(ctas) };
  }

  // ترتيب+تصنيف عام: بيحسب rank/ratio/status على مصفوفة مرتبة بالفعل، ويرجّع ثقة المجموعة
  function ciAssignRankStatus(arr) {
    var poolConfidence = ciAggregateConfidence(arr);
    var bestMetric = arr.length ? arr[0].metric : null;
    arr.forEach(function (x, idx) {
      x.rank = idx + 1;
      x.ratio = bestMetric > 0 ? x.metric / bestMetric : 1;
      x.status = ciClassifyStatus(x, idx, poolConfidence, bestMetric);
    });
    return poolConfidence;
  }

  // نفس الفكرة بس لمجموعة العناصر المؤهلة كـ"Pattern محتوى" (actionable) —
  // بيتخزن في حقول منفصلة (aRank/aRatio/aStatus) عشان الرانك الأصلي (أداء
  // رقمي بحت) يفضل موجود ومستقل — بند ٢/٧ (فصل الأداء عن الإلهام الإبداعي)
  function ciAssignActionableRank(arr) {
    var poolConfidence = ciAggregateConfidence(arr);
    var bestMetric = arr.length ? arr[0].metric : null;
    arr.forEach(function (x, idx) {
      x.aRank = idx + 1;
      x.aRatio = bestMetric > 0 ? x.metric / bestMetric : 1;
      x.aStatus = ciClassifyStatus(x, idx, poolConfidence, bestMetric);
    });
    return poolConfidence;
  }

  // بناء pool مُصنَّف من أنماط vw_content_intelligence_patterns —
  // pool = ترتيب أداء رقمي بحت، actionablePool = بس اللي فيهم إشارة إبداعية مفيدة (V3)
  function ciBuildPatternPool(matchedPatterns, metricKey) {
    var valid = matchedPatterns.filter(function (p) { return p[metricKey] != null; });
    var arr = valid.map(function (p) {
      return { raw: p, metric: Number(p[metricKey]), sample: Number(p.total_messages || 0) + Number(p.total_leads || 0), spend: Number(p.total_spend || 0), runs: Number(p.ads_count || 1) };
    });
    arr = ciSortComparable(arr);
    arr.forEach(function (x) { x.actionable = ciIsActionable(x.raw, "pattern"); });
    var poolConfidence = ciAssignRankStatus(arr);
    var actionableArr = arr.filter(function (x) { return x.actionable; });
    var actionableConfidence = actionableArr.length ? ciAssignActionableRank(actionableArr) : "low";
    return { pool: arr, confidence: poolConfidence, actionablePool: actionableArr, actionableConfidence: actionableConfidence };
  }

  // بناء pool مُصنَّف من إعلانات vw_meta_ad_performance — مُستبعد منه الإعلانات
  // التقنية/الرابط بس (بترجع منفصلة في technical)، ومُجمّع حسب creative_group_id
  // (نفس المجموعة = مثال واحد + عدد تكرارات)
  function ciBuildExamplePool(ads, metaLabel, objMeta, objKey) {
    var filtered = ads.filter(function (a) { return a.specialty === metaLabel && a.objective === objMeta; });
    var metricField = objKey === "messages" ? "cost_per_msg_conv" : objKey === "lead_generation" ? "cost_per_lead" : "cpm";
    var sampleField = objKey === "messages" ? "msg_conv" : objKey === "lead_generation" ? "leads" : "impressions";
    var valid = filtered.filter(function (a) {
      if (objKey === "messages") return Number(a.msg_conv) > 0 && a.cost_per_msg_conv != null;
      if (objKey === "lead_generation") return Number(a.leads) > 0 && a.cost_per_lead != null;
      return a.cpm != null;
    });
    var technical = valid.filter(ciIsTechnical);
    var creative = valid.filter(function (a) { return !ciIsTechnical(a); });

    var arr = creative.map(function (a) {
      return { metric: Number(a[metricField]), sample: Number(a[sampleField] || 0), spend: Number(a.spend || 0), a: a };
    });
    arr = ciSortComparable(arr); // نرتب الإعلانات الفردية الأول عشان نمثّل كل مجموعة كرييتف بأفضل تشغيل ليها

    var groups = {}; var deduped = [];
    arr.forEach(function (x) {
      var key = x.a.creative_group_id || x.a.ad_id;
      if (groups[key]) { groups[key].runs += 1; return; }
      var g = { raw: x.a, metric: x.metric, sample: x.sample, spend: x.spend, runs: 1 };
      groups[key] = g; deduped.push(g);
    });

    var pool = ciSortComparable(deduped);
    pool.forEach(function (x) { x.actionable = ciIsActionable(x.raw, "ad"); });
    var poolConfidence = ciAssignRankStatus(pool);
    var actionablePool = pool.filter(function (x) { return x.actionable; });
    var actionableConfidence = actionablePool.length ? ciAssignActionableRank(actionablePool) : "low";
    return { pool: pool, confidence: poolConfidence, actionablePool: actionablePool, actionableConfidence: actionableConfidence, technical: ciTechnicalSummary(technical, metricField), metricField: metricField };
  }

  function ciSignalHtml(confidence) {
    if (confidence === "high") return '<p style="font-size:12px;color:var(--c-positive);margin:4px 0;">📊 لدينا بيانات قوية لهذا التخصص والهدف.</p>';
    if (confidence === "medium") return '<p style="font-size:12px;color:var(--c-muted);margin:4px 0;">📊 بيانات متوسطة — نتايج مبدئية مفيدة لكن لسه محتاجة تجربة أكتر.</p>';
    return '<p style="font-size:12px;color:var(--c-muted);margin:4px 0;">📊 العينة محدودة — تعامل مع النتائج كتجربة وليست قاعدة مؤكدة.</p>';
  }

  // كارت موحّد لعنصر مُصنَّف (نمط أو إعلان فردي) — رانك + حالة + ثقة + ليه/إزاي
  // mode: "perf" (رانك أداء رقمي بحت، الافتراضي) أو "actionable" (رانك بين
  // الـPatterns القابلة للاستخدام بس — بيستخدم aRank/aRatio/aStatus)
  function ciCardHtml(x, objKey, poolConfidence, kind, mode) {
    mode = mode || "perf";
    var metricLabel = ciMetricLabel(objKey);
    var p = x.raw;
    var rank = mode === "actionable" ? x.aRank : x.rank;
    var status = mode === "actionable" ? x.aStatus : x.status;
    var ratio = mode === "actionable" ? x.aRatio : x.ratio;
    var confLabel = ciItemConfidenceLabel(x, poolConfidence);
    var why = ciWhyText(status, ratio, x.runs, metricLabel);
    var how = ciHowToUseText(p, status, false);
    var incomplete = !x.actionable ? '<div style="color:var(--c-negative);margin-top:2px;">⚠️ بيانات التنفيذ الإبداعي غير مكتملة لهذا الإعلان — مفيد كإشارة أداء بس، مش مرجع كافٍ لصناعة محتوى جديد.</div>' : "";
    var html = '<div style="border:1px solid var(--c-border,#e3e3e3);border-radius:6px;padding:8px 10px;margin-bottom:6px;font-size:12px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;"><b>#' + rank + ' ' + status.emoji + ' ' + escapeHtml(status.label) + '</b>' +
      '<span class="status-pill ' + confLabel.cls + '" style="font-size:10px;">ثقة: ' + confLabel.label + '</span></div>' + incomplete;
    if (kind === "ad") {
      html += '<div style="margin-top:4px;"><b>' + escapeHtml(p.ad_name || p.campaign_name || "—") + '</b>' +
        (x.runs > 1 ? ' <span style="color:var(--c-muted);">(' + x.runs + ' تكرار)</span>' : '') + '</div>';
      if (p.creative_title) html += '<div><b>العنوان:</b> ' + escapeHtml(p.creative_title) + '</div>';
      if (p.creative_body) html += '<div><b>النص:</b> ' + escapeHtml(String(p.creative_body).slice(0, 140)) + (String(p.creative_body).length > 140 ? "…" : "") + '</div>';
    }
    html += '<div><b>Hook:</b> ' + escapeHtml(p.hook_type || "—") + ' &nbsp; <b>Angle:</b> ' + escapeHtml(p.content_angle || "—") + '</div>';
    html += '<div><b>Format:</b> ' + escapeHtml(p.creative_type || "—") + ' &nbsp; <b>CTA:</b> ' + escapeHtml(p.cta_type || "—") + '</div>';
    if (kind === "ad") {
      html += '<div>إنفاق: ' + fmtMoneyW(p.spend) + ' | محادثات: ' + fmtNumW(p.msg_conv) + ' | تكلفة/محادثة: ' + fmtMoneyW(p.cost_per_msg_conv) +
        ' | Leads: ' + fmtNumW(p.leads) + ' | CPL: ' + fmtMoneyW(p.cost_per_lead) + ' | CTR: ' + (p.ctr != null ? Number(p.ctr).toFixed(2) + "%" : "—") +
        ' | CPC: ' + fmtMoneyW(p.cpc) + ' | CPM: ' + fmtMoneyW(p.cpm) + '</div>';
      if (p.creative_group_id) html += '<div style="color:var(--c-muted);">Creative Group: ' + escapeHtml(p.creative_group_id) + ' — Runs: ' + x.runs + '</div>';
      if (p.preview_url) html += '<div><a href="' + p.preview_url + '" target="_blank" rel="noopener noreferrer">معاينة الإعلان الأصلي</a></div>';
    } else {
      html += '<div>' + metricLabel + ': <b>' + fmtMoneyW(x.metric) + '</b> &nbsp; إعلانات: ' + fmtNumW(p.ads_count) + '</div>';
    }
    html += '<div style="margin-top:4px;color:var(--c-muted);"><b>ليه بنرشحه؟</b> ' + escapeHtml(why) + '</div>';
    html += '<div style="color:var(--c-muted);"><b>استخدمه إزاي؟</b> ' + escapeHtml(how) + '</div>';
    html += '</div>';
    return html;
  }

  function ciCardsHtml(title, items, objKey, poolConfidence, kind, emptyMsg, mode) {
    var html = '<h4 style="font-size:12px;margin:10px 0 6px;">' + title + '</h4>';
    if (!items.length) {
      html += '<div class="empty-state" style="font-size:11px;">' + (emptyMsg || "لا يوجد") + '</div>';
      return html;
    }
    items.forEach(function (x) { html += ciCardHtml(x, objKey, poolConfidence, kind, mode); });
    return html;
  }

  function ciTechnicalHtml(tech) {
    if (!tech) return "";
    return '<h4 style="font-size:12px;margin:10px 0 6px;">📌 إشارة أداء للـCTA (إعلانات تقنية/رابط بس — مش مصدر إلهام إبداعي)</h4>' +
      '<div class="empty-state" style="font-size:11px;">' + tech.count + ' إعلان تقني، CTA: ' + escapeHtml(tech.ctas.join("، ") || "—") +
      (tech.avgMetric != null ? " — متوسط الأداء: " + fmtMoneyW(tech.avgMetric) : "") + '</div>';
  }

  function contentIntelligencePanelHtml() {
    return '<div class="section ci-panel" style="margin-top:14px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" id="ci-toggle-head">' +
      '<h3 style="margin:0;font-size:14px;">✨ ذكاء المحتوى</h3><span id="ci-toggle-arrow">▾</span></div>' +
      '<div id="ci-body" style="margin-top:10px;">' +
      '<div class="field"><label>الهدف الإعلاني</label>' + ciObjectiveSelectHtml("ci-objective") + '</div>' +
      '<div class="field"><label>شكل المحتوى (اختياري)</label>' + ciFormatSelectHtml("ci-format") + '</div>' +
      '<div class="field"><label>الموضوع / الخدمة (اختياري)</label><input id="ci-topic" placeholder="مثال: الصداع النصفي، رسم المخ، تنميل الأطراف..."></div>' +
      '<div id="ci-output"><div class="empty-state" style="font-size:12px;">اختر التخصص فوق ثم الهدف الإعلاني لعرض التوصيات</div></div>' +
      '</div></div>';
  }

  function ciCurrentState(container) {
    var objSel = container.querySelector("#ci-objective");
    var fmtSel = container.querySelector("#ci-format");
    var topicSel = container.querySelector("#ci-topic");
    return { objKey: objSel ? objSel.value : "", fmtKey: fmtSel ? fmtSel.value : "", topicText: topicSel ? topicSel.value.trim() : "" };
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
      renderCiResults(out, data, specialtyKey, st.objKey, st.fmtKey, st.topicText);
    }).catch(function (e) {
      out.innerHTML = '<div class="err-msg">تعذّر تحميل بيانات ذكاء المحتوى: ' + escapeHtml(e.message || e) + '</div>';
    });
  }

  function ciGeneralFallbackHtml(patterns, objKey) {
    if (!patterns.length) return "";
    var metricKey = ciMetricFor(objKey);
    var info = ciBuildPatternPool(patterns, metricKey);
    var html = '<h4 style="font-size:12px;margin:10px 0 6px;color:var(--c-muted);">أفضل الأنماط العامة عبر الحساب (GENERAL ACCOUNT INSIGHTS — مش خاصة بالتخصص ده)</h4>';
    info.pool.slice(0, 3).forEach(function (x) { html += ciCardHtml(x, objKey, info.confidence, "pattern"); });
    return html;
  }

  function renderCiResults(out, data, specialtyKey, objKey, fmtKey, topicText) {
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
    var metricKey = ciMetricFor(objKey);
    var patternInfo = ciBuildPatternPool(matched, metricKey);
    var examplesInfo = ciBuildExamplePool(data.ads, metaLabel, objMeta, objKey);

    if (!matched.length && !examplesInfo.pool.length) {
      var general = data.patterns.filter(function (p) { return p.objective === objMeta && p.confidence !== "low"; });
      out.innerHTML = '<div class="empty-state" style="font-size:12px;">لا توجد بيانات تاريخية كافية لهذا التخصص مع الهدف ده.</div>' + ciGeneralFallbackHtml(general, objKey);
      out.dataset.ciBrief = "";
      return;
    }

    var pPool = patternInfo.pool, pConf = patternInfo.confidence;
    var pActionable = patternInfo.actionablePool, pActConf = patternInfo.actionableConfidence;
    var avoidPatterns = pPool.filter(function (x) { return x.status.key === "weak"; });

    var exPool = examplesInfo.pool, exConf = examplesInfo.confidence;
    var exActionable = examplesInfo.actionablePool, exActConf = examplesInfo.actionableConfidence;
    var exWeak = exPool.filter(function (x) { return x.status.key === "weak"; });

    // V3 — فصل "أفضل أداء رقمي" عن "أفضل Pattern محتوى قابل للاستخدام":
    // أداء البسط (worked/exStrong) دلوقتي بيتحسب بس من العناصر المؤهلة
    // إبداعيًا (actionable) — أداء رقمي بحت بمتاداتا ناقصة (Hook=UNKNOWN...)
    // يفضل يظهر كـ"أفضل أداء تاريخي" بس، مش كـPattern موصى بيه (بند ١/٢/٣)
    var workedPatterns = pActionable.filter(function (x) { return x.status.key !== "weak"; }).slice(0, 3);
    var workedExamples = exActionable.filter(function (x) { return x.status.key !== "weak"; });
    var exSectionTitle = (exActConf === "high" || exActConf === "medium") ? "🏆 أمثلة ناجحة" : "📚 أمثلة تاريخية للمقارنة";

    var overallConfidence = ciBetterConf(pActionable.length ? pActConf : null, exActionable.length ? exActConf : null);

    // أ) أفضل أداء تاريخي (رقم بحت، بغض النظر عن اكتمال البيانات الإبداعية)
    var perfCandidates = [];
    if (pPool.length) perfCandidates.push({ x: pPool[0], kind: "pattern", kindLabel: "نمط", conf: pConf });
    if (exPool.length) perfCandidates.push({ x: exPool[0], kind: "ad", kindLabel: "إعلان تاريخي", conf: exConf });
    perfCandidates.sort(function (a, b) { return a.x.metric - b.x.metric; });
    var bestPerf = perfCandidates[0] || null;

    // ب) أفضل Pattern محتوى قابل فعلاً للاستخدام (قد لا يكون أرخص إعلان)
    var actionableCombined = workedPatterns.map(function (x) { return { x: x, kind: "pattern", kindLabel: "نمط", conf: pActConf }; })
      .concat(workedExamples.map(function (x) { return { x: x, kind: "ad", kindLabel: "إعلان تاريخي", conf: exActConf }; }));
    actionableCombined.sort(function (a, b) { return a.x.metric - b.x.metric; });
    var bestActionable = actionableCombined[0] || null;
    var secondActionable = actionableCombined[1] || null;

    var weakPick = exWeak[0] ? { x: exWeak[0], kind: "ad", kindLabel: "إعلان تاريخي", conf: exConf } :
      (avoidPatterns[0] ? { x: avoidPatterns[0], kind: "pattern", kindLabel: "نمط", conf: pConf } : null);

    var html = "";
    // ملخصين أعلى البانل — أداء رقمي منفصل عن اتجاه محتوى قابل للاستخدام (بند ٥)
    if (bestPerf) {
      var perfIncomplete = !bestPerf.x.actionable;
      html += '<div style="background:var(--c-bg-alt,#f6f6f6);border-radius:6px;padding:8px 10px;margin-bottom:6px;font-size:12px;">' +
        '<div><b>📊 أفضل أداء تاريخي:</b> ' + fmtMoneyW(bestPerf.x.metric) + ' (' + ciMetricLabel(objKey) + ')</div>' +
        (perfIncomplete
          ? '<div style="color:var(--c-negative);">⚠️ بيانات التنفيذ الإبداعي غير مكتملة لهذا الإعلان — Performance benchmark only.</div>'
          : '<div>' + escapeHtml((bestPerf.x.raw.hook_type || "—") + " + " + (bestPerf.x.raw.content_angle || "—") + " + " + (bestPerf.x.raw.cta_type || "—")) + '</div>') +
        '</div>';
    }
    if (bestActionable) {
      html += '<div style="background:var(--c-bg-alt,#f6f6f6);border-radius:6px;padding:8px 10px;margin-bottom:8px;font-size:12px;">' +
        '<div><b>✨ أفضل اتجاه قابل للاستخدام في المحتوى حاليًا:</b> ' + escapeHtml((bestActionable.x.raw.hook_type || "—") + " + " + (bestActionable.x.raw.content_angle || "—") + " + " + (bestActionable.x.raw.cta_type || "—")) + '</div>' +
        '<div>' + ciMetricLabel(objKey) + ': ' + fmtMoneyW(bestActionable.x.metric) + '</div>' +
        '<div>Confidence: ' + ciItemConfidenceLabel(bestActionable.x, bestActionable.conf).label + '</div>' +
        '<div>Reason: ' + escapeHtml(ciWhyText(bestActionable.x.aStatus, bestActionable.x.aRatio, bestActionable.x.runs, ciMetricLabel(objKey))) + '</div>' +
        (overallConfidence === "low" ? '<div style="color:var(--c-negative);">أفضل اتجاه متاح حاليًا، لكن الأدلة محدودة ويحتاج اختبار.</div>' : "") +
        '</div>';
    } else {
      html += '<div style="background:var(--c-bg-alt,#f6f6f6);border-radius:6px;padding:8px 10px;margin-bottom:8px;font-size:12px;">لا توجد بيانات Creative كافية حاليًا لاستخراج اتجاه محتوى موثوق.</div>';
    }

    html += ciSignalHtml(overallConfidence);
    var workedHeading = overallConfidence === "low" ? "🧪 فرضيات تستحق الاختبار — أدلة محدودة" : "✅ ما نجح والأنماط القوية";
    html += ciCardsHtml(workedHeading, workedPatterns, objKey, pActConf, "pattern", "لسه معندناش أنماط بثقة كافية لهذا التخصص/الهدف.", "actionable");
    if (avoidPatterns.length) html += ciCardsHtml("🔴 أنماط أداء ضعيف تاريخيًا", avoidPatterns, objKey, pConf, "pattern", "", "perf");

    html += ciCardsHtml(exSectionTitle, workedExamples, objKey, exActConf, "ad", "لا توجد أمثلة تاريخية مطابقة كافية.", "actionable");
    if (exWeak.length) html += ciCardsHtml("🔴 أمثلة أداء ضعيف تاريخيًا", exWeak, objKey, exConf, "ad", "", "perf");
    html += ciTechnicalHtml(examplesInfo.technical);

    html += '<div style="text-align:left;margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;">' +
      '<button class="btn ghost sm" id="ci-copy-brief">نسخ Brief للوكيل</button>' +
      '<button class="btn ghost sm" id="ci-open-agent">وكيل إنشاء المحتوى ↗</button></div>';

    out.innerHTML = html;

    var briefCopyBtn = out.querySelector("#ci-copy-brief");
    if (briefCopyBtn) {
      briefCopyBtn.onclick = function () {
        ciCopyBrief(out, {
          specialtyKey: specialtyKey, metaLabel: metaLabel, objKey: objKey, fmtKey: fmtKey, topicText: topicText,
          overallConfidence: overallConfidence, bestPerf: bestPerf, bestActionable: bestActionable, secondActionable: secondActionable, weak: weakPick
        });
      };
    }
    var agentBtn = out.querySelector("#ci-open-agent");
    if (agentBtn) { agentBtn.onclick = function () { ciOpenAgent(); }; }
  }

  // mode: "perf" (رانك أداء رقمي، الافتراضي) أو "actionable"
  function ciBriefCardLines(x, objKey, poolConfidence, kind, mode) {
    mode = mode || "perf";
    var p = x.raw, metricLabel = ciMetricLabel(objKey), lines = [];
    var rank = mode === "actionable" ? x.aRank : x.rank;
    var status = mode === "actionable" ? x.aStatus : x.status;
    var ratio = mode === "actionable" ? x.aRatio : x.ratio;
    lines.push("RANK: #" + rank);
    lines.push("STATUS: " + status.label);
    lines.push("CONFIDENCE: " + ciItemConfidenceLabel(x, poolConfidence).label);
    if (!x.actionable) lines.push("NOTE: Creative metadata incomplete for this ad.");
    if (kind === "ad") {
      if (ciIsMeaningful(p.creative_title)) lines.push("Creative Title: " + p.creative_title);
      if (p.creative_body && String(p.creative_body).trim().length > 15) lines.push("Body excerpt: " + String(p.creative_body).slice(0, 140));
    }
    if (ciIsMeaningful(p.hook_type)) lines.push("Hook: " + p.hook_type);
    if (ciIsMeaningful(p.content_angle)) lines.push("Angle: " + p.content_angle);
    if (ciIsMeaningful(p.creative_type)) lines.push("Format: " + p.creative_type);
    if (ciIsMeaningful(p.cta_type)) lines.push("CTA: " + p.cta_type);
    if (kind === "ad") {
      lines.push("Spend: " + fmtMoneyW(p.spend));
      lines.push("Messages: " + fmtNumW(p.msg_conv));
      lines.push("Cost/Message: " + fmtMoneyW(p.cost_per_msg_conv));
      lines.push("Leads: " + fmtNumW(p.leads));
      lines.push("CPL: " + fmtMoneyW(p.cost_per_lead));
      lines.push("CTR: " + (p.ctr != null ? Number(p.ctr).toFixed(2) + "%" : "—"));
      lines.push("CPC: " + fmtMoneyW(p.cpc));
      lines.push("Creative Group: " + (p.creative_group_id || "—"));
      lines.push("Runs: " + x.runs);
    } else {
      lines.push(metricLabel + ": " + fmtMoneyW(x.metric));
      lines.push("Ads count: " + fmtNumW(p.ads_count));
    }
    if (x.actionable) {
      lines.push("WHY: " + ciWhyText(status, ratio, x.runs, metricLabel));
      lines.push("HOW TO USE: " + ciHowToUseText(p, status, false));
    } else {
      lines.push("USE: Performance benchmark only. Do NOT derive Hook/Angle from this ad.");
    }
    return lines;
  }

  function ciCopyBrief(out, ctx) {
    var brand = document.getElementById("cf-brand");
    var lines = [];
    lines.push("=== Brief للوكيل — إنشاء محتوى جديد ===");
    lines.push("Brand: " + (brand && brand.value ? brand.value : "—"));
    lines.push("Specialty: " + (SPECIALTIES[ctx.specialtyKey] ? SPECIALTIES[ctx.specialtyKey].label : ctx.specialtyKey));
    lines.push("Topic/Service: " + (ctx.topicText || "—"));
    lines.push("Advertising Objective: " + (CONTENT_OBJECTIVES[ctx.objKey] ? CONTENT_OBJECTIVES[ctx.objKey].label : ctx.objKey));
    lines.push("Preferred Format: " + (CONTENT_FORMATS[ctx.fmtKey] ? CONTENT_FORMATS[ctx.fmtKey].label : "أي شكل"));
    lines.push("Evidence level: " + (CONFIDENCE_LABELS[ctx.overallConfidence] || CONFIDENCE_LABELS.low).label);
    lines.push("");
    if (ctx.bestPerf) {
      lines.push("BEST HISTORICAL PERFORMANCE:");
      ciBriefCardLines(ctx.bestPerf.x, ctx.objKey, ctx.bestPerf.conf, ctx.bestPerf.kind, "perf").forEach(function (l) { lines.push(l); });
      lines.push("");
    }
    if (!ctx.bestActionable) {
      lines.push("لا توجد Winning Patterns مؤكدة لهذا التخصص/الهدف. لا توجد بيانات Creative كافية حاليًا لاستخراج اتجاه محتوى موثوق.");
      lines.push("استخدم الأمثلة التالية للمقارنة وصياغة فرضيات اختبار، وليس كدليل نهائي.");
      lines.push("");
    } else {
      lines.push("BEST ACTIONABLE CONTENT PATTERN (RECOMMENDED OPTION #1 — " + ctx.bestActionable.kindLabel + "):");
      ciBriefCardLines(ctx.bestActionable.x, ctx.objKey, ctx.bestActionable.conf, ctx.bestActionable.kind, "actionable").forEach(function (l) { lines.push(l); });
      lines.push("");
    }
    if (ctx.secondActionable) {
      lines.push("OPTION #2:");
      ciBriefCardLines(ctx.secondActionable.x, ctx.objKey, ctx.secondActionable.conf, ctx.secondActionable.kind, "actionable").forEach(function (l) { lines.push(l); });
      lines.push("");
    }
    if (ctx.weak) {
      lines.push("WEAK EXAMPLE (لا تكرره — للمقارنة بس):");
      ciBriefCardLines(ctx.weak.x, ctx.objKey, ctx.weak.conf, ctx.weak.kind, "perf").forEach(function (l) { lines.push(l); });
      lines.push("");
    }
    lines.push("استخدم النتائج كمرجع استراتيجي وليس كنص للنسخ. هذا نمط استراتيجي وليس نص للنسخ الحرفي.");
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
