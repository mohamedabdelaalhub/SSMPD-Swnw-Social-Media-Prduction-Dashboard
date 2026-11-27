// Owner 2026-11-27 «الزرار دا عطلان مابقاش بيفتح» («تعديل البيانات» in a lead): the edit panel opened below the long
// «رسالة افتتاحية جاهزة» block, out of view. Real leads-edit-details.js in jsdom: the click opens the panel RIGHT UNDER the header,
// «إلغاء» closes it, and the ✕ of the modal is still there.
const { JSDOM } = require('jsdom'); const fs = require('fs'); const path = require('path'); const assert = require('assert');
const root = path.join(__dirname, '..');
const dom = new JSDOM('<!doctype html><body><div id="ld-sub-view"><button data-open="L1">فتح</button></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window; w.HTMLElement.prototype.scrollIntoView = function () { w.__scrolled = this.id; };
w.SSMPDDb = { client: { from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { id: 'L1', customer_name: 'لمياء', phone_raw: '01028124677', source: 'whatsapp', message_text: '' }, error: null }) }) }) }), functions: { invoke: () => Promise.resolve({ data: {}, error: null }) } } };
w.eval(fs.readFileSync(path.join(root, 'assets/js/leads-edit-details.js'), 'utf8'));
(async () => {
  w.document.querySelector('[data-open]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const bd = w.document.createElement('div'); bd.className = 'modal-backdrop';
  bd.innerHTML = '<div class="modal"><div class="modal-head"><h3>لمياء</h3><button class="modal-close">✕</button></div><p>الهاتف…</p>' +
    '<div class="lead-opener"><select><option>علاج طبيعي</option></select><textarea rows="30"></textarea></div>' +
    '<div class="field"><select id="lm-status"></select><button id="lm-save-status">حفظ</button></div></div>';
  w.document.body.appendChild(bd);
  await new Promise(r => setTimeout(r, 20));
  const modal = bd.querySelector('.modal'), btn = modal.querySelector('#lm-edit-details');
  assert.ok(btn, '«تعديل البيانات» button added'); assert.ok(modal.querySelector('.modal-close'), '✕ still there');
  btn.click(); await new Promise(r => setTimeout(r, 20));
  const panel = modal.querySelector('#lm-edit-panel');
  assert.ok(panel, 'click opens the edit panel');
  assert.ok(panel.previousElementSibling && panel.previousElementSibling.classList.contains('modal-head'), 'panel sits right under the header (visible), not below the opener block');
  assert.strictEqual(w.__scrolled, 'lm-edit-panel', 'panel is scrolled into view');
  assert.strictEqual(modal.querySelector('#lm-edit-name').value, 'لمياء');
  panel.querySelector('#lm-edit-cancel').click(); assert.ok(!modal.querySelector('#lm-edit-panel'), '«إلغاء» closes the panel');
  console.log('leads-edit-visible-dom: OK');
})().catch(e => { console.error(e); process.exit(1); });
