const assert=require('assert/strict'),fs=require('fs'),vm=require('vm'),{stripTypeScriptTypes}=require('node:module');
const {PNG}=require('pngjs');
let handler,providerCalls=0,reservations=0,allowed=true,admin=true,brand="sono",libraryPrefix;const jobs=new Map(),files=new Map();
function image(w,h,r,g,b){const p=new PNG({width:w,height:h});for(let i=0;i<p.data.length;i+=4){p.data[i]=r;p.data[i+1]=g;p.data[i+2]=b;p.data[i+3]=255;}return p;}
function uri(p){return 'data:image/png;base64,'+PNG.sync.write(p).toString('base64');}
const base=image(1024,1536,210,30,40),mask=new PNG({width:1024,height:1536});for(let y=230;y<1306;y++)for(let x=153;x<871;x++)mask.data[(y*1024+x)*4+3]=255;
const body={action:'expand',mode:'all',content_id:'item',request_key:'request1',quality:'high',image:uri(base),mask:uri(mask),original:uri(image(800,1000,210,30,40))};
const db={
 rpc:async(name,args)=>{if(name==='my_admin_id')return {data:admin?'staff':null};if(!allowed)return {error:{message:'not allowed'}};reservations++;let job=jobs.get(args.p_request_key);if(job)return {data:{job,new:false}};job={id:args.p_request_key,scene_prompt:args.p_prompt,image_quality:args.p_quality,status:'generating_scene'};jobs.set(job.id,job);return {data:{job,new:true}};},
 storage:{from:()=>({upload:async(path,bytes)=>{assert(!files.has(path));files.set(path,Buffer.from(bytes));return {};},createSignedUrl:async(path)=>({data:{signedUrl:'https://storage.test/'+path}})})},
 from:(table)=>{let patch;return {
  update(v){patch=v;return this;},async eq(k,id){Object.assign(jobs.get(id),patch);return {};},
  select(){return {eq:(k,id)=>({maybeSingle:async()=>({data:allowed?(table==='content_items'?{brand}:jobs.get(id)):null})}),like(k,prefix){libraryPrefix=prefix;return this;},order(){return this;},limit:async()=>({data:Array.from(jobs.values())})};}
 };}
};
const code=fs.readFileSync(require('path').join(__dirname,'../supabase/functions/design-scene/index.ts'),'utf8').replace(/^import .*;\n/gm,'').replace('const { PNG } = pngjs;','');
vm.runInNewContext(stripTypeScriptTypes(code),{PNG,Buffer,crypto,Uint8Array,DataView,TextEncoder,atob,Blob,FormData,Response,AbortSignal,createClient:()=>db,Deno:{env:{get:()=> 'configured'},serve:fn=>handler=fn},fetch:async(url,options)=>{providerCalls++;if(url.endsWith('/edits')){assert.equal(options.body.get('input_fidelity'),'high');assert.equal(options.body.get('model'),'gpt-image-1.5');assert.equal(options.body.get('size'),'1024x1536');assert(options.body.get('mask') instanceof Blob);assert(!options.headers['Content-Type']);}else assert(url.endsWith('/generations'));return Response.json({data:[{b64_json:PNG.sync.write(image(1024,1536,20,180,70)).toString('base64')}],usage:{total_tokens:1}});}});
async function run(b,auth=true){return handler(new Request('https://edge.test/design-scene',{method:'POST',headers:auth?{Authorization:'Bearer mock'}:{},body:JSON.stringify(b)}));}
(async()=>{
 let response=await run(body);assert.equal(response.status,200);const result=await response.json();assert(result.expansion.original_url.endsWith('/original.png'));assert.equal(providerCalls,1);const out=PNG.sync.read(files.get('sono/request1/scene.png'));function pixel(x,y){return Array.from(out.data.subarray((y*1024+x)*4,(y*1024+x)*4+4));}assert.deepEqual(pixel(512,768),[210,30,40,255],'protected subject pixels remain exact even if provider changes them');assert.deepEqual(pixel(20,20),[20,180,70,255]);assert(files.get('sono/request1/original.png').equals(PNG.sync.write(image(800,1000,210,30,40))));
 response=await run(body);assert.equal(response.status,200);assert.equal(providerCalls,1,'same request reuses saved result');
 response=await run({...body,mode:'horizontal'});assert.equal(response.status,400);assert.equal(providerCalls,1);
 response=await run({...body,image:'https://evil.test/image'});assert.equal(response.status,400);assert.equal(providerCalls,1);
 const count=reservations;response=await run({...body,request_key:'badmask',mask:uri(image(100,100,0,0,0))});assert.equal(response.status,400);assert.equal(reservations,count,'invalid masks rejected before budget reservation');
 response=await run(body,false);assert.equal(response.status,400);assert.equal(providerCalls,1);
 admin=false;response=await run(body);assert.equal(response.status,400);admin=true;allowed=false;response=await run({...body,request_key:'denied'});assert.equal(response.status,400);assert.equal(providerCalls,1);response=await run({action:'original',job_id:'request1'});assert.equal(response.status,400);allowed=true;
 response=await run({action:'original',job_id:'request1'});assert.equal(response.status,200);assert((await response.json()).expansion.original_url);
 response=await run({content_id:'item',request_key:'generation',quality:'medium',prompt:'normal scene generation'});assert.equal(response.status,200);assert.equal(providerCalls,2,'ordinary generation still uses generations API');
 brand='dr_dina';response=await run({content_id:'item',request_key:'dina-generation',quality:'medium',prompt:'dina scene generation'});assert.equal(response.status,200);assert(files.has('dr_dina/dina-generation/scene.png'));response=await run({action:'library',brand:'dr_dina'});assert.equal(response.status,200);assert.equal(libraryPrefix,'dr_dina/%');brand='other';const prior=providerCalls;response=await run({content_id:'item',request_key:'unsupported',quality:'medium',prompt:'scene generation'});assert.equal(response.status,400);assert.equal(providerCalls,prior);
 console.log('PASS: mocked image edits, exact original pixels, original storage/undo, authentication, permission failure, payload validation, idempotency and ordinary generation. No paid API calls.');
})().catch(e=>{console.error(e);process.exit(1)});
