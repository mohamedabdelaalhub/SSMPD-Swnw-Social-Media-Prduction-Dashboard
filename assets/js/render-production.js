/* SSMPD — شاشة إنتاج المحتوى (موظف الصفحات) */
(function () {
  "use strict";
  var W = window.SSMPDWorkflow;
  var C = window.SSMPDComments;

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function stagePillClass(stage) {
    if (stage === "published") return "published";
    if (stage === "needs_revision") return "revision";
    if (stage === "scheduled") return "received";
    if (stage === "ready_to_publish") return "approved";
    if (stage === "idea_selection") return "draft";
    return "approval";
  }

  function structuredFieldsHtml() {
    return '<details style="margin-top:12px;"><summary style="cursor:pointer;font-weight:700;">بيانات التنفيذ / الفيديو (اختياري)</summary>' +
      '<div style="margin-top:10px;">' +
      '<div style="margin-bottom:12px;"><button class="btn ghost" id="cf-import-agent" type="button">✨ استيراد نتيجة الوكيل</button></div>' +
      '<div class="field"><label>Hook</label><textarea id="cf-hook" placeholder="الجملة الافتتاحية"></textarea></div>' +
      '<div class="field"><label>Angle</label><input id="cf-angle" placeholder="مثال: Medical authority + patient safety"></div>' +
      '<div class="field"><label>سكريبت / Voice-over</label><textarea id="cf-script" placeholder="النص اللي هيتقال في الفيديو"></textarea></div>' +
      '<div class="field"><label>كابشن النشر</label><textarea id="cf-caption" placeholder="Caption"></textarea></div>' +
      '<div class="field"><label>نوع CTA</label><input id="cf-cta-type" placeholder="مثال: save_share / whatsapp / book"></div>' +
      '<div class="field"><label>نص CTA</label><input id="cf-cta-text" placeholder="الجملة النهائية"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
        '<div class="field"><label>أقل مدة (ث)</label><input id="cf-duration-min" type="number" min="0" step="1"></div>' +
        '<div class="field"><label>أقصى مدة (ث)</label><input id="cf-duration-max" type="number" min="0" step="1"></div>' +
      '</div>' +
      '<div class="field"><label>Video Template</label><input id="cf-video-template" placeholder="مثال: medical_educational"></div>' +
      '<div class="field"><label>سبب الفرضية / Evidence note</label><textarea id="cf-hypothesis" placeholder="ليه الفكرة تستحق الاختبار"></textarea></div>' +
      '<div class="field"><label>الناتج الخام من الوكيل (اختياري)</label><textarea id="cf-agent-raw" placeholder="احتفظ بالرد الكامل للرجوع إليه لاحقًا"></textarea></div>' +
      '</div></details>';
  }

  function intOrNull(id) {
    var el = document.getElementById(id);
    if (!el || el.value === "") return null;
    var n = parseInt(el.value, 10);
    return isNaN(n) ? null : n;
  }

  function valueOrNull(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    var v = String(el.value || "").trim();
    return v || null;
  }


  function cleanAgentBlock(s) {
    return String(s || "")
      .replace(/\r/g, "")
      .replace(/^\`\`\`[^\n]*$/gim, "")
      .replace(/^\`\`\`$/gim, "")
      .replace(/^\s*svg\s*$/gim, "")
      .replace(/^[\s\n]+|[\s\n]+$/g, "");
  }

  function stripMd(s) {
    return cleanAgentBlock(s)
      .replace(/^\s*[-*]\s+/gm, "")
      .replace(/\*\*/g, "")
      .trim();
  }

  function normalizeImportedIdea(x, idx) {
    x = x || {};
    var fmtRaw = String(x.format || x.content_format || "");
    var fmtKey = x.formatKey || x.content_format || "";
    if (!fmtKey) {
      if (/reel|فيديو|video/i.test(fmtRaw)) fmtKey = "video";
      else if (/صورة|بوست|image/i.test(fmtRaw)) fmtKey = "image_post";
      else if (/رابط|link/i.test(fmtRaw)) fmtKey = "link_post";
    }
    var dMin = x.durationMin != null ? x.durationMin : x.duration_min_seconds;
    var dMax = x.durationMax != null ? x.durationMax : x.duration_max_seconds;
    dMin = dMin == null || dMin === "" ? null : parseInt(dMin, 10);
    dMax = dMax == null || dMax === "" ? null : parseInt(dMax, 10);
    if (isNaN(dMin)) dMin = null;
    if (isNaN(dMax)) dMax = null;

    var cta = stripMd(x.cta || x.cta_text || "");
    var template = stripMd(x.videoTemplate || x.video_template || "");
    if (!template && fmtKey === "video") template = "medical_educational";

    return {
      number: String(x.number || x.idea_number || idx + 1),
      title: stripMd(x.title || ""),
      idea: stripMd(x.idea || x.description || ""),
      hook: stripMd(x.hook || x.hook_text || ""),
      angle: stripMd(x.angle || x.content_angle || ""),
      format: stripMd(fmtRaw),
      formatKey: fmtKey,
      script: stripMd(x.script || x.script_text || x.voice_over || ""),
      caption: stripMd(x.caption || x.caption_text || ""),
      cta: cta,
      ctaType: stripMd(x.ctaType || x.cta_type || "") || inferCtaType(cta),
      why: stripMd(x.why || x.hypothesis_reason || x.evidence_note || ""),
      durationMin: dMin,
      durationMax: dMax,
      videoTemplate: template
    };
  }

  function parseStructuredAgentJson(raw) {
    var source = String(raw || "");
    var marker = source.match(/SSMPD_STRUCTURED_JSON\s*([\s\S]*?)(?:SSMPD_STRUCTURED_JSON_END|$)/i);
    if (!marker) return [];
    var chunk = marker[1]
      .replace(/^\s*\`\`\`(?:json)?\s*/i, "")
      .replace(/\s*\`\`\`\s*$/i, "")
      .trim();
    var firstObj = chunk.indexOf("{");
    var firstArr = chunk.indexOf("[");
    var first = firstObj < 0 ? firstArr : (firstArr < 0 ? firstObj : Math.min(firstObj, firstArr));
    var lastObj = chunk.lastIndexOf("}");
    var lastArr = chunk.lastIndexOf("]");
    var last = Math.max(lastObj, lastArr);
    if (first < 0 || last < first) return [];
    try {
      var parsed = JSON.parse(chunk.slice(first, last + 1));
      var ideas = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.ideas) ? parsed.ideas : []);
      return ideas.map(normalizeImportedIdea).filter(function (x) {
        return x.title || x.idea || x.hook || x.script;
      });
    } catch (e) {
      return [];
    }
  }

  var AGENT_LABELS = [
    { key: "idea", re: /^(?:الفكرة|وصف\s*الفكرة)\s*:?\s*(.*)$/i },
    { key: "hook", re: /^(?:الـ\s*)?Hook(?:\s+المقترح)?\s*:?\s*(.*)$/i },
    { key: "angle", re: /^(?:(?:الـ\s*)?Angle(?:\s+المقترح)?|الزاوية(?:\s+المقترحة)?)\s*:?\s*(.*)$/i },
    { key: "format", re: /^(?:الشكل(?:\s+المقترح)?|Format|الشكل\s+الموصى\s+به)\s*:?\s*(.*)$/i },
    { key: "script", re: /^(?:سكريبت(?:\s*\/\s*(?:نص\s*كامل|Voice-?over))?|السكريبت(?:\s*\/\s*(?:النص\s*الكامل|Voice-?over))?|النص\s*الكامل|Script(?:\s*\/\s*Voice-?over)?|Voice-?over)\s*:?\s*(.*)$/i },
    { key: "caption", re: /^(?:كابشن(?:\s+النشر)?|الكابشن(?:\s+للنشر)?|Caption)\s*:?\s*(.*)$/i },
    { key: "cta", re: /^(?:(?:الـ\s*)?CTA(?:\s+المقترح)?|دعوة\s+الإجراء)\s*:?\s*(.*)$/i },
    { key: "why", re: /^(?:لماذا\s+تصلح\s+للاختبار|لماذا\s+هذه\s+(?:الفكرة|الفرضية)(?:\s+مناسبة\s+للاختبار)?|ليه\s+(?:الفكرة|الفرضية|كل\s+فكرة)(?:\s+مناسبة\s+للاختبار)?|سبب\s+الفرضية|Evidence\s*note)(?:\?|؟)?\s*:?\s*(.*)$/i }
  ];

  function identifyAgentLabel(line) {
    var clean = String(line || "")
      .replace(/^\s*#{1,6}\s*/, "")
      .replace(/\*\*/g, "")
      .replace(/^\s*[-*]\s*/, "")
      .trim();
    for (var i = 0; i < AGENT_LABELS.length; i++) {
      var m = clean.match(AGENT_LABELS[i].re);
      if (m) return { key: AGENT_LABELS[i].key, value: stripMd(m[1] || "") };
    }
    return null;
  }

  function parseAgentSections(block) {
    var values = { idea: "", hook: "", angle: "", format: "", script: "", caption: "", cta: "", why: "" };
    var current = "";
    var buf = [];

    function flush() {
      if (!current) { buf = []; return; }
      var v = stripMd(buf.join("\n"));
      if (v) values[current] = values[current] ? (values[current] + "\n" + v).trim() : v;
      buf = [];
    }

    String(block || "").split("\n").forEach(function (line) {
      var found = identifyAgentLabel(line);
      if (found) {
        flush();
        current = found.key;
        if (found.value) buf.push(found.value);
      } else if (current) {
        buf.push(line);
      }
    });
    flush();
    return values;
  }

  function inferCtaType(cta) {
    var s = String(cta || "").toLowerCase();
    if (!s) return "";
    if (/طوارئ|الطوارئ|توج.?ه.*طوارئ|اذهب.*طوارئ|emergency|urgent/.test(s)) return "emergency_action";
    if (/احفظ|احتفظ|شارك|share|save/.test(s)) return "save_share";
    if (/واتساب|whatsapp/.test(s)) return "whatsapp";
    if (/احجز|حجز|book/.test(s)) return "book";
    if (/رسالة|message/.test(s)) return "message";
    if (/اتصل|call/.test(s)) return "call";
    return "custom";
  }

  function parseDuration(text) {
    var s = String(text || "");
    var range = s.match(/(\d{1,3})\s*(?:-|–|—|إلى|الى)\s*(\d{1,3})\s*(?:ث|ثانية|ثواني)/);
    if (range) return { min: parseInt(range[1], 10), max: parseInt(range[2], 10) };
    var one = s.match(/(\d{1,3})\s*(?:ث|ثانية|ثواني)/);
    if (one) {
      var n = parseInt(one[1], 10);
      return { min: n, max: n };
    }
    return { min: null, max: null };
  }

  function parseAgentHypotheses(raw) {
    var structured = parseStructuredAgentJson(raw);
    if (structured.length) return structured;

    var text = cleanAgentBlock(raw);
    if (!text) return [];

    var headingRe = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?(?:الفرضية|الفكرة)\s*(\d+)\s*(?:[:：]|—|–|-)\s*(?:\*\*)?([^\n]+)/gim;
    var matches = [], m;
    while ((m = headingRe.exec(text))) {
      matches.push({
        index: m.index,
        end: headingRe.lastIndex,
        number: m[1],
        title: stripMd(m[2]).replace(/^[«"']|[»"']$/g, "")
      });
    }

    if (!matches.length) matches.push({ index: 0, end: 0, number: "1", title: "" });

    var out = [];
    matches.forEach(function (h, idx) {
      var start = h.end;
      var end = idx + 1 < matches.length ? matches[idx + 1].index : text.length;
      var block = text.slice(start, end);
      var values = parseAgentSections(block);

      // Legacy fallback: بعض الردود تحط السكريبت بعد "الشكل المقترح" مباشرة
      // من غير عنوان "سكريبت". ناخد الجزء بين الشكل والكابشن فقط.
      if (!values.script) {
        var lines = block.split("\n");
        var collecting = false, scriptLines = [];
        for (var i = 0; i < lines.length; i++) {
          var lab = identifyAgentLabel(lines[i]);
          if (lab && lab.key === "format") { collecting = true; continue; }
          if (collecting && lab && (lab.key === "caption" || lab.key === "cta" || lab.key === "why")) break;
          if (collecting && !lab) scriptLines.push(lines[i]);
        }
        values.script = stripMd(scriptLines.join("\n")
          .replace(/^\s*Reel[^\n]*$/gim, "")
          .replace(/^\s*فيديو[^\n]*$/gim, ""));
      }

      var duration = parseDuration(values.format + "\n" + block);
      var fmtKey = /reel|فيديو|video/i.test(values.format) ? "video" :
        (/صورة|بوست|image/i.test(values.format) ? "image_post" :
        (/رابط|link/i.test(values.format) ? "link_post" : ""));
      var title = h.title || values.hook || values.idea.split("\n")[0] || ("فكرة " + h.number);

      out.push(normalizeImportedIdea({
        number: h.number,
        title: title,
        idea: values.idea,
        hook: values.hook,
        angle: values.angle,
        format: values.format,
        content_format: fmtKey,
        script: values.script,
        caption: values.caption,
        cta: values.cta,
        cta_type: inferCtaType(values.cta),
        hypothesis_reason: values.why,
        duration_min_seconds: duration.min,
        duration_max_seconds: duration.max,
        video_template: fmtKey === "video" ? "medical_educational" : ""
      }, idx));
    });

    return out.filter(function (x) { return x.title || x.idea || x.hook || x.script; });
  }

  function importMissingFields(h) {
    var missing = [];
    var selectedFmtEl = document.getElementById("ci-format");
    var effectiveFormat = h.formatKey || (selectedFmtEl ? selectedFmtEl.value : "");
    if (!h.title) missing.push("Title");
    if (!h.idea) missing.push("Idea");
    if (!h.hook) missing.push("Hook");
    if (!h.angle) missing.push("Angle");
    if (!effectiveFormat) missing.push("Format");
    if (!h.caption) missing.push("Caption");
    if (!h.cta) missing.push("CTA");
    if (!h.why) missing.push("Hypothesis Reason");
    if (effectiveFormat === "video") {
      if (!h.script) missing.push("Script");
      if (h.durationMin == null || h.durationMax == null) missing.push("Duration");
      if (!h.videoTemplate) missing.push("Video Template");
    }
    return { missing: missing, effectiveFormat: effectiveFormat };
  }

function openAgentImportModal(parentBackdrop) {
    var importBackdrop = document.createElement("div");
    importBackdrop.className = "modal-backdrop";
    importBackdrop.style.zIndex = "9999";
    importBackdrop.innerHTML = '<div class="modal"><div class="modal-head"><h3>✨ استيراد نتيجة الوكيل</h3>' +
      '<button class="modal-close">×</button></div>' +
      '<p style="font-size:12px;color:var(--c-muted);">الصق رد الوكيل كاملًا كما هو. هنقسّمه لفرضيات وتختار واحدة لملء الحقول تلقائيًا.</p>' +
      '<div class="field"><textarea id="agent-import-text" style="min-height:260px;" placeholder="الصق هنا رد الوكيل الكامل..."></textarea></div>' +
      '<div style="text-align:left;margin-bottom:12px;"><button class="btn" id="agent-import-parse">تحليل الرد</button></div>' +
      '<div id="agent-import-results"></div></div>';
    document.body.appendChild(importBackdrop);

    function close() { importBackdrop.remove(); }
    importBackdrop.querySelector(".modal-close").onclick = close;
    importBackdrop.onclick = function (e) { if (e.target === importBackdrop) close(); };

    document.getElementById("agent-import-parse").onclick = function () {
      var raw = document.getElementById("agent-import-text").value;
      var hypotheses = parseAgentHypotheses(raw);
      var slot = document.getElementById("agent-import-results");
      if (!hypotheses.length) {
        slot.innerHTML = '<div class="err-msg">مقدرتش أتعرف على أفكار واضحة. جرّب لصق الرد كاملًا من أول "الفكرة 1" أو "الفرضية 1".</div>';
        return;
      }

      slot.innerHTML = hypotheses.map(function (h, i) {
        var validation = importMissingFields(h);
        var missing = validation.missing;
        var status = missing.length
          ? '<div style="font-size:11px;color:var(--c-negative);margin:6px 0;">⚠️ ناقص: ' + escapeHtml(missing.join("، ")) + ' — لا يمكن اعتماد الفكرة قبل اكتمالها.</div>'
          : '<div style="font-size:11px;color:var(--c-positive,#2f7d5c);margin:6px 0;">✅ كل الحقول المطلوبة مكتملة</div>';
        return '<div class="section" style="margin-bottom:10px;">' +
          '<h4 style="margin:0 0 6px;">فكرة ' + escapeHtml(h.number) + ': ' + escapeHtml(h.title) + '</h4>' +
          (h.hook ? '<div style="font-size:12px;margin-bottom:4px;"><b>Hook:</b> ' + escapeHtml(h.hook) + '</div>' : '') +
          (h.angle ? '<div style="font-size:12px;margin-bottom:4px;"><b>Angle:</b> ' + escapeHtml(h.angle) + '</div>' : '') +
          (h.script ? '<div style="font-size:12px;margin-bottom:4px;"><b>Script:</b> ' + escapeHtml(h.script.slice(0, 180)) + (h.script.length > 180 ? "…" : "") + '</div>' : '') +
          (h.caption ? '<div style="font-size:12px;margin-bottom:4px;"><b>Caption:</b> ' + escapeHtml(h.caption.slice(0, 120)) + (h.caption.length > 120 ? "…" : "") + '</div>' : '') +
          (h.cta ? '<div style="font-size:12px;margin-bottom:4px;"><b>CTA:</b> ' + escapeHtml(h.cta) + '</div>' : '') +
          (h.format ? '<div style="font-size:12px;margin-bottom:4px;"><b>الشكل:</b> ' + escapeHtml(h.format) + '</div>' : '') +
          ((h.durationMin != null || h.durationMax != null) ? '<div style="font-size:12px;margin-bottom:4px;"><b>المدة:</b> ' + escapeHtml((h.durationMin == null ? "—" : h.durationMin) + "–" + (h.durationMax == null ? "—" : h.durationMax) + " ث") + '</div>' : '') +
          status +
          (missing.length
            ? '<button class="btn ghost sm" type="button" disabled style="opacity:.55;cursor:not-allowed;">⚠️ الفكرة غير مكتملة</button>'
            : '<button class="btn sm" data-agent-pick="' + i + '">✅ اعتماد هذه الفكرة</button>') +
          '</div>';
      }).join("");

      slot.querySelectorAll("[data-agent-pick]").forEach(function (btn) {
        btn.onclick = function () {
          var h = hypotheses[parseInt(btn.getAttribute("data-agent-pick"), 10)];
          document.getElementById("cf-title").value = h.title || "";
          document.getElementById("cf-body").value = h.idea || h.hook || "";
          document.getElementById("cf-hook").value = h.hook || "";
          document.getElementById("cf-angle").value = h.angle || "";
          document.getElementById("cf-script").value = h.script || "";
          document.getElementById("cf-caption").value = h.caption || "";
          document.getElementById("cf-cta-type").value = h.ctaType || "";
          document.getElementById("cf-cta-text").value = h.cta || "";
          document.getElementById("cf-duration-min").value = h.durationMin == null ? "" : h.durationMin;
          document.getElementById("cf-duration-max").value = h.durationMax == null ? "" : h.durationMax;
          document.getElementById("cf-video-template").value = h.videoTemplate || "";
          document.getElementById("cf-hypothesis").value = h.why || "";
          document.getElementById("cf-agent-raw").value = raw;

          var fmt = document.getElementById("ci-format");
          if (fmt && h.formatKey) fmt.value = h.formatKey;

          if (window.SSMPDToast) window.SSMPDToast.show("تم ملء بيانات الفكرة من رد الوكيل", "success");
          close();
        };
      });
    };
  }

  function structuredDetailsHtml(item) {
    var rows = [];
    function add(label, value) {
      if (value == null || value === "") return;
      rows.push('<div style="margin-bottom:8px;"><b>' + escapeHtml(label) + ':</b><div style="white-space:pre-wrap;">' + escapeHtml(value) + '</div></div>');
    }
    add("Hook", item.hook_text);
    add("Angle", item.content_angle);
    add("Script / Voice-over", item.script_text);
    add("Caption", item.caption_text);
    add("CTA Type", item.cta_type);
    add("CTA", item.cta_text);
    if (item.target_duration_min_seconds != null || item.target_duration_max_seconds != null) {
      var d = (item.target_duration_min_seconds != null ? item.target_duration_min_seconds : "—") +
        "–" + (item.target_duration_max_seconds != null ? item.target_duration_max_seconds : "—") + " ثانية";
      add("المدة المستهدفة", d);
    }
    add("Video Template", item.video_template);
    add("سبب الفرضية", item.hypothesis_reason);
    if (!rows.length) return "";
    return '<details style="margin:12px 0;"><summary style="cursor:pointer;font-weight:700;">بيانات التنفيذ المنظمة</summary><div style="margin-top:10px;">' + rows.join("") + '</div></details>';
  }

  function videoAssetTypeLabel(type) {
    var labels = {
      image: "صورة",
      video: "فيديو",
      voiceover: "Voice-over",
      music: "موسيقى"
    };
    return labels[type] || type || "—";
  }

  function videoMediaModeLabel(mode) {
    var labels = {
      uploaded_only: "المواد المرفوعة فقط",
      uploaded_plus_auto: "استخدم المرفوع وكمل الناقص تلقائيًا",
      auto: "إنتاج تلقائي بالكامل"
    };
    return labels[mode] || labels.uploaded_plus_auto;
  }

  function formatBytes(bytes) {
    var n = Number(bytes || 0);
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }

  function videoJobStatusLabel(status) {
    var labels = {
      pending: "في انتظار عامل الفيديو",
      preparing: "تجهيز المواد",
      rendering: "جاري الرندر",
      uploading: "جاري رفع الفيديو",
      ready: "الفيديو جاهز",
      failed: "فشل الإنتاج",
      cancelled: "ملغي"
    };
    return labels[status] || status || "—";
  }

  function videoJobMissingFields(item) {
    var missing = [];
    if (item.content_format !== "video") missing.push("Format = video");
    if (!item.script_text) missing.push("Script");
    if (item.target_duration_min_seconds == null || item.target_duration_max_seconds == null) missing.push("Duration");
    if (!item.video_template) missing.push("Video Template");
    return missing;
  }

  function coverSettingsHtml(item, brandLogo) {
    var c = item.cover_settings || {};
    var brandName = item.brand === 'sono' ? 'سونو' : (item.brand === 'dr_dina' ? 'د. دينا' : 'غير محدد');
    return '<details style="margin:12px 0;"><summary>اقتراحات كفر الفيديو</summary>' +
      '<label style="display:block;margin:12px 0;"><input type="checkbox" id="cover-enabled"' + (c.enabled ? ' checked' : '') + '> جهّز 5 كفرات للاختيار منها</label>' +
      '<div class="field"><label for="cover-title">عنوان الكفر</label><input id="cover-title" maxlength="80" value="' + escapeHtml(c.title || item.title || '') + '"></div>' +
      '<div class="field"><label for="cover-position">مكان العنوان</label><select id="cover-position"><option value="bottom"' + (c.position !== 'top' ? ' selected' : '') + '>أسفل الصورة</option><option value="top"' + (c.position === 'top' ? ' selected' : '') + '>أعلى الصورة</option></select></div>' +
      '<div class="field"><label>لوجو البراند — ' + escapeHtml(brandName) + '</label>' +
      (brandLogo ? '<img id="content-brand-logo" alt="لوجو البراند" style="width:150px;height:100px;object-fit:contain;background:#fff;"><p>يُستخدم لوجو ' + escapeHtml(brandName) + ' المحفوظ في لوحة الإدارة.</p>' : '<p>احفظ لوجو ' + escapeHtml(brandName) + ' من قسم لوجوهات البراندات في لوحة الإدارة قبل الإنتاج.</p>') + '</div>' +
      '<p>العنوان ومكانه يُستخدمان مع الإنتاج القادم. اللوجو مرتبط بالبراند تلقائيًا.</p>' +
      '<button class="btn sm" id="save-cover-settings">حفظ إعدادات الكفر</button><span id="cover-settings-feedback" role="status"></span></details>';
  }

  function loadCoverChoices(host, job, refresh) {
    window.SSMPDDb.listVideoCoverCandidates(job.id).then(function (rows) {
      if (!host.isConnected || !rows.length) return;
      host.innerHTML = '<h4>اختار كفر الفيديو</h4><p>الكفر المختار محفوظ على Google Drive. تقدر تغيّره من هنا.</p>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:12px;">' + rows.map(function (c) {
          return '<div><img data-cover-preview="' + escapeHtml(c.id) + '" alt="اقتراح الكفر ' + c.candidate_index + '" style="width:100%;aspect-ratio:9/16;object-fit:contain;background:#132636;border-radius:8px;">' +
            '<button class="btn sm" style="width:100%;margin-top:6px;" data-select-cover="' + escapeHtml(c.id) + '"' + (job.selected_cover_id === c.id ? ' disabled' : '') + '>' +
            (job.selected_cover_id === c.id ? 'الكفر المختار' : 'اختيار الكفر ' + c.candidate_index) + '</button></div>';
        }).join('') + '</div><p data-cover-feedback role="status"></p>';
      rows.forEach(function (c) {
        window.SSMPDDb.getVideoAssetSignedUrl(c.storage_path).then(function (url) {
          var img = host.querySelector('[data-cover-preview="' + c.id + '"]');
          if (img && url) img.src = url;
        }).catch(function () { host.querySelector('[data-cover-feedback]').textContent = 'تعذر تحميل إحدى المعاينات. أعد فتح المادة.'; });
      });
      host.querySelectorAll('[data-select-cover]').forEach(function (btn) {
        btn.onclick = function () {
          host.querySelectorAll('[data-select-cover]').forEach(function (b) { b.disabled = true; });
          window.SSMPDDb.selectVideoCover(job.id, btn.getAttribute('data-select-cover')).then(refresh).catch(function (e) {
            host.querySelector('[data-cover-feedback]').textContent = e.message;
            host.querySelectorAll('[data-select-cover]').forEach(function (b) { b.disabled = b.getAttribute('data-select-cover') === job.selected_cover_id; });
          });
        };
      });
    }).catch(function (e) { if (host.isConnected) host.textContent = 'تعذر تحميل اقتراحات الكفر: ' + e.message; });
  }

  function renderVideoJobSection(slot, item) {
    if (!slot || item.content_format !== "video") return;

    slot.innerHTML = '<div class="section"><h4 style="margin:0;">🎬 إنتاج الفيديو</h4><div class="loading" style="margin-top:8px;">بيحمّل حالة الإنتاج…</div></div>';

    Promise.all([
      window.SSMPDDb.listVideoJobsForContent(item.id),
      window.SSMPDDb.listVideoAssetsForContent(item.id),
      window.SSMPDDb.listBrandLogos()
    ]).then(function (res) {
      var jobs = res[0] || [];
      var assets = res[1] || [];
      var brandLogo = (res[2] || []).filter(function (b) { return b.brand === item.brand; })[0];
      var latest = jobs.length ? jobs[0] : null;
      var missing = videoJobMissingFields(item);
      var mediaMode = item.video_media_mode || "uploaded_plus_auto";
      var html = '<div class="section"><h4 style="margin:0 0 8px;">🎬 إنتاج الفيديو</h4>';

      html += '<div style="border:1px solid var(--c-border);border-radius:10px;padding:10px;margin-bottom:12px;">' +
        '<div style="font-weight:700;margin-bottom:8px;">📦 مواد الإنتاج <span style="font-size:11px;color:var(--c-muted);font-weight:400;">(اختياري)</span></div>' +
        '<div style="font-size:11px;color:var(--c-muted);margin-bottom:8px;">ارفع صور/فيديو/Voice-over/موسيقى. النظام يعطيها الأولوية، ولو ناقص مواد يكمل تلقائيًا حسب الوضع المختار.</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-bottom:8px;">' +
          '<div class="field" style="margin:0;min-width:220px;"><label>Media Mode</label>' +
            '<select id="video-media-mode">' +
              '<option value="uploaded_plus_auto"' + (mediaMode === "uploaded_plus_auto" ? " selected" : "") + '>استخدم المرفوع وكمل الناقص تلقائيًا</option>' +
              '<option value="uploaded_only"' + (mediaMode === "uploaded_only" ? " selected" : "") + '>المواد المرفوعة فقط</option>' +
              '<option value="auto"' + (mediaMode === "auto" ? " selected" : "") + '>إنتاج تلقائي بالكامل</option>' +
            '</select>' +
          '</div>' +
          '<div class="field" style="margin:0;min-width:150px;"><label>نوع الملف</label>' +
            '<select id="video-asset-type">' +
              '<option value="image">صورة</option>' +
              '<option value="video">فيديو</option>' +
              '<option value="voiceover">Voice-over</option>' +
              '<option value="music">موسيقى</option>' +
            '</select>' +
          '</div>' +
          '<div class="field" style="margin:0;min-width:220px;flex:1;"><label>اختيار الملفات</label>' +
            '<input id="video-asset-files" type="file" multiple accept="image/*,video/*,audio/*">' +
          '</div>' +
          '<button class="btn sm" id="upload-video-assets-btn">⬆️ رفع</button>' +
        '</div>';

      if (!assets.length) {
        html += '<div style="font-size:11px;color:var(--c-muted);">لا توجد مواد مرفوعة لهذا الفيديو حتى الآن.</div>';
      } else {
        html += '<div style="display:flex;flex-direction:column;gap:6px;">';
        assets.forEach(function (a) {
          html += '<div style="display:flex;align-items:center;gap:8px;padding:7px 8px;border:1px solid var(--c-border);border-radius:8px;">' +
            '<span style="font-size:11px;font-weight:700;min-width:72px;">' + escapeHtml(a.asset_role === "legacy_logo" ? "لوجو سابق — مستبعد" : videoAssetTypeLabel(a.asset_type)) + '</span>' +
            '<span style="font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(a.file_name) + '</span>' +
            '<span style="font-size:10px;color:var(--c-muted);">' + escapeHtml(formatBytes(a.file_size)) + '</span>' +
            '<button class="btn ghost sm" data-open-video-asset="' + escapeHtml(a.id) + '">فتح</button>' +
            '<button class="btn ghost sm" data-delete-video-asset="' + escapeHtml(a.id) + '">حذف</button>' +
          '</div>';
        });
        html += '</div>';
      }
      html += '</div>';

      html += coverSettingsHtml(item, brandLogo);

      if (!latest) {
        html += '<div style="font-size:12px;color:var(--c-muted);margin-bottom:8px;">حوّل المسودة إلى Video Job مستقل ليقرأه عامل الفيديو على الماك لاحقًا.</div>';
        if (missing.length) {
          html += '<div class="err-msg">⚠️ لا يمكن إنشاء Video Job قبل اكتمال: ' + escapeHtml(missing.join("، ")) + '</div>';
        } else {
          html += '<div style="font-size:12px;margin-bottom:10px;"><b>القالب:</b> ' + escapeHtml(item.video_template) +
            ' &nbsp; <b>المدة:</b> ' + escapeHtml(item.target_duration_min_seconds + "–" + item.target_duration_max_seconds + " ث") + '</div>' +
            '<button class="btn sm" id="create-video-job-btn">🎬 إنشاء Video Job</button>';
        }
      } else {
        html += '<div style="font-size:12px;margin-bottom:6px;"><b>الحالة:</b> ' + escapeHtml(videoJobStatusLabel(latest.status)) + '</div>' +
          '<div style="font-size:12px;margin-bottom:6px;"><b>القالب:</b> ' + escapeHtml(latest.video_template || "—") +
          ' &nbsp; <b>المدة:</b> ' + escapeHtml((latest.duration_min_seconds == null ? "—" : latest.duration_min_seconds) + "–" +
          (latest.duration_max_seconds == null ? "—" : latest.duration_max_seconds) + " ث") + '</div>' +
          '<div style="font-size:11px;color:var(--c-muted);margin-bottom:8px;">تم إنشاء الـJob: ' +
          escapeHtml(new Date(latest.created_at).toLocaleString("ar-EG")) + '</div>';

        if (latest.status === "ready" && (latest.drive_video_url || latest.output_video_url)) {
          html += '<a class="btn sm" target="_blank" href="' + escapeHtml(latest.drive_video_url || latest.output_video_url) + '">▶️ فتح الفيديو النهائي</a>';
          if (latest.drive_folder_url) html += ' <a class="btn ghost sm" target="_blank" rel="noopener" href="' + escapeHtml(latest.drive_folder_url) + '">أرشيف Google Drive</a>';
          if (latest.cover_url) html += ' <a class="btn ghost sm" target="_blank" rel="noopener" href="' + escapeHtml(latest.cover_url) + '">فتح الغلاف</a>';
          if (!missing.length) {
            html += ' <button class="btn ghost sm" id="create-video-job-btn">🔁 إعادة إنتاج الفيديو</button>';
          }
        } else if (latest.status === "failed") {
          html += '<div class="err-msg">' + (latest.archive_status === "failed" ? "اكتمل الرندر وتعطلت الأرشفة" : "فشل الإنتاج") +
            (latest.error_message ? ': ' + escapeHtml(latest.error_message) : '') + '</div>';
          if (!missing.length) html += '<button class="btn sm" id="create-video-job-btn">🔁 إنشاء محاولة جديدة</button>';
        } else if (latest.status === "pending" && !missing.length) {
          html += '<p>بعد حفظ الإعدادات أو رفع المواد، حدّث المهمة لتستخدمها عند التشغيل.</p><button class="btn sm" id="create-video-job-btn">تحديث مهمة الانتظار</button>';
        } else if (latest.status === "cancelled" && !missing.length) {
          html += '<button class="btn sm" id="create-video-job-btn">🔁 إنشاء Video Job جديد</button>';
        } else {
          html += '<div style="font-size:12px;color:var(--c-muted);">الـJob محفوظ في الطابور وجاهز للمرحلة التالية: ربط Mac Video Worker.</div>';
        }
      }

      html += '</div>';
      html += '<div id="video-cover-choices"></div>';
      slot.innerHTML = html;
      if (latest && latest.status === "ready" && latest.cover_settings && latest.cover_settings.enabled) {
        loadCoverChoices(slot.querySelector('#video-cover-choices'), latest, function () { renderVideoJobSection(slot, item); });
      }
      if (brandLogo) window.SSMPDDb.getBrandLogoUrl(brandLogo.storage_path).then(function (url) {
        var img = slot.querySelector('#content-brand-logo');
        if (img) img.src = url;
      }).catch(function () {});
      var saveCover = slot.querySelector('#save-cover-settings');
      saveCover.onclick = function () {
        var settings = {
          enabled: slot.querySelector('#cover-enabled').checked,
          title: slot.querySelector('#cover-title').value.trim(),
          position: slot.querySelector('#cover-position').value
        };
        var feedback = slot.querySelector('#cover-settings-feedback');
        if (settings.enabled && (!settings.title || !brandLogo)) {
          feedback.textContent = 'اكتب العنوان وتأكد من حفظ لوجو هذا البراند في لوحة الإدارة.'; return;
        }
        saveCover.disabled = true;
        var createJobButton = slot.querySelector('#create-video-job-btn');
        if (createJobButton) createJobButton.disabled = true;
        window.SSMPDDb.updateContentItem(item.id, { cover_settings: settings }).then(function () {
          item.cover_settings = settings;
          feedback.textContent = 'تم حفظ إعدادات الكفر للإنتاج القادم.';
        }).catch(function (e) { feedback.textContent = e.message; }).then(function () {
          saveCover.disabled = false;
          if (createJobButton) createJobButton.disabled = false;
        });
      };

      var mediaModeSelect = slot.querySelector("#video-media-mode");
      if (mediaModeSelect) {
        mediaModeSelect.onchange = function () {
          var mode = mediaModeSelect.value;
          mediaModeSelect.disabled = true;
          window.SSMPDDb.updateContentItem(item.id, { video_media_mode: mode }).then(function () {
            item.video_media_mode = mode;
            mediaModeSelect.disabled = false;
            if (window.SSMPDToast) window.SSMPDToast.show("تم حفظ Media Mode: " + videoMediaModeLabel(mode), "success");
          }).catch(function (e) {
            mediaModeSelect.disabled = false;
            alert("خطأ: " + e.message);
          });
        };
      }

      var uploadBtn = slot.querySelector("#upload-video-assets-btn");
      if (uploadBtn) {
        uploadBtn.onclick = function () {
          var typeEl = slot.querySelector("#video-asset-type");
          var filesEl = slot.querySelector("#video-asset-files");
          var files = Array.prototype.slice.call((filesEl && filesEl.files) || []);
          var assetType = typeEl ? typeEl.value : "image";
          if (!files.length) { alert("اختار ملف واحد على الأقل"); return; }

          for (var i = 0; i < files.length; i++) {
            if (files[i].size > 50 * 1024 * 1024) {
              alert("الملف " + files[i].name + " أكبر من 50MB");
              return;
            }
            if ((assetType === "image" && files[i].type.indexOf("image/") !== 0) ||
                (assetType === "video" && files[i].type.indexOf("video/") !== 0) ||
                ((assetType === "voiceover" || assetType === "music") && files[i].type.indexOf("audio/") !== 0)) {
              alert("نوع الملف لا يطابق الاختيار: " + files[i].name);
              return;
            }
          }

          var me = window.SSMPDAuth.currentAdmin;
          uploadBtn.disabled = true;
          uploadBtn.textContent = "جاري الرفع…";

          var chain = Promise.resolve();
          files.forEach(function (file) {
            chain = chain.then(function () {
              return window.SSMPDDb.uploadVideoAsset(item.id, me.id, assetType, file);
            });
          });

          chain.then(function () {
            if (window.SSMPDToast) window.SSMPDToast.show("تم رفع مواد الإنتاج", "success");
            renderVideoJobSection(slot, item);
          }).catch(function (e) {
            uploadBtn.disabled = false;
            uploadBtn.textContent = "⬆️ رفع";
            alert("خطأ في الرفع: " + e.message);
          });
        };
      }

      slot.querySelectorAll("[data-open-video-asset]").forEach(function (btn) {
        btn.onclick = function () {
          var id = btn.getAttribute("data-open-video-asset");
          var asset = assets.filter(function (a) { return a.id === id; })[0];
          if (!asset) return;
          window.SSMPDDb.getVideoAssetSignedUrl(asset.storage_path).then(function (url) {
            if (url) window.open(url, "_blank");
          }).catch(function (e) { alert("خطأ: " + e.message); });
        };
      });

      slot.querySelectorAll("[data-delete-video-asset]").forEach(function (btn) {
        btn.onclick = function () {
          var id = btn.getAttribute("data-delete-video-asset");
          var asset = assets.filter(function (a) { return a.id === id; })[0];
          if (!asset) return;
          if (!confirm("حذف " + asset.file_name + "؟")) return;
          btn.disabled = true;
          window.SSMPDDb.deleteVideoAsset(asset).then(function () {
            renderVideoJobSection(slot, item);
          }).catch(function (e) {
            btn.disabled = false;
            alert("خطأ: " + e.message);
          });
        };
      });

      var createBtn = slot.querySelector("#create-video-job-btn");
      if (createBtn) {
        createBtn.onclick = function () {
          createBtn.disabled = true;
          createBtn.textContent = "جاري إنشاء الـJob…";
          window.SSMPDDb.createVideoJob(item.id).then(function () {
            if (window.SSMPDToast) window.SSMPDToast.show("تم إنشاء Video Job — جاهز لطابور عامل الفيديو", "success");
            renderVideoJobSection(slot, item);
          }).catch(function (e) {
            createBtn.disabled = false;
            createBtn.textContent = "🎬 إنشاء Video Job";
            alert("خطأ: " + e.message);
          });
        };
      }
    }).catch(function (e) {
      slot.innerHTML = '<div class="err-msg">تعذر تحميل Video Jobs: ' + escapeHtml(e.message) + '</div>';
    });
  }

  function render(container) {
    var me = window.SSMPDAuth.currentAdmin;
    container.innerHTML = '<div class="loading">بيحمّل…</div>';

    Promise.all([
      window.SSMPDDb.listContentItems({ createdBy: me.id }),
      window.SSMPDDb.listAllComments(),
      window.SSMPDDb.listMyCommentReads(me.id)
    ]).then(function (res) {
      var items = res[0];
      var stats = C.computeCommentStats(res[1], res[2], me.id);

      var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
        '<h2>إنتاج المحتوى</h2><button class="btn" id="new-content-btn">+ فكرة/محتوى جديد</button></div>';

      html += '<div class="section"><h3>كل المواد بتاعتي (' + items.length + ')</h3>';
      if (!items.length) {
        html += '<div class="empty-state">لسه مفيش محتوى — ابدأ بفكرة جديدة</div>';
      } else {
        html += '<table class="simple"><thead><tr><th>العنوان</th><th>الحالة</th><th>آخر تحديث</th><th></th></tr></thead><tbody>';
        items.forEach(function (i) {
          var titleOpenAttr = i.stage === "published" ? 'data-published-open="' + i.id + '"' : 'data-open="' + i.id + '"';
          html += '<tr><td><span class="link-open" ' + titleOpenAttr + '>' + escapeHtml(i.title) + '</span>' + W.brandBadgeHtml(i.brand) + W.specialtyBadgeHtml(i.specialty) + '</td>' +
            '<td><span class="status-pill ' + stagePillClass(i.stage) + '">' + W.stageLabel(i.stage) + '</span></td>' +
            '<td>' + new Date(i.updated_at).toLocaleDateString("ar-EG") + '</td>' +
            '<td><button class="btn ghost sm" data-open="' + i.id + '">فتح</button> ' + C.commentButtonHtml(i.id, stats) + '</td></tr>';
        });
        html += '</tbody></table>';
      }
      html += '</div>';

      container.innerHTML = html;

      document.getElementById("new-content-btn").onclick = openCreateModal;
      container.querySelectorAll("[data-published-open]").forEach(function (btn) {
        btn.onclick = function () {
          var id = btn.getAttribute("data-published-open");
          var item = items.filter(function (x) { return x.id === id; })[0];
          if (!item) return;
          W.openPublishedPostOptions(item, function () { openViewModal(id); });
        };
      });
      container.querySelectorAll("[data-open]").forEach(function (btn) {
        btn.onclick = function () { openViewModal(btn.getAttribute("data-open")); };
      });
      container.querySelectorAll("[data-comment]").forEach(function (btn) {
        btn.onclick = function () { openViewModal(btn.getAttribute("data-comment")); };
      });
    }).catch(function (e) {
      container.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
    });
  }

  function openCreateModal() {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal"><div class="modal-head"><h3>فكرة/محتوى جديد</h3>' +
      '<button class="modal-close">×</button></div>' +
      '<div class="field"><label>العنوان</label><input id="cf-title" placeholder="عنوان المحتوى"></div>' +
      '<div class="field"><label>المادة دي لصفحة</label>' + W.brandSelectHtml("cf-brand", "") + '</div>' +
      '<div class="field"><label>التخصص</label>' + W.specialtySelectHtml("cf-specialty", "") + '</div>' +
      '<div class="field"><label>نص المحتوى</label><textarea id="cf-body" placeholder="اكتب الفكرة والنص..."></textarea></div>' +
      W.contentIntelligencePanelHtml() +
      structuredFieldsHtml() +
      '<div style="text-align:left;margin-top:10px;"><button class="btn" id="cf-submit">إرسال للاعتماد الأولي</button> ' +
      '<button class="btn ghost" id="cf-draft">حفظ كمسودة</button></div></div>';
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    W.wireContentIntelligence(backdrop, function () { return document.getElementById("cf-specialty").value; });
    var importAgentBtn = document.getElementById("cf-import-agent");
    if (importAgentBtn) importAgentBtn.onclick = function () { openAgentImportModal(backdrop); };
    document.getElementById("cf-specialty").addEventListener("change", function () {
      W.refreshContentIntelligence(backdrop, function () { return document.getElementById("cf-specialty").value; });
    });

    function submit(stage) {
      var title = document.getElementById("cf-title").value.trim();
      var body = document.getElementById("cf-body").value.trim();
      var brand = document.getElementById("cf-brand").value;
      var specialty = document.getElementById("cf-specialty").value;
      var advertisingObjective = valueOrNull("ci-objective");
      var contentFormat = valueOrNull("ci-format");
      var topicService = valueOrNull("ci-topic");
      var durationMin = intOrNull("cf-duration-min");
      var durationMax = intOrNull("cf-duration-max");
      if (durationMin != null && durationMax != null && durationMax < durationMin) {
        alert("أقصى مدة لازم تكون أكبر من أو تساوي أقل مدة");
        return;
      }
      if (!title) { alert("اكتب عنوان الأول"); return; }
      if (!brand) { alert("اختر المادة دي لصفحة سونو ولا د.دينا"); return; }
      var me = window.SSMPDAuth.currentAdmin;
      window.SSMPDDb.createContentItem({
        title: title,
        body: body,
        stage: stage,
        created_by: me.id,
        brand: brand,
        specialty: specialty || null,
        advertising_objective: advertisingObjective,
        content_format: contentFormat,
        topic_service: topicService,
        hook_text: valueOrNull("cf-hook"),
        content_angle: valueOrNull("cf-angle"),
        script_text: valueOrNull("cf-script"),
        caption_text: valueOrNull("cf-caption"),
        cta_type: valueOrNull("cf-cta-type"),
        cta_text: valueOrNull("cf-cta-text"),
        target_duration_min_seconds: durationMin,
        target_duration_max_seconds: durationMax,
        video_template: valueOrNull("cf-video-template"),
        hypothesis_reason: valueOrNull("cf-hypothesis"),
        agent_raw_output: valueOrNull("cf-agent-raw")
      })
        .then(function (row) {
          window.SSMPDDrive.logIdea(row.id, title).catch(function () {});
          window.SSMPDDb.logUsageActivity(me.id, "إنشاء مادة محتوى", title).catch(function () {});
          return window.SSMPDDb.logActivity({ content_id: row.id, actor_id: me.id, action: "إنشاء", from_stage: null, to_stage: stage });
        }).then(function () {
          backdrop.remove();
          render(document.getElementById("view-container"));
        }).catch(function (e) { alert("خطأ: " + e.message); });
    }
    document.getElementById("cf-submit").onclick = function () { submit("initial_approval"); };
    document.getElementById("cf-draft").onclick = function () { submit("idea_selection"); };
  }

  function openViewModal(id) {
    window.SSMPDDb.getContentItem(id).then(function (item) {
      var me = window.SSMPDAuth.currentAdmin;
      var backdrop = document.createElement("div");
      backdrop.className = "modal-backdrop";
      backdrop.innerHTML = '<div class="modal"><div class="modal-head"><h3>' + escapeHtml(item.title) + W.brandBadgeHtml(item.brand) + W.specialtyBadgeHtml(item.specialty) + '</h3>' +
        '<button class="modal-close">×</button></div>' +
        '<div class="status-pill ' + stagePillClass(item.stage) + '" style="margin-bottom:12px;">' + W.stageLabel(item.stage) + '</div>' +
        '<p style="white-space:pre-wrap;">' + escapeHtml(item.body || "") + '</p>' +
        structuredDetailsHtml(item) +
        (item.content_format === "video" ? '<div id="video-job-slot"></div>' : '') +
        (item.design_file_url ? '<p><a href="' + item.design_file_url + '" target="_blank" class="btn ghost sm">فتح ملف التصميم</a></p>' : '') +
        '<div style="margin:10px 0;">' + W.itemActionsHtml(item, me) + '</div>' +
        W.metaLinksSectionHtml(item) +
        '<div id="comments-slot"></div></div>';
      document.body.appendChild(backdrop);
      backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
      backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };
      W.wireItemActions(backdrop, item, function () { render(document.getElementById("view-container")); });
      W.wireMetaLinksSection(backdrop, item, me);
      renderVideoJobSection(backdrop.querySelector("#video-job-slot"), item);

      window.SSMPDDb.listAdminsBasic().then(function (admins) {
        var map = {}; admins.forEach(function (a) { map[a.id] = a; });
        window.SSMPDComments.render(document.getElementById("comments-slot"), item.id, map);
      });
    });
  }

  window.SSMPDRenderProduction = { render: render };
})();

