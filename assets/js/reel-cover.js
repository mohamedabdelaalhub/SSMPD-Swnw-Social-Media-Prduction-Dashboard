/* Reel cover maker (Mohamed, 2026-10-11): a 1080×1920 cover in the approved carousel-cover style for
   video items, for both pages. Same look as Claude's docs/templates/{sono,dina}-reel-cover/cover.html.
   Saved as a private file in content-designs and linked in content_items.cover_settings.cover_image_url —
   the reel itself (design_file_url) is never touched. The publisher sends it as the Instagram reel cover. */
(function () {
  'use strict';
  var assets = new URL('../', document.currentScript.src), fontsPromise = null, logoCache = {};
  var BRAND = {
    sono: { bg: '#0F369D', end: '#0a2a7c', mid: 'rgba(15,54,157,', accent: '#F15A22', sub: '#dbe6ff', font: 'ReelSono', logo: 'design-templates/reel-cover/sono_logo_white.png', logoW: 300, title: 700 },
    dr_dina: { bg: '#5a1b4a', end: '#2c0b26', mid: 'rgba(74,21,64,', accent: '#ff4b52', tagBg: '#E3141B', sub: '#f6edd6', font: 'ReelDina', logo: 'design-templates/reel-cover/dina_logo_badge.png', logoW: 170, title: 900 }
  };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fonts() {
    if (!fontsPromise) fontsPromise = Promise.all([
      ['ReelSono', 'fonts/BigVesta-Regular.woff2', '400'], ['ReelSono', 'fonts/BigVesta-Bold.woff2', '700'],
      ['ReelDina', 'fonts/Tajawal-Medium.ttf', '500'], ['ReelDina', 'fonts/Tajawal-Bold.ttf', '700'], ['ReelDina', 'fonts/Tajawal-Black.ttf', '900']
    ].map(function (f) { return new FontFace(f[0], 'url(' + new URL(f[1], assets) + ')', { weight: f[2] }).load().then(function (face) { document.fonts.add(face); }); }))
      .catch(function (e) { fontsPromise = null; throw e; });
    return fontsPromise;
  }
  function image(src) { return new Promise(function (ok, fail) { var i = new Image(); i.crossOrigin = 'anonymous'; i.onload = function () { ok(i); }; i.onerror = function () { fail(new Error('تعذر تحميل الصورة')); }; i.src = src; }); }
  function logo(brand) { var b = BRAND[brand]; return logoCache[brand] || (logoCache[brand] = image(new URL(b.logo, assets).href)); }
  // Word wrap that never leaves one word alone on the last line (permanent rule).
  function wrap(ctx, text, width) {
    var out = [];
    String(text || '').trim().split('\n').forEach(function (p) {
      var line = '', start = out.length;
      p.split(/\s+/).filter(Boolean).forEach(function (w) { var next = line ? line + ' ' + w : w; if (line && ctx.measureText(next).width > width) { out.push(line); line = w; } else line = next; });
      if (line) out.push(line);
      var k = out.length; if (k - start >= 2 && line.indexOf(' ') < 0) { var prev = out[k - 2].split(' '); if (prev.length >= 3) { var moved = prev.pop() + ' ' + line; if (ctx.measureText(moved).width <= width) { out[k - 2] = prev.join(' '); out[k - 1] = moved; } } }
    });
    return out;
  }
  // Draws one line right-aligned, colouring the highlight word(s) in the accent colour.
  function drawLine(ctx, line, right, y, color, accent, highlight) {
    var words = line.split(' '), x = right, hl = String(highlight || '').trim().split(/\s+/).filter(Boolean);
    ctx.textAlign = 'right';
    var space = ctx.measureText(' ').width;
    words.forEach(function (w) {
      var bare = w.replace(/[؟?!.,،]/g, '');
      ctx.fillStyle = (hl.indexOf(bare) !== -1 || hl.indexOf(bare.replace(/^و/, '')) !== -1) ? accent : color;
      ctx.fillText(w, x, y);
      x -= ctx.measureText(w).width + space;
    });
  }
  async function render(canvas, data) {
    var b = BRAND[data.brand] || BRAND.sono;
    await fonts();
    canvas.width = 1080; canvas.height = 1920;
    var ctx = canvas.getContext('2d');
    // Background: soft brand glow (no photo under the text). Photo = rounded card on top, so faces stay clear
    // of the colour layer (Mohamed 2026-10-12: «الصورة تصغر وتتحرك لفوق علشان تبان الملامح»).
    var bgc = data.brand === 'dr_dina' ? ['#7a2a66', '#5a1b4a', '#2c0b26'] : ['#2a5bd0', '#0F369D', '#0a2a7c'];
    var rg = ctx.createRadialGradient(540, 345, 0, 540, 345, 1300);
    rg.addColorStop(0, bgc[0]); rg.addColorStop(0.55, bgc[1]); rg.addColorStop(1, bgc[2]);
    ctx.fillStyle = rg; ctx.fillRect(0, 0, 1080, 1920);
    if (data.photo) {
      var CX = 43, CY = 150, CW = 994, CH = 800;
      var p = data.photo, scale = Math.max(CW / p.width, CH / p.height) * (Number(data.zoom) || 1), w = p.width * scale, h = p.height * scale;
      var card = document.createElement('canvas'); card.width = CW; card.height = CH;
      var cc = card.getContext('2d');
      cc.drawImage(p, (CW - w) * (Number(data.x == null ? 50 : data.x) / 100), (CH - h) * (Number(data.y == null ? 0 : data.y) / 100), w, h);
      cc.globalCompositeOperation = 'destination-in';
      var fade = cc.createLinearGradient(0, 0, 0, CH); fade.addColorStop(0, '#000'); fade.addColorStop(0.84, '#000'); fade.addColorStop(1, 'rgba(0,0,0,0)');
      cc.fillStyle = fade; cc.fillRect(0, 0, CW, CH);
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 14;
      ctx.beginPath(); ctx.roundRect(CX, CY, CW, CH, 28); ctx.clip(); ctx.drawImage(card, CX, CY); ctx.restore();
    }
    try { var l = await logo(data.brand === 'dr_dina' ? 'dr_dina' : 'sono'); ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 14; ctx.drawImage(l, 60, 70, b.logoW, b.logoW * l.height / l.width); ctx.restore(); } catch (e) { /* logo is decorative */ }
    ctx.direction = 'rtl'; ctx.textBaseline = 'alphabetic';
    var right = 1010, width = 940, bottom = 1590, issues = [];
    // "شوف الفيديو" play hint at the bottom of the text block.
    ctx.font = '700 38px ' + b.font; ctx.fillStyle = '#fff'; ctx.textAlign = 'right';
    ctx.fillStyle = b.tagBg || b.accent; ctx.beginPath(); ctx.arc(right - 32, bottom + 66, 32, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(right - 42, bottom + 50); ctx.lineTo(right - 42, bottom + 82); ctx.lineTo(right - 18, bottom + 66); ctx.closePath(); ctx.fill();
    ctx.fillText('شوف الفيديو', right - 80, bottom + 79);
    var sub = String(data.subtitle || '').trim();
    if (sub) { ctx.font = (data.brand === 'dr_dina' ? '500 ' : '400 ') + '46px ' + b.font; var sl = wrap(ctx, sub, width).slice(0, 2); ctx.fillStyle = b.sub; for (var i = sl.length - 1; i >= 0; i--) { ctx.textAlign = 'right'; ctx.fillText(sl[i], right, bottom); bottom -= 62; } bottom -= 22; }
    var head = String(data.title || '').trim(), size = 104, lines;
    do { ctx.font = b.title + ' ' + size + 'px ' + b.font; lines = wrap(ctx, head, width); if (lines.length <= 3) break; size -= 6; } while (size > 64);
    if (lines.length > 3) issues.push('العنوان طويل — قصّره لثلاث سطور.');
    var lead = size * 1.24;
    for (var j = lines.length - 1; j >= 0; j--) { drawLine(ctx, lines[j], right, bottom, '#fff', b.accent, data.highlight); bottom -= lead; }
    var tag = String(data.tag || '').trim();
    if (tag) { ctx.font = '700 40px ' + b.font; var tw = ctx.measureText(tag).width + 60; bottom -= 10; ctx.fillStyle = b.tagBg || b.accent; ctx.beginPath(); ctx.roundRect(right - tw, bottom - 52, tw, 66, 33); ctx.fill(); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(tag, right - tw / 2, bottom - 6); bottom -= 66; }
    if (bottom < 260) issues.push('النص طالع فوق قوي — قصّر العنوان.');
    canvas.coverIssues = issues;
    return canvas;
  }
  function canEdit(item) {
    var me = window.SSMPDAuth && window.SSMPDAuth.currentAdmin, R = window.SSMPDRoles;
    return !!(me && R && R.canCreateAIDesign && R.canCreateAIDesign(me) && ['sono', 'dr_dina'].indexOf(item.brand) !== -1 && item.content_format === 'video' && ['published', 'scheduled'].indexOf(item.stage) === -1);
  }
  function current(item) { return ((item.cover_settings || {}).cover_image_url) || ''; }
  function mount(slot, item) {
    if (!slot || item.content_format !== 'video') return;
    var box = document.createElement('div'); box.className = 'reel-cover-box'; box.style.cssText = 'margin:10px 0;display:flex;gap:10px;align-items:center;flex-wrap:wrap;';
    var thumb = document.createElement('img'); thumb.alt = 'غلاف الريل'; thumb.style.cssText = 'width:72px;aspect-ratio:9/16;object-fit:cover;border-radius:8px;display:none;';
    box.appendChild(thumb);
    if (current(item) && window.SSMPDDesignFiles) window.SSMPDDesignFiles.resolve(current(item)).then(function (u) { thumb.src = u; thumb.style.display = 'block'; }).catch(function () {});
    if (canEdit(item)) { var btn = document.createElement('button'); btn.className = 'btn ghost'; btn.textContent = current(item) ? '🎬 تعديل غلاف الريل' : '🎬 تصميم غلاف الريل'; btn.onclick = function () { open(item, function (url) { item.cover_settings = Object.assign({}, item.cover_settings || {}, { cover_image_url: url }); window.SSMPDDesignFiles.resolve(url).then(function (u) { thumb.src = u; thumb.style.display = 'block'; }); btn.textContent = '🎬 تعديل غلاف الريل'; }); }; box.appendChild(btn); }
    // Text style on the reel (Mohamed, 2026-10-11): white box that hugs the words, or big headline on the video.
    var styleWrap = document.createElement('label'); styleWrap.style.cssText = 'display:flex;gap:6px;align-items:center;font-size:13px;';
    styleWrap.textContent = 'شكل الكلام على الفيديو:';
    var sel = document.createElement('select'); sel.setAttribute('data-caption-style', '');
    [['', 'Claude يختار'], ['box', 'بوكس أبيض على قد الكلام'], ['headline', 'عنوان كبير على الفيديو']].forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; sel.appendChild(op); });
    sel.value = (item.cover_settings || {}).caption_style || '';
    if (!canEdit(item)) sel.disabled = true;
    sel.onchange = function () {
      var settings = Object.assign({}, item.cover_settings || {}, { caption_style: sel.value });
      sel.disabled = true;
      window.SSMPDDb.updateContentItem(item.id, { cover_settings: settings }).then(function () { item.cover_settings = settings; }).catch(function () { sel.value = (item.cover_settings || {}).caption_style || ''; }).then(function () { sel.disabled = false; });
    };
    styleWrap.appendChild(sel); box.appendChild(styleWrap);
    slot.appendChild(box);
  }
  function open(item, done) {
    var c = item.cover_settings || {}, root = document.createElement('div');
    root.className = 'modal-backdrop'; root.style.zIndex = 10003;
    root.innerHTML = '<div class="modal" dir="rtl" style="max-width:860px;"><div class="modal-head"><h3>غلاف الريل — بستايل غلاف الكاروسيل</h3><button class="modal-close" aria-label="إغلاق">×</button></div>' +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;"><div style="flex:1;min-width:260px;">' +
      '<div class="field"><label>كلمة التصنيف (فوق العنوان)</label><input data-f="tag" maxlength="30" value="' + esc(c.cover_tag || '') + '"></div>' +
      '<div class="field"><label>العنوان</label><textarea data-f="title" rows="2" maxlength="80">' + esc(c.title || item.hook_text || item.title || '') + '</textarea></div>' +
      '<div class="field"><label>الكلمة الملوّنة في العنوان</label><input data-f="highlight" maxlength="40" value="' + esc(c.cover_highlight || '') + '"></div>' +
      '<div class="field"><label>السطر التوضيحي</label><input data-f="subtitle" maxlength="70" value="' + esc(c.cover_subtitle || '') + '"></div>' +
      '<div class="field"><label>الصورة (تقدر تاخد لقطة من الفيديو)</label><input type="file" data-f="photo" accept="image/png,image/jpeg,image/webp"></div>' +
      '<div class="field"><label>مكان الصورة يمين/شمال</label><input type="range" data-f="x" min="0" max="100" value="50"></div>' +
      '<div class="field"><label>مكان الصورة فوق/تحت</label><input type="range" data-f="y" min="0" max="100" value="0"></div>' +
      '<div class="field"><label>تكبير الصورة</label><input type="range" data-f="zoom" min="100" max="220" value="100"></div>' +
      '<p data-issues style="color:var(--c-negative);font-size:12px;"></p>' +
      '<button class="btn" data-save>حفظ الغلاف</button> <span data-status role="status" style="font-size:12px;color:var(--c-muted);"></span></div>' +
      '<div><canvas data-canvas style="width:270px;height:480px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.2);"></canvas></div></div></div>';
    document.body.appendChild(root);
    var canvas = root.querySelector('[data-canvas]'), photo = null, q = function (k) { return root.querySelector('[data-f="' + k + '"]'); };
    function data() { return { brand: item.brand, tag: q('tag').value, title: q('title').value, highlight: q('highlight').value, subtitle: q('subtitle').value, photo: photo, x: q('x').value, y: q('y').value, zoom: q('zoom').value / 100 }; }
    var pending = null;
    function draw() { pending = render(canvas, data()).then(function () { root.querySelector('[data-issues]').textContent = (canvas.coverIssues || []).join(' '); }).catch(function (e) { root.querySelector('[data-issues]').textContent = e.message; }); }
    ['tag', 'title', 'highlight', 'subtitle', 'x', 'y', 'zoom'].forEach(function (k) { q(k).oninput = draw; });
    q('photo').onchange = function () { var f = q('photo').files[0]; if (!f) return; var u = URL.createObjectURL(f); image(u).then(function (i) { photo = i; draw(); }); };
    root.querySelector('.modal-close').onclick = function () { root.remove(); };
    root.querySelector('[data-save]').onclick = async function () {
      var btn = this, status = root.querySelector('[data-status]');
      btn.disabled = true; status.textContent = 'جاري الحفظ…';
      try {
        await pending; await render(canvas, data());
        if (!q('title').value.trim()) throw new Error('اكتب عنوان الغلاف');
        var blob = await new Promise(function (ok) { canvas.toBlob(ok, 'image/png'); });
        var key = item.id + '/' + crypto.randomUUID() + '/reel-cover.png', client = window.SSMPDDb.client;
        var up = await client.storage.from('content-designs').upload(key, blob, { contentType: 'image/png', upsert: false });
        if (up.error) throw new Error(/row-level security/i.test(up.error.message) ? 'صلاحية حفظ الغلاف لسه مش متفعّلة في قاعدة البيانات (محتاجة تشغيل سكريبت reel-cover في Supabase مرة واحدة).' : 'تعذر حفظ الغلاف. ' + up.error.message);
        var url = window.SSMPD_CONFIG.supabase.url.replace(/\/+$/, '') + '/storage/v1/object/authenticated/content-designs/' + key;
        var settings = Object.assign({}, item.cover_settings || {}, { cover_image_url: url, cover_tag: q('tag').value.trim(), cover_highlight: q('highlight').value.trim(), cover_subtitle: q('subtitle').value.trim(), title: q('title').value.trim() });
        await window.SSMPDDb.updateContentItem(item.id, { cover_settings: settings });
        status.textContent = 'اتحفظ الغلاف ✓'; if (done) done(url); setTimeout(function () { root.remove(); }, 600);
      } catch (e) { status.textContent = 'خطأ: ' + e.message; btn.disabled = false; }
    };
    draw();
  }
  window.SSMPDReelCover = { render: render, mount: mount, open: open, canEdit: canEdit };
})();
