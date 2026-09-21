const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
let writes = 0, answer = false, confirmations = 0, lastModal;
const chain = { select() { return this; }, eq() { return this; }, single() { return this; }, then(fn) { return Promise.resolve(fn({ data: { ok: true } })); } };
const client = { from() { return { insert() { writes++; return chain; }, update() { writes++; return chain; } }; }, rpc() { writes++; return chain; } };
const document = {
  activeElement: { isConnected: true, focus() {} },
  addEventListener() {}, removeEventListener() {},
  body: { appendChild(modal) { lastModal = modal; } },
  createElement() {
    const controls = {};
    return { style: {}, remove() { this.removed = true; }, querySelector(key) { return controls[key] ||= { focus() {}, textContent: '' }; } };
  }
};
const window = { SSMPD_CONFIG: { supabase: { url: 'https://example.invalid', anonKey: 'test' } }, supabase: { createClient: () => client }, confirm() { confirmations++; return answer; } };
const context = vm.createContext({ window, document, console, Promise, Set, Map });
for (const file of ['content-text.js', 'db.js']) vm.runInContext(fs.readFileSync(path.join(root, 'assets/js', file), 'utf8'), context);
const T = window.SSMPDContentText, db = window.SSMPDDb;
const paragraph = 'مع بداية المدارس نلاحظ تغير سلوك الطفل وقد يحتاج إلى دعم ومتابعة من الأسرة والمدرسة.';
async function main() {
  assert.equal(T.repeatedExcerpt(paragraph), '');
  for (const separator of ['\n\n', '\n', ' ']) assert.ok(T.repeatedExcerpt(paragraph + separator + paragraph + '\nللتواصل والاستفسار'));
  assert.equal(T.repeatedExcerpt('نعم\nنعم'), '');
  const repeated = paragraph + '\n' + paragraph;
  answer = false;
  await assert.rejects(db.createContentItem({ body: repeated }));
  await assert.rejects(db.updateContentItem('id', { caption_text: repeated }));
  await assert.rejects(db.saveContentIdea({ script: repeated }));
  assert.equal(writes, 0, 'Cancel must prevent every database write');
  answer = true;
  const row = { body: repeated };
  await db.createContentItem(row);
  assert.equal(writes, 1);
  assert.equal(row.body, repeated, 'Keep intentional repetition unchanged');
  const before = confirmations;
  await db.updateContentItem('id', { stage: 'scheduled' });
  assert.equal(confirmations, before, 'Stage-only patches must not show a save warning');
  assert.equal(T.publicationText({ body: paragraph, caption_text: 'Different caption', title: 'Title' }), paragraph);
  assert.equal(T.publicationText({ body: '', title: 'Title' }), 'Title');
  let result = T.preview({ body: repeated }, 'تأكيد النشر');
  assert.ok(lastModal.querySelector('[data-repeat]').textContent.includes('مكرر'));
  assert.equal(lastModal.querySelector('[data-text]').textContent, repeated);
  lastModal.querySelector('[data-back]').onclick();
  assert.equal(await result, false);
  result = T.preview({ body: '<img src=x onerror=alert(1)>' }, 'تأكيد الجدولة');
  assert.equal(lastModal.querySelector('[data-text]').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(lastModal.querySelector('[data-text]').innerHTML, undefined, 'Preview uses textContent, not HTML');
  lastModal.querySelector('[data-continue]').onclick();
  assert.equal(await result, true);
  // Exercise both real UI entry points. Cancelling the preview must not queue a post.
  let updates = 0, jobs = 0, previewAnswer = false;
  window.SSMPDWorkflow = { readPlatformCheckboxes: () => ['facebook'] };
  window.SSMPDAuth = { currentAdmin: { id: 'admin' } };
  window.SSMPDToast = { show() {} };
  document.getElementById = id => ({ value: id.startsWith('pb-brand-') ? 'sono' : id.startsWith('pb-when-') ? '2026-12-01T12:00' : '' });
  document.querySelectorAll = () => [];
  window.SSMPDDb = {
    getContentItem: async () => ({ stage: 'ready_to_publish', body: paragraph }),
    updateContentItem: async () => { updates++; return {}; },
    logActivity: async () => {},
    createMetaPublishJob: async () => { jobs++; },
    listContentItems: async () => []
  };
  T.preview = async () => previewAnswer;
  const source = fs.readFileSync(path.join(root, 'assets/js/render-publish.js'), 'utf8')
    .replace('window.SSMPDRenderPublish = { render: render };', 'window.testPublishing = { schedule: schedule, publishNow: publishNow };');
  vm.runInContext(source, context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  for (const action of ['schedule', 'publishNow']) {
    previewAnswer = false;
    const previous = updates;
    window.testPublishing[action]('item'); await settle();
    assert.equal(updates, previous, action + ' cancellation must not update content');
    previewAnswer = true;
    window.testPublishing[action]('item'); await settle();
    assert.equal(updates, previous + 1, action + ' confirmation must continue once');
  }
  assert.equal(jobs, 2, 'One publish job for each confirmed action');
  console.log('PASS duplicate detection, save cancellation/override, text preservation, preview and HTML escaping');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
