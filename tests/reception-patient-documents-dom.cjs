// DOM test (owner 2026-11-17): reception patient documents — 5 document types in a dropdown, several files at once (+ مستند تاني / ×),
// a file without a type is refused, each upload goes to the archive edge function with the right category + the type as description,
// nothing uploads without an archive-linked patient, and the timeline modal path uploads and reports the count.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
(async () => {
  const dom = new JSDOM('<form id="f"></form>', { url: 'https://t.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  const sent = [];
  w.SSMPDDb = { uploadPatientFile: async fd => { sent.push({ patient: fd.get('patient_id'), category: fd.get('category'), desc: fd.get('other_description'), name: fd.get('file').name }); return { ok: true }; } };
  let toasts = []; w.SSMPDToast = { show: (m, k) => toasts.push([m, k || 'success']) };
  w.eval(fs.readFileSync('assets/js/reception-patient-documents.js', 'utf8'));
  const D = w.SSMPDReceptionDocs, form = d.getElementById('f');
  form.innerHTML = D.markup(true); D.wire(form);
  assert.equal(form.querySelectorAll('[name]').length, 0, 'no named fields: the booking FormData stays clean');
  const opts = [...form.querySelectorAll('[data-rxd-type] option')].map(o => o.textContent).slice(1);
  assert.equal(opts.length, 5); assert(opts[0].includes('البطاقة') && opts[1].includes('الباسبور') && opts[2].includes('كارنيه') && opts[3].includes('خطاب التحمل') && opts[4].includes('شهادة ميلاد الطفل'));
  form.querySelector('[data-rxd-add]').click(); form.querySelector('[data-rxd-add]').click();
  assert.equal(form.querySelectorAll('[data-rxd-row]').length, 3);
  form.querySelectorAll('[data-rxd-remove]')[2].click(); assert.equal(form.querySelectorAll('[data-rxd-row]').length, 2);
  const setFile = (input, name) => Object.defineProperty(input, 'files', { configurable: true, value: [new w.File(['x'], name, { type: 'image/jpeg' })] });
  const rows = form.querySelectorAll('[data-rxd-row]');
  setFile(rows[0].querySelector('[data-rxd-file]'), 'id.jpg');
  assert.throws(() => D.picked(form), /اختار نوع المستند للملف: id.jpg/);
  rows[0].querySelector('[data-rxd-type]').value = 'national_id';
  rows[1].querySelector('[data-rxd-type]').value = 'approval_letter'; setFile(rows[1].querySelector('[data-rxd-file]'), 'letter.pdf');
  const items = D.picked(form); assert.equal(items.length, 2);
  await assert.rejects(() => D.upload(null, items), /مش مربوط بأرشيف المرضى/);
  assert.equal(await D.upload('arch-1', items, form.querySelector('[data-rxd-status]')), 2);
  assert.deepEqual(sent.map(s => [s.patient, s.category, s.name]), [['arch-1', 'id_document', 'id.jpg'], ['arch-1', 'insurance', 'letter.pdf']]);
  assert(sent[1].desc.includes('خطاب التحمل')); assert.equal(form.querySelector('[data-rxd-status]').textContent, 'اترفع 2 مستند');
  // timeline modal path
  let saveFn = null, modalRoot = null;
  const modal = (title, body, save) => { modalRoot = d.createElement('div'); modalRoot.innerHTML = '<h3>' + title + '</h3><form>' + body + '</form>'; d.body.append(modalRoot); saveFn = save; return modalRoot; };
  D.openModal(null, 'X', modal); assert.equal(modalRoot, null); assert.match(toasts.pop()[0], /مش مربوط/);
  D.openModal('arch-2', 'منى', modal);
  assert(modalRoot.querySelector('h3').textContent.includes('منى') && !modalRoot.querySelector('details'), 'open, no collapse');
  assert.throws(() => saveFn(), /ملف واحد على الأقل/);
  const r = modalRoot.querySelector('[data-rxd-row]'); r.querySelector('[data-rxd-type]').value = 'passport'; setFile(r.querySelector('[data-rxd-file]'), 'pp.png');
  assert.equal(await saveFn(), 1); assert.deepEqual([sent.at(-1).patient, sent.at(-1).category], ['arch-2', 'id_document']); assert.match(toasts.pop()[0], /اترفع 1 مستند/);
  console.log('PASS reception patient documents: 5 types, several files, type required, archive upload with category + description, unlinked refused, timeline modal.');
})().catch(e => { console.error(e); process.exit(1); });
