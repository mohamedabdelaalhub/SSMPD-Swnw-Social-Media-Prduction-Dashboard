(function (w) {
  'use strict';
  // End of service and final settlement («إنهاء خدمة / مخالصة»). Server: hr_offboarding_workspace / hr_offboarding_command / hr_offboarding_template (migration 20261109160000).
  // One component, two homes: the HR tab «إنهاء الخدمة» and the accounting tab «مخالصات الموظفين». Every button is shown by the role flags the server returns; the server enforces them again.
  // Order that the screen follows: open -> accountant sheet -> financial-manager approval -> print -> HR uploads the signed file -> experience certificate (locked until then) -> insurance stop -> net payment recorded -> close.
  var STATUS = { requested: 'قيد إعداد الكشف', sheet_ready: 'بانتظار الاعتماد', approved: 'معتمدة — بانتظار الملف الموقع', signed: 'موقعة', completed: 'مغلقة', cancelled: 'ملغاة' };
  var REASON = { resignation: 'استقالة', termination: 'إنهاء من المركز', contract_end: 'انتهاء العقد', other: 'أخرى' };
  var KIND = { due_to_him: 'مستحق له', due_on_him: 'مستحق عليه', custody: 'عهدة لم تُسلَّم', document: 'مستند أو عقد بحوزته' };
  var RES = { counted: '—', pending: 'لم تُعالج', returned: 'سُلِّمت', deducted: 'تُخصم من مستحقاته', waived: 'تنازل' };
  function esc(v) { return w.SSMPDWorkforceUtils.escape(v); }
  function money(v) { return Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function opts(map) { return Object.keys(map).map(function (k) { return [k, map[k]]; }); }
  function day(v) { return v ? String(v).slice(0, 10) : ''; }
  function btn(action, label, id, extra) { return '<button type="button" class="btn ghost" data-offb="' + action + '" data-id="' + esc(id || '') + '"' + (extra || '') + '>' + esc(label) + '</button>'; }

  // fills a template body (plain text with {{placeholders}}) for one case; text is escaped first, so nothing typed in a template can inject markup
  function fill(body, c, today) {
    var net = c.net || {}, lines = (c.lines || []).map(function (l) {
      return '<tr><td>' + esc(KIND[l.kind]) + '</td><td>' + esc(l.label) + '</td><td>' + (l.kind === 'document' ? '—' : money(l.amount)) + '</td><td>' + esc(RES[l.resolution] || '') + (l.resolution_note ? ' — ' + esc(l.resolution_note) : '') + '</td></tr>';
    }).join('');
    var map = { date: esc(today), name: esc(c.full_name), code: esc(c.code), job_title: esc(c.job_title || ''), start_date: esc(day(c.start_date)), last_day: esc(day(c.last_day)), reason: esc(REASON[c.reason] || c.reason),
      to_him: money(net.to_him), on_him: money(net.on_him), net: money(net.net) };
    var html = esc(body).replace(/\n/g, '<br>').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, function (m, k) {
      if (k === 'lines') return '<table border="1" cellpadding="6" style="border-collapse:collapse;width:100%"><thead><tr><th>البند</th><th>الوصف</th><th>القيمة</th><th>المعالجة</th></tr></thead><tbody>' + lines + '</tbody></table>';
      return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : m;
    });
    return html;
  }
  function printHtml(title, inner) {
    var win = w.open ? w.open('', '_blank') : null;
    if (!win) return false;
    win.document.write('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>body{font-family:Tahoma,Arial,sans-serif;line-height:2;padding:32px;color:#111}</style></head><body>' + inner + '</body></html>');
    win.document.close(); win.focus(); try { win.print(); } catch (e) { /* the user can print from the window */ }
    return true;
  }

  function mount(shell, active) {
    if (!shell || !active) return;
    var U = w.SSMPDWorkforceUtils, owner = w.SSMPDAuth && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id, data = null, sel = null, serial = 0;
    var host = document.createElement('div');
    host.dataset.hrOffboarding = '';
    shell.append(host);
    function live() { return host.isConnected && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id === owner; }
    function item(id) { return data.cases.find(function (x) { return x.id === id; }); }
    function command(action, payload) { return U.rpc('hr_offboarding_command', { p_action: action, p_payload: payload }).then(load); }
    function template(id, kind) {
      var list = data.templates.filter(function (t) { return t.kind === kind; });
      return list.find(function (t) { return t.id === id; }) || list.find(function (t) { return t.status === 'published'; });
    }

    function load() {
      var n = ++serial;
      host.innerHTML = '<p role="status">جاري تحميل إجراءات إنهاء الخدمة…</p>';
      return U.rpc('hr_offboarding_workspace', {}).then(function (d) {
        if (!live() || n !== serial) return;
        data = d; if (sel && !item(sel)) sel = null; draw();
        // locks the dashboard account of anyone whose closed file has reached its last day (idempotent)
        if (d.can_manage || d.can_prepare) U.rpc('hr_offboarding_lock_due', {}).catch(function () { /* not critical for the screen */ });
      }).catch(function (err) {
        if (!live()) return;
        var missing = /hr_offboarding_workspace|404|schema cache/i.test(err.message || '');
        host.innerHTML = '<p role="alert">' + esc(missing ? 'إنهاء الخدمة غير مفعّل بعد على قاعدة البيانات' : err.message) + '</p>' + btn('retry', 'إعادة المحاولة');
        bind();
      });
    }

    function nextStep(c) {
      if (c.status === 'requested') return 'المحاسب يعدّ الكشف ثم يرسله للاعتماد';
      if (c.status === 'sheet_ready') return 'المدير المالي يعتمد الكشف';
      if (c.status === 'approved') return 'طباعة المخالصة وتوقيعها ثم رفع الملف الموقع';
      if (c.status === 'signed') return c.paid_on ? 'إصدار الشهادة وإيقاف التأمينات ثم إغلاق الملف' : 'تسجيل صرف الصافي ثم إغلاق الملف';
      return '—';
    }

    function draw() {
      var cs = data.cases, open = cs.filter(function (c) { return c.status !== 'completed' && c.status !== 'cancelled'; });
      var cards = [['إجراءات مفتوحة', open.length], ['بانتظار الاعتماد', cs.filter(function (c) { return c.status === 'sheet_ready'; }).length], ['بانتظار الملف الموقع', cs.filter(function (c) { return c.status === 'approved'; }).length], ['مغلقة', cs.filter(function (c) { return c.status === 'completed'; }).length]];
      host.innerHTML = '<p>إنهاء الخدمة بالترتيب: الموارد البشرية تفتح الطلب، المحاسب يعدّ كشف المخالصة (المستحق له والمستحق عليه والعهد والمستندات)، المدير المالي يعتمد (ولا يعتمد من فتح الطلب أو أعدّ الكشف)، تُطبع المخالصة وتُوقَّع، وبعد رفع الملف الموقع فقط تُفتح شهادة الخبرة.</p>' +
        '<div class="wp-grid" data-offb-cards>' + cards.map(function (c) { return '<div class="wp-card"><b>' + esc(c[1]) + '</b><span>' + esc(c[0]) + '</span></div>'; }).join('') + '</div>' +
        '<div class="wp-actions">' + (data.can_manage ? btn('new', 'بدء إنهاء خدمة') + btn('templates', 'نصوص المخالصة والشهادة') : '') + '</div>' +
        '<div data-offb-table></div><div data-offb-detail></div>';
      var t = host.querySelector('[data-offb-table]');
      t.innerHTML = cs.length ? U.table(['الموظف', 'آخر يوم', 'السبب', 'الحالة', 'الصافي', 'الخطوة التالية', 'الإجراء'], cs.map(function (c) {
        var n = c.net || {};
        return ['<b>' + esc(c.full_name) + '</b><br><small>' + esc(c.code) + '</small>', esc(day(c.last_day)), esc(REASON[c.reason] || c.reason), '<span data-offb-status="' + esc(c.status) + '">' + esc(STATUS[c.status] || c.status) + '</span>',
          c.status === 'cancelled' ? '—' : money(c.status === 'approved' || c.status === 'signed' || c.status === 'completed' ? c.net_amount : n.net), esc(nextStep(c)), btn('open', 'فتح', c.id)];
      })) : '<p class="wn-empty">لا توجد إجراءات إنهاء خدمة</p>';
      detail(); bind();
    }

    function stepList(c) {
      var done = function (ok, label, extra) { return '<li data-offb-step="' + (ok ? 'done' : 'todo') + '">' + (ok ? '✔ ' : '○ ') + esc(label) + (extra ? ' <small>' + esc(extra) + '</small>' : '') + '</li>'; };
      return '<ol class="wp-steps">' +
        done(true, 'فتح الطلب', day(c.created_at)) + done(!!c.sheet_at, 'إعداد الكشف', day(c.sheet_at)) + done(!!c.approved_at, 'اعتماد المدير المالي', day(c.approved_at)) +
        done(!!c.signed_at, 'رفع المخالصة الموقعة', day(c.signed_at)) + done(!!c.cert_issued_at, 'شهادة الخبرة', c.cert_override_reason ? 'باستثناء المالك: ' + c.cert_override_reason : day(c.cert_issued_at)) +
        done(!!c.insurance_stopped_on, 'إيقاف التأمينات', c.insurance_stopped_on ? day(c.insurance_stopped_on) + (c.insurance_deadline ? ' — آخر موعد للإخطار: ' + day(c.insurance_deadline) : ' — موعد الإخطار لم يُسجَّل') : '') +
        done(!!c.paid_on, 'صرف صافي المخالصة', c.payment_reference) + done(c.status === 'completed', 'إغلاق الملف', day(c.completed_at)) + '</ol>';
    }

    function detail() {
      var box = host.querySelector('[data-offb-detail]'), c = sel && item(sel);
      if (!c) { box.innerHTML = ''; return; }
      var n = c.net || {}, editable = c.status === 'requested' || c.status === 'sheet_ready', closed = c.status === 'completed' || c.status === 'cancelled';
      var netNum = c.status === 'approved' || c.status === 'signed' || c.status === 'completed' ? Number(c.net_amount) : Number(n.net);
      var rows = c.lines.map(function (l) {
        var act = '';
        if (editable && data.can_prepare) {
          if (l.kind === 'custody' || l.kind === 'document') act += btn('resolve', 'معالجة', l.id);
          if (l.source === 'manual') act += btn('remove', 'حذف', l.id);
        }
        return [esc(KIND[l.kind]), esc(l.label), l.kind === 'document' ? '—' : money(l.amount), '<span data-offb-res="' + esc(l.resolution) + '">' + esc(RES[l.resolution] || '') + '</span>' + (l.resolution_note ? '<br><small>' + esc(l.resolution_note) + '</small>' : ''), act || '—'];
      });
      var b = [];
      if (!closed) {
        if (data.can_prepare && editable) b.push(btn('defaults', 'تحميل البيانات من الدفاتر والعهد', c.id), btn('addline', 'إضافة بند', c.id));
        if (data.can_prepare && c.status === 'requested') b.push(btn('submit', 'إرسال الكشف للاعتماد', c.id));
        if (data.can_review && c.status === 'sheet_ready') {
          var self = data.me === c.created_by || data.me === c.sheet_by;
          b.push(btn('approve', 'اعتماد الكشف', c.id, self ? ' disabled title="لا يعتمد من فتح الطلب أو أعدّ الكشف"' : ''), btn('return', 'إعادة الكشف للمحاسب', c.id));
        }
        if (c.status === 'approved' || c.status === 'signed' || c.status === 'completed') b.push(btn('print', 'طباعة المخالصة', c.id));
        if (data.can_manage && c.status === 'approved') b.push(btn('upload', 'رفع المخالصة الموقعة', c.id));
        if (data.can_prepare && (c.status === 'approved' || c.status === 'signed') && !c.paid_on) b.push(btn('pay', 'تسجيل صرف الصافي', c.id));
        if (data.can_manage && (c.status === 'approved' || c.status === 'signed')) {
          if (c.signed_url || c.cert_issued_at) b.push(btn('cert', c.cert_issued_at ? 'إعادة طباعة شهادة الخبرة' : 'إصدار شهادة الخبرة', c.id));
          else b.push('<span data-offb-locked>شهادة الخبرة مقفلة حتى رفع المخالصة الموقعة</span>');
          if (!c.signed_url && !c.cert_issued_at && data.is_owner) b.push(btn('override', 'استثناء المالك: إصدار الشهادة قبل التوقيع', c.id));
          b.push(btn('insurance', 'إيقاف التأمينات', c.id), btn('complete', 'إغلاق ملف الموظف', c.id));
        }
        if (data.can_manage && editable) b.push(btn('lastday', 'تغيير آخر يوم', c.id), btn('cancel', 'إلغاء الإجراء', c.id));
      } else if (data.can_manage && c.status === 'completed') b.push(btn('print', 'طباعة المخالصة', c.id), btn('cert', c.cert_issued_at ? 'إعادة طباعة شهادة الخبرة' : 'إصدار شهادة الخبرة', c.id));
      box.innerHTML = '<h4 data-offb-title>' + esc(c.full_name) + ' — آخر يوم ' + esc(day(c.last_day)) + ' — ' + esc(STATUS[c.status]) + '</h4>' +
        (c.return_note ? '<p role="alert" data-offb-return>أُعيد الكشف: ' + esc(c.return_note) + '</p>' : '') + stepList(c) +
        (rows.length ? U.table(['النوع', 'البند', 'القيمة', 'المعالجة', 'الإجراء'], rows) : '<p class="wn-empty">لم يُحمَّل كشف بعد</p>') +
        '<div class="wp-grid" data-offb-net><div class="wp-card"><b>' + money(n.to_him) + '</b><span>مستحق له</span></div><div class="wp-card"><b>' + money(n.on_him) + '</b><span>مستحق عليه (سلف وخصومات وعهد مخصومة)</span></div><div class="wp-card"><b data-offb-netvalue>' + money(netNum) + '</b><span>' + (netNum < 0 ? 'الصافي سالب: الموظف مدين للمركز' : 'الصافي للموظف') + '</span></div></div>' +
        (c.signed_url ? '<p>الملف الموقع: <a href="' + esc(c.signed_url) + '" target="_blank" rel="noopener noreferrer">فتح</a></p>' : '') +
        '<div class="wp-actions">' + b.join('') + '</div>';
    }

    function act(action, id) {
      var c = (sel && item(sel)) || (id && item(id)), today = data.today;
      if (action === 'retry') return load();
      if (action === 'open') { sel = id; return draw(); }
      if (action === 'new') {
        var rq = w.crypto.randomUUID();
        return U.modal('بدء إنهاء خدمة', U.select('person_id', 'الموظف', data.people.map(function (p) { return [p.id, p.full_name + ' — ' + p.code]; }), '') + U.field('last_day', 'آخر يوم عمل', 'date', today, 'required') +
          U.select('reason', 'السبب', opts(REASON), 'resignation') + U.field('reason_note', 'ملاحظات', 'text', ''), function (v) {
          return command('open', { request_id: rq, person_id: v.person_id, last_day: v.last_day, reason: v.reason, reason_note: v.reason_note }).then(function () { /* shown in the list */ });
        });
      }
      if (action === 'templates') return templates();
      if (!c) return;
      if (action === 'defaults') return command('load_defaults', { id: c.id });
      if (action === 'submit') return command('submit_sheet', { id: c.id });
      if (action === 'approve') return command('approve', { id: c.id, revision: c.revision });
      if (action === 'return') return U.modal('إعادة الكشف للمحاسب', U.field('note', 'السبب', 'text', '', 'required minlength="3"'), function (v) { return command('return_sheet', { id: c.id, note: v.note }); });
      if (action === 'cancel') return U.modal('إلغاء إنهاء الخدمة', U.field('reason', 'سبب الإلغاء', 'text', '', 'required minlength="3"'), function (v) { return command('cancel', { id: c.id, reason: v.reason }); });
      if (action === 'lastday') return U.modal('تغيير آخر يوم', U.field('last_day', 'آخر يوم عمل', 'date', day(c.last_day), 'required'), function (v) { return command('change_last_day', { id: c.id, last_day: v.last_day }); });
      if (action === 'addline') {
        return U.modal('إضافة بند للكشف', U.select('kind', 'النوع', opts(KIND), 'due_on_him') + U.field('label', 'الوصف', 'text', '', 'required minlength="2"') + U.field('amount', 'القيمة (للمستند 0)', 'number', 0, 'min="0" step="0.01"'), function (v) {
          return command('add_line', { id: c.id, kind: v.kind, label: v.label, amount: v.amount });
        });
      }
      if (action === 'remove') return command('remove_line', { id: c.id, line_id: id });
      if (action === 'resolve') {
        var l = c.lines.find(function (x) { return x.id === id; }), choices = l.kind === 'document' ? [['returned', 'سُلِّم'], ['waived', 'تنازل']] : [['returned', 'سُلِّمت'], ['deducted', 'تُخصم من مستحقاته'], ['waived', 'تنازل']];
        return U.modal('معالجة: ' + l.label, U.select('resolution', 'المعالجة', choices, 'returned') + U.field('note', 'ملاحظة (إجبارية عند التنازل أو الخصم)', 'text', ''), function (v) {
          return command('resolve_line', { id: c.id, line_id: id, resolution: v.resolution, note: v.note });
        });
      }
      if (action === 'print') {
        var t = template(c.settlement_template_id, 'settlement');
        if (!printHtml('مخالصة ' + c.full_name, fill(t.body, c, today))) draw();
        return;
      }
      if (action === 'upload') {
        return U.modal('رفع المخالصة الموقعة', '<p class="wp-wide">ارفع الملف الموقع إلى مجلد مستندات المركز ثم الصق رابطه هنا (يبدأ بـ https://).</p>' + U.field('url', 'رابط الملف الموقع', 'url', '', 'required placeholder="https://"'), function (v) { return command('upload_signed', { id: c.id, url: v.url }); });
      }
      if (action === 'pay') {
        return U.modal('تسجيل صرف الصافي', '<p class="wp-wide">الصافي ' + money(c.net_amount) + ' جنيه. سجّل مرجع الصرف الفعلي (تحويل أو إيصال)؛ لا يُنشأ قيد جديد من هنا.</p>' + U.field('reference', 'مرجع الصرف', 'text', '', 'required minlength="2"') + U.field('paid_on', 'تاريخ الصرف', 'date', today), function (v) {
          return command('record_payment', { id: c.id, reference: v.reference, paid_on: v.paid_on });
        });
      }
      if (action === 'cert' || action === 'override') {
        var go = function (reason) {
          return command('issue_certificate', { id: c.id, override_reason: reason || '' }).then(function () {
            var c2 = item(c.id), t2 = template(c2.cert_template_id, 'certificate');
            printHtml('شهادة خبرة ' + c2.full_name, fill(t2.body, c2, data.today));
          });
        };
        if (action === 'override') return U.modal('استثناء المالك', '<p class="wp-wide">الشهادة تخرج قبل المخالصة الموقعة، وسيُسجَّل اسمك والسبب في السجل.</p>' + U.field('reason', 'سبب الاستثناء', 'text', '', 'required minlength="5"'), function (v) { return go(v.reason); });
        return go('');
      }
      if (action === 'insurance') {
        return U.modal('إيقاف التأمينات', U.field('stopped_on', 'تاريخ الإيقاف', 'date', day(c.last_day), 'required') + U.field('reference', 'رقم أو مرجع الإخطار', 'text', '') +
          U.field('deadline', 'آخر موعد للإخطار (يكتبه المسؤول يدويًا)', 'date', ''), function (v) { return command('stop_insurance', { id: c.id, stopped_on: v.stopped_on, reference: v.reference, deadline: v.deadline }); });
      }
      if (action === 'complete') {
        return U.modal('إغلاق ملف الموظف', '<p class="wp-wide">سيتم: إنهاء عقوده كطبيب في آخر يوم، وإنهاء ملفه، وإيقاف اشتراكاته، وقفل حسابه على النظام من آخر يوم. لا رجوع تلقائي.</p>', function () { return command('complete', { id: c.id }); });
      }
    }

    function templates() {
      var parts = ['settlement', 'certificate'].map(function (k) {
        var list = data.templates.filter(function (t) { return t.kind === k; });
        return '<h4>' + (k === 'settlement' ? 'نص المخالصة' : 'نص شهادة الخبرة') + '</h4>' + U.table(['النسخة', 'الحالة', 'ملاحظة', ''], list.map(function (t) {
          return ['v' + t.version, esc({ draft: 'مسودة', published: 'منشورة', retired: 'قديمة' }[t.status]), esc(t.note || ''), btn('tpl-edit', 'تعديل كنسخة جديدة', t.id) + (t.status === 'draft' ? btn('tpl-publish', 'نشر', t.id) : '')];
        }));
      }).join('');
      var f = U.modal('نصوص المخالصة والشهادة', '<div class="wp-wide" data-offb-templates>' + parts + '<p><small>المتغيرات المتاحة: {{name}} {{code}} {{job_title}} {{start_date}} {{last_day}} {{reason}} {{date}} {{to_him}} {{on_him}} {{net}} {{lines}}. النص المنشور وقت الاعتماد هو الذي يُطبع للحالة.</small></p></div>', function () { return true; });
      f.querySelectorAll('[data-offb]').forEach(function (n) {
        n.onclick = function () {
          var t = data.templates.find(function (x) { return x.id === n.dataset.id; });
          if (n.dataset.offb === 'tpl-publish') { U.rpc('hr_offboarding_template', { p_action: 'publish', p_payload: { id: t.id } }).then(load).catch(fail); return; }
          U.modal('نسخة جديدة من نص ' + (t.kind === 'settlement' ? 'المخالصة' : 'الشهادة'), '<label class="wp-wide">النص<textarea name="body" rows="14" required minlength="20">' + esc(t.body) + '</textarea></label>' + U.field('note', 'ملاحظة على النسخة (مثلًا: مراجعة المحامي)', 'text', ''), function (v) {
            return U.rpc('hr_offboarding_template', { p_action: 'save', p_payload: { kind: t.kind, body: v.body, note: v.note } }).then(load);
          });
        };
      });
    }

    function fail(err) { host.insertAdjacentHTML('afterbegin', '<p role="alert">' + esc(err.message) + '</p>'); }
    function bind() {
      host.querySelectorAll('[data-offb]').forEach(function (n) {
        n.onclick = function () { try { var r = act(n.dataset.offb, n.dataset.id); if (r && r.catch) r.catch(fail); } catch (err) { fail(err); } };
      });
    }
    load();
  }
  w.SSMPDHROffboarding = { mount: mount, fill: fill };
})(window);
