(function () {
  "use strict";

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }
  function normalise(x) {
    x = x || {};
    return {
      raw: x,
      title: x.title || "",
      idea: x.idea || "",
      hook: x.hook || "",
      angle: x.angle || "",
      formatKey: x.format || x.format_key || "",
      script: x.script || "",
      caption: x.caption || "",
      ctaType: x.cta_type || x.ctaType || "",
      cta: x.cta_text || x.cta || "",
      durationMin: x.duration_min_seconds == null ? x.durationMin : x.duration_min_seconds,
      durationMax: x.duration_max_seconds == null ? x.durationMax : x.duration_max_seconds,
      videoTemplate: x.video_template || x.videoTemplate || "",
      why: x.hypothesis_reason || x.why || ""
    };
  }
  function renderCard(idea, index, extra) {
    return '<article class="section" style="margin:10px 0;padding:14px;">' +
      '<h4 style="margin:0 0 7px;">فكرة ' + (index + 1) + ': ' + esc(idea.title) + '</h4>' +
      '<div style="font-size:12px;margin:5px 0;"><b>الفكرة:</b> ' + esc(idea.idea) + '</div>' +
      '<div style="font-size:12px;margin:5px 0;"><b>الافتتاحية:</b> ' + esc(idea.hook) + '</div>' +
      '<div style="font-size:12px;margin:5px 0;"><b>الزاوية:</b> ' + esc(idea.angle) + '</div>' +
      '<div style="font-size:12px;margin:5px 0;"><b>الشكل:</b> ' + esc(idea.formatKey || "—") + '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">' + extra + '</div></article>';
  }
  function getContext() {
    var val = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; };
    return {
      brand: val("cf-brand"),
      specialty: val("cf-specialty"),
      advertisingObjective: val("ci-objective"),
      format: val("ci-format"),
      topic: val("ci-topic"),
      title: val("cf-title"),
      body: val("cf-body")
    };
  }
  function fill(idea) {
    var set = function (id, value) { var el = document.getElementById(id); if (el) el.value = value == null ? "" : value; };
    set("cf-title", idea.title); set("cf-body", idea.idea || idea.hook);
    set("cf-hook", idea.hook); set("cf-angle", idea.angle); set("cf-script", idea.script);
    set("cf-caption", idea.caption); set("cf-cta-type", idea.ctaType); set("cf-cta-text", idea.cta);
    set("cf-duration-min", idea.durationMin); set("cf-duration-max", idea.durationMax);
    set("cf-video-template", idea.videoTemplate); set("cf-hypothesis", idea.why);
    set("cf-agent-raw", JSON.stringify(idea.raw));
    var format = document.getElementById("ci-format"); if (format && idea.formatKey) format.value = idea.formatKey;
  }
  function openGenerator() {
    var context = getContext();
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.style.zIndex = "9999";
    backdrop.innerHTML = '<div class="modal"><div class="modal-head"><h3>توليد أفكار بالذكاء الاصطناعي</h3><button class="modal-close">×</button></div>' +
      '<p style="font-size:12px;color:var(--c-muted);">سيظهر ٣ اقتراحات جديدة فقط. اختَر واحدة للتنفيذ أو احفظ الباقي في بنك الأفكار.</p>' +
      '<div class="field"><label>نوع الطلب</label><select id="ai-mode"><option value="ideas">توليد ٣ أفكار جديدة</option><option value="develop">تطوير الفكرة/المسودة المكتوبة</option></select></div>' +
      '<div class="field"><label>الموضوع أو توجيه إضافي</label><textarea id="ai-topic" placeholder="مثال: الصداع النصفي، أو اتركه ليستخدم بيانات المادة"></textarea></div>' +
      '<div id="ai-context-note" style="font-size:12px;color:var(--c-muted);margin-bottom:10px;"></div>' +
      '<button class="btn" id="ai-generate">توليد الاقتراحات</button><div id="ai-results"></div></div>';
    document.body.appendChild(backdrop);
    function close() { backdrop.remove(); }
    backdrop.querySelector(".modal-close").onclick = close;
    backdrop.onclick = function (e) { if (e.target === backdrop) close(); };
    var note = "الصفحة: " + (context.brand || "غير محددة") + " — التخصص: " + (context.specialty || "غير محدد") +
      " — الهدف: " + (context.advertisingObjective || "غير محدد");
    backdrop.querySelector("#ai-context-note").textContent = note;
    backdrop.querySelector("#ai-generate").onclick = function () {
      var btn = backdrop.querySelector("#ai-generate");
      var slot = backdrop.querySelector("#ai-results");
      var mode = backdrop.querySelector("#ai-mode").value;
      var topic = backdrop.querySelector("#ai-topic").value.trim();
      if (!context.brand) { alert("اختر الصفحة أولًا من نموذج المحتوى."); return; }
      if (mode === "develop" && !(topic || context.title || context.body)) { alert("اكتب فكرة أو مسودة لتطويرها."); return; }
      btn.disabled = true; btn.textContent = "جاري التوليد…"; slot.innerHTML = '<div class="loading" style="margin-top:10px;">يتم إعداد ٣ اقتراحات…</div>';
      window.SSMPDDb.generateContentIdeas({
        mode: mode, brand: context.brand, specialty: context.specialty,
        advertising_objective: context.advertisingObjective, preferred_format: context.format,
        topic: topic || context.topic, manual_draft: mode === "develop" ? (context.body || context.title) : "",
        title: context.title, performance_brief: ""
      }).then(function (data) {
        var ideas = (data.ideas || []).slice(0, 3).map(normalise);
        if (ideas.length !== 3) throw new Error("لم تصل ٣ أفكار مكتملة. أعد المحاولة.");
        slot.innerHTML = ideas.map(function (idea, i) {
          return renderCard(idea, i,
            '<button class="btn sm" data-use="' + i + '">اعتماد وتنفيذ</button>' +
            '<button class="btn ghost sm" data-save="' + i + '">حفظ لوقت لاحق</button>');
        }).join("");
        slot.querySelectorAll("[data-use]").forEach(function (b) { b.onclick = function () {
          var idea = ideas[Number(b.getAttribute("data-use"))]; fill(idea);
          if (window.SSMPDToast) window.SSMPDToast.show("تم ملء بيانات المادة. اختر إنشاء فيديو أو تصميم بعد الحفظ.", "success");
          close();
        };});
        slot.querySelectorAll("[data-save]").forEach(function (b) { b.onclick = function () {
          var idea = ideas[Number(b.getAttribute("data-save"))]; b.disabled = true;
          window.SSMPDDb.saveContentIdea(idea, context).then(function () {
            b.textContent = "تم الحفظ"; if (window.SSMPDToast) window.SSMPDToast.show("تم حفظ الفكرة في بنك الأفكار", "success");
          }).catch(function (e) { b.disabled = false; alert("تعذر حفظ الفكرة: " + e.message); });
        };});
      }).catch(function (e) { slot.innerHTML = '<div class="err-msg" style="margin-top:10px;">' + esc(e.message) + '</div>'; })
        .finally(function () { btn.disabled = false; btn.textContent = "توليد الاقتراحات"; });
    };
  }
  function openIdeaBank() {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop"; backdrop.style.zIndex = "9999";
    backdrop.innerHTML = '<div class="modal"><div class="modal-head"><h3>بنك الأفكار</h3><button class="modal-close">×</button></div><div class="loading">بيحمّل الأفكار المحفوظة…</div></div>';
    document.body.appendChild(backdrop);
    function close() { backdrop.remove(); }
    backdrop.querySelector(".modal-close").onclick = close; backdrop.onclick = function (e) { if (e.target === backdrop) close(); };
    window.SSMPDDb.listSavedContentIdeas().then(function (rows) {
      var slot = backdrop.querySelector(".loading");
      if (!rows.length) { slot.outerHTML = '<div class="empty-state">لا توجد أفكار محفوظة بعد.</div>'; return; }
      slot.outerHTML = '<div id="idea-bank-list"></div>'; var list = backdrop.querySelector("#idea-bank-list");
      list.innerHTML = rows.map(function (row, i) {
        var idea = normalise(row);
        return renderCard(idea, i,
          '<button class="btn sm" data-bank-use="' + row.id + '">استخدام في مادة جديدة</button>' +
          '<button class="btn ghost sm" data-bank-discard="' + row.id + '">استبعاد</button>');
      }).join("");
      list.querySelectorAll("[data-bank-use]").forEach(function (b) { b.onclick = function () {
        var row = rows.filter(function (x) { return x.id === b.getAttribute("data-bank-use"); })[0];
        window.SSMPDDb.markContentIdeaUsed(row.id).then(function () {
          close(); document.getElementById("new-content-btn").click();
          setTimeout(function () { fill(normalise(row)); }, 50);
        }).catch(function (e) { alert(e.message); });
      };});
      list.querySelectorAll("[data-bank-discard]").forEach(function (b) { b.onclick = function () {
        if (!confirm("استبعاد هذه الفكرة من البنك؟")) return;
        window.SSMPDDb.discardContentIdea(b.getAttribute("data-bank-discard")).then(function () { b.closest("article").remove(); })
          .catch(function (e) { alert(e.message); });
      };});
    }).catch(function (e) { backdrop.querySelector(".loading").outerHTML = '<div class="err-msg">' + esc(e.message) + '</div>'; });
  }
  window.SSMPDContentAI = { openGenerator: openGenerator, openIdeaBank: openIdeaBank };
})();