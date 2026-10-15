/* لقطات فيديو Gemini (Veo): توليد آلي بميزانية شهرية بالجنيه، والناتج بيتحفظ على الدرايف (ماتيريال / لقطات Gemini). */
(function () {
  'use strict';
  var MODELS = { 'veo-3.1-lite-generate-preview': 'Lite — الأرخص', 'veo-3.1-fast-generate-preview': 'Fast — جودة جيدة', 'veo-3.1-generate-preview': 'Standard — الأعلى جودة' };
  var STATUS = { queued: ['في الانتظار', 'pending'], submitted: ['بتتولّد…', 'pending'], done: ['جاهزة', 'approved'], failed: ['فشلت', 'rejected'], skipped_budget: ['الحد الشهري خلص', 'rejected'], cancelled: ['ملغية', 'rejected'] };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { return Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  function when(v) { return v ? new Date(v).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : ''; }
  function driveId(url) { var m = /\/d\/([\w-]+)/.exec(url || '') || /[?&]id=([\w-]+)/.exec(url || ''); return m ? m[1] : null; }

  function mount(slot, item) {
    if (!slot || !item || item.content_format !== 'video' || !window.SSMPDDb || !window.SSMPDDb.aiClipOverview) return;
    var state = { data: null, confirm: false, busy: false, settings: false, error: '', preview: '' }, timer = null;
    slot.innerHTML = '<section class="ai-clips" data-ai-clips><p class="ai-clips-hint">جاري تحميل اللقطات…</p></section>';
    var root = slot.firstChild;

    function load() {
      if (!root.isConnected) { clearInterval(timer); return Promise.resolve(); }
      return window.SSMPDDb.aiClipOverview(item.id).then(function (d) { state.data = d; draw(); }, function () {
        root.innerHTML = '';  // الشخص ده مش مسموح له بالميزة أو الجداول لسه ما اتفعلتش — منظهرش حاجة
        clearInterval(timer);
      });
    }
    function busyJobs() { return state.data && state.data.jobs.some(function (j) { return j.status === 'queued' || j.status === 'submitted'; }); }
    function jobHtml(j) {
      var st = STATUS[j.status] || [j.status, 'pending'], id = driveId(j.drive_url);
      var html = '<li class="ai-clip-job"><div class="ai-clip-row"><span class="status-pill ' + st[1] + '">' + esc(st[0]) + '</span> <small>' + esc(when(j.created_at)) + (j.source === 'auto' ? ' · تلقائي' : '') + (j.est_cost_usd ? ' · ≈ ' + num(j.est_cost_usd * j.usd_to_egp_at_submit) + ' ج.م' : '') + '</small>';
      if (j.status === 'queued') html += ' <button class="btn-link" data-cancel="' + j.id + '">إلغاء</button>';
      if (j.status === 'done' && id) html += ' <button class="btn ghost sm" data-preview="' + esc(id) + '">معاينة</button> <a class="btn ghost sm" href="' + esc(j.drive_url) + '" target="_blank" rel="noopener">فتح على الدرايف</a>';
      html += '</div>';
      if (j.error && j.status !== 'done') html += '<p class="ai-clips-error">' + esc(j.error) + '</p>';
      if (state.preview && j.status === 'done' && id === state.preview) html += '<iframe class="ai-clip-frame" src="https://drive.google.com/file/d/' + esc(id) + '/preview" allow="autoplay" loading="lazy"></iframe>';
      return html + '</li>';
    }
    function settingsHtml(s) {
      return '<form class="ai-clips-settings" data-settings><label class="inv-check"><input type="checkbox" name="enabled" ' + (s.enabled ? 'checked' : '') + '> تفعيل توليد اللقطات</label>' +
        '<label class="inv-check"><input type="checkbox" name="auto" ' + (s.auto_enqueue ? 'checked' : '') + '> توليد لقطة تلقائياً لما مادة فيديو تدخل مرحلة التصميم</label>' +
        '<label>الحد الشهري (ج.م)<input name="budget" type="number" min="0" step="10" value="' + esc(s.monthly_budget_egp) + '"></label>' +
        '<label>سعر الدولار (ج.م)<input name="rate" type="number" min="1" step="0.05" value="' + esc(s.usd_to_egp) + '"></label>' +
        '<label>النموذج<select name="model">' + Object.keys(MODELS).map(function (k) { return '<option value="' + k + '" ' + (s.default_model === k ? 'selected' : '') + '>' + MODELS[k] + '</option>'; }).join('') + '</select></label>' +
        '<label>مدة اللقطة<select name="seconds">' + [4, 6, 8].map(function (n) { return '<option ' + (Number(s.clip_seconds) === n ? 'selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' +
        '<button class="btn btn-primary sm">حفظ الإعدادات</button></form>';
    }
    function draw() {
      var d = state.data; if (!d) return;
      var s = d.settings, html = '<div class="ai-clips-head"><h4>🎬 لقطات Gemini</h4>' + (d.is_super ? '<button class="btn-link" data-gear>⚙ الإعدادات</button>' : '') + '</div>' +
        '<p class="ai-clips-hint">استخدمت ' + num(d.spent_egp) + ' من ' + num(s.monthly_budget_egp) + ' ج.م هذا الشهر (الباقي ' + num(d.remaining_egp) + ' ج.م) · اللقطة الواحدة حوالي ' + num(d.est_clip_egp) + ' ج.م · لو الحد خلص التوليد بيقف والشغل بيكمل بالطريقة المعتادة.</p>';
      if (!s.enabled) html += '<p class="ai-clips-error">التوليد متوقف من الإعدادات.</p>';
      if (state.settings && d.is_super) html += settingsHtml(s);
      if (d.can_request && s.enabled) {
        html += '<textarea class="ai-clips-prompt" rows="2" maxlength="600" placeholder="وصف اللقطة (اختياري). لو سبته فاضي النظام بيكتب وصف مناسب للمادة لوحده."></textarea>';
        html += state.confirm
          ? '<div class="ai-clips-confirm">هيتحسب عليك حوالي ' + num(d.est_clip_egp) + ' ج.م. <button class="btn btn-primary sm" data-go ' + (state.busy ? 'disabled' : '') + '>تأكيد التوليد</button> <button class="btn ghost sm" data-no>إلغاء</button></div>'
          : '<button class="btn sm" data-ask ' + (d.remaining_egp < d.est_clip_egp ? 'disabled title="الحد الشهري خلص"' : '') + '>ولّد لقطة (≈ ' + num(d.est_clip_egp) + ' ج.م)</button>';
      }
      if (state.error) html += '<p class="ai-clips-error">' + esc(state.error) + '</p>';
      html += d.jobs.length ? '<ul class="ai-clips-list">' + d.jobs.map(jobHtml).join('') + '</ul>' : '<p class="ai-clips-hint">لسه مفيش لقطات لهذه المادة.</p>';
      var keep = root.querySelector('.ai-clips-prompt'), typed = keep ? keep.value : '';
      root.innerHTML = html;
      var ta = root.querySelector('.ai-clips-prompt'); if (ta) ta.value = typed;
      wire();
      clearInterval(timer);
      if (busyJobs()) timer = setInterval(load, 20000);
    }
    function wire() {
      var g = root.querySelector('[data-gear]'); if (g) g.onclick = function () { state.settings = !state.settings; draw(); };
      var ask = root.querySelector('[data-ask]'); if (ask) ask.onclick = function () { state.confirm = true; state.error = ''; draw(); };
      var no = root.querySelector('[data-no]'); if (no) no.onclick = function () { state.confirm = false; draw(); };
      var go = root.querySelector('[data-go]'); if (go) go.onclick = function () {
        var p = root.querySelector('.ai-clips-prompt'); state.busy = true; draw();
        window.SSMPDDb.aiClipRequest(item.id, p && p.value).then(function () { state.confirm = false; state.busy = false; return load(); }).catch(function (e) { state.busy = false; state.confirm = false; state.error = (e && e.message) || 'تعذر الطلب'; draw(); });
      };
      root.querySelectorAll('[data-cancel]').forEach(function (b) { b.onclick = function () { window.SSMPDDb.aiClipCancel(b.dataset.cancel).then(load).catch(function (e) { state.error = e.message; draw(); }); }; });
      root.querySelectorAll('[data-preview]').forEach(function (b) { b.onclick = function () { state.preview = state.preview === b.dataset.preview ? '' : b.dataset.preview; draw(); }; });
      var f = root.querySelector('[data-settings]'); if (f) f.onsubmit = function (ev) {
        ev.preventDefault();
        window.SSMPDDb.aiClipSaveSettings({ enabled: f.enabled.checked, auto: f.auto.checked, budget: Number(f.budget.value), rate: Number(f.rate.value), model: f.model.value, seconds: Number(f.seconds.value) })
          .then(function () { state.settings = false; return load(); }).catch(function (e) { state.error = (e && e.message) || 'تعذر الحفظ'; draw(); });
      };
    }
    load();
  }
  window.SSMPDAiClips = { mount: mount };
})();
