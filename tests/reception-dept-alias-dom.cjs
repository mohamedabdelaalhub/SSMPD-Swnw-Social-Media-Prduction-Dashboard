// Owner 2026-11-21: typing «معمل» in «القسم / التخصص» found nothing because the lab departments are «التحاليل» / «باقي التحاليل».
// The department combo also matches common spoken names (search-only aliases, never displayed).
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const src=fs.readFileSync('assets/js/reception-workspace.js','utf8');
const pick=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b));
const dom=new JSDOM('',{runScripts:'outside-only'}),w=dom.window;
const ln=src.slice(src.indexOf('function normAr('),src.indexOf('\n',src.indexOf('function normAr(')));
w.eval(ln+'\n'+pick('var DEPT_ALIASES=','function selectCombo(')+';window.da=deptAlias;window.n=normAr;window.cs='+'null;');
const hit=(dept,q)=>w.n(dept+' '+w.da(dept)).includes(w.n(q));
assert(hit('التحاليل','معمل'));assert(hit('باقي التحاليل','معمل'));assert(hit('التحاليل','مختبر'));
assert(hit('الاشعة','سونار'));assert(hit('الأشعة','أشعة'));assert(hit('العلاج الطبيعي','فيزيو'));
assert(hit('النساء والتوليد','حمل'));assert(hit('النفسية والتخاطب','نفسي'));
assert(!hit('الباطنة','معمل'),'no alias leaks to other departments');
assert.equal(w.da('خدمات بدون اسم'),'');
assert(/alias:function\(o\)\{return deptAlias\(o\.text\);\}/.test(src),'department combo uses the aliases');
assert(/\(cfg\.alias\?' '\+cfg\.alias\(o\):''\)/.test(src),'aliases are searched, not rendered');
console.log('PASS department search aliases (معمل → التحاليل)');
