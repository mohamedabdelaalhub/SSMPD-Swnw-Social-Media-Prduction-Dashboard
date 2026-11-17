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
  const cb = [{ id: 'c1', channel: 'whatsapp', customer_name: 'سلمى', phone: '01000000005', doctor_name: 'د. دينا', appointment_date: today, appointment_time: '20:00', status: 'confirmed', booking_reference: 'M-1' }];
  const portal = [{ id: 'p1', status: 'pending', requested_date: today }, { id: 'p2', status: 'confirmed', requested_date: today }, { id: 'p3', status: 'cancelled_by_staff', requested_date: today }];
  let portalRendered = 0;
  const q = { select() { return q; }, gte() { return q; }, order() { return q; }, limit() { return Promise.resolve({ data: cb }); } };
  w.SSMPDDb = { client: { rpc: async (fn, a) => { assert.equal(fn, 'clinic_reception_fallback'); assert.equal(a.p_workspace, 'ws1'); return { data: { bookings: fb } }; }, from: t => { assert.equal(t, 'customer_bookings'); return q; }, functions: { invoke: async (n, o) => { assert.equal(o.body.op, 'staff_list'); return { data: { requests: portal } }; } } } };
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
  assert.deepEqual(['whatsapp', 'website', 'portal'].map(k => btn(k).querySelector('.ab-total').textContent), ['3', '1', '3']);
  assert(btn('whatsapp').textContent.includes('1 محتاج إجراء') && btn('whatsapp').textContent.includes('النهارده 2'));
  assert(btn('website').textContent.includes('1 محتاج إجراء') && btn('website').textContent.includes('النهارده 1'), 'conflict needs action');
  assert(btn('portal').textContent.includes('1 محتاج إجراء') && btn('portal').textContent.includes('النهارده 2'));
  btn('whatsapp').click();
  const panel = () => card.querySelector('[data-ab-panel]');
  assert(!panel().hidden && panel().textContent.includes('منى') && panel().textContent.includes('سلمى') && !panel().textContent.includes('ملغي'));
  assert(!panel().querySelector('b'), 'escaped');
  let went = 0; d.querySelector('[data-rx-section="appointments"]').onclick = () => went++;
  panel().querySelector('[data-ab-goto]').click(); assert.equal(went, 1, 'jumps to المواعيد');
  btn('portal').click(); assert.equal(portalRendered, 1); assert(panel().textContent.includes('شاشة البوابة'));
  btn('portal').click(); assert(panel().hidden, 'second tap closes');
  // redraw of the reception host keeps the card without refetching
  card.remove(); w.SSMPDAutoBookings.decorate({ data: { workspace: { mode: 'live' } }, workspace: 'ws1', host });
  assert.equal(d.getElementById('auto-booking-requests-rx').querySelector('[data-ab-open="whatsapp"] .ab-total').textContent, '3');
  console.log('PASS auto booking requests: one card, 3 channel buttons with totals / needs action / today, lists per channel, portal screen reused, old card hidden, trial ignored.');
})().catch(e => { console.error(e); process.exit(1); });
