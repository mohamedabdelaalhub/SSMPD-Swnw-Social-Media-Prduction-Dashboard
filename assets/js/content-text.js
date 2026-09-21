(function () {
  "use strict";

  // Compare text only. Never rewrite or remove any saved content.
  function repeatedExcerpt(value) {
    var words = String(value || "").trim().split(/\s+/);
    var seen = new Map();
    for (var i = 0; i + 8 <= words.length; i++) {
      var phrase = words.slice(i, i + 8).join(" ");
      if (phrase.length < 40) continue;
      if (seen.has(phrase) && i - seen.get(phrase) >= 8) return phrase;
      if (!seen.has(phrase)) seen.set(phrase, i);
    }
    var lines = String(value || "").split(/[\r\n]+/);
    seen = new Map();
    for (var j = 0; j < lines.length; j++) {
      var line = lines[j].trim().replace(/\s+/g, " ");
      if (line.length < 25) continue;
      if (seen.has(line)) return line;
      seen.set(line, true);
    }
    return "";
  }

  function confirmSave(item) {
    var fields = [["نص المحتوى", item.body], ["كابشن النشر", item.caption_text], ["السكريبت", item.script_text]];
    var matches = fields.map(function (field) {
      var excerpt = repeatedExcerpt(field[1]);
      return excerpt ? field[0] + "\n«" + excerpt.slice(0, 180) + "»" : "";
    }).filter(Boolean);
    if (!matches.length) return true;
    return window.confirm("فيه نص مكرر داخل الحقول التالية\n\n" + matches.join("\n\n") +
      "\n\nموافق = حفظ النص كما هو لو التكرار مقصود.\nإلغاء = الرجوع لتعديل النص. لن نحذف أي نص تلقائيًا.");
  }

  // Matches the existing meta-publish-process body/title fallback exactly.
  function publicationText(item) {
    return item.body || item.title || "";
  }

  function preview(item, actionLabel) {
    return new Promise(function (resolve) {
      var modal = document.createElement("div");
      modal.className = "modal-backdrop";
      modal.style.zIndex = "10000";
      modal.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-label="معاينة نص النشر">' +
        '<div class="modal-head"><h3>معاينة نص النشر</h3><button class="modal-close" aria-label="إغلاق">×</button></div>' +
        '<p data-source style="color:var(--c-muted)"></p>' +
        '<p data-repeat role="alert" style="color:var(--c-negative);white-space:pre-wrap"></p>' +
        '<div data-text dir="auto" style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:45vh;overflow:auto;padding:14px;border:1px solid var(--c-border);border-radius:8px"></div>' +
        '<div style="display:flex;gap:8px;margin-top:16px"><button class="btn" data-continue></button>' +
        '<button class="btn ghost" data-back>رجوع بدون نشر</button></div></div>';
      var text = publicationText(item);
      var repeated = repeatedExcerpt(text);
      modal.querySelector("[data-source]").textContent = item.body ? "المصدر الحالي للنشر هو نص المحتوى." : "نص المحتوى فارغ، لذلك سيُنشر العنوان.";
      modal.querySelector("[data-text]").textContent = text;
      modal.querySelector("[data-repeat]").textContent = repeated ? "فيه مقطع مكرر\n«" + repeated.slice(0, 180) + "»\nيمكنك الرجوع للتعديل أو تأكيد التكرار لو مقصود." : "";
      modal.querySelector("[data-continue]").textContent = repeated ? actionLabel + " بالنص المكرر" : actionLabel;
      var previousFocus = document.activeElement;
      function finish(accepted) {
        document.removeEventListener("keydown", onKey, true);
        modal.remove();
        if (previousFocus && previousFocus.isConnected) previousFocus.focus();
        resolve(accepted);
      }
      function onKey(e) {
        if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); finish(false); }
        if (e.key === "Tab") {
          var buttons = Array.from(modal.querySelectorAll("button"));
          var index = buttons.indexOf(document.activeElement);
          e.preventDefault(); buttons[(index + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
        }
      }
      modal.querySelector("[data-continue]").onclick = function () { finish(true); };
      modal.querySelector("[data-back]").onclick = modal.querySelector(".modal-close").onclick = function () { finish(false); };
      modal.onclick = function (e) { if (e.target === modal) finish(false); };
      document.body.appendChild(modal);
      document.addEventListener("keydown", onKey, true);
      modal.querySelector("[data-back]").focus();
    });
  }
  window.SSMPDContentText = { repeatedExcerpt: repeatedExcerpt, confirmSave: confirmSave, publicationText: publicationText, preview: preview };
})();
