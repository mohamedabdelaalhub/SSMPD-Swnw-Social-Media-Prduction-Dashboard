const fs=require('fs'),vm=require('vm'),ts=require('typescript'),assert=require('assert/strict');
function compile(file,require){const box={exports:{},require};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,box);return box.exports;}
const lib=compile('supabase/functions/content-proofread/review.ts'),engine=compile('supabase/functions/content-proofread/schedule.ts',()=>lib);
const issue=(field,before,after)=>({field,before,after,category:'spelling',reason:'تصحيح الرسم الإملائي'});
(async()=>{
 const fields={f0:'د/ أية مفتاح',f1:'استشاري الباطنة والكلي',f2:'د/ مصطفي احمد'},labels={f0:'العيادة 1 — اسم الطبيب',f1:'العيادة 1 — التخصص',f2:'العيادة 2 — اسم الطبيب'};let calls=[];
 assert(engine.isSchedule(fields,labels));assert(!engine.isSchedule({f0:'أية مشكلة'},{f0:'نص المحتوى'}));
 let result=await engine.reviewSchedule(fields,labels,async(current,round)=>{
   calls.push({...current});assert.equal(current.f0,'د/ آية مفتاح','name rule applies even when model never reports Aya');
   return {complete:true,issues:round===0?[issue('f1','الكلي','الكلى')]:round===1?[issue('f2','احمد','أحمد')]:[]};
 });
 assert.equal(calls.length,3);assert.equal(result.issues.length,3);assert.equal(result.issues.find(i=>i.field==='f0').after,'د/ آية مفتاح');assert.equal(result.issues.find(i=>i.field==='f1').after,'استشاري الباطنة والكلى');assert.equal(result.issues.find(i=>i.field==='f2').before,'د/ مصطفي احمد');assert.equal(result.issues.find(i=>i.field==='f2').after,'د/ مصطفى أحمد');assert.equal(fields.f0,'د/ أية مفتاح');
 const safe=engine.knownScheduleSpelling({f0:'أية مشكلة',f1:'د/ أية وأية',f2:'رأية',f3:'المجموع الكلي'},{f0:'نص المحتوى',f1:'العيادة 1 — اسم الطبيب',f2:'العيادة 2 — اسم الطبيب',f3:'العيادة 1 — التخصص'});assert.equal(safe.f0,'أية مشكلة');assert.equal(safe.f1,'د/ آية وأية');assert.equal(safe.f2,'رأية');assert.equal(safe.f3,'المجموع الكلي');
 let rounds=0;result=await engine.reviewSchedule({f0:'اسم سليم'},{f0:'العيادة 1 — اسم الطبيب'},async()=>{rounds++;return{complete:true,issues:[]};});assert.equal(rounds,2);assert.equal(result.issues.length,0);
 await assert.rejects(engine.reviewSchedule({f0:'د/ أية 100'},{f0:'العيادة 1 — اسم الطبيب'},async()=>({complete:true,issues:[issue('f0','100','200')]})));
 console.log('PASS discoveries across internal rounds merge into one response, omitted Aya corrected in name field, all name rules suggested together, original source and numbers protected, non-name أية unchanged and clean text checked twice. Model mocked.');
})().catch(e=>{console.error(e);process.exitCode=1;});
