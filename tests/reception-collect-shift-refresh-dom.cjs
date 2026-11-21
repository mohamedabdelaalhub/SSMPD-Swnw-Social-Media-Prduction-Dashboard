// Owner 2026-11-21 «هو الموظفين لازم يعملوا ريفريش بعد فتح الوردية؟»: the collect form re-reads shifts when it opens,
// lists open shifts only, auto-picks the user's own open shift, and with none shows «افتح ورديتي».
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const src=fs.readFileSync('assets/js/reception-services.js','utf8');
const fn=src.slice(src.indexOf('function shiftLabel('),src.indexOf('function rows(c,list,key){'));
const dom=new JSDOM('<form><label>وردية<select name="shift_id"></select></label></form>',{runScripts:'outside-only'}),w=dom.window,d=w.document;
let opened=0,fresh=null;w.SSMPDAuth={currentAdmin:{id:'me'}};w.SSMPDDb={receptionSnapshot:()=>Promise.resolve(fresh)};
w.eval('var acted=[];function act(a,id,c){acted.push(a);}'+fn+';window.paint=paintShifts;window.fresh=freshShifts;window.acted=acted;');
const esc=v=>String(v);const c={workspace:'ws',from:'d',to:'d',esc,lookup:(l,id)=>({r1:'خزينة منار',r2:'خزينة الاستقبال'})[id]||id,data:{registers:[],shifts:[]}};
const form=d.querySelector('form'),sel=form.elements.shift_id;
w.paint(c,form,null);assert.ok(form.querySelector('[data-rx-no-shift]'),'no open shift → message');assert.match(form.querySelector('[data-rx-no-shift]').textContent,/افتح ورديتك الأول/);
const root=d.createElement('div');d.body.appendChild(root);
form.querySelector('[data-rx-open-shift]').onclick&&0;
(async()=>{
 // shift opened elsewhere after page load → re-read on open, auto-picked, message gone
 fresh={shifts:[{id:'s1',register_id:'r1',status:'open',cashier_id:'me'},{id:'s0',register_id:'r1',status:'closed',cashier_id:'me'},{id:'s2',register_id:'r2',status:'open',cashier_id:'other'}]};
 w.fresh(c,form,root);await new Promise(r=>setTimeout(r,10));
 assert.equal(sel.value,'s1','own open shift selected');assert.deepEqual([...sel.options].map(o=>o.value),['','s1','s2'],'open shifts only');
 assert.match(sel.options[1].textContent,/ورديتك/);assert.equal(form.querySelector('[data-rx-no-shift]'),null);
 // none of mine → button opens the shift form
 c.data.shifts=[{id:'s2',register_id:'r2',status:'open',cashier_id:'other'}];w.paint(c,form,root);
 assert.equal(sel.value,'','someone else\'s shift not auto-picked');form.querySelector('[data-rx-open-shift]').click();
 assert.deepEqual([...w.acted],['shift_open']);assert.equal(root.isConnected,false,'collect modal closed first');
 assert(/sharedPayments\.bindPaymentFields\(fields\);freshShifts\(c,fields,r\);/.test(src),'wired into the collect form');
 console.log('PASS collect form re-reads shifts, auto-picks own open shift, «افتح ورديتي»');
})().catch(e=>{console.error(e);process.exit(1);});
