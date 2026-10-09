const assert=require('assert/strict'),fs=require('fs');
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="form"><input id="cf-title"><select id="cf-brand"><option value="sono">Sono</option></select><input id="cf-specialty" value="الأطفال"><input id="ci-objective" value="awareness"><select id="ci-format"><option value="video">video</option><option value="image_post">image</option></select><input id="ci-topic"><textarea id="cf-body"></textarea><textarea id="cf-agent-raw"></textarea><textarea id="cf-caption"></textarea></div>',{runScripts:'outside-only'});
const w=dom.window,doc=w.document,alerts=[];w.alert=message=>alerts.push(message);w.SSMPDToast={show(){}};
w.eval(fs.readFileSync('assets/js/doctor-schedule.js','utf8'));w.eval(fs.readFileSync('assets/js/doctor-content.js','utf8'));const D=w.SSMPDDoctorContent;
doc.querySelector('#form').insertAdjacentHTML('beforeend',D.html());D.wire(doc.querySelector('#form'));
function set(id,value){const el=doc.getElementById(id);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));}
set('cf-title','تعريف د/ راضي');set('cf-title','تعريف د/ راضي منصور');assert.equal(D.current(false).name,'راضي منصور');assert.equal(doc.getElementById('ci-format').value,'image_post');assert.throws(()=>D.current(true),/التايتل/);
set('doctor-title','استشاري أمراض الأطفال');assert.throws(()=>D.current(true));set('doctor-days','الأحد - الاثنين');set('doctor-time_from','17:30');set('doctor-time_to','00:00');const facts=D.current(true);assert.equal(facts.qualifications,'');assert.equal(facts.time_to,'00:00');assert(D.prompt(facts).includes('لا تضف سنوات خبرة'));
doc.getElementById('doctor-schedule-mode').value='different';doc.getElementById('doctor-schedule-mode').dispatchEvent(new w.Event('change'));doc.querySelector('[data-add-schedule]').click();assert.equal(D.current(true).schedule.length,1);
const extra=doc.querySelector('[data-schedule-rows]');for(const [key,value] of Object.entries({days:'الأربعاء',time_from:'20:00',time_to:'22:00'})){const el=extra.querySelector('[data-key="'+key+'"]');el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));}
assert.equal(D.current(true).schedule.length,2);D.hydrate(D.current(true));assert.equal(doc.querySelector('[data-schedule-rows] [data-key="time_from"]').value,'20:00');
set('doctor-days','');set('doctor-time_from','');set('doctor-time_to','');assert.equal(D.current(true).schedule.length,1);assert.equal(D.current(true).days,'الأربعاء');D.hydrate({...facts,schedule_mode:'different',schedule:[facts,{days:"الأربعاء",time_from:"20:00",time_to:"22:00"}]});
const savedFacts=D.current(true);doc.getElementById('doctor-schedule-mode').value='except';set('doctor-days','الأحد - الأربعاء');assert.equal(D.current(true).schedule.length,5);assert(!D.current(true).schedule.some(r=>r.days==='الأحد'));D.hydrate(D.current(true));assert.equal(doc.getElementById('doctor-days').value,'الأحد - الأربعاء');set('doctor-days','');assert.equal(D.current(true).schedule.length,7);D.hydrate(savedFacts);
let sent;
w.SSMPDWorkflow={objectiveSelectHtml:id=>'<select id="'+id+'"><option value="awareness">awareness</option></select>',getContentAIBrief:async ctx=>{assert.equal(ctx.doctorBrief.name,'راضي منصور');return D.prompt(ctx.doctorBrief);}};
w.SSMPDDb={generateContentIdeas:async body=>{sent=body;const idea={title:'نرحب بالدكتور راضي',idea:'ترحيب',caption:'بوست ترحيب',format:'image_post'};return {ideas:[idea,{...idea},{...idea}]};}};
w.eval(fs.readFileSync('assets/js/content-ai.js','utf8'));
(async()=>{
 set('doctor-time_from','');w.SSMPDContentAI.openGenerator();assert.equal(doc.querySelectorAll('.modal-backdrop').length,0);assert(alerts.at(-1).includes('موعد'));
 set('doctor-time_from','17:30');w.SSMPDContentAI.openGenerator();doc.getElementById('ai-generate').click();await new Promise(r=>setTimeout(r,20));assert.equal(sent.content_kind,'doctor_intro');assert.equal(sent.doctor_brief.name,'راضي منصور');assert.equal(sent.preferred_format,'image_post');assert.equal(sent.doctor_brief.schedule[1].time_to,'22:00');
 doc.querySelector('[data-use]').click();const raw=JSON.parse(doc.getElementById('cf-agent-raw').value);assert.equal(raw.doctor_brief.time_from,'17:30');assert.equal(D.from({agent_raw_output:JSON.stringify(raw)}).name,'راضي منصور');assert.equal(D.current(true).name,'راضي منصور');
 const kind=doc.getElementById('cf-content-kind');kind.value='standard';kind.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(D.current(true),null);assert.equal(doc.getElementById('doctor-content-fields').hidden,true);
 console.log('PASS: title detection, required schedules, optional credentials, generation payload, selected-idea metadata, and generic-content switch. No AI calls.');
})().catch(e=>{console.error(e);process.exitCode=1});
