/* Ordered image scenes: preserve the complete script and require one image per scene. */
(function () {
  'use strict';
  var motions = { pan_left: 'تحريك لليسار', pan_right: 'تحريك لليمين', zoom_in: 'تقريب', zoom_out: 'إبعاد' };
  function normalize(text) { return String(text || '').trim().replace(/\s+/g, ' '); }
  function minimum(item) { return Math.max(3, Math.ceil(Number(item.target_duration_min_seconds || 0) / 8)); }
  function split(item) {
    var text = normalize(item.script_text), words = text ? text.split(' ') : [];
    var count = Math.min(words.length, Math.max(minimum(item), Math.ceil(Number(item.target_duration_max_seconds || 0) / 6), Math.ceil(words.length / 24)));
    if (count < minimum(item) || count > 20) throw new Error('راجع السكريبت والمدة. نحتاج من ' + minimum(item) + ' إلى 20 مشهدًا.');
    var scenes = [], cursor = 0, movement = Object.keys(motions);
    for (var i = 0; i < count; i++) {
      var remaining = count - i, size = Math.ceil((words.length - cursor) / remaining), end = cursor + size;
      if (remaining > 1) {
        // Prefer a sentence boundary near the balanced split, keeping every word.
        for (var delta = 0; delta <= 3; delta++) {
          var found = [end + delta, end - delta].find(function (n) { return n > cursor && n - cursor <= 35 && n <= words.length - remaining + 1 && /[.!?؟؛،:]$/.test(words[n - 1]); });
          if (found) { end = found; break; }
        }
      } else end = words.length;
      if (end - cursor > 35) throw new Error('السكريبت طويل. قلّل النص أو قسّمه لفيديوهين.');
      scenes.push({ text: words.slice(cursor, end).join(' '), asset_id: null, motion: movement[i % movement.length] });
      cursor = end;
    }
    return { version: 1, source_script: item.script_text, transition: 'fade', scenes: scenes };
  }
  function problem(item, board, assets) {
    if (!board || !Array.isArray(board.scenes)) return 'قسّم السكريبت إلى مشاهد.';
    if (normalize(board.source_script) !== normalize(item.script_text) || normalize(board.scenes.map(function (s) { return s.text; }).join(' ')) !== normalize(item.script_text)) return 'السكريبت اتغير. أعد تقسيم المشاهد.';
    if (board.scenes.length < minimum(item) || board.scenes.length > 20) return 'عدد المشاهد لا يناسب مدة الفيديو. أعد التقسيم.';
    var used = new Set(), missing = 0;
    for (var scene of board.scenes) {
      if (!normalize(scene.text) || normalize(scene.text).split(' ').length > 35 || !motions[scene.motion]) return 'راجع نص المشهد وحركته.';
      var asset = assets.find(function (a) { return a.id === scene.asset_id && a.asset_type === 'image' && a.asset_role !== 'legacy_logo'; });
      if (!asset) missing++;
      else { if (used.has(asset.id)) return 'استخدم صورة مختلفة لكل مشهد.'; used.add(asset.id); }
    }
    return missing ? 'ارفع صور المشاهد المتبقية وعددها ' + missing + '.' : '';
  }
  function esc(value) { return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function mount(host, item, initialAssets, changed) {
    var assets = initialAssets.slice(), board = item.video_storyboard ? JSON.parse(JSON.stringify(item.video_storyboard)) : null;
    var dirty = false, busy = false, message = '';
    function ready() { return !busy && !dirty && !problem(item, board, assets); }
    function signal() { changed(ready()); }
    function draw() {
      if (!host.isConnected) return;
      var invalid = problem(item, board, assets);
      host.innerHTML = '<div class="section" style="margin:10px 0;"><h4>مشاهد الفيديو من الصور</h4>' +
        '<p>صورة مختلفة لكل مقطع. العامل يحرك الصورة كاملة ويحافظ على ترتيب السكريبت. الفيديو رأسي 9:16 والقص من المنتصف.</p>' +
        '<p style="font-size:12px;">المدد تقديرية حسب عدد كلمات كل مقطع، وتتوزع على مدة الصوت عند الإنتاج.</p>' +
        '<button type="button" class="btn ghost" data-split>' + (board ? 'إعادة تقسيم السكريبت' : 'تقسيم السكريبت إلى مشاهد') + '</button>' +
        (board ? '<div class="field" style="margin-top:12px;"><label>الانتقال بين الصور<select data-transition><option value="fade">تلاشي</option><option value="slide">انزلاق</option><option value="none">قطع مباشر</option></select></label></div><div data-scenes></div><button type="button" class="btn" data-save>حفظ إعدادات المشاهد</button>' : '') +
        '<p role="status" data-feedback>' + esc(message || (dirty ? 'احفظ تعديلات المشاهد قبل الإنتاج.' : invalid || 'كل المشاهد مكتملة وجاهزة للإرسال.')) + '</p></div>';
      host.querySelector('[data-split]').onclick = async function () {
        if (board && board.scenes.some(function (s) { return s.asset_id; }) && !window.confirm('إعادة التقسيم هتلغي ربط الصور بالمشاهد الحالية. تكمل؟')) return;
        try { board = split(item); dirty = true; message = ''; draw(); await save(); } catch (e) { message = e.message; draw(); }
      };
      if (board) {
        var transition = host.querySelector('[data-transition]'); transition.value = board.transition;
        transition.onchange = function () { board.transition = transition.value; dirty = true; message = ''; signal(); host.querySelector('[data-feedback]').textContent = 'احفظ تعديلات المشاهد قبل الإنتاج.'; };
        var totalWords = board.scenes.reduce(function (sum, s) { return sum + normalize(s.text).split(' ').length; }, 0);
        var duration = Number(item.target_duration_max_seconds || 30), cursor = 0;
        board.scenes.forEach(function (scene, index) {
          var seconds = duration * normalize(scene.text).split(' ').length / totalWords;
          var card = document.createElement('div'); card.className = 'section'; card.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;margin:12px 0;';
          var asset = assets.find(function (a) { return a.id === scene.asset_id; });
          card.innerHTML = '<div style="flex:1;min-width:200px;"><h4>المشهد ' + (index + 1) + ' <small>(' + cursor.toFixed(1) + '–' + (cursor + seconds).toFixed(1) + ' ث تقريبًا)</small></h4><p style="white-space:pre-wrap;">' + esc(scene.text) + '</p>' +
            '<label>حركة الصورة<select data-motion>' + Object.keys(motions).map(function (key) { return '<option value="' + key + '">' + motions[key] + '</option>'; }).join('') + '</select></label>' +
            '<label style="display:block;margin-top:10px;">' + (asset ? 'استبدال صورة المشهد' : 'ارفع صورة مناسبة لهذا المقطع') + '<input type="file" data-image accept="image/jpeg,image/png,image/webp"></label><p>' + esc(asset ? asset.file_name : 'صورة مطلوبة') + '</p></div>' +
            '<img data-preview alt="معاينة قص صورة المشهد" style="width:108px;height:192px;object-fit:cover;border-radius:8px;" hidden>';
          cursor += seconds;
          host.querySelector('[data-scenes]').appendChild(card);
          var motion = card.querySelector('[data-motion]'); motion.value = scene.motion;
          motion.onchange = function () { scene.motion = motion.value; dirty = true; message = ''; signal(); host.querySelector('[data-feedback]').textContent = 'احفظ تعديلات المشاهد قبل الإنتاج.'; };
          if (asset) window.SSMPDDb.getVideoAssetSignedUrl(asset.storage_path).then(function (url) { if (!card.isConnected) return; var img = card.querySelector('[data-preview]'); img.src = url; img.hidden = false; }).catch(function () {});
          card.querySelector('[data-image]').onchange = async function () {
            var file = this.files[0]; if (!file) return;
            if (!['image/jpeg','image/png','image/webp'].includes(file.type) || !file.size || file.size > 15 * 1024 * 1024) { message = 'اختر JPG أو PNG أو WebP بحجم حتى 15 ميجابايت.'; draw(); return; }
            busy = true; message = 'جارٍ رفع صورة المشهد ' + (index + 1); draw();
            try {
              var bytes = await file.arrayBuffer();
              var hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(function (n) { return n.toString(16).padStart(2, '0'); }).join('');
              if (board.scenes.some(function (s, i) { return i !== index && s.image_sha256 === hash; })) throw new Error('الصورة دي مستخدمة في مشهد آخر. اختر صورة مختلفة.');
              var row = await window.SSMPDDb.uploadVideoAsset(item.id, window.SSMPDAuth.currentAdmin.id, 'image', file);
              assets.push(row); scene.asset_id = row.id; scene.image_sha256 = hash; dirty = true;
              await persist(); message = 'تم حفظ صورة المشهد ' + (index + 1);
            } catch (e) { message = e.message; } finally { busy = false; draw(); }
          };
        });
        host.querySelector('[data-save]').onclick = save;
      }
      host.querySelectorAll('button,input,select').forEach(function (control) { control.disabled = busy; });
      signal();
    }
    async function persist() {
      var result = await window.SSMPDDb.saveVideoStoryboard(item.id, board);
      item.video_storyboard = result.video_storyboard; item.video_media_mode = result.video_media_mode; dirty = false;
    }
    async function save() {
      if (busy) return; busy = true; message = 'جارٍ الحفظ…'; draw();
      try { await persist(); message = 'تم حفظ إعدادات المشاهد.'; } catch (e) { message = /save_video_storyboard|video_storyboard/.test(e.message) ? 'يلزم تشغيل تحديث قاعدة البيانات الخاص بمشاهد الصور أولًا.' : e.message; }
      finally { busy = false; draw(); }
    }
    draw();
    return { ready: ready };
  }
  window.SSMPDVideoStoryboard = { split: split, problem: problem, mount: mount };
})();
