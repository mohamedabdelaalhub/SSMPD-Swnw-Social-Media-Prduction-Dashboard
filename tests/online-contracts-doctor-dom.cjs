// DOM test: doctor side «عقدي»: entry + count only for linked doctors, consent (non-blocking), contract text + schedule, signature (draw on canvas / upload image), accept / reject-with-reason, stale, enforcement notice, errors.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
(async () => {
  const dom = new JSDOM('<div id="user-dropdown"><button class="ud-item" data-goto="home">الرئيسية</button></div>', { url: 'https://test.invalid', runScripts: 'outside-only', pretendToBeVisual: true }), w = dom.window, d = w.document;
  const calls = [], toasts = []; let inbox;
  const sched = [{ service: 'حشو أسنان (D-1)', fee_kind: 'percent', rate: 30, fixed_amount: null, valid_from: '2027-01-01', valid_to: '2027-12-31', basis: 'performed', base_scope: 'service', deduction: 'none' }, { service: 'كشف', fee_kind: 'fixed', rate: 0, fixed_amount: 200, valid_from: '2027-01-01', valid_to: '2027-12-31', basis: 'collected', base_scope: 'invoice', deduction: 'cost' }];
  const req = (id, status, extra) => Object.assign({ id, reference: 'اتفاق 2027', status, stale: false, template_version: 3, schedule: sched, text: 'نص العقد القانوني <b>x</b>\n\nجدول الشروط المالية\n1. ...', sha256: 'a'.repeat(64), created_at: '2026-11-09', decided_at: null, reason: null }, extra || {});
  inbox = { linked: true, doctor_key: 'DOC-Q', pending: 1, enforcement: { contract_signature: { start_date: '2027-02-01', active: false }, consent: { start_date: null, active: false } }, compliance: { contract_ok: false, consent_ok: false }, consent: { template_id: 'c1', version: 1, title: 'إقرار المسؤولية', body: 'أقر بأنني المسؤول مهنيًا', sha256: 'b'.repeat(64), accepted_at: null }, requests: [req('r1', 'pending')] };
  let fail = null;
  w.SSMPDToast = { show: (m, k) => toasts.push([m, k]) };
  w.SSMPDAuth = { currentAdmin: { id: 'adm-1' } };
  w.SSMPDDb = { client: { rpc: async (name, args) => { calls.push([name, args]); if (fail) return { error: { message: fail } }; if (name === 'doctor_contract_inbox') return { data: JSON.parse(JSON.stringify(inbox)) }; if (name === 'doctor_contract_decide') { const r = inbox.requests.find(x => x.id === args.p_request); r.status = args.p_accept ? 'accepted' : 'rejected'; r.decided_at = '2026-11-10T08:00:00Z'; r.reason = args.p_reason; r.signature_kind = args.p_sig_kind; r.signature_image = args.p_sig_image; inbox.pending = 0; return { data: { status: r.status } }; } if (name === 'doctor_consent_accept') { inbox.consent.accepted_at = '2026-11-10T08:00:00Z'; inbox.consent.signature_kind = args.p_sig_kind; inbox.consent.signature_image = args.p_sig_image; return { data: {} }; } } } };
  // jsdom has no canvas: a tiny recording stub
  const strokes = []; const PNGURL = 'data:image/png;base64,' + Buffer.from('drawn-signature'.repeat(10)).toString('base64');
  w.HTMLCanvasElement.prototype.getContext = function () { return { beginPath() {}, moveTo(x, y) { strokes.push(['m', x, y]); }, lineTo(x, y) { strokes.push(['l', x, y]); }, stroke() {}, clearRect() { strokes.push(['clear']); } }; };
  w.HTMLCanvasElement.prototype.toDataURL = () => PNGURL;
  const ev = (type, x, y) => { const e = new w.Event(type, { bubbles: true, cancelable: true }); e.clientX = x; e.clientY = y; e.pointerId = 1; return e; };
  const stroke = cv => { cv.dispatchEvent(ev('pointerdown', 10, 10)); cv.dispatchEvent(ev('pointermove', 40, 30)); cv.dispatchEvent(ev('pointerup', 40, 30)); };
  const pick = (input, type, bytes) => { const f = new w.File([Buffer.from(bytes)], 'sig', { type }); Object.defineProperty(input, 'files', { value: [f], configurable: true }); input.dispatchEvent(new w.Event('change', { bubbles: true })); };
  w.__mcNoPoll = true; Object.defineProperty(w.navigator, 'userAgent', { value: 'UA-test', configurable: true });
  w.eval(fs.readFileSync('assets/js/my-contract.js', 'utf8'));
  const tick = async () => { w.SSMPDMyContract._tick(); await new Promise(r => setTimeout(r, 20)); };
  await tick();
  const entry = d.querySelector('[data-my-contract-entry]'); assert(entry, 'entry added for a linked doctor'); assert.equal(entry.textContent, 'عقدي (2)', 'one contract + the consent');
  assert.equal(toasts.length, 1, 'one notification'); assert(toasts[0][0].includes('2')); await tick(); assert.equal(toasts.length, 1, 'no repeat toast');
  entry.click(); await new Promise(r => setTimeout(r, 20));
  const ov = d.querySelector('.mc-overlay'); assert(ov, 'overlay opened');
  assert(ov.querySelector('[data-mc-consent="open"]').textContent.includes('أقر بأنني المسؤول مهنيًا')); assert(ov.querySelector('[data-mc-consent="open"] [data-mc-close]'), 'consent can be postponed (blocks nothing)');
  const card = ov.querySelector('[data-mc-request="r1"]'); assert(card.textContent.includes('نسخة النص 3') && card.textContent.includes('حشو أسنان (D-1)') && card.textContent.includes('نسبة 30') && card.textContent.includes('مبلغ ثابت 200') && card.textContent.includes('حسب التحصيل') && card.textContent.includes('خصم تكلفة المستلزمات'));
  assert(card.textContent.includes('نص العقد القانوني <b>x</b>') && !card.querySelector('b'), 'text is escaped, not interpreted'); assert(!card.textContent.includes('1. ...'), 'schedule text appears once, as a table');
  assert(ov.querySelector('[data-mc-enforce]').textContent.includes('سيُشترط اعتبارًا من 2027-02-01') && !ov.querySelector('[data-mc-enforce]').textContent.includes('الإقرار'), 'only rules with a start date are announced (consent has none)');
  // consent: signing is required (nothing is sent without it), then drawn with pointer events
  ov.querySelector('[data-mc-consent-accept]').click(); await new Promise(r => setTimeout(r, 10));
  assert(d.querySelector('[data-mc-status-line]').textContent.includes('وقّع')); assert(!calls.some(c => c[0] === 'doctor_consent_accept'));
  stroke(ov.querySelector('[data-mc-sig="consent"] [data-mc-canvas]')); assert(strokes.some(x => x[0] === 'l'), 'canvas received the stroke');
  ov.querySelector('[data-mc-sig="consent"] [data-mc-sig-clear]').click(); assert.equal(strokes[strokes.length - 1][0], 'clear'); ov.querySelector('[data-mc-consent-accept]').click(); await new Promise(r => setTimeout(r, 10)); assert(!calls.some(c => c[0] === 'doctor_consent_accept'), 'cleared pad = not signed');
  stroke(ov.querySelector('[data-mc-sig="consent"] [data-mc-canvas]'));
  ov.querySelector('[data-mc-consent-accept]').click(); await new Promise(r => setTimeout(r, 30));
  assert.equal(JSON.stringify(calls.find(c => c[0] === "doctor_consent_accept")[1]), JSON.stringify({ p_template: 'c1', p_sha: 'b'.repeat(64), p_user_agent: 'UA-test', p_sig_kind: 'drawn', p_sig_image: PNGURL }));
  assert(d.querySelector('[data-mc-consent="done"]')); assert.equal(d.querySelector('[data-mc-consent="done"] [data-mc-signed]').getAttribute('src'), PNGURL, 'signature shown under the accepted declaration'); assert.equal(d.querySelector('[data-my-contract-entry]').textContent, 'عقدي (1)');
  // reject needs a reason
  d.querySelector('[data-mc-reject="r1"]').click(); const send = d.querySelector('[data-mc-reject-send="r1"]'); assert(send); send.click(); await new Promise(r => setTimeout(r, 10));
  assert(d.querySelector('[data-mc-status-line]').textContent.includes('سبب الرفض')); assert(!calls.some(c => c[0] === 'doctor_contract_decide'));
  // server error is shown, nothing recorded
  fail = 'نص العقد اتغيّر'; d.querySelector('[data-mc-request="r1"] [data-mc-reason]').value = 'النسبة لا تناسبني'; d.querySelector('[data-mc-reject-send="r1"]').click(); await new Promise(r => setTimeout(r, 20));
  assert(d.querySelector('[data-mc-status-line]').textContent.includes('اتغيّر')); fail = null;
  // accept path: reload to get the buttons back; no signature -> refused locally; a bad file type is refused; upload a PNG -> sent as 'uploaded'
  await w.SSMPDMyContract.reload(); const acc = d.querySelector('[data-mc-accept="r1"]'); assert(acc, 'accept button back after reload');
  const nDecide = calls.filter(c => c[0] === 'doctor_contract_decide').length; acc.click(); await new Promise(r => setTimeout(r, 10));
  assert.equal(calls.filter(c => c[0] === 'doctor_contract_decide').length, nDecide, 'accept without a signature sends nothing'); assert(d.querySelector('[data-mc-status-line]').textContent.includes('وقّع'));
  const pad = d.querySelector('[data-mc-sig="r1"]'); pad.querySelector('[data-mc-sig-mode="upload"]').click(); assert.equal(pad.querySelector('[data-mc-canvas]').style.display, 'none'); assert(!pad.querySelector('[data-mc-upload]').hasAttribute('hidden'));
  pick(pad.querySelector('[data-mc-file]'), 'image/gif', 'GIF89a'); await new Promise(r => setTimeout(r, 30)); assert(d.querySelector('[data-mc-status-line]').textContent.includes('PNG أو JPEG'));
  d.querySelector('[data-mc-request="r1"] [data-mc-accept]').click(); await new Promise(r => setTimeout(r, 10)); assert.equal(calls.filter(c => c[0] === 'doctor_contract_decide').length, nDecide, 'a refused file is not a signature');
  pick(pad.querySelector('[data-mc-file]'), 'image/png', 'png-bytes-here'); await new Promise(r => setTimeout(r, 40));
  const upSrc = pad.querySelector('[data-mc-upload-img]').getAttribute('src'); assert(upSrc.startsWith('data:image/png;base64,'), 'uploaded image previewed on the page');
  d.querySelector('[data-mc-request="r1"] [data-mc-accept]').click(); await new Promise(r => setTimeout(r, 30));
  const dec = calls.filter(c => c[0] === 'doctor_contract_decide').pop()[1]; assert.equal(JSON.stringify(dec), JSON.stringify({ p_request: 'r1', p_accept: true, p_reason: null, p_sha: 'a'.repeat(64), p_user_agent: 'UA-test', p_sig_kind: 'uploaded', p_sig_image: upSrc }));
  assert(d.querySelector('[data-mc-request="r1"] [data-mc-done]').textContent.includes('وافقت على العقد بتاريخ 2026-11-10')); assert.equal(d.querySelector('[data-mc-request="r1"] [data-mc-signed]').getAttribute('src'), upSrc, 'the signature image sits under the signed contract'); assert.equal(d.querySelector('[data-my-contract-entry]').textContent, 'عقدي');
  // stale request: no buttons
  inbox.requests = [req('r2', 'pending', { stale: true })]; await w.SSMPDMyContract.reload(); assert(d.querySelector('[data-mc-stale]')); assert(!d.querySelector('[data-mc-accept]'));
  d.querySelector('.mc-overlay [data-mc-close]').click(); assert(!d.querySelector('.mc-overlay'));
  // not linked -> no entry; migration missing -> no entry
  inbox = { linked: false, requests: [], pending: 0 }; await w.SSMPDMyContract.reload(); assert(!d.querySelector('[data-my-contract-entry]'));
  console.log('PASS online contracts doctor UI');
})().catch(e => { console.error(e); process.exit(1); });
