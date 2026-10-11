// اختبار تفاصيل الإشعارات وفتح الشاشة المناسبة (بيستخرج الدوال من app.js ويجرّبها).
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(path.join(__dirname, '../assets/js/app.js'), 'utf8');
const pick = (name) => { const i = src.indexOf('  function ' + name + '('); assert.ok(i >= 0, name); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } };
const consts = src.match(/  var NOTIF_FORMATS = [^\n]+\n  var NOTIF_BRANDS = [^\n]+\n/)[0];
const dom = new JSDOM('<div id="tabs-bar"><button data-tab="review"></button><button data-tab="production"></button><button data-tab="design"></button><button data-tab="publish"></button><button data-tab="archive"></button></div><div id="view-container"></div>', { runScripts: 'outside-only' });
const w = dom.window; let tab = null, gotoId = null;
w.TAB_LABELS = { review: 'إدارة المحتوى', production: 'إنتاج المحتوى', design: 'شاشة التصميم', publish: 'النشر', archive: 'الأرشيف' };
w.SSMPDWorkflow = { stageLabel: k => ({ ready_to_publish: 'جاهز للنشر', scheduled: 'مجدول', in_design: 'قيد التصميم' }[k] || k) };
w.SSMPDGotoContent = id => { gotoId = id; };
w.eval('var notifEscHtml=function(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;")};var notifRelTime=function(){return "من 5 دقيقة"};var TAB_LABELS=window.TAB_LABELS;var W;var switchTab=function(t){window.__tab=t};' + consts + ['notifTargetTab', 'notifItemHtml', 'openNotifTarget', 'wireNotifItems'].map(pick).join('\n') + ';window.__f={notifTargetTab,notifItemHtml,openNotifTarget,wireNotifItems};');
const f = w.__f, mk = (o) => Object.assign({ at: new Date().toISOString(), text: 'Zeina Badr — x', contentId: 'c1', title: '6 خطوات', format: 'image_post', brand: 'sono', fromStage: '', toStage: '', action: '' }, o);
const cases = [['تعديل ميعاد النشر إلى 2026-10-21', 'publish'], ['جدولة للنشر', 'publish'], ['تأكيد نشر مجدول', 'publish'], ['إلغاء جدولة النشر', 'publish'], ['نشر', 'archive'], ['نشر فوري (تلقائي)', 'archive'], ['حفظ نسخة تصميم خاصة جديدة', 'design'], ['استلام التصميم', 'design'], ['رفع كاروسيل (3)', 'design'], ['طلب تعديل', 'review'], ['إنشاء', 'production']];
for (const [action, want] of cases) assert.equal(f.notifTargetTab(mk({ action })), want, action);
assert.equal(f.notifTargetTab(mk({ action: 'شيء جديد', toStage: 'in_design' })), 'design');
const html = f.notifItemHtml(mk({ action: 'تعديل ميعاد النشر', fromStage: 'ready_to_publish', toStage: 'scheduled' }), new Date(0).toISOString());
for (const needle of ['«6 خطوات»', 'بوست صورة · سونو', 'جاهز للنشر ← مجدول', 'يفتح في: النشر', 'data-notif-tab="publish"']) assert.ok(html.includes(needle), needle);
const noContent = f.notifItemHtml({ at: new Date().toISOString(), text: 'x — تقرير' }, new Date(0).toISOString());
assert.ok(!noContent.includes('data-notif-cid'), 'usage notifications stay plain');
assert.ok(!f.notifItemHtml(mk({ title: '', action: 'نشر' }), new Date(0).toISOString()).includes('data-notif-cid'), 'deleted item is not clickable');
// الضغط: يفتح التاب ويضغط على عنصر المادة
const host = w.document.createElement('div'); host.innerHTML = html; w.document.body.appendChild(host);
let closed = false, opened = false; f.wireNotifItems(host, () => { closed = true; });
host.querySelector('[data-notif-cid]').click();
assert.ok(closed); assert.equal(w.__tab, 'publish');
setTimeout(() => {
  const row = w.document.createElement('div'); row.setAttribute('data-open-pub', 'c1'); row.onclick = () => { opened = true; }; w.document.getElementById('view-container').appendChild(row);
  setTimeout(() => {
    assert.ok(opened, 'the item row was clicked after the tab rendered');
    // مش ظاهرة في التاب → fallback لإدارة المحتوى
    f.openNotifTarget('zzz', 'design');
    setTimeout(() => { assert.equal(gotoId, 'zzz'); console.log('PASS notif-detail'); w.close(); process.exit(0); }, 4500);
  }, 400);
}, 100);
