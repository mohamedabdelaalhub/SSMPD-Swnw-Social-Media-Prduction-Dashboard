/* SSMPD — سطر المصدر الطبي على الحافة اليسرى للتصميم (image_post فقط).
   النص بيجي حرفيًا من cover_source_text (data.coverSourceText) — مفيش رابط ولا عنوان صفحة هنا. */
(function () {
  "use strict";

  function lightBackground(ctx, x, y, w, h) {
    try {
      var data = ctx.getImageData(Math.max(0, Math.round(x)), Math.max(0, Math.round(y)), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))).data, total = 0, count = 0;
      for (var i = 0; i < data.length; i += 16) { total += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; count++; }
      return count ? total / count > 150 : false;
    } catch (e) { return false; }
  }

  function draw(canvas, data) {
    var text = String(data && data.coverSourceText || "").replace(/\s+/g, " ").trim();
    if (!text || !canvas || !canvas.getContext) return canvas;
    var ctx = canvas.getContext("2d"), s = (canvas.width || 1080) / 1080, height = canvas.height || 1350;
    var family = data.brand === "dr_dina" ? "DinaDesign, SonoDesign, SonoLatin, sans-serif" : "SonoDesign, SonoLatin, DinaDesign, sans-serif";
    var size = 21 * s, maxLength = height * 0.34;
    ctx.save();
    ctx.direction = "rtl"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "400 " + size + "px " + family;
    var length = ctx.measureText(text).width;
    if (length > maxLength) { size = Math.max(14 * s, size * maxLength / length); ctx.font = "400 " + size + "px " + family; length = ctx.measureText(text).width; }
    // Position per template (Mohamed's reference: left edge, beside the title block ≈60% of the height).
    // Dina quote layouts 1–2 keep their justified body near the left edge in the lower half → sit higher there.
    var v = Number(data.dinaVariant), dinaQuote = data.layoutTemplate === "dina" && (v === 1 || v === 2);
    var x = 36 * s, centerY = height * (dinaQuote ? 0.42 : 0.60);
    centerY = Math.max(220 * s + length / 2, Math.min(centerY, height - 170 * s - length / 2));
    var onLight = lightBackground(ctx, x - size, centerY - length / 2, size * 2, length);
    var color = onLight ? "rgba(22,33,46,0.62)" : "rgba(255,255,255,0.72)";
    ctx.fillStyle = color;
    // علامة صغيرة فوق السطر زي المرجع
    var top = centerY - length / 2 - 16 * s;
    ctx.beginPath(); ctx.moveTo(x - 7 * s, top - 4 * s); ctx.lineTo(x + 7 * s, top - 4 * s); ctx.lineTo(x, top + 5 * s); ctx.closePath(); ctx.fill();
    ctx.translate(x, centerY); ctx.rotate(-Math.PI / 2);
    ctx.fillText(text, 0, 0);
    ctx.restore();
    return canvas;
  }

  window.SSMPDDesignSource = { draw: draw };
})();
