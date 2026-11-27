// DOM test (owner 2026-11-17): «طلبات الحجز الآلية» card: 3 buttons (واتساب/الموقع/بوابة المرضى) with totals, «محتاج إجراء» and today's count;
// clicking opens the channel list; the portal button reuses the existing portal screen; the old portal card is not mounted; trial workspace shows nothing.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
const tick = () => new Promise(r => setTimeout(r, 30));
(async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
  const dom = new JSDOM('<div class="rx-shell"><header class="rx-header">الاستقبال</header><main id="host"></main><button data-rx-section="appointments">المواعيد</button></div>', { url: 'https://t.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  const fb = [
    { fallback_booking_id: 'f1', source: 'whatsapp', status: 'pending', reception_confirmed: false, customer_name: 'منى <b>x</b>', phone: '01000000001', doctor_name: 'د. سارة', appointment_date: today, appointment_time: '18:00', needed_service: 'كشف' },
    { fallback_booking_id: 'f2', source: 'whatsapp', status: 'replayed', reception_confirmed: true, customer_name: 'كريم', phone: '01000000002', doctor_name: 'د. سارة', appointment_date: '2099-01-01', appointment_time: '18:20' },
    { fallback_booking_id: 'f3', source: 'website', status: 'conflict', reception_confirmed: true, customer_name: 'هدى', phone: '01000000003', doctor_name: 'د. علي', appointment_date: today, appointment_time: '19:00' },
    { fallback_booking_id: 'f4', source: 'whatsapp', status: 'cancelled', customer_name: 'ملغي', phone: '01000000004', appointment_date: today }];
  const cb = [{ id: 'c1', channel: 'whatsapp', customer_name: 'سلمى', phone: '01000000005', doctor_name: 'د. دينا', appointment_date: today, appointment_time: '20:00', status: 'confirmed', booking_reference: 'M-1' },
    // website form (2026-11-22): the agent mirrors it as channel 'other' + wa_id 'web:…'; a future 'website' channel counts too
    { id: 'c2', channel: 'other', wa_id: 'web:1a2b3c4d', customer_name: 'ياسمين', phone: '01000000006', doctor_name: 'د. شريف', appointment_date: today, appointment_time: '21:00', status: 'confirmed', booking_reference: '236100' },
    { id: 'c3', channel: 'website', wa_id: 'web:5e6f7a8b', customer_name: 'رنا', phone: '01000000007', doctor_name: 'د. شريف', appointment_date: '2099-01-02', appointment_time: '21:20', status: 'confirmed', booking_reference: '236101' },
    { id: 'c6', channel: 'other', wa_id: 'web:aaaaaaaa', customer_name: 'تأمين وصل', phone: '01000000010', doctor_name: 'د. شريف', appointment_date: today, appointment_time: '21:40', status: 'confirmed', booking_reference: '236102', payment_mode: 'insurance', payer_entity_id: 'e1', approval_no: 'AP-5566', approval_at: '2026-11-27T12:05:00Z' },
    { id: 'c7', channel: 'other', wa_id: 'web:bbbbbbbb', customer_name: 'تأمين مستني', phone: '01000000011', doctor_name: 'د. شريف', appointment_date: today, appointment_time: '22:00', status: 'confirmed', booking_reference: '236103', payment_mode: 'insurance', payer_entity_id: 'e1' },
    { id: 'c4', channel: 'other', wa_id: 'web:99999999', customer_name: 'ملغي موقع', phone: '01000000008', appointment_date: today, status: 'cancelled' },
    { id: 'c5', channel: 'other', wa_id: '201000000009', customer_name: 'قناة تانية', phone: '01000000009', appointment_date: today, status: 'confirmed' }];
  const portal = [{ id: 'p1', status: 'pending', requested_date: today }, { id: 'p2', status: 'confirmed', requested_date: today }, { id: 'p3', status: 'cancelled_by_staff', requested_date: today }];
  let portalRendered = 0;
  const qe = { select() { return qe; }, in(c, ids) { assert.equal(c, 'id'); assert.deepEqual(ids, ['e1']); return Promise.resolve({ data: [{ id: 'e1', name: 'تأمين أ' }] }); } };
  const q = { select() { return q; }, gte() { return q; }, order() { return q; }, limit() { return Promise.resolve({ data: cb }); } };
  w.SSMPDDb = { client: { rpc: async (fn, a) => { assert.equal(fn, 'clinic_reception_fallback'); assert.equal(a.p_workspace, 'ws1'); return { data: { bookings: fb } }; }, from: t => { if (t === 'contracting_entities') return qe; assert.equal(t, 'customer_bookings'); return q; }, functions: { invoke: async (n, o) => { assert.equal(o.body.op, 'staff_list'); return { data: { requests: portal } }; } } } };
  w.SSMPDAuth = { currentAdmin: { id: 'a1', role: 'reception' } }; w.SSMPDRoles = { hasAnyRole: (a, rs) => rs.includes(a.role) };
  w.eval(fs.readFileSync('assets/js/portal-booking-requests.js', 'utf8'));
  w.SSMPDPortalBookingRequests.render = box => { portalRendered++; box.textContent = 'شاشة البوابة'; };
  w.eval(fs.readFileSync('assets/js/auto-booking-requests.js', 'utf8'));
  const host = d.getElementById('host');
  w.SSMPDAutoBookings.decorate({ data: { workspace: { mode: 'trial' } }, workspace: 'ws0', host });
  assert(!d.getElementById('auto-booking-requests-rx'), 'nothing for a trial workspace');
  w.SSMPDAutoBookings.decorate({ data: { workspace: { mode: 'live' } }, workspace: 'ws1', host }); await tick(); await tick();
  const card = d.getElementById('auto-booking-requests-rx'); assert(card && card.previousElementSibling.classList.contains('rx-header'), 'card right under the header');
  assert.equal(card.querySelector('h3').textContent, 'طلبات الحجز الآلية');
  assert(!d.getElementById('portal-booking-requests-rx'), 'old portal card not mounted');
  const btn = k => card.querySelector('[data-ab-open="' + k + '"]');
  assert.deepEqual(['whatsapp', 'website', 'portal'].map(k => btn(k).querySelector('.ab-name').textContent), ['واتساب', 'الموقع', 'بوابة المرضى']);
  assert.deepEqual(['whatsapp', 'website', 'portal'].map(k => btn(k).querySelector('.ab-total').textContent), ['3', '5', '3']);
  assert(btn('whatsapp').textContent.includes('1 محتاج إجراء') && btn('whatsapp').textContent.includes('النهارده 2'));
  assert(btn('website').textContent.includes('1 محتاج إجراء') && btn('website').textContent.includes('النهارده 4'), 'conflict needs action; website-form bookings counted today');
  assert.deepEqual(cb.map(b => w.SSMPDAutoBookings.mirrorChannel(b)), ['whatsapp', 'website', 'website', 'website', 'website', 'website', 'other']);
  assert(btn('portal').textContent.includes('1 محتاج إجراء') && btn('portal').textContent.includes('النهارده 2'));
  btn('whatsapp').click();
  const panel = () => card.querySelector('[data-ab-panel]');
  assert(!panel().hidden && panel().textContent.includes('منى') && panel().textContent.includes('سلمى') && !panel().textContent.includes('ملغي'));
  assert(!panel().querySelector('b'), 'escaped');
  let went = 0; d.querySelector('[data-rx-section="appointments"]').onclick = () => went++;
  panel().querySelector('[data-ab-goto]').click(); assert.equal(went, 1, 'jumps to المواعيد');
  btn('website').click();
  assert(panel().textContent.includes('هدى') && panel().textContent.includes('ياسمين') && panel().textContent.includes('رنا'), 'website list shows fallback + website-form bookings');
  assert(panel().textContent.includes('236100') && panel().textContent.includes('اتسجلت على ماسا'));
  assert(!panel().textContent.includes('ملغي موقع') && !panel().textContent.includes('قناة تانية') && !panel().textContent.includes('سلمى'), 'cancelled / other-channel / whatsapp rows stay out of الموقع');
  // payment step (owner 2026-11-27): badge, entity name, approval number + time + copy, filters
  const wp = panel().textContent;
  assert(wp.includes('تأمين · الموافقة وصلت') && wp.includes('تأمين أ') && wp.includes('AP-5566') && wp.includes('وصلت 14:05') && panel().querySelector('[data-ab-copy="AP-5566"]'), 'approval arrived: badge, entity, number, time, copy');
  assert(wp.includes('تأمين · مستنية موافقة') && wp.includes('لسه ما بعتتش رقم الموافقة'), 'insurance without approval');
  const chip = k => panel().querySelector('[data-ab-pay="' + k + '"]');
  chip('wait').click(); assert(panel().textContent.includes('تأمين مستني') && !panel().textContent.includes('تأمين وصل') && !panel().textContent.includes('ياسمين'), 'filter: waiting for approval');
  chip('got').click(); assert(panel().textContent.includes('تأمين وصل') && !panel().textContent.includes('تأمين مستني'), 'filter: approval arrived');
  chip('direct').click(); assert(panel().textContent.includes('ياسمين') && !panel().textContent.includes('تأمين وصل'), 'filter: direct (no payer)');
  chip('all').click();
  btn('whatsapp').click(); assert(!panel().textContent.includes('ياسمين'), 'website-form bookings stay out of واتساب');
  assert(!panel().querySelector('[data-ab-pay]'), 'payment filters only on الموقع');
  btn('portal').click(); assert.equal(portalRendered, 1); assert(panel().textContent.includes('شاشة البوابة'));
  btn('portal').click(); assert(panel().hidden, 'second tap closes');
  // redraw of the reception host keeps the card without refetching
  card.remove(); w.SSMPDAutoBookings.decorate({ data: { workspace: { mode: 'live' } }, workspace: 'ws1', host });
  assert.equal(d.getElementById('auto-booking-requests-rx').querySelector('[data-ab-open="whatsapp"] .ab-total').textContent, '3');
  console.log('PASS auto booking requests: website-form mirror rows (other + web:) counted under الموقع; one card, 3 channel buttons with totals / needs action / today, lists per channel, portal screen reused, old card hidden, trial ignored.');
})().catch(e => { console.error(e); process.exit(1); });
