const fs=require('fs'),assert=require('assert/strict'),{JSDOM}=require('jsdom');
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only'}),w=dom.window,d=w.document;let calls=0,drawn=[];
 w.SSMPDDb={proofreadContent:async(fields,labels)=>{calls++;assert.match(labels.f0,/اسم الطبيب/);assert.equal(fields.f0,'د/ مصطفي محمد');return {complete:true,issues:[['f0','مصطفي','مصطفى'],['f1','الكلي','الكلى'],['f2','أية','آية']].map(([field,before,after])=>({field,before,after,category:'spelling',reason:'تصحيح الرسم الإملائي مع الاحتفاظ بالمقصود'}))};}};
 w.eval(fs.readFileSync('assets/js/content-proofreading.js','utf8'));
 const source=fs.readFileSync('assets/js/daily-clinics.js','utf8'),helpers=source.slice(source.indexOf(' var days='),source.indexOf(' function from(')),fields=source.match(/ function fields\(\)\{[^\n]+/)[0],row=source.match(/ function row\(r\)\{[^\n]+/)[0],setup=source.slice(source.indexOf(' function setup('),source.indexOf(' function description('));
 w.__draw=b=>drawn.push(JSON.parse(JSON.stringify(b)));w.HTMLCanvasElement.prototype.getContext=()=>({drawImage:()=>{}});
 const factory=w.eval('(function(){'+helpers+fields+row+'async function render(c,b){window.__draw(b);}async function blob(){return "mock-png";}'+setup+'return {fields:fields,setup:setup};})()');
 const root=d.querySelector('main');root.innerHTML=factory.fields();const original={day:'الخميس',layout:'story',rows:[{name:'د/ مصطفي محمد',specialty:'استشاري الباطنة والكلي',from:'20:00',to:'22:00'},{name:'د/ أية مفتاح',specialty:'النساء والتوليد',from:'18:00',to:'20:00'}]};
 const form=factory.setup(root,original);let p=form.prepare();await tick();assert.equal(calls,1);assert.equal(d.querySelectorAll('.proofreading-issue').length,3);d.querySelector('[data-proof-apply]').click();let result=await p;
 assert.equal(result.brief.rows[0].name,'د/ مصطفى محمد');assert.equal(result.brief.rows[0].specialty,'استشاري الباطنة والكلى');assert.equal(result.brief.rows[1].name,'د/ آية مفتاح');assert.equal(result.brief.day,'الخميس');assert.equal(result.brief.layout,'story');assert.equal(result.brief.rows[0].from,'20:00');assert.equal(result.brief.rows[0].to,'22:00');assert.equal(result.output,'mock-png');assert.equal(drawn.at(-1).rows[1].name,'د/ آية مفتاح');assert.equal(original.rows[0].name,'د/ مصطفي محمد');
 await form.prepare();assert.equal(calls,1,'unchanged reviewed schedule does not incur another request');
 const input=root.querySelector('[data-daily-key=name]');input.value='د/ مصطفي محمد';input.dispatchEvent(new w.Event('input',{bubbles:true}));p=form.prepare();await tick();d.querySelector('[data-proof-skip]').click();await p;assert.equal(input.value,'د/ مصطفي محمد');assert.equal(calls,2);
 dom.window.close();console.log('PASS review names/specialties from actual form, مصطفى/آية/الكلى proposals, reviewed text reaches render and saved brief, day/time/layout preserved, unchanged form no repeat request and original-text choice. Renderer/provider mocked.');
})().catch(e=>{console.error(e);process.exitCode=1;});
