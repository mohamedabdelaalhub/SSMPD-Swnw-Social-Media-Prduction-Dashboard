const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const src=fs.readFileSync('assets/js/render-patients.js','utf8'),tick=()=>new Promise(r=>setTimeout(r,0));
(async()=>{
 const dom=new JSDOM('<details class="nutrition-visit-card" open><div id="status"></div></details><div id="meals"><div class="meal-row" data-meal-id="m"></div></div>',{runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;let timers=[],rows=[{meal_id:'m',completed:true}],reads=0;
 w.setTimeout=f=>timers.push(f);w.SSMPDDb={listNutritionMealCompletions:async()=>[],listNutritionDailyCompletions:async()=>{reads++;return rows}};w.eval(fs.readFileSync('assets/js/nutrition-view.js','utf8'));w.escapeHtml=v=>String(v).replace(/</g,'&lt;');
 w.eval(src.slice(src.indexOf('  function watchNutritionStatus('),src.indexOf('  function openNutritionVisitFormModal(')));
 const el=w.document.getElementById('status');w.watchNutritionStatus(el,{id:'v',visit_date:'2026-01-01',meals:[{id:'m',name:'<img>'}]});await tick();assert.match(el.textContent,/تم تأكيد 1 من 1/);assert.equal(el.querySelector('img'),null);
 rows=[{meal_id:'m',completed:false}];timers.shift()();await tick();assert.match(el.textContent,/تم تأكيد 0 من 1/);el.remove();let before=reads;timers.shift()();await tick();assert.equal(reads,before);
 const code=src.slice(src.indexOf('    function applyCompletionUi()'),src.indexOf('    function loadCompletions()'));
 w.eval('var v={visit_date:"2026-01-01",meals:[{id:"m"}]},trackingDay={value:"2026-09-01"},mealsContainer=document.getElementById("meals"),completions={},completionsLoaded=false,completionWrites=0;'+code+';applyCompletionUi();');assert.equal(w.document.querySelector('input').disabled,true);
 w.eval('completionsLoaded=true;completions={m:{completed:true}};applyCompletionUi();');assert.equal(w.document.querySelector('input').checked,true);assert.equal(w.document.querySelector('input').disabled,false);
 w.eval('completions={m:{completed:false}};applyCompletionUi();');assert.equal(w.document.querySelector('input').checked,false);assert.equal(w.document.querySelectorAll('input').length,1);
 dom.window.close();console.log('PASS dashboard nutrition: delayed completion load, refreshed state, summary, escaping, polling cleanup');
})().catch(e=>{console.error(e);process.exitCode=1});
