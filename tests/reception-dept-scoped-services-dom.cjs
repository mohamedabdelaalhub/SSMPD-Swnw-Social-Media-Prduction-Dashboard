// Owner 2026-11-21: a doctor department with no services of its own (e.g. «الباطنة», doctors moved there for search) offers the
// services its doctors are scoped + contracted for (consult in خدمات الكشف, سونار in الاشعة), so the modal is not empty.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const src=fs.readFileSync('assets/js/reception-workspace.js','utf8');
const fn=src.slice(src.indexOf('function deptScoped('),src.indexOf('\nfunction fillServices('));
const dom=new JSDOM('',{runScripts:'outside-only'}),w=dom.window;
w.eval("var CONSULT_DEPT='خدمات الكشف';var data={providers:[{id:'d1',department:'الباطنة'},{id:'d2',department:'الاشعة'},{id:'d3',department:'الباطنة',active:false}],provider_service_scopes:{d1:['0001393','0000031'],d2:['0000032'],d3:['X9']}};"+fn+";window.ds=deptScoped;");
const s=c=>({code:c});
assert.equal(w.ds(s('0001393'),'الباطنة'),true,'scoped consult offered in الباطنة');
assert.equal(w.ds(s('0000031'),'الباطنة'),true,'scoped سونار offered');
assert.equal(w.ds(s('0000032'),'الباطنة'),false,'another department doctor scope not offered');
assert.equal(w.ds(s('X9'),'الباطنة'),false,'inactive doctor ignored');
assert.equal(w.ds(s('0001393'),''),false);assert.equal(w.ds(s('0001393'),'__none__'),false);assert.equal(w.ds(s('0001393'),'خدمات الكشف'),false);
assert(/\(inDept\(s,dept\)\|\|isBasic\(s\)\|\|deptScoped\(s,dept\)\)/.test(src),'used by fillServices');
console.log('PASS department offers its doctors\' scoped services');
