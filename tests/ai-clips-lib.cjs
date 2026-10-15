const assert=require('node:assert/strict'),path=require('path'),{pathToFileURL}=require('url');
(async()=>{
 const L=await import(pathToFileURL(path.resolve(__dirname,'../supabase/functions/ai-clip-process/lib.mjs')).href);
 const prices={'veo-3.1-fast-generate-preview':0.10,'veo-3.1-lite-generate-preview':0.05};
 assert.equal(L.costUsd(prices,'veo-3.1-fast-generate-preview',8),0.8);
 assert.throws(()=>L.costUsd(prices,'nope',8));
 // الميزانية: 500 جنيه بسعر 52.5 → لقطة fast 8 ثواني = 42 جنيه
 let d=L.budgetDecision({spentEgp:0,budgetEgp:500,estUsd:0.8,rate:52.5});assert.deepEqual(d,{ok:true,estEgp:42,remaining:500});
 let spent=0,count=0;while(L.budgetDecision({spentEgp:spent,budgetEgp:500,estUsd:0.8,rate:52.5}).ok){spent+=42;count++;}
 assert.equal(count,11,'11 fast clips fit in 500 EGP');assert.equal(spent,462);
 assert.equal(L.budgetDecision({spentEgp:470,budgetEgp:500,estUsd:0.8,rate:52.5}).ok,false,'blocks when remaining < cost');
 assert.equal(L.budgetDecision({spentEgp:458,budgetEgp:500,estUsd:0.8,rate:52.5}).ok,true,'allows exact fit');
 // نتيجة Veo
 assert.equal(L.extractVideoUri({done:true,response:{generateVideoResponse:{generatedSamples:[{video:{uri:'https://x/v.mp4'}}]}}}),'https://x/v.mp4');
 assert.equal(L.extractVideoUri({done:true,response:{}}),null);
 assert.match(L.extractError({error:{message:'bad'}}),/bad/);
 assert.match(L.extractError({response:{generateVideoResponse:{raiMediaFilteredReasons:['safety']}}}),/safety/);
 assert.equal(L.extractError({done:true,response:{generateVideoResponse:{generatedSamples:[{}]}}}),null);
 // اختيار النموذج النصي
 assert.equal(L.pickTextModel([{name:'models/gemini-2.5-flash',supportedGenerationMethods:['generateContent']},{name:'models/gemini-3-flash',supportedGenerationMethods:['generateContent']},{name:'models/gemini-3-flash-image',supportedGenerationMethods:['generateContent']},{name:'models/gemini-2.0-flash-lite',supportedGenerationMethods:['generateContent']}]),'gemini-3-flash');
 assert.equal(L.pickTextModel([]),'gemini-2.5-flash');
 // الوصف
 assert.match(L.fallbackPrompt({title:'فحص الثدي',brand:'dr_dina'}),/vertical 9:16.*No on-screen text/);
 assert.equal(L.cleanPrompt('short','x').startsWith('Cinematic'),true);
 const long='A slow dolly shot through a bright modern clinic corridor with soft morning light and gentle depth of field';assert.equal(L.cleanPrompt('"'+long+'"',{}),long);
 assert.match(L.promptRequest({title:'العنوان',script_text:'نص'}),/Arabic medical social media post/);
 // base64
 assert.equal(L.bytesToBase64(new Uint8Array([104,105])),'aGk=');
 const big=new Uint8Array(200000).fill(65);assert.equal(Buffer.from(L.bytesToBase64(big),'base64').length,200000);
 // الأخطاء
 assert.equal(L.classifyApiError(429,'Quota exceeded').retry,true);
 assert.equal(L.classifyApiError(403,'billing').retry,false);
 assert.equal(L.classifyApiError(400,'API key not valid').retry,false);
 assert.equal(L.classifyApiError(503,'x').retry,true);
 console.log('PASS: Veo cost/budget (500 EGP = 11 fast clips), operation parsing, text-model pick, prompts, base64, error classes.');
})().catch(e=>{console.error(e);process.exit(1)});
