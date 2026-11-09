/* SSMPD — ملفات مرفقة بطلب تصميم Claude Creative:
   «صور للاستخدام في التصميم» + «مثال للشكل المطلوب». الموظف يرفعها وهو بيعمل المحتوى،
   وClaude بيقراها مع الطلب (جدول claude_design_inputs + bucket video-inputs). */
(function () {
  "use strict";
  var KINDS = { use: "صور تتستخدم في التصميم", reference: "مثال للشكل المطلوب" };
  var MAX = 20 * 1024 * 1024;
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  // تصغير الصورة في المتصفح قبل الرفع (أقصى ضلع 1800px) عشان التخزين يفضل خفيف. أي فشل = نرفع الأصل.
  function shrink(file) {
    if (file.size <= 600 * 1024 || !window.URL || !document.createElement("canvas").toBlob) return Promise.resolve(file);
    return new Promise(function (resolve) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.onload = function () {
        URL.revokeObjectURL(url);
        var scale = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
        var ctx = c.getContext("2d");
        if (!ctx) return resolve(file);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        var png = file.type === "image/png"; // PNG بيفضل PNG عشان الشفافية (لوجوهات)
        c.toBlob(function (blob) {
          if (!blob || blob.size >= file.size) return resolve(file);
          var name = png ? file.name : String(file.name || "image").replace(/\.[^.]+$/, "") + ".jpg";
          try { resolve(new File([blob], name, { type: png ? "image/png" : "image/jpeg" })); } catch (e) { resolve(file); }
        }, png ? "image/png" : "image/jpeg", 0.85);
      };
      img.src = url;
    });
  }
  function html(item) {
    if (!item || item.content_format === "video") return "";
    return '<div class="claude-inputs" data-claude-inputs="' + esc(item.id) + '" style="margin-top:12px;padding:12px;border:1px solid var(--c-border,#DCE5F5);border-radius:12px;">' +
      '<b>مرفقات لتصميم Claude</b>' +
      '<p style="font-size:12px;color:var(--c-muted);margin:6px 0;">اختياري: ارفع صور عايزها تظهر في التصميم (منتج، جهاز، صورة من المركز)، وارفع مثال للشكل اللي عايزه. Claude هيعمل نفس الفكرة بهوية الصفحة، مش نسخة من المثال.</p>' +
      '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
      Object.keys(KINDS).map(function (kind) {
        return '<div class="field" style="margin:0;flex:1;min-width:220px;"><label for="ci-' + kind + '-' + esc(item.id) + '">' + KINDS[kind] + '</label>' +
          '<input id="ci-' + kind + '-' + esc(item.id) + '" type="file" multiple accept="image/jpeg,image/png,image/webp" data-ci-kind="' + kind + '"></div>';
      }).join("") + '</div>' +
      '<div data-ci-list style="display:flex;flex-direction:column;gap:6px;margin-top:8px;"></div>' +
      '<p data-ci-status role="status" style="font-size:12px;color:var(--c-muted);margin:6px 0 0;"></p></div>';
  }
  function wire(root, item) {
    var box = root && root.querySelector('[data-claude-inputs="' + item.id + '"]');
    if (!box) return;
    var list = box.querySelector("[data-ci-list]"), status = box.querySelector("[data-ci-status]");
    var me = (window.SSMPDAuth.currentAdmin || {});
    function refresh() {
      return window.SSMPDDb.listClaudeDesignInputs(item.id).then(function (rows) {
        list.innerHTML = (rows || []).map(function (r) {
          return '<div style="display:flex;align-items:center;gap:8px;padding:7px 8px;border:1px solid var(--c-border);border-radius:8px;">' +
            '<span style="font-size:11px;font-weight:700;min-width:130px;">' + (KINDS[r.kind] || esc(r.kind)) + '</span>' +
            '<span style="font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(r.file_name) + '</span>' +
            '<button type="button" class="btn ghost sm" data-ci-open="' + esc(r.id) + '">فتح</button>' +
            (r.created_by === me.id || me.role === "super_admin" ? '<button type="button" class="btn ghost sm" data-ci-del="' + esc(r.id) + '">حذف</button>' : '') + '</div>';
        }).join("");
        list.querySelectorAll("[data-ci-open]").forEach(function (b) {
          b.onclick = function () {
            var row = rows.filter(function (r) { return r.id === b.getAttribute("data-ci-open"); })[0];
            window.SSMPDDb.getVideoAssetSignedUrl(row.storage_path).then(function (url) { window.open(url, "_blank", "noopener"); }, function (e) { status.textContent = "خطأ: " + e.message; });
          };
        });
        list.querySelectorAll("[data-ci-del]").forEach(function (b) {
          b.onclick = function () {
            var row = rows.filter(function (r) { return r.id === b.getAttribute("data-ci-del"); })[0];
            b.disabled = true;
            window.SSMPDDb.deleteClaudeDesignInput(row).then(refresh, function (e) { b.disabled = false; status.textContent = "خطأ: " + e.message; });
          };
        });
      }, function (e) {
        status.textContent = /claude_design_inputs/.test(e.message || "") ? "شغّل تحديث قاعدة البيانات الخاص بمرفقات تصميم Claude أولاً." : "خطأ: " + e.message;
      });
    }
    box.querySelectorAll("[data-ci-kind]").forEach(function (input) {
      input.onchange = function () {
        var files = Array.prototype.slice.call(input.files || []), kind = input.getAttribute("data-ci-kind");
        if (!files.length) return;
        var bad = files.filter(function (f) { return f.size > MAX || !/^image\/(jpeg|png|webp)$/.test(f.type); })[0];
        if (bad) { status.textContent = "الملف " + bad.name + " لازم يكون صورة JPG أو PNG أو WebP وأقل من 20MB."; input.value = ""; return; }
        input.disabled = true; status.textContent = "جاري الرفع…";
        var chain = Promise.resolve();
        files.forEach(function (f) { chain = chain.then(function () { return shrink(f); }).then(function (small) { return window.SSMPDDb.uploadClaudeDesignInput(item.id, me.id, kind, small); }); });
        chain.then(function () { status.textContent = "تم الرفع ✅"; }, function (e) { status.textContent = "خطأ في الرفع: " + e.message; })
          .then(function () { input.disabled = false; input.value = ""; return refresh(); });
      };
    });
    refresh();
  }
  window.SSMPDDesignInputs = { html: html, wire: wire };
})();
