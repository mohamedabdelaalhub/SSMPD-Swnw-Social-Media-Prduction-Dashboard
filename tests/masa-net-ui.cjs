// تقرير ماسا: التحصيل والمصروفات والصافي — واجهة (RPC مموّه)
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const src=fs.readFileSync(__dirname+'/../assets/js/finance-masa-net.js','utf8');
const tick=()=>new Promise(r=>setTimeout(r,15));
const report={from:'2026-01-01',to:'2026-11-20',group_by:'month',source:null,totals:{income:4862300,operating:1432830,advance:591822,partner_draw:529525,transfer:280336,ignored:155742,unclassified:124594,net_cash:1584129,net_operating:3304876},
 by_period:[{period:'2026-10',income:598000,operating:310000,advance:90000,partner_draw:64000,transfer:58000,net_cash:134000,net_operating:288000},{period:'2026-11',income:612000,operating:286000,advance:94000,partner_draw:68000,transfer:56000,net_cash:164000,net_operating:326000}],
 unclassified_accounts:[{account:'مستلزمات طبية متنوعة',code:'5101',amount:124594,payouts:51}],
 top_accounts:[{account:'رواتب موظفين',kind:'operating',amount:642000,payouts:212},{account:'مستلزمات طبية متنوعة',kind:'unclassified',amount:124594,payouts:51}]};
(async()=>{const dom=new JSDOM('<div id="host"></div>',{url:'https://t.invalid',runScripts:'outside-only'}),w=dom.window,d=w.document;const calls=[];
 w.SSMPDDb={client:{rpc:(n,a)=>{calls.push([n,a]);return Promise.resolve({data:a.p_action==='classify'?{ok:true}:report});}}};
 w.SSMPDFinanceControls={panel:(t)=>t==='masa-payments'?'<div class="mp" data-masa-payments>x</div>':'other',act(){},due(){},ledger(){}};
 w.SSMPDToast={show(){}};w.eval(src);
 assert.equal(w.SSMPDFinanceControls.panel('other'),'other');
 d.getElementById('host').innerHTML=w.SSMPDFinanceControls.panel('masa-payments');
 assert.ok(d.querySelector('[data-mn-pane="net"][hidden]'),'net view hidden by default');
 d.querySelector('[data-mn-view="net"]').click();await tick();
 assert.equal(calls[0][0],'clinic_finance_masa_net');assert.equal(calls[0][1].p_action,'report');assert.equal(calls[0][1].p.group_by,'month');assert.equal(calls[0][1].p.source,undefined);
 assert.equal(d.querySelectorAll('.mn-tile').length,4);assert.ok(d.querySelector('.mn-tile.hero').textContent.includes('1,584,129'));
 assert.ok(d.querySelector('.mn-warn').textContent.includes('1'),'unclassified warning');
 // source filter
 d.querySelector('[data-mn-source="old"]').click();await tick();assert.equal(calls.at(-1)[1].p.source,'old');
 d.querySelector('[data-mn-source=""]').click();await tick();assert.equal(calls.at(-1)[1].p.source,undefined);
 // tile popup
 d.querySelector('[data-mn-tile="out"]').click();assert.ok(d.querySelector('.mn-modal'));assert.ok(d.querySelector('.mn-modal').textContent.includes('غير مصنّف'));d.querySelector('[data-mn-close]').click();assert.equal(d.querySelector('.mn-modal'),null);
 // drill to days
 d.querySelector('[data-mn-month="2026-10"]').click();await tick();let p=calls.at(-1)[1].p;assert.equal(p.group_by,'day');assert.equal(p.from,'2026-10-01');assert.equal(p.to,'2026-10-31');assert.ok(d.querySelector('[data-mn-back]'));
 // classify
 d.querySelector('[data-mn-edit="1"]').click();assert.ok(d.querySelector('.mn-modal'));
 d.querySelector('[data-mn-save]').click();assert.equal(calls.filter(c=>c[1].p_action==='classify').length,0,'kind required');
 d.querySelector('[data-kind="advance"]').click();d.querySelector('[data-mn-cat]').value='مستلزمات';d.querySelector('[data-mn-save]').click();await tick();
 const c=calls.filter(x=>x[1].p_action==='classify')[0];assert.equal(c[1].p.account_name,'مستلزمات طبية متنوعة');assert.equal(c[1].p.kind,'advance');assert.equal(c[1].p.category,'مستلزمات');
 // unclassified list modal
 d.querySelector('[data-mn-classify]').click();assert.ok(d.querySelector('[data-mn-un="0"]'));
 console.log('PASS masa net report UI: tabs, tiles, source filter, popups, day drill, classify.');w.close();
})().catch(e=>{console.error(e);process.exit(1);});
