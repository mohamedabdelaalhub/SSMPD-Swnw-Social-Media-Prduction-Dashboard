/* SSMPD — «مساعد إنستنكت» (Phase 1): ملاحظات (مسودة ← معتمدة ← منشورة) + أسئلة الموظفين في محادثات بتفتح من تحت زي ماسنجر.
   كل القراءة والكتابة عن طريق RPCs بتتأكد من الدور على السيرفر (supabase/migrations/20261124200000_instinct_assistant.sql).
   الأزرار بتظهر بس للدور اللي السيرفر هيقبل منه الإجراء. */
(function (w) {
  'use strict';
  var GROUPS = { all: 'كل الموظفين', reception: 'الاستقبال', customer_service: 'خدمة العملاء', content: 'فريق المحتوى', finance: 'الحسابات', management: 'الإدارة' };
  var STATUS = { draft: 'مسودة', approved: 'معتمدة', published: 'منشورة' };
  var ACTIONS = { note_create: 'كتب مسودة', note_edit: 'عدّل مسودة', note_approve: 'اعتمد ملاحظة', note_publish: 'نشر ملاحظة', question: 'سأل', reply: 'رد' };
  var WARNING = 'ممنوع كتابة اسم أو رقم أو بيانات مريض';
  var AI_LABEL = 'رد من مساعد آلي (إنستنكت) — مش تعليمات رسمية من الإدارة';
  var st = { el: null, ctx: null, notes: [], threads: [], notifs: [], thread: null, editing: null, chatOpen: false };
  var badgeTimer = null, lastUnread = null;

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(iso) { if (!iso) return ''; try { return new Date(iso).toLocaleString('ar-EG-u-nu-latn', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return String(iso); } }
  function client() { return w.SSMPDDb && w.SSMPDDb.client; }
  function rpc(name, args) {
    var c = client(); if (!c || typeof c.rpc !== 'function') return Promise.reject(new Error('الاتصال بالسيرفر مش جاهز'));
    return Promise.resolve(c.rpc(name, args || {})).then(function (r) { if (r && r.error) throw new Error(r.error.message || 'تعذر تنفيذ الطلب'); return r ? r.data : null; });
  }
  // نفس فحص السيرفر (instinct_patient_data_reason) — للتنبيه الفوري بس؛ السيرفر هو اللي بيرفض فعلاً
  function patientReason(text) {
    var t = String(text || '').replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); }).replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); });
    var joined = t.replace(/([0-9+])[\s./()_-]+(?=[0-9])/g, '$1');
    if (/(01[0125][0-9]{8}|201[0125][0-9]{8})/.test(joined)) return 'ممنوع كتابة رقم موبايل في مساعد إنستنكت (ممكن يكون رقم مريض). امسح الرقم واكتب سؤالك من غير بيانات مريض.';
    if (/p[\s_-]*[0-9]{4}[\s_-]*[0-9]{4,6}/i.test(t)) return 'ممنوع كتابة كود ملف مريض (P-…) في مساعد إنستنكت. امسح الكود واكتب سؤالك من غير بيانات مريض.';
    if (/[23][0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])[0-9]{7}/.test(joined)) return 'ممنوع كتابة رقم قومي في مساعد إنستنكت. امسح الرقم واكتب سؤالك من غير بيانات مريض.';
    if (/(مريض|مريضة|المريض|المريضه|العيان|ملف)/.test(t) && /[0-9]{5,}/.test(joined)) return 'ممنوع كتابة رقم مريض أو رقم ملف في مساعد إنستنكت. امسح الرقم واكتب سؤالك من غير بيانات مريض.';
    return null;
  }
  function q(sel) { return st.el ? st.el.querySelector(sel) : null; }
  function showError(msg) { var b = q('[data-ins-error]'); if (b) { b.textContent = msg || ''; b.hidden = !msg; } }

  function noteCard(n) {
    var c = st.ctx, btns = '';
    var canEdit = n.status === 'draft' && c.can_decide;
    if (canEdit) btns += '<button type="button" class="btn ghost sm" data-ins-edit="' + esc(n.id) + '">تعديل</button>';
    if (c.can_decide && n.status === 'draft') btns += '<button type="button" class="btn sm" data-ins-approve="' + esc(n.id) + '">اعتماد</button>';
    if (c.can_decide && n.status !== 'published') btns += '<button type="button" class="btn primary sm" data-ins-publish="' + esc(n.id) + '">نشر</button>';
    var date = n.published_at || n.updated_at || n.created_at;
    return '<article class="ins-note ins-' + esc(n.status) + '" data-ins-note="' + esc(n.id) + '"><header><h4>' + esc(n.title) + '</h4>' +
      '<span class="ins-chip ins-chip-' + esc(n.status) + '">' + esc(STATUS[n.status] || n.status) + '</span></header>' +
      '<div class="ins-meta">' + esc(fmt(date)) + ' · لـ ' + esc(GROUPS[n.target_role] || n.target_role) + '</div>' +
      '<div class="ins-body">' + esc(n.body) + '</div>' + (btns ? '<div class="ins-actions">' + btns + '</div>' : '') + '</article>';
  }
  function threadRow(t) {
    return '<button type="button" class="ins-thread" data-ins-thread="' + esc(t.id) + '"><b>' + esc(t.first_question || 'سؤال') + '</b>' +
      '<small>' + (st.ctx.sees_all_threads ? esc(t.staff_name) + ' · ' : '') + esc(fmt(t.last_message_at)) + ' · ' + (t.answered ? 'اترد عليه' : 'مستني رد') + '</small></button>';
  }
  function notifRow(n) {
    return '<div class="ins-notif' + (n.read ? ' read' : '') + '"' + (n.entity_type === 'thread' ? ' data-ins-open-thread="' + esc(n.entity_id) + '" role="button" tabindex="0"' : '') + '>' +
      esc(n.message) + '<small>' + esc(fmt(n.created_at)) + '</small></div>';
  }
  function noteForm() {
    var n = st.editing || {}, opts = Object.keys(GROUPS).map(function (k) { return '<option value="' + k + '"' + ((n.target_role || 'all') === k ? ' selected' : '') + '>' + esc(GROUPS[k]) + '</option>'; }).join('');
    return '<form class="ins-note-form" data-ins-form><label>العنوان<input data-ins-title maxlength="200" value="' + esc(n.title || '') + '"></label>' +
      '<label>لمين<select data-ins-target>' + opts + '</select></label><label>النص<textarea data-ins-body maxlength="4000" rows="5">' + esc(n.body || '') + '</textarea></label>' +
      '<div class="ins-warning" role="note">' + WARNING + '</div><div class="ins-actions"><button type="submit" class="btn primary sm" data-ins-save>حفظ المسودة</button>' +
      '<button type="button" class="btn ghost sm" data-ins-cancel>إلغاء</button></div></form>';
  }

  function draw() {
    var c = st.ctx, el = st.el; if (!el || !c) return;
    var tools = '';
    if (c.can_ask) tools += '<button type="button" class="btn primary" data-ins-ask>اسأل إنستنكت</button>';
    if (c.can_draft) tools += '<button type="button" class="btn" data-ins-new-note>ملاحظة جديدة</button>';
    tools += '<button type="button" class="btn ghost" data-ins-refresh>تحديث</button>';
    el.innerHTML = '<section class="ins-page" data-ins-root><header class="ins-head"><div><h2>مساعد إنستنكت</h2><p>دليل للشغل على الداشبورد: ملاحظات معتمدة من المالك وأسئلة بترد عليها إنستنكت.</p></div>' +
      '<span class="ins-badge" data-ins-unread' + (c.unread ? '' : ' hidden') + '>' + esc(c.unread) + '</span></header>' +
      '<div class="ins-error" data-ins-error role="alert" hidden></div><div class="ins-tools">' + tools + '</div>' +
      (st.editing ? noteForm() : '') +
      '<section class="ins-block"><h3>الملاحظات</h3><div data-ins-notes>' + (st.notes.length ? st.notes.map(noteCard).join('') : '<p class="ins-empty">مفيش ملاحظات لسه.</p>') + '</div></section>' +
      '<section class="ins-block"><h3>' + (c.sees_all_threads ? 'كل الأسئلة' : 'أسئلتي') + '</h3><div data-ins-threads>' + (st.threads.length ? st.threads.map(threadRow).join('') : '<p class="ins-empty">مفيش أسئلة لسه.</p>') + '</div></section>' +
      '<section class="ins-block"><h3>الإشعارات</h3>' + (st.notifs.some(function (n) { return !n.read; }) ? '<button type="button" class="btn ghost sm" data-ins-read-all>تحديد الكل كمقروء</button>' : '') +
      '<div data-ins-notifs>' + (st.notifs.length ? st.notifs.map(notifRow).join('') : '<p class="ins-empty">مفيش إشعارات.</p>') + '</div></section>' +
      (c.sees_all_threads ? '<details class="ins-block" data-ins-profiles><summary>الوصف المخفي للموظفين</summary><div data-ins-profiles-body></div></details>' : '') +
      (c.owner && (c.ai_accounts || []).length ? '<section class="ins-block" data-ins-accounts><h3>حساب إنستنكت</h3>' + c.ai_accounts.map(function (a) {
        return '<div class="ins-account"><b>' + esc(a.name) + '</b> <span class="ins-chip ins-chip-' + (a.active ? 'published' : 'draft') + '">' + (a.active ? 'شغال' : 'موقوف') + '</span> ' +
          '<button type="button" class="btn ' + (a.active ? 'danger' : 'primary') + ' sm" data-ins-kill="' + esc(a.id) + '" data-active="' + (a.active ? '1' : '') + '">' + (a.active ? 'إيقاف الحساب' : 'تشغيل الحساب') + '</button></div>';
      }).join('') + '</section>' : '') +
      (c.owner ? '<details class="ins-block" data-ins-audit><summary>سجل التدقيق</summary><div data-ins-audit-body></div></details>' : '') + '</section>' + chatHtml();
    wire();
  }
  function chatHtml() {
    var c = st.ctx, t = st.thread, mine = !t || (t.staff_id && t.staff_id === c.id) || t.mine;
    var canWrite = t ? (c.can_reply || (c.can_ask && mine)) : c.can_ask;
    var msgs = t ? t.messages.map(function (m) {
        var ai = m.author_kind === 'instinct', tools = '';
        if (ai && c.can_hide) tools = '<button type="button" class="btn ghost sm" data-ins-hide="' + esc(m.id) + '" data-hidden="' + (m.hidden ? '1' : '') + '">' + (m.hidden ? 'إظهار الرد' : 'إخفاء الرد') + '</button>';
        return '<div class="ins-msg ' + (ai ? 'them' : 'me') + (m.hidden ? ' hidden-reply' : '') + '">' + (ai ? '<em class="ins-ai-label">' + AI_LABEL + '</em>' : '') +
          (m.hidden ? '<em class="ins-hidden-label">مخفي عن الموظف</em>' : '') + '<div class="ins-text">' + esc(m.body) + '</div><small>' + esc(fmt(m.created_at)) + '</small>' + tools + '</div>';
      }).join('')
      : '<div class="ins-msg them"><div>اكتب سؤالك عن أي خطوة في الداشبورد، وإنستنكت هترد عليك هنا.</div></div>';
    return '<aside class="ins-chat" data-ins-chat' + (st.chatOpen ? '' : ' hidden') + ' aria-label="محادثة مساعد إنستنكت"><div class="ins-chat-head"><b>' + (t ? (c.sees_all_threads ? esc(t.staff_name) : 'سؤالك') : 'سؤال جديد') + '</b>' +
      '<button type="button" class="ins-x" data-ins-close aria-label="إغلاق">×</button></div><div class="ins-chat-msgs" data-ins-msgs>' + msgs + '</div>' +
      (canWrite ? '<div class="ins-chat-form"><div class="ins-warning" role="note" data-ins-warning>' + WARNING + '</div><textarea data-ins-input maxlength="' + (c.can_reply ? 4000 : 2000) + '" placeholder="' + (c.can_reply ? 'اكتب الرد…' : 'اكتب سؤالك…') + '"></textarea>' +
        '<div class="ins-chat-error" data-ins-chat-error role="alert" hidden></div><button type="button" class="btn primary sm" data-ins-send>' + (c.can_reply ? 'إرسال الرد' : 'إرسال') + '</button></div>' : '<div class="ins-chat-ro">عرض فقط</div>') + '</aside>';
  }
  function chatError(msg) { var b = q('[data-ins-chat-error]'); if (b) { b.textContent = msg || ''; b.hidden = !msg; } }

  function wire() {
    var el = st.el;
    el.querySelectorAll('[data-ins-ask]').forEach(function (b) { b.onclick = function () { st.thread = null; st.chatOpen = true; draw(); focusInput(); }; });
    el.querySelectorAll('[data-ins-new-note]').forEach(function (b) { b.onclick = function () { st.editing = { target_role: 'all' }; draw(); }; });
    el.querySelectorAll('[data-ins-refresh]').forEach(function (b) { b.onclick = function () { load(); }; });
    el.querySelectorAll('[data-ins-edit]').forEach(function (b) { b.onclick = function () { st.editing = st.notes.find(function (n) { return n.id === b.getAttribute('data-ins-edit'); }) || null; draw(); }; });
    el.querySelectorAll('[data-ins-approve]').forEach(function (b) { b.onclick = function () { decide(b, b.getAttribute('data-ins-approve'), 'approve'); }; });
    el.querySelectorAll('[data-ins-publish]').forEach(function (b) { b.onclick = function () { decide(b, b.getAttribute('data-ins-publish'), 'publish'); }; });
    el.querySelectorAll('[data-ins-thread],[data-ins-open-thread]').forEach(function (b) {
      var go = function () { openThread(b.getAttribute('data-ins-thread') || b.getAttribute('data-ins-open-thread')); };
      b.onclick = go; b.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    });
    el.querySelectorAll('[data-ins-read-all]').forEach(function (b) { b.onclick = function () { b.disabled = true; rpc('instinct_notifications_read', { p_ids: null }).then(load).catch(function (e) { b.disabled = false; showError(e.message); }); }; });
    var form = el.querySelector('[data-ins-form]');
    if (form) {
      form.onsubmit = function (e) { e.preventDefault(); saveNote(form); };
      form.querySelector('[data-ins-cancel]').onclick = function () { st.editing = null; draw(); };
    }
    var prof = el.querySelector('[data-ins-profiles]');
    if (prof) prof.addEventListener('toggle', function () { if (!prof.open || prof.dataset.loaded) return; prof.dataset.loaded = '1'; rpc('instinct_staff_profiles').then(function (rows) {
      el.querySelector('[data-ins-profiles-body]').innerHTML = (rows || []).map(function (p) { return '<div class="ins-profile">' + esc(p.description) + '</div>'; }).join('') || '<p class="ins-empty">مفيش موظفين.</p>';
    }).catch(function (e) { prof.dataset.loaded = ''; showError(e.message); }); });
    var aud = el.querySelector('[data-ins-audit]');
    if (aud) aud.addEventListener('toggle', function () { if (!aud.open || aud.dataset.loaded) return; aud.dataset.loaded = '1'; rpc('instinct_audit_list', { p_limit: 100 }).then(function (rows) {
      el.querySelector('[data-ins-audit-body]').innerHTML = (rows || []).map(function (a) { return '<div class="ins-audit-row">' + esc(fmt(a.at)) + ' — ' + esc(a.actor_name) + ' ' + esc(ACTIONS[a.action] || a.action) + (a.detail && a.detail.title ? ': ' + esc(a.detail.title) : '') + '</div>'; }).join('') || '<p class="ins-empty">السجل فاضي.</p>';
    }).catch(function (e) { aud.dataset.loaded = ''; showError(e.message); }); });
    el.querySelectorAll('[data-ins-kill]').forEach(function (b) { b.onclick = function () {
      var on = !!b.getAttribute('data-active');
      if (on && w.confirm && !w.confirm('إيقاف حساب إنستنكت؟ مش هيقدر يدخل أو يكتب أي حاجة لحد ما تشغّله تاني.')) return;
      b.disabled = true; rpc('instinct_set_ai_active', { p_admin: b.getAttribute('data-ins-kill'), p_active: !on }).then(load).catch(function (e) { b.disabled = false; showError(e.message); });
    }; });
    el.querySelectorAll('[data-ins-hide]').forEach(function (b) { b.onclick = function () {
      b.disabled = true; var tid = st.thread && st.thread.id;
      rpc('instinct_message_hide', { p_message: b.getAttribute('data-ins-hide'), p_hidden: !b.getAttribute('data-hidden') }).then(function () { return tid ? openThread(tid) : load(); })
        .catch(function (e) { b.disabled = false; chatError(e.message); });
    }; });
    var chat = el.querySelector('[data-ins-chat]');
    if (chat) {
      chat.querySelector('[data-ins-close]').onclick = function () { st.chatOpen = false; chat.hidden = true; };
      var send = chat.querySelector('[data-ins-send]'), input = chat.querySelector('[data-ins-input]');
      if (send) send.onclick = function () { sendMessage(send, input); };
      if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(send, input); } });
      var box = chat.querySelector('[data-ins-msgs]'); if (box) box.scrollTop = box.scrollHeight;
    }
  }
  function focusInput() { var i = q('[data-ins-input]'); if (i) i.focus(); }

  function saveNote(form) {
    var title = form.querySelector('[data-ins-title]').value.trim(), body = form.querySelector('[data-ins-body]').value.trim(), target = form.querySelector('[data-ins-target]').value;
    var why = patientReason(title + '\n' + body); if (why) { showError(why); return; }
    var btn = form.querySelector('[data-ins-save]'); btn.disabled = true;
    rpc('instinct_note_save', { p_id: st.editing && st.editing.id || null, p_title: title, p_body: body, p_target: target })
      .then(function () { st.editing = null; return load(); }).catch(function (e) { btn.disabled = false; showError(e.message); });
  }
  function decide(btn, id, action) {
    btn.disabled = true;
    rpc('instinct_note_decide', { p_id: id, p_action: action }).then(load).catch(function (e) { btn.disabled = false; showError(e.message); });
  }
  function openThread(id) {
    return rpc('instinct_thread', { p_thread: id }).then(function (t) {
      var row = st.threads.find(function (x) { return x.id === id; });
      t.staff_id = row ? row.staff_id : null; t.mine = !st.ctx.sees_all_threads || (row && row.staff_id === st.ctx.id);
      st.thread = t; st.chatOpen = true; draw(); focusInput();
    }).catch(function (e) { showError(e.message); });
  }
  function sendMessage(btn, input) {
    var body = (input.value || '').trim(); if (!body) return;
    var why = patientReason(body); if (why) { chatError(why); return; }
    btn.disabled = true; chatError('');
    var c = st.ctx, call = c.can_reply ? rpc('instinct_reply', { p_thread: st.thread && st.thread.id, p_body: body }) : rpc('instinct_ask', { p_thread: st.thread ? st.thread.id : null, p_body: body });
    call.then(function (r) { return load().then(function () { return openThread(r.thread_id); }); })
      .catch(function (e) { btn.disabled = false; chatError(e.message); });
  }

  function load() {
    showError('');
    return rpc('instinct_context').then(function (c) {
      st.ctx = c; if (document.body) document.body.classList.toggle('ins-ai-only', c.kind === 'instinct');
      return Promise.all([rpc('instinct_notes_list'), rpc('instinct_threads_list'), rpc('instinct_notifications_list')]);
    }).then(function (r) {
      st.notes = r[0] || []; st.threads = r[1] || []; st.notifs = r[2] || []; setBadge(st.ctx.unread); draw();
    }).catch(function (e) {
      if (st.el) st.el.innerHTML = '<section class="ins-page"><h2>مساعد إنستنكت</h2><div class="ins-error" role="alert">' + esc(e.message || 'تعذر التحميل') + '</div></section>';
    });
  }

  // بادچ الإشعارات على زرار «مساعد إنستنكت» في القائمة + تنبيه لما يوصل جديد
  function setBadge(n) {
    document.querySelectorAll('[data-goto="instinct"]').forEach(function (b) {
      var s = b.querySelector('.ins-menu-badge'); if (!s) { s = document.createElement('b'); s.className = 'ins-menu-badge'; b.appendChild(s); }
      s.textContent = n > 99 ? '99+' : String(n || 0); s.hidden = !n;
    });
    if (lastUnread !== null && n > lastUnread && w.SSMPDToast) w.SSMPDToast.show('وصل جديد في مساعد إنستنكت', 'info');
    lastUnread = n || 0;
  }
  function pollBadge() { return rpc('instinct_context').then(function (c) { setBadge(c.unread); }).catch(function () {}); }
  function startBadge() {
    if (badgeTimer) return;
    var a = w.SSMPDAuth && w.SSMPDAuth.currentAdmin;
    if (document.body && w.SSMPDRoles && w.SSMPDRoles.isInstinctOnly) document.body.classList.toggle('ins-ai-only', !!a && w.SSMPDRoles.isInstinctOnly(a));
    if (!a || !w.SSMPDRoles || !w.SSMPDRoles.canSeeTab(a, 'instinct')) { setTimeout(startBadge, 1500); return; }
    pollBadge(); badgeTimer = setInterval(function () { if (!document.hidden) pollBadge(); }, 90000);
  }

  w.SSMPDInstinct = {
    render: function (el) { st.el = el; st.thread = null; st.chatOpen = false; st.editing = null; if (el) el.innerHTML = '<p class="ins-empty">بيحمّل…</p>'; return load(); },
    patientReason: patientReason,
    startBadge: startBadge,
    _state: st
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(startBadge, 1500); }); else setTimeout(startBadge, 1500);
})(window);
