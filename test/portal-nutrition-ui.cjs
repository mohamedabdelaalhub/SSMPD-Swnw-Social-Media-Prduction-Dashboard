const assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const tick=()=>new Promise(r=>setTimeout(r,20));
(async()=>{
 const dom=new JSDOM('<main id="portal-root"><nav class="profile-tabs"><button class="active">Data</button></nav><section class="profile-content"></section></main>',{runScripts:'outside-only'}),w=dom.window;
 let calls=[],fail=false,pending;
 w.SSMPD_CONFIG={supabase:{url:'test',anonKey:'test'}};w.supabase={createClient:()=>({functions:{invoke:async(name,{body})=>{calls.push(body);if(body.op==='daily_overview')return {data:{visits:[{id:'visit',patient_id:'p',visit_date:'2026-01-01',patients:{full_name:'<img src=x>'},meals:[{id:'meal',name:'<script>x</script>',ingredients:['food'],calories:100}],completions:[]}],next_offset:null}};if(pending)await pending;if(fail)return {error:new Error('offline')};return {data:{completion:{completed:body.completed},audit_recorded:true}};}}})};
 w.eval(fs.readFileSync('assets/js/nutrition-view.js','utf8'));
 w.eval(fs.readFileSync('patient-portal/portal-nutrition.js','utf8'));w.document.querySelector('[data-nutrition-tab]').click();await tick();
 assert.equal(w.document.querySelectorAll('[data-nutrition-tab]').length,1);assert.equal(w.document.querySelectorAll('.nutrition-view script,.nutrition-view img').length,0);
 const box=w.document.querySelector('input[type=checkbox]');box.click();assert.equal(box.disabled,true);await tick();assert.equal(box.checked,true);assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), {op:'set_daily_completion',visit_id:'visit',meal_id:'meal',tracking_date:w.SwnwNutritionView.today(),completed:true});
 fail=true;box.click();await tick();assert.equal(box.checked,true);assert.match(w.document.querySelector('.nutrition-meal [role=status]').textContent,/تعذر/);
 fail=false;let resolve;pending=new Promise(r=>resolve=r);box.click();w.document.querySelector('.profile-content').innerHTML='different tab';resolve();await tick();assert.equal(w.document.querySelector('.profile-content').textContent,'different tab');
 dom.window.close();console.log('PASS nutrition UI: tab, escaped content, explicit state, pending lock, rollback, stale view');
})().catch(e=>{console.error(e);process.exitCode=1});
