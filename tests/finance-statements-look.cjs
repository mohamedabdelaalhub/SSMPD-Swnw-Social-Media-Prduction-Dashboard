// Owner 2026-11-25 («طبقه», mockup docs/ui-references/mockups/finance-statements-look.html): «القوائم المالية» — answer cards, one tab per statement,
// revenue/expense sections, account TREE by finance_accounts.parent_code (a 4-digit system account sits under its 10-digit parent, archived accounts skipped),
// zero rows behind a toggle, fold, period chips that drive the existing period form, print without buttons. Real browser, real finance-cash.js helpers + CSS,
// as the financial manager, at 1280 and 390 (no horizontal overflow). Totals use the exact same formulas as before.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const accounts=[
 {code:'04',name:'الإيرادات',kind:'income',parent_code:null},{code:'0401',name:'إيرادات النشاط الرئيسي',kind:'income',parent_code:'04'},
 {code:'040101',name:'المبيعات',kind:'income',parent_code:'0401'},{code:'04010101',name:'مبيعات نقدي',kind:'income',parent_code:'040101'},
 {code:'4110',name:'إيراد الكشف (نظام)',kind:'income',parent_code:'040101',is_system:true},{code:'040102',name:'الخصم على المبيعات',kind:'income',parent_code:'0401'},
 {code:'040103',name:'مردودات المبيعات',kind:'income',parent_code:'0401'},{code:'040199',name:'حساب مؤرشف',kind:'income',parent_code:'0401',archived:true},
 {code:'05',name:'المصروفات',kind:'expense',parent_code:null},{code:'0505',name:'أتعاب الأطباء',kind:'expense',parent_code:'05'},{code:'5227',name:'أتعاب بالنسبة (نظام)',kind:'expense',parent_code:'0505'},
 {code:'0506',name:'الإيجارات',kind:'expense',parent_code:'05'},
 {code:'01',name:'الأصول',kind:'asset',parent_code:null},{code:'1111',name:'الخزنة',kind:'asset',parent_code:'01'},{code:'02',name:'الالتزامات',kind:'liability',parent_code:null},{code:'2120',name:'مستحقات الأطباء',kind:'liability',parent_code:'02'},{code:'03',name:'حقوق الملكية',kind:'equity',parent_code:null},{code:'3198',name:'رأس المال',kind:'equity',parent_code:'03'}];
