const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
let modal, saved, writes = 0, refreshed = 0, fail = false;
const messages = [];
const client = { from(table) {
  const query = { update(patch) { saved = { table, patch, filters: {} }; writes++; return this; },
    eq(key, value) { saved.filters[key] = value; return this; }, select() { return this; },
    single() { return Promise.resolve(fail ? { error: { message: 'denied' } } : { data: { id: 'contract-1' } }); } };
  return query;
} };
const document = {
  body: { appendChild(node) { modal = node; } },
  createElement() {
    const controls = {};
    return { remove() { this.removed = true; }, querySelectorAll() { return []; },
      querySelector(selector) { return controls[selector] ||= { value: '', focus() {}, disabled: false }; } };
  }
};
const window = { SSMPD_CONFIG: { supabase: { url: 'https://example.invalid', anonKey: 'test' } },
  supabase: { createClient: () => client }, SSMPDToast: { show(message) { messages.push(message); } } };
const context = vm.createContext({ window, document, console, Promise });
vm.runInContext(fs.readFileSync(path.join(root, 'assets/js/db.js'), 'utf8'), context);
const ui = fs.readFileSync(path.join(root, 'assets/js/render-contracting-entities.js'), 'utf8');
vm.runInContext(ui.replace('window.SSMPDRenderContractingEntities = { render: render };',
  'window.testEdit = openEditContract;'), context);
const contract = { id: 'contract-1', entity_id: 'entity-1', status: 'negotiating',
  agreement_date: '2026-09-01', start_date: '2026-09-01', end_date: '2027-09-01',
  discount_percent: 30, cashback_percent: 10, services: 'خدمات', signed_document_url: 'https://example.invalid/contract.pdf' };
function open() {
  window.testEdit(contract, () => refreshed++);
  const values = { status: 'active', agreement: '2026-09-21', start: '2026-10-01', end: '2027-10-01',
    discount: '30', cashback: '10', recipient: '', transfer: '', services: 'خدمات', notes: '', signer: '' };
  for (const [key, value] of Object.entries(values)) modal.querySelector('#cee-' + key).value = value;
}
const submit = () => modal.querySelector('#cee-form').onsubmit({ preventDefault() {} });
const settle = () => new Promise(resolve => setImmediate(resolve));
async function main() {
  open();
  assert.ok(modal.innerHTML.includes('value="negotiating" selected'));
  assert.ok(modal.innerHTML.includes('value="2027-09-01"'));
  modal.querySelector('#cee-end').value = '2026-09-01'; submit();
  assert.equal(writes, 0, 'Reversed dates must not save');
  modal.querySelector('#cee-end').value = '2027-10-01';
  modal.querySelector('#cee-discount').value = '101'; submit();
  assert.equal(writes, 0, 'Invalid percentages must not save');
  modal.querySelector('#cee-discount').value = '30'; submit(); submit(); await settle();
  assert.equal(writes, 1, 'Double submit saves only once');
  assert.deepEqual(saved.filters, { id: 'contract-1', entity_id: 'entity-1' });
  assert.equal(saved.table, 'contracting_entity_contracts');
  assert.equal(saved.patch.status, 'active');
  assert.equal(saved.patch.agreement_date, '2026-09-21');
  assert.equal(saved.patch.start_date, '2026-10-01');
  assert.equal(saved.patch.end_date, '2027-10-01');
  assert.equal('signed_document_url' in saved.patch, false, 'Keep uploaded file metadata untouched');
  assert.equal(refreshed, 1);
  assert.equal(modal.removed, true);
  open(); modal.querySelector('#cee-end').value = ''; submit(); await settle();
  assert.equal(saved.patch.end_date, null, 'Allow removing an optional end date');
  fail = true; open(); submit(); await settle();
  assert.equal(modal.removed, undefined, 'Failed save keeps the form open');
  assert.equal(modal.querySelector('#cee-save').disabled, false);
  assert.ok(messages.at(-1).includes('denied'));
  const before = writes; open(); modal.querySelector('#cee-cancel').onclick();
  assert.equal(writes, before, 'Cancel must not save');
  console.log('PASS contract status/dates, exact record update, validation, retry, cancel and document preservation');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
