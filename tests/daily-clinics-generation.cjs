const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const b={day:'السبت',rows:[{name:'د. أحمد علي',specialty:'أطفال',from:'20:00',to:'00:30'}]};
let handle,requests=[],active=true,repair=false;
const sandbox={console,Request,Response,URL,AbortSignal,Set,Map,createClient:()=>({rpc:async()=>({data:active?'staff-id':null})}),Deno:{env:{get:key=>key==='CONTENT_AI_MODEL'?'test-model':'configured'},serve:fn=>handle=fn},fetch:async(url,opts)=>{
 assert.equal(url,'https://api.openai.com/v1/responses');const q=JSON.parse(opts.body);requests.push(q);const brief=JSON.parse(q.input.split('\n')[1]);assert.equal(brief.content_kind,'daily_clinics');assert.equal(brief.daily_clinics_brief.rows[0].to,'00:30');assert(q.instructions.includes('إعلان إداري'));
 const count=q.text.format.schema.properties.ideas.minItems;
 const ideas=Array.from({length:count},(_,i)=>({title:'مواعيد عيادات السبت',idea:'إعلان جدول العيادات',hook:'راجع مواعيد عيادتك',angle:'تسهيل الحجز',format:'image_post',script:null,caption:'مواعيد عيادات السبت موضحة في الصورة. تواصل معنا للحجز.',cta_type:'whatsapp',cta_text:'تواصل معنا للحجز',duration_min_seconds:null,duration_max_seconds:null,video_template:null,hypothesis_reason:'صياغة إعلان الجدول دون افتراض نتائج أداء',design_headline:repair&&requests.length===1&&i===0?'كلمة '.repeat(20):'مواعيد عيادات السبت',design_subtitle:'راجع الجدول واختار تخصصك',design_cta:'تواصل للحجز',sources:[],cover_source_text:''}));
 return Response.json({output_text:JSON.stringify({ideas})});}};
for(const file of ['sources.ts','daily-clinics.ts','index.ts']){let s=fs.readFileSync('supabase/functions/content-ai/'+file,'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');s=ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;vm.runInNewContext(s,sandbox);}
const request=(body,auth=true)=>new Request('https://test.local/content-ai',{method:'POST',headers:{'content-type':'application/json',...(auth?{Authorization:'Bearer test'}:{})},body:JSON.stringify(body)});
(async()=>{
 const body={brand:'sono',content_kind:'daily_clinics',preferred_format:'image_post',advertising_objective:'messages',daily_clinics_brief:b};
 let r=await handle(request(body));assert.equal(r.status,200);let out=await r.json();assert.equal(out.ideas.length,3);for(const x of out.ideas){assert.equal(x.content_kind,'daily_clinics');assert.deepEqual(x.daily_clinics_brief,b);assert.equal(x.format,'image_post');assert.equal(x.script,null);assert.deepEqual(x.sources,[]);}assert.equal(requests.length,1);
 for(const changed of [{...body,brand:'dr_dina'},{...body,daily_clinics_brief:{...b,rows:[]}},{...body,daily_clinics_brief:{...b,rows:[{...b.rows[0],from:'28:00'}]}},{...body,doctor_brief:{name:'other'}}]){r=await handle(request(changed));assert.equal(r.status,400);}assert.equal(requests.length,1);
 r=await handle(request(body,false));assert.equal(r.status,400);active=false;r=await handle(request(body));assert.equal(r.status,400);assert.equal(requests.length,1);active=true;
 requests=[];repair=true;r=await handle(request(body));out=await r.json();assert.equal(out.ideas.length,3);assert.equal(requests.length,2);assert.equal(requests[1].text.format.schema.properties.ideas.minItems,1);
 console.log('PASS automatic schedule backend: authenticated route, trusted facts, 3 image-post ideas, invalid-input rejection before provider, and repair of failed idea only. Mocked provider and database.');
})().catch(e=>{console.error(e);process.exitCode=1;});
