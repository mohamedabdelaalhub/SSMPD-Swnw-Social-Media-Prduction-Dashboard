// Owner 2026-11-18: no English word in the accounting screens. Technical codes become Arabic, unknown text is never
// invented, raw JS errors are replaced by one Arabic message.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<table><tbody><tr><td>open</td><td>manual_correction</td><td>EMP-000037</td><td>abc123</td><td><b>open</b></td><td>confirmed</td></tr></tbody></table>',{runScripts:'outside-only'}),w=dom.window;
w.eval(fs.readFileSync('assets/js/finance-labels.js','utf8'));const L=w.SSMPDFinanceLabels;
assert.equal(L.label('submitted'),'للمراجعة');assert.equal(L.label('payment'),'تحصيل');assert.equal(L.label('no_show'),'ماحضرش');
assert.equal(L.label('reception_whatever'),'الاستقبال','known prefix');assert.equal(L.label('totally_new_code'),'حركة أخرى','unknown code: neutral Arabic, not English');
assert.equal(L.label('خزينة'),'خزينة','Arabic text untouched');assert.equal(L.label(null),'');
L.translate(w.document);const td=[...w.document.querySelectorAll('td')].map(t=>t.textContent);
assert.deepEqual(td,['مفتوحة','تصحيح يدوي','EMP-000037','abc123','open','مؤكد'],'only exact known codes in plain cells change');
assert.equal(w.document.querySelector('td').title,'open','code kept in tooltip');
// finance-cash note(): raw English error → Arabic
const src=fs.readFileSync('assets/js/finance-cash.js','utf8'),m=src.match(/function note\(e\)\{[^\n]*\}/);assert(m,'note() present');const note=new Function(m[0]+';return note;')();
assert.match(note(new Error("Cannot read properties of undefined (reading 'filter')")),/حصلت مشكلة/);assert.equal(note(new Error('الخزينة مقفولة')),'الخزينة مقفولة');
// the screens use the map
for(const f of ['finance-advances','ledger-editor'])assert.match(fs.readFileSync('assets/js/'+f+'.js','utf8'),/SSMPDFinanceLabels/,f+' uses Arabic labels');
console.log('PASS finance labels: statuses/sources/methods in Arabic, unknown codes neutral, Arabic untouched, only exact codes in plain cells, tooltip keeps code, raw JS errors → Arabic, advances/ledger wired');
// one number/date format (owner 2026-11-18)
{const d=new JSDOM('<table><tr><td>-20.00</td><td>1,500.00</td><td>2026-11-18</td><td>INV-1</td></tr></table>',{runScripts:'outside-only'}),x=d.window;x.eval(fs.readFileSync('assets/js/finance-labels.js','utf8'));const F=x.SSMPDFinanceLabels;F.translate(x.document);const c=x.document.querySelectorAll('td');
 assert.equal(c[0].querySelector('.acs-num').getAttribute('dir'),'ltr');assert.equal(c[0].textContent,'−20.00','sign stays on the left');assert.equal(c[2].textContent,'18 نوفمبر 2026');assert.equal(c[3].textContent,'INV-1');
 assert.equal(F.fmtStamp('2026-11-18T07:05:00Z'),'18 نوفمبر 2026 · 9:05 ص');assert.equal(F.fmtStamp('2026-11-18T13:30:00Z'),'18 نوفمبر 2026 · 3:30 م');assert.equal(F.fmtDate('2026-10-31'),'31 أكتوبر 2026');assert.equal(F.fmtStamp(null),'—');
 console.log('PASS formats: signed numbers isolated LTR, ISO dates and stamps in one Arabic format (Cairo time)');}
