/* Fixed Sono overlay. All lettering is rendered locally with the video fonts. */
(function () {
  'use strict';
  var base = new URL('../', document.currentScript.src);
  var fonts;
  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var image = new Image(); image.crossOrigin = 'anonymous';
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error('تعذر تحميل الصورة.')); };
      image.src = url;
    });
  }
  function ready() {
    if (!fonts) fonts = Promise.all([
      new FontFace('SonoDesign', 'url(' + new URL('fonts/BigVesta-Bold.woff2', base) + ')', {weight:'700'}),
      new FontFace('SonoDesign', 'url(' + new URL('fonts/BigVesta-Regular.woff2', base) + ')', {weight:'400'}),
      new FontFace('SonoLatin', 'url(' + new URL('fonts/Hiragino-W6.woff2', base) + ')')
    ].map(function (f) { return f.load().then(function (loaded) { document.fonts.add(loaded); }); }));
    return fonts;
  }
  function fit(ctx, value, box, weight) {
    var text = String(value || '').trim();
    if (!text) return null;
    for (var size = box.max; size >= box.min; size -= 2) {
      ctx.font = weight + ' ' + size + 'px SonoLatin, SonoDesign';
      var lines = [], overflow = false;
      text.split('\n').forEach(function (paragraph) {
        var line = '';
        paragraph.split(/\s+/).forEach(function (word) {
          if (ctx.measureText(word).width > box.w) overflow = true;
          var candidate = line ? line + ' ' + word : word;
          if (ctx.measureText(candidate).width > box.w && line) { lines.push(line); line = word; }
          else line = candidate;
        });
        lines.push(line);
      });
      if (!overflow && lines.length <= box.lines && lines.length * size * 1.35 <= box.h) return {lines:lines,size:size};
    }
    throw new Error('النص أطول من المساحة المتاحة. عدّله قبل التصدير.');
  }
  async function render(canvas, scene, data) {
    await ready();
    var overlay = await loadImage(new URL('design-templates/sono-white/overlay.png', base));
    canvas.width = 1080; canvas.height = 1350;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,1080,1350);
    if (scene) {
      var height = 830, scale = Math.max(1080 / scene.width, height / scene.height) * (Number(data.zoom) || 1);
      var w = scene.width * scale, h = scene.height * scale;
      ctx.save(); ctx.beginPath(); ctx.rect(0,0,1080,height); ctx.clip();
      ctx.drawImage(scene, (1080-w) * (Number(data.x)/100), (height-h) * (Number(data.y)/100), w,h); ctx.restore();
    }
    // Fade the scene before the fixed overlay so brand pixels stay untouched.
    var fade = ctx.createLinearGradient(0,650,0,830);
    fade.addColorStop(0,'rgba(255,255,255,0)');
    fade.addColorStop(1,'rgba(255,255,255,1)');
    ctx.fillStyle = fade; ctx.fillRect(0,650,1080,180);
    ctx.drawImage(overlay,0,0,1080,1350);
    ctx.direction = 'rtl'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    function draw(text, box, weight, color, shadow) {
      var layout = fit(ctx,text,box,weight); if (!layout) return;
      ctx.font = weight + ' ' + layout.size + 'px SonoLatin, SonoDesign';
      layout.lines.forEach(function (line,i) {
        var y = box.y + box.h/2 + (i-(layout.lines.length-1)/2)*layout.size*(box.leading || 1.35);
        if (shadow) { ctx.fillStyle='#00dedb'; ctx.fillText(line,544,y+5); }
        ctx.fillStyle=color; ctx.fillText(line,540,y);
      });
    }
    function bounded(value, fallback, min, max) {
      var n = Number(value); return Number.isFinite(n) && n > 0 ? Math.max(min,Math.min(max,n)) : fallback;
    }
    var headlineSize = bounded(data.headlineSize,83,46,90);
    var subtitleSize = bounded(data.subtitleSize,42,24,48);
    var ctaScale = bounded(data.ctaScale,1,0.8,1.15);
    var buttonWidth = 372 * ctaScale, buttonHeight = 56 * ctaScale;
    var buttonY = 1088 - buttonHeight / 2;
    draw(data.headline,{y:806,h:155,w:960,max:headlineSize,min:46,lines:2,leading:1.15},700,'#07599d',true);
    draw(data.subtitle,{y:940,h:88,w:950,max:subtitleSize,min:24,lines:2},400,'#272727');
    if (String(data.cta || '').trim()) {
      fit(ctx,data.cta,{h:buttonHeight,w:buttonWidth-28,max:31*ctaScale,min:22,lines:1},700);
      ctx.fillStyle='#ff541d'; ctx.beginPath(); ctx.roundRect(540-buttonWidth/2,buttonY,buttonWidth,buttonHeight,buttonHeight/2); ctx.fill();
      draw(data.cta,{y:buttonY,h:buttonHeight,w:buttonWidth-28,max:31*ctaScale,min:22,lines:1},700,'white');
    }
    return canvas;
  }
  window.SSMPDDesignComposer = {render:render,loadImage:loadImage,ready:ready};
})();
