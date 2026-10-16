const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),ts=require('typescript');
(async()=>{
 let handler,manager=false,quota=true,fetches=0,saved=0;
 const calls=[],advice={diagnosis:'نحتاج اختبار السبب',evidence_gaps:'بيانات الإلغاء ناقصة',actions:[{title:'تحقق من أسباب الإلغاء',kind:'operations',brief:'راجع السجلات',output:'جدول أسباب موثق',steps:[{title:'جمع السجلات',output:'جدول موثق'}]}]};
 let code=fs.readFileSync(__dirname+'/../supabase/functions/operations-advisor/index.ts','utf8').replace(/^import .*;\n/gm,'');
 code=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{Request,Response,AbortSignal,JSON,Number,Date,Deno:{serve:f=>handler=f,env:{get:()=> 'test-only'}},
  createClient:()=>({rpc:async(name)=>{calls.push(name);if(name==='operations_manager')return {data:manager};if(name==='operations_advice_limit')return {data:quota};if(name==='operations_save_advice'){saved++;return {data:null};}if(name==='operations_issue_detail')return {data:{issue:{title:'فقد الحجز',status:'persistent',appearance_count:2,risk_key:'loss'},report:{snapshot:{kpis:{revenue:100},coverage:{cost:false},plan:[]}},actions:[],outcomes:[]}};throw Error('Unexpected mutation '+name);}}),
  fetch:async(url,init)=>{fetches++;const request=JSON.parse(init.body);assert.equal(request.text.format.strict,true);assert(request.instructions.includes('لا تختلق'));return Response.json({output_text:JSON.stringify(advice)});}});
 const request=()=>new Request('https://example.invalid',{method:'POST',body:JSON.stringify({issue_id:'30000000-0000-4000-8000-000000000001'})});
 assert.equal((await handler(request())).status,403);assert.equal(fetches,0);
 manager=true;quota=false;assert.equal((await handler(request())).status,429);assert.equal(fetches,0);
 quota=true;const result=await handler(request());assert.equal(result.status,200);assert.equal(saved,1);assert.equal(fetches,1);assert.equal((await result.json()).advice.actions[0].kind,'operations');assert(!calls.includes('operations_create_action'),'AI only saves a draft, never assigns work');
 console.log('PASS advisor handler: management Auth, quota, structured contextual recommendation and draft-only persistence');
})().catch(e=>{console.error(e);process.exit(1)});