const pl=[['04','الإيرادات','income',0],['0401','إيرادات النشاط الرئيسي','income',0],['040101','المبيعات','income',0],['04010101','مبيعات نقدي','income',39500],['4110','إيراد الكشف (نظام)','income',11500],['040102','الخصم على المبيعات','income',-2750],['040103','مردودات المبيعات','income',0],['05','المصروفات','expense',0],['0505','أتعاب الأطباء','expense',0],['5227','أتعاب بالنسبة (نظام)','expense',-18400],['0506','الإيجارات','expense',0]].map(r=>({code:r[0],name:r[1],kind:r[2],amount:r[3]}));
const bs=[['1111','الخزنة','asset',30000],['2120','مستحقات الأطباء','liability',18400],['3198','رأس المال','equity',0]].map(r=>({code:r[0],name:r[1],kind:r[2],amount:r[3]}));
const data={financial_reports:{from:'2026-11-01',to:'2026-11-25',opening_approved:false,profit_loss:pl,balance_sheet:bs,cumulative_result:11600,cash_opening:10000,cash_closing:30000,cash_flows:[{category:'operating',amount:20000}]},finance_accounts:accounts};
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});try{for(const width of [1280,390]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://fr.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><main id="view-container" style="padding:16px"><section class="fc-workspace"><form class="fc-filters"><label class="fc-field">من<input name="from" type="date" value="2026-11-01"></label><label class="fc-field">إلى<input name="to" type="date" value="2026-11-25"></label><button class="btn" type="submit">عرض الفترة</button></form><div id="host"></div></section></main></body></html>'}));
 await page.route('**/*.woff2',r=>{const f='assets/fonts/'+path.basename(new URL(r.request().url()).pathname);return fs.existsSync(f)?r.fulfill({path:f,contentType:'font/woff2'}):r.abort();});
 await page.goto('https://fr.test/');for(const f of ['styles','finance-cash','finance-reports','dashboard-theme','dashboard-glass'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:"window.SSMPDAuth={currentAdmin:{id:'fm',role:'financial_manager'}};window.SSMPDDb={};window.__submits=0;document.querySelector('.fc-filters').addEventListener('submit',function(e){e.preventDefault();window.__submits++;});"});
 for(const f of ['finance-cash','finance-controls','finance-reports','accountant-workspace'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
 await page.evaluate(d=>{var h=SSMPDFinanceCash.helpers,host=document.getElementById('host');host.innerHTML=SSMPDFinanceControls.panel('reports',d,h);host.querySelectorAll('[data-fin-action]').forEach(function(b){b.onclick=function(){SSMPDFinanceControls.act(b.dataset.finAction,b.dataset.id,d,h);};});},data);
 const txt=s=>page.locator(s).first().innerText();
 // answer cards = the old formulas (revenue = Σ income, expenses = −Σ expense, net = revenue − expenses)
 const cards=await page.locator('[data-fr-pane="pl"] .fr-kpi b').allInnerTexts();assert.deepEqual(cards,['48,250.00','18,400.00','29,850.00']);
 assert.equal(await page.locator('[data-fr-pane="pl"] .fr-foot').count(),0,'repeated summary line removed');
 assert.equal(await txt('.fr-alert b'),'أرصدة الافتتاح لسه ما اتعتمدتش — الأرقام دي من الحركات المتسجلة بس.','one-line opening alert');
 assert.equal(await txt('.fr-head .fr-range'),'من 1 لـ 25 نوفمبر 2026','period in words');assert.doesNotMatch(await page.locator('.fr-look').innerText(),/2026-11-/,'no ISO dates on screen');
 // codes hidden until the toggle; one level (lone «الإيرادات» root not drawn twice)
 assert.equal(await page.locator('.fr-node[data-fr-code="040101"]>.fr-row code').isVisible(),false,'codes hidden');
 assert.equal(await page.locator('.fr-node[data-fr-code="04"]>.fr-row').count(),0,'same-name root not drawn twice');assert.equal(await page.locator('.fr-node[data-fr-code="04"] .fr-node[data-fr-code="0401"]').count(),1);
 await page.locator('[data-fr-pane="pl"] .fr-ct').click();assert(await page.locator('.fr-node[data-fr-code="040101"]>.fr-row code').isVisible(),'codes shown');assert.equal(await txt('[data-fr-pane="pl"] .fr-ct'),'خبّي أرقام الحسابات');
 await page.locator('[data-fr-pane="pl"] .fr-ct').click();assert.equal(await page.locator('.fr-node[data-fr-code="040101"]>.fr-row code').isVisible(),false);
 // tree by parent_code: system 4110 is nested under 040101, its branch total rolls up; archived account absent
 assert.equal(await page.locator('.fr-node[data-fr-code="040101"] .fr-node[data-fr-code="4110"]').count(),1,'4110 sits under 040101 (parent link, not prefix)');
 assert.equal(await page.locator('.fr-node[data-fr-code="0505"] .fr-node[data-fr-code="5227"]').count(),1,'5227 under 0505');
 assert.equal(await page.locator('[data-fr-code="040199"]').count(),0,'archived skipped');
 assert.equal(await page.locator('.fr-node[data-fr-code="040101"]>.fr-row .fr-v').innerText(),'51,000.00','branch rollup');
 assert.equal(await txt('[data-fr-pane="pl"] .fr-sec h5 b'),'48,250.00','section total');
 assert.equal(await page.locator('.fr-node[data-fr-code="0505"]>.fr-row .fr-v').innerText(),'18,400.00','expenses shown positive');
 // zero rows hidden, toggle shows them
 const z=page.locator('.fr-node[data-fr-code="040103"]');assert.equal(await z.isVisible(),false);await page.locator('[data-fr-pane="pl"] .fr-zt[data-fin-action="report-zero"]').click();assert.equal(await z.isVisible(),true);await page.locator('[data-fr-pane="pl"] .fr-zt[data-fin-action="report-zero"]').click();assert.equal(await z.isVisible(),false);
 // fold
 const kid=page.locator('.fr-node[data-fr-code="04010101"]');assert(await kid.isVisible());await page.locator('.fr-fold[data-id="040101"]').click();assert.equal(await kid.isVisible(),false);await page.locator('.fr-fold[data-id="040101"]').click();assert(await kid.isVisible());
 // no overflow
 const ov=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(ov<=1,'overflow '+width+': '+ov);
 if(process.env.FR_QA)await page.screenshot({path:process.env.FR_QA+'/fr-'+width+'.png',fullPage:true});
 // tabs
 await page.locator('.fr-tab[data-id="bs"]').click();assert(await page.locator('[data-fr-pane="bs"]').isVisible());assert.equal(await page.locator('[data-fr-pane="pl"]').isVisible(),false);
 assert.deepEqual(await page.locator('[data-fr-pane="bs"] .fr-kpi b').allInnerTexts(),['30,000.00','18,400.00','0.00']);assert((await txt('[data-fr-pane="bs"] .fr-kpi.gain')).includes('متوازنة'));
 await page.locator('.fr-tab[data-id="cf"]').click();assert.deepEqual(await page.locator('[data-fr-pane="cf"] .fr-kpi b').allInnerTexts(),['10,000.00','20,000.00','30,000.00']);assert((await txt('[data-fr-pane="cf"] .fr-total')).includes('0.00'));assert((await txt('[data-fr-pane="cf"]')).includes('من الشغل اليومي'));assert.doesNotMatch(await txt('[data-fr-pane="cf"]'),/تشغيلية/);
 if(process.env.FR_QA&&width===1280){await page.locator('.fr-tab[data-id="bs"]').click();await page.screenshot({path:process.env.FR_QA+'/fr-bs.png'});}
 // one period control: the form's dates hidden until «فترة تانية…»
 assert.equal(await page.locator('.fc-filters [name=from]').isVisible(),false,'dates hidden while a preset is used');
 await page.locator('.fr-chip[data-fin-action="report-custom"]').click();assert(await page.locator('.fc-filters [name=from]').isVisible(),'«فترة تانية…» shows the dates');assert(await page.locator('.fc-filters button[type=submit]').isVisible());
 await page.locator('.fr-chip[data-id="last"]').click();const v=await page.evaluate(()=>[document.querySelector('.fc-filters [name=from]').value,document.querySelector('.fc-filters [name=to]').value,window.__submits]);assert(/^\d{4}-\d{2}-01$/.test(v[0])&&v[2]===1,'chip fills + submits '+v);
 // print: same report node, buttons stripped
 const printed=await page.evaluate(()=>{var html='';window.open=function(){return {document:{write:function(x){html+=x;},close:function(){}},print:function(){},opener:1};};SSMPDFinanceControls.act('report-print','',{financial_reports:{opening_approved:false}},SSMPDFinanceCash.helpers);return html;});
 assert(printed.includes('الأرباح والخسائر')&&printed.includes('المركز المالي')&&printed.includes('مبيعات نقدي'),'print has all statements');assert(!/<button/.test(printed),'no buttons in print');
 assert(!/[٠-٩]/.test(await page.locator('.fr-look').innerText()),'English digits');
 assert.deepEqual(errors,[]);await page.close();}
 console.log('PASS finance statements look 1280/390: cards = old formulas, parent_code tree (system accounts nested, archived skipped, rollups), zero toggle, fold, tabs, period chips drive the period form, print without buttons, no overflow.');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
