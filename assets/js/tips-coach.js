/* «نصايح الشغل» — role-based tips with animated slides (owner 2026-11-22, «طبقه» on docs/ui-references/mockups/tips-coach.html).
   Reception and finance staff get a short tip now and then: at most 3 a day, 20 minutes apart, never while a form is open
   or while typing. What is happening on screen comes first (a doctor arrived → link him to a clinic; a patient owes money → collect).
   «فهمت» / «فكّرني بعدين» (2 h) / «ما تورينيش دي تاني» are saved per user (RPC tip_progress_mark, migration 20261122230000);
   «جرّبها دلوقتي» opens the real screen, «كمّل اتعلّم» plays the matching training video. «💡 نصايح الشغل» in the user menu
   lists every tip; managers also see who learned what. Presentation and progress only — no business data is changed. */
(function (root) {
'use strict';
var TIPS={
 reception:[
  {id:'room',go:'tab-reception_services',t:'اربط الدكتور بالعيادة',vid:null,ctx:true,frames:[
   ['افتح <span>«الغرف والطابور»</span> من «⋯» فوق',`<div class="m-row"><span class="m-b main">حجز جديد</span><span class="m-b hl">⋯</span></div><div class="m-card"><b>الغرف والطابور</b><span>العيادات · طوابير الأطباء</span></div>`,[14,8]],
   ['في كارت العيادة اختار <span>الدكتور</span>',`<div class="m-card"><b>عيادة 3</b><span>فاضية</span><div class="m-row"><span class="m-sel hl">د. سارة علي ▾</span><span class="m-b">ربط</span></div></div>`,[62,38]],
   ['دوس <span>«ربط»</span>',`<div class="m-card"><b>عيادة 3</b><span>فاضية</span><div class="m-row"><span class="m-sel">د. سارة علي ▾</span><span class="m-b main hl">ربط</span></div></div>`,[62,62]],
   ['خلاص — رقم العيادة <span>بيظهر للمرضى لوحده</span> على الشاشة وفي «دوري»',`<div class="m-scr"><span>رقم</span><b>A-12</b><span>اتفضل على عيادة 3</span></div>`,[45,48]]]},
  {id:'doc_arrive',go:'tab-reception_services',t:'سجّل وصول الدكتور',vid:null,ctx:true,frames:[
   ['في سطر <span>«الأطباء»</span> دوس «تفاصيل»',`<div class="fk-doc" style="font-size:11px"><b>الأطباء:</b> د. أحمد سمير مجدول <span class="m-b hl">تفاصيل ⌄</span></div>`,[22,10]],
   ['جنب الدكتور افتح <span>«⋯» ← حالة الطبيب</span>',`<div class="m-card"><b>د. أحمد سمير</b><span>مجدول</span><div class="m-row"><span class="m-b hl">⋯</span></div></div>`,[64,10]],
   ['اختار <span>«وصل»</span> (أو «تأخير» واكتب الدقايق)',`<div class="m-card"><div class="m-row"><span class="m-b">في الطريق</span><span class="m-b main hl">وصل</span><span class="m-b">تأخير</span></div></div>`,[22,48]],
   ['بعدها <span>اربطه بعيادة</span> عشان المرضى يعرفوا يدخلوا فين',`<div class="m-card"><b>د. أحمد سمير</b><span class="chip ctx">وصل</span><span class="m-b or">اربط بعيادة</span></div>`,[60,20]]]},
  {id:'arrive',go:'tab-reception_services',t:'سجّل وصول المريض',vid:'01-booking-arrival.mp4',frames:[
   ['دوس على <span>اسم المريض</span> في الساعة بتاعته',`<div class="fk-pill hl"><i></i>6:30 منى سعيد</div>`,[18,40]],
   ['دوس <span>«وصل»</span>',`<div class="m-card"><b>منى سعيد · 6:30</b><div class="m-row"><span class="m-b main hl">وصل</span><span class="m-b">⋯</span></div></div>`,[52,74]],
   ['أكّد — المريض <span>بيدخل «في الانتظار»</span> والزيارة بتتفتح',`<div class="m-card"><b>تأكيد: وصل</b><div class="m-row"><span class="m-b main hl">تأكيد</span><span class="m-b">رجوع</span></div></div>`,[52,70]]]},
  {id:'call',go:'tab-reception_services',t:'نادِ على المريض',vid:'02-call-start.mp4',frames:[
   ['المريض «في الانتظار» — دوس على اسمه',`<div class="fk-pill hl"><i></i>كريم حسن · مستني 12 د</div>`,[18,40]],
   ['دوس <span>«نادي»</span> — الشاشة بتنادي برقمه',`<div class="m-card"><b>كريم حسن</b><div class="m-row"><span class="m-b main hl">نادي</span></div></div>`,[52,78]],
   ['لما يدخل دوس <span>«بدأ الكشف»</span> — يتنقل «في غرفة الكشف»',`<div class="m-card"><b>كريم حسن</b><div class="m-row"><span class="m-b main hl">بدأ الكشف</span></div></div>`,[52,70]]]},
  {id:'collect',go:'tab-reception_services',t:'حصّل قبل ما المريض يمشي',vid:null,ctx:true,frames:[
   ['جنب المريض هتلاقي <span>«التحصيل»</span> بالبرتقاني',`<div class="m-row"><span class="fk-pill"><i></i>يحيى أحمد كمال · متبقي 500</span><span class="m-b or hl">التحصيل</span></div>`,[16,10]],
   ['اختار <span>طريقة الدفع</span> واكتب المبلغ',`<div class="m-card"><b>تسجيل تحصيل</b><div class="m-row"><span class="m-sel hl">كاش ▾</span><span class="m-b">500</span></div></div>`,[54,46]],
   ['لو عليه أكتر من زيارة <span>علّم عليهم</span> وادفعهم مرة واحدة',`<div class="m-card"><div class="m-row"><span class="m-b hl">☑ زيارة 12 نوفمبر · 150</span></div><span class="m-b main">حفظ</span></div>`,[36,40]],
   ['اتسجل — يظهر <span>«تم التحصيل ✓»</span> بالأخضر',`<div class="m-row"><span class="fk-pill"><i></i>يحيى أحمد كمال</span><span class="m-b ok">تم التحصيل ✓</span></div>`,[16,10]]]},
  {id:'service',go:'tab-reception_services',t:'طلب خدمة وإنهاء الزيارة',vid:'03-service-finish.mp4',frames:[['افتح المريض ← «⋯» ← <span>«طلب خدمة»</span>',`<div class="m-card"><b>سلمى إبراهيم</b><span class="m-b hl">طلب خدمة</span></div>`,[52,60]],['في الآخر <span>«إنهاء الزيارة»</span>',`<div class="m-card"><span class="m-b main hl">إنهاء الزيارة</span></div>`,[40,60]]]},
  {id:'noshow',go:'tab-reception_services',t:'لم يحضر / تغيير الميعاد',vid:'04-noshow-reschedule-search.mp4',frames:[['افتح المريض ← «⋯»',`<div class="m-card"><b>عمر خالد · متأخر 40 د</b><span class="m-b hl">⋯</span></div>`,[52,10]],['<span>«لم يحضر»</span> واكتب السبب، أو <span>«تغيير الميعاد»</span>',`<div class="m-card"><div class="m-row"><span class="m-b hl">لم يحضر</span><span class="m-b">تغيير الميعاد</span></div></div>`,[22,70]]]},
  {id:'delay',go:'tab-reception_services',t:'الدكتور هيتأخر؟ عرّف المرضى',vid:null,frames:[['«⋯» جنب الدكتور ← <span>«تأخير»</span>',`<div class="m-card"><div class="m-row"><span class="m-b hl">تأخير</span></div></div>`,[22,60]],['اكتب <span>الدقايق والسبب</span>',`<div class="m-card"><div class="m-row"><span class="m-b hl">20 دقيقة</span><span class="m-b">زحمة</span></div></div>`,[22,60]]]},
  {id:'expenses',go:'tab-reception_services',t:'مصروفات الوردية',vid:null,frames:[['«الخزينة والوردية» ← <span>«صرف من مصروفات الوردية»</span>',`<div class="m-card"><b>مصروفات الوردية</b><span class="m-b hl">− صرف</span></div>`,[52,60]]]},
  {id:'peer',go:'tab-reception_services',t:'سلّم تحصيلك لزميل',vid:null,frames:[['<span>«تسليم تحصيل لزميل»</span> واختار الزميل',`<div class="m-card"><span class="m-sel hl">منى ▾</span></div>`,[40,50]],['الزميل لازم يدوس <span>«استلمت»</span>',`<div class="m-card"><span class="m-b ok hl">استلمت</span></div>`,[40,60]]]},
  {id:'close_shift',go:'tab-reception_services',t:'اقفل ورديتك وسلّم الكاش',vid:null,frames:[['«شغلي النهارده» ← <span>«اقفل ورديتي وسلّم الكاش»</span>',`<div class="m-card"><span class="m-b main hl">اقفل ورديتي</span></div>`,[40,60]],['<span>عِد الكاش</span> واكتبه — أي فرق بيتراجع',`<div class="m-card"><div class="m-row"><span class="m-b hl">الفعلي 4,350</span></div></div>`,[40,60]]]},
  {id:'help',go:'tab-reception_services',t:'طلب دعم أو أولوية',vid:null,frames:[['«⋯» على المريض ← <span>«طلب دعم»</span> أو «تحديد الأولوية»',`<div class="m-card"><div class="m-row"><span class="m-b hl">طلب دعم</span><span class="m-b">الأولوية</span></div></div>`,[22,70]]]},
  {id:'book',go:'tab-reception_services',t:'حجز جديد',vid:'01-booking-arrival.mp4',frames:[['دوس <span>«حجز جديد»</span> فوق',`<div class="m-row"><span class="m-b main hl">حجز جديد</span></div>`,[14,60]]]},
  {id:'leads',go:'tab-leads',t:'سجّل رسالة عميل جديد (ليد)',vid:'09-leads.mp4',frames:[['الليدز ← <span>«ليد جديد»</span>',`<div class="m-card"><span class="m-b main hl">ليد جديد</span></div>`,[40,60]]]}],
 finance:[
  {id:'receive_cash',go:'cash-shifts',t:'استلم الكاش من الخزن',vid:null,ctx:true,frames:[
   ['من <span>«شغلي النهارده»</span> هتلاقي «استلم كاش من الخزن»',`<div class="m-card"><b>استلم كاش من الخزن</b><span>منى · 4,350 ج.م</span><span class="m-b main hl">استلم</span></div>`,[66,62]],
   ['<span>عِد المبلغ</span> وقارنه باللي مكتوب',`<div class="m-card"><div class="m-row"><span class="m-b">المسلّم 4,350</span><span class="m-b hl">الفعلي 4,350</span></div></div>`,[22,40]],
   ['دوس <span>«استلم النقدية»</span> — أو «رفض» واكتب السبب',`<div class="m-card"><div class="m-row"><span class="m-b main hl">استلم النقدية</span><span class="m-b">رفض</span></div></div>`,[22,62]]]},
  {id:'approve',go:'cash-requests',t:'اعتمادات مستنياك',vid:null,ctx:true,frames:[['«اعتمادات مستنياك» ← <span>«اعتمد»</span>',`<div class="m-card"><b>طلب صرف · 1,200</b><span class="m-b main hl">اعتمد</span></div>`,[66,62]]]},
  {id:'voucher_in',go:'tab-accounting',t:'سند قبض',vid:null,frames:[['«السندات» ← <span>«سند قبض»</span>',`<div class="m-row"><span class="m-b main hl">سند قبض</span><span class="m-b">سند صرف</span></div>`,[14,60]]]},
  {id:'voucher_out',go:'tab-accounting',t:'سند صرف',vid:null,frames:[['«السندات» ← <span>«سند صرف»</span>',`<div class="m-row"><span class="m-b">سند قبض</span><span class="m-b main hl">سند صرف</span></div>`,[14,40]]]},
  {id:'main_count',go:'cash-shifts',t:'جرد الخزينة الرئيسية',vid:null,frames:[['<span>«جرد الخزينة الرئيسية»</span>',`<div class="m-card"><span class="m-b main hl">جرد الخزينة الرئيسية</span></div>`,[40,50]],['اكتب <span>الفعلي</span> ← «حفظ الجرد» — الخزينة بتفضل مفتوحة',`<div class="m-card"><span class="m-b hl">حفظ الجرد</span></div>`,[40,60]]]},
  {id:'review_shift',go:'cash-shifts',t:'مراجعة الوردية',vid:null,frames:[['«الخزائن والورديات» ← <span>«مراجعة الوردية»</span>',`<div class="m-card"><span class="m-b hl">مراجعة الوردية</span></div>`,[40,60]]]},
  {id:'cases',go:'tab-accounting',t:'فروق الخزينة',vid:null,frames:[['«فروق الخزينة» ← <span>«راجع الفروق»</span> ← «استكمال المسار»',`<div class="m-card"><b>فرق −50</b><span class="m-b hl">راجع الفروق</span></div>`,[60,60]]]},
  {id:'statement',go:'tab-accounting',t:'كشف الخزينة',vid:null,frames:[['«كشف الخزينة» واختار <span>الفترة</span>',`<div class="m-card"><span class="m-b hl">كشف الخزينة</span></div>`,[40,60]]]},
  {id:'advance',go:'cash-advances',t:'مقدمات الحجز',vid:null,frames:[['«مقدمات الحجز» ← <span>«تسجيل مقدم»</span> ثم «استخدام على فاتورة»',`<div class="m-card"><span class="m-b main hl">تسجيل مقدم</span></div>`,[40,60]]]},
  {id:'doctor_pay',go:'doctor-accounts',t:'مستحقات دكتور',vid:null,frames:[['«الأطباء والأتعاب» ← <span>«حساب الدكتور»</span> ← «طلب صرف مستحقات»',`<div class="m-card"><span class="m-b hl">طلب صرف مستحقات</span></div>`,[40,60]]]},
  {id:'supplier',go:'cash-suppliers',t:'سداد مورد',vid:null,frames:[['«الموردون» ← <span>«طلب سداد مورد»</span>',`<div class="m-card"><span class="m-b hl">طلب سداد مورد</span></div>`,[40,60]]]},
  {id:'bank',go:'cash-bank',t:'رفع كشف البنك ومطابقته',vid:null,frames:[['«البنك والبطاقات» ← <span>«رفع PDF أو Excel»</span> ← «مطابقة»',`<div class="m-card"><span class="m-b hl">رفع كشف</span><span class="m-b">مطابقة</span></div>`,[40,60]]]},
  {id:'multi',go:'cash-payments',t:'تحصيل أكتر من زيارة مرة واحدة',vid:null,frames:[['في «تسجيل تحصيل» <span>علّم على الزيارات</span>',`<div class="m-card"><span class="m-b hl">☑ زيارة 12 نوفمبر</span></div>`,[40,60]]]},
  {id:'payroll',go:'cash-payroll',t:'صرف راتب',vid:null,frames:[['«المرتبات والسلف» ← <span>«طلب صرف راتب»</span>',`<div class="m-card"><span class="m-b hl">طلب صرف راتب</span></div>`,[40,60]]]}]};
var ROLE_SETS = { reception: ['reception', 'customer_service'], finance: ['accountant', 'financial_manager'] };
var MANAGERS = ['super_admin', 'general_manager', 'financial_manager'];
var MAX_PER_DAY = 3, GAP_MS = 20 * 60000, FIRST_DELAY_MS = 2 * 60000, CHECK_MS = 60000;
var progress = {}, loaded = false, started = false, startedAt = Date.now(), timer = null, slideTimer = null, current = null;

function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function admin() { return root.SSMPDAuth && root.SSMPDAuth.currentAdmin; }
function rolesOf(a) { var R = root.SSMPDRoles; return a ? (R && R.rolesOf ? R.rolesOf(a) : [a.role]) : []; }
function sets(a) { var r = rolesOf(a); return Object.keys(ROLE_SETS).filter(function (k) { return ROLE_SETS[k].some(function (x) { return r.indexOf(x) !== -1; }); }); }
function isManager(a) { var r = rolesOf(a); return MANAGERS.some(function (x) { return r.indexOf(x) !== -1; }); }
function db() { return root.SSMPDDb && root.SSMPDDb.client; }
function all() { return TIPS.reception.map(function (t) { return Object.assign({ set: 'reception' }, t); }).concat(TIPS.finance.map(function (t) { return Object.assign({ set: 'finance' }, t); })); }
function find(id) { return all().filter(function (t) { return t.id === id; })[0]; }
function day() { return new Date().toLocaleDateString('en-CA'); }
function key(a) { return 'swnw_tips_' + (a ? a.id : 'x') + '_' + day(); }
var memo = {}; // same-day counter even where localStorage is blocked
function store(a) { var k = key(a); try { var v = localStorage.getItem(k); if (v) return JSON.parse(v); } catch (e) {} return memo[k] || {}; }
function save(a, v) { var k = key(a); memo[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function mark(id, action) {
  var p = progress[id] = progress[id] || { tip: id, seen: 0 };
  if (action === 'seen') { p.seen = (p.seen || 0) + 1; p.last_seen_at = new Date().toISOString(); }
  if (action === 'learned') p.learned = true;
  if (action === 'snooze') p.snoozed_until = new Date(Date.now() + 2 * 3600e3).toISOString();
  if (action === 'never') p.never = true;
  if (action === 'reset') { p.learned = false; p.never = false; p.snoozed_until = null; }
  var c = db(); if (c && c.rpc) { try { Promise.resolve(c.rpc('tip_progress_mark', { p_tip: id, p_action: action })).catch(function () {}); } catch (e) {} }
}
function load() {
  var c = db(); if (!c || !c.rpc) { loaded = true; return Promise.resolve(); }
  return Promise.resolve(c.rpc('tip_progress_mine')).then(function (r) {
    (r && Array.isArray(r.data) ? r.data : []).forEach(function (p) { progress[p.tip] = p; });
  }).catch(function () {}).then(function () { loaded = true; });
}
function available(t) {
  var p = progress[t.id] || {};
  return !p.learned && !p.never && !(p.snoozed_until && Date.parse(p.snoozed_until) > Date.now());
}
// What is on screen right now → the tip that helps with it (reason shown in the popup).
function context(set) {
  var host = document.getElementById('view-container') || document.body, out = [];
  if (set === 'reception') {
    var docs = host.querySelector('.journey-docline-list');
    if (docs) Array.from(docs.querySelectorAll('.journey-docline-item')).forEach(function (el) {
      var txt = el.textContent.replace(/\s+/g, ' ').trim();
      if (/(وصل|بدأ العيادة)/.test(txt)) out.push({ id: 'room', why: txt + ' — اتأكد إنه مربوط بعيادة عشان رقمها يظهر للمرضى.' });
    });
    if (host.querySelector('.journey-queue-hint, [data-qa-hint="no-room"]')) out.push({ id: 'room', why: 'فيه دكتور مش مربوط بعيادة.' });
    var due = host.querySelector('.journey-pay-due');
    if (due) { var card = due.closest('.journey-card'), name = card && card.querySelector('.journey-chip-name'); out.push({ id: 'collect', why: (name ? name.textContent.trim() + ' ' : 'فيه مريض ') + 'خلّص وعليه فلوس — حصّل قبل ما يمشي.' }); }
  }
  if (set === 'finance') {
    Array.from(host.querySelectorAll('[data-ft-go]')).forEach(function (b) {
      if (/استلم/.test(b.textContent)) out.push({ id: 'receive_cash', why: 'فيه كاش متسلّم من الخزن مستنيك تستلمه.' });
      if (/اعتمد/.test(b.textContent)) out.push({ id: 'approve', why: 'فيه اعتمادات مستنياك.' });
    });
  }
  return out;
}
function busy() {
  if (document.visibilityState && document.visibilityState !== 'visible') return true;
  if (document.querySelector('.modal-backdrop, dialog[open], .rx-modal, .tc-tip, .pp-confirm[open]')) return true;
  var f = document.activeElement; return !!(f && /^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName));
}
function pick(a) {
  var mine = sets(a); if (!mine.length) return null;
  for (var i = 0; i < mine.length; i++) {
    var ctx = context(mine[i]).filter(function (c) { var t = find(c.id); return t && available(t); })[0];
    if (ctx) return { tip: find(ctx.id), why: ctx.why };
  }
  var list = all().filter(function (t) { return mine.indexOf(t.set) !== -1 && available(t); })
    .sort(function (x, y) { return ((progress[x.id] || {}).seen || 0) - ((progress[y.id] || {}).seen || 0); });
  return list.length ? { tip: list[0], why: '' } : null;
}
function check(force) {
  var a = admin(); if (!a || !loaded || busy()) return false;
  var s = store(a), now = Date.now();
  if (!force && (now - startedAt < FIRST_DELAY_MS || (s.count || 0) >= MAX_PER_DAY || (s.last && now - s.last < GAP_MS))) return false;
  var p = pick(a); if (!p) return false;
  save(a, { count: (s.count || 0) + 1, last: now });
  show(p.tip.id, p.why);
  return true;
}
function go(t) {
  var a = admin(), T = root.SSMPDUITitles, R = root.SSMPDRoles;
  var tabs = T && T.tabs ? Object.keys(T.tabs).filter(function (k) { return !R || !R.canSeeTab || R.canSeeTab(a, k); }) : [];
  if (t.go && root.SSMPDSearchDestinations && root.SSMPDSearchDestinations.open(t.go, a, tabs, root.SSMPDGotoTab || function () {})) return;
  if (t.go && /^tab-/.test(t.go) && root.SSMPDGotoTab) root.SSMPDGotoTab(t.go.slice(4));
}
function frame(box, t, i) {
  var f = t.frames[i], stage = box.querySelector('.tc-stage');
  stage.innerHTML = f[1] + '<span class="tc-cursor" aria-hidden="true"></span>';
  box.querySelector('.tc-cap').innerHTML = (i + 1) + '. ' + f[0];
  box.querySelector('.tc-dots').innerHTML = t.frames.map(function (_, k) { return '<i class="' + (k === i ? 'on' : '') + '"></i>'; }).join('');
  var h = stage.querySelector('.hl'), c = stage.querySelector('.tc-cursor');
  if (h && stage.getBoundingClientRect) { var a = stage.getBoundingClientRect(), r = h.getBoundingClientRect(); c.style.top = (r.top - a.top + r.height / 2 - 4) + 'px'; c.style.left = (r.left - a.left + r.width / 2 - 4) + 'px'; }
  else { c.style.top = f[2][0] + '%'; c.style.left = f[2][1] + '%'; }
}
function close() { clearTimeout(slideTimer); if (current) { current.remove(); current = null; } }
function show(id, why) {
  var t = find(id); if (!t) return null;
  close(); mark(id, 'seen');
  var list = TIPS[t.set], n = list.indexOf(list.filter(function (x) { return x.id === id; })[0]) + 1;
  var box = document.createElement('section');
  box.className = 'tc-tip'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'نصيحة: ' + t.t); box.dataset.tip = id;
  box.innerHTML = '<div class="tc-h"><span class="tc-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/></svg></span>' +
    '<div class="tc-t"><small>نصيحة ' + n + ' من ' + list.length + ' · ' + (t.set === 'reception' ? 'الاستقبال' : 'الحسابات') + '</small><b>' + esc(t.t) + '</b></div>' +
    '<button type="button" class="tc-x" data-tc="close" aria-label="إغلاق">✕</button></div>' +
    (why ? '<div class="tc-why">' + esc(why) + '</div>' : '') +
    '<div class="tc-slides"><div class="tc-stage"></div><div class="tc-cap" aria-live="polite"></div><div class="tc-nav"><button type="button" data-tc="prev">‹ السابق</button><div class="tc-dots"></div><button type="button" data-tc="next">التالي ›</button></div></div>' +
    '<div class="tc-acts"><button type="button" class="tc-btn tc-main" data-tc="try">جرّبها دلوقتي</button>' +
    (t.vid ? '<button type="button" class="tc-btn tc-vid" data-tc="video">▶ كمّل اتعلّم</button>' : '<button type="button" class="tc-btn tc-vid missing" disabled>الفيديو جاي قريب</button>') + '</div>' +
    '<div class="tc-later"><button type="button" data-tc="learned">✓ فهمت</button><button type="button" data-tc="snooze">فكّرني بعدين</button><button type="button" data-tc="never">ما تورينيش دي تاني</button></div>';
  document.body.appendChild(box); current = box;
  var i = 0, reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function step(k) { i = (k + t.frames.length) % t.frames.length; frame(box, t, i); clearTimeout(slideTimer); if (!reduce) slideTimer = setTimeout(function () { if (current === box) step(i + 1); }, 2800); }
  step(0);
  box.addEventListener('click', function (e) {
    var b = e.target.closest('[data-tc]'); if (!b) return;
    var act = b.dataset.tc;
    if (act === 'next') return step(i + 1);
    if (act === 'prev') return step(i - 1);
    if (act === 'try') { close(); go(t); return; }
    if (act === 'video') { close(); if (root.SSMPDTrainingVideos) root.SSMPDTrainingVideos.open(t.vid); return; }
    if (act === 'learned' || act === 'snooze' || act === 'never') { mark(id, act); if (root.SSMPDToast) root.SSMPDToast.show(act === 'learned' ? 'اتسجلت إنك اتعلّمتها ✓' : act === 'snooze' ? 'هتظهرلك تاني بعد ساعتين' : 'مش هتظهرلك تاني — تقدر ترجعها من «💡 نصايح الشغل»'); }
    close();
  });
  box.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  var first = box.querySelector('[data-tc="try"]'); if (first && first.focus) try { first.focus({ preventScroll: true }); } catch (e) {}
  return box;
}
// «💡 نصايح الشغل»: every tip for my role(s), its state, «اعرضها»; managers also get the team view.
function library() {
  var a = admin(); if (!a) return;
  var mine = sets(a), mgr = isManager(a); if (!mine.length && !mgr) return;
  var view = mine.length ? mine : ['reception', 'finance'];
  var d = document.createElement('div'); d.className = 'modal-backdrop tc-lib';
  function state(t) { var p = progress[t.id] || {}; return p.learned ? ['ok', 'اتعلّمتها'] : p.never ? ['off', 'مخفية'] : p.seen ? ['seen', 'شفتها'] : ['new', 'جديدة']; }
  function rows(setKey) {
    return TIPS[setKey].map(function (t) { var s = state(t); return '<div class="tc-row"><div class="tc-row-n"><b>' + esc(t.t) + '</b><small>' + (t.vid ? 'فيه فيديو' : 'الفيديو جاي قريب') + '</small></div><span class="tc-st ' + s[0] + '">' + s[1] + '</span><button type="button" class="tc-btn" data-tc-show="' + t.id + '">اعرضها</button></div>'; }).join('');
  }
  d.innerHTML = '<section class="modal tc-lib-modal" role="dialog" aria-modal="true" aria-label="نصايح الشغل"><header class="modal-head"><h3>💡 نصايح الشغل</h3><button type="button" class="modal-close" data-tc-close aria-label="إغلاق">×</button></header>' +
    '<div class="tc-tabs">' + view.map(function (k, i) { return '<button type="button" class="' + (i ? '' : 'on') + '" data-tc-set="' + k + '">' + (k === 'reception' ? 'الاستقبال' : 'الحسابات') + '</button>'; }).join('') + (mgr ? '<button type="button" data-tc-set="team">متابعة الفريق</button>' : '') + '</div>' +
    '<div class="tc-lib-body">' + rows(view[0]) + '</div></section>';
  document.body.appendChild(d);
  var body = d.querySelector('.tc-lib-body');
  function done() { d.remove(); document.removeEventListener('keydown', esc_); }
  function esc_(e) { if (e.key === 'Escape') done(); }
  document.addEventListener('keydown', esc_);
  d.addEventListener('click', function (e) {
    if (e.target === d || e.target.closest('[data-tc-close]')) return done();
    var s = e.target.closest('[data-tc-set]');
    if (s) {
      d.querySelectorAll('[data-tc-set]').forEach(function (x) { x.classList.toggle('on', x === s); });
      if (s.dataset.tcSet !== 'team') { body.innerHTML = rows(s.dataset.tcSet); return; }
      body.innerHTML = '<p class="tc-muted">بيحمّل…</p>';
      var c = db();
      Promise.resolve(c && c.rpc ? c.rpc('tip_progress_team') : { data: [] }).then(function (r) {
        var list = (r && r.data) || [], total = TIPS.reception.length;
        body.innerHTML = list.length ? '<div class="tc-team">' + list.map(function (m) {
          var tot = /accountant|financial/.test(m.role) ? TIPS.finance.length : total, pct = Math.round((m.learned || 0) / tot * 100);
          return '<div class="tc-row"><div class="tc-row-n"><b>' + esc(m.name) + '</b><small>شاف ' + (m.seen || 0) + ' · اتعلّم ' + (m.learned || 0) + ' من ' + tot + '</small></div><div class="tc-bar" role="img" aria-label="' + pct + '%"><i style="width:' + pct + '%"></i></div></div>';
        }).join('') + '</div>' : '<p class="tc-muted">لسه محدش شاف نصايح.</p>';
      }).catch(function () { body.innerHTML = '<p class="tc-muted">تعذر تحميل المتابعة.</p>'; });
      return;
    }
    var sh = e.target.closest('[data-tc-show]');
    if (sh) { done(); var p = progress[sh.dataset.tcShow]; if (p && (p.never || p.learned)) mark(sh.dataset.tcShow, 'reset'); show(sh.dataset.tcShow, ''); }
  });
  var first = d.querySelector('[data-tc-close]'); if (first) first.focus();
}
function inject() {
  var items = document.querySelector('#user-dropdown .ud-items'), a = admin();
  if (!items || !a || items.querySelector('[data-tips-coach]') || (!sets(a).length && !isManager(a))) return;
  var b = document.createElement('button'); b.type = 'button'; b.className = 'ud-item'; b.dataset.tipsCoach = '1'; b.textContent = '💡 نصايح الشغل';
  b.onclick = function () { library(); }; items.appendChild(b);
}
function start() {
  if (started) return; started = true; startedAt = Date.now();
  load(); timer = setInterval(function () { inject(); check(false); }, CHECK_MS);
  setInterval(inject, 1500);
}
root.SSMPDTipsCoach = { tips: TIPS, show: show, check: check, library: library, start: start, close: close, _context: context, _reset: function () { progress = {}; loaded = true; startedAt = 0; } };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window);
