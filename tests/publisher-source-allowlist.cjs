/* Offline regression + adversarial tests for the content-source allowlist added to supabase/functions/{meta,tiktok}-publish-process (review #116).
   Loads the PATCHED helper text from both working-tree files, extracts the PRE-PATCH fallback rule (verbatim, embedded) to show the SSRF surface, and checks
   the call sites statically. No network. Usage: node tests/publisher-source-allowlist.cjs */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const files={meta:read('supabase/functions/meta-publish-process/index.ts'),tiktok:read('supabase/functions/tiktok-publish-process/index.ts')};
function extractBlock(src,startRe){const m=startRe.exec(src);assert.ok(m,'found '+startRe);let i=m.index,d=0,j=src.indexOf('{',i);for(let k=j;k<src.length;k++){if(src[k]==='{')d++;if(src[k]==='}'){d--;if(!d)return src.slice(i,k+1);}}throw new Error('unbalanced');}
function loadHelper(src){const consts=/const PUBLIC_CONTENT_BUCKETS = [^;]+;/.exec(src)[0];const fn=extractBlock(src,/function contentSource\(/);const ctx=vm.createContext({URL,String,RegExp});vm.runInContext(consts+'\n'+fn+';this.fn=contentSource',ctx);return ctx.fn;}
const meta0=loadHelper(files.meta),tiktok0=loadHelper(files.tiktok);
const plain=f=>(...a)=>{const r=f(...a);return r===null?null:JSON.parse(JSON.stringify(r));};   // vm-realm objects -> plain objects for deepStrictEqual
const meta=plain(meta0),tiktok=plain(tiktok0);
assert.equal(extractBlock(files.meta,/function contentSource\(/),extractBlock(files.tiktok,/function contentSource\(/));
const SUP='https://abcdefghijklmnopqrst.supabase.co',U='11111111-1111-1111-1111-111111111111',V='22222222-2222-2222-2222-222222222222';
// PRE-PATCH rule (verbatim logic of the fallback): same-origin authenticated content-designs|video-inputs -> storage download; EVERYTHING ELSE -> fetch(sourceUrl)
const oldRule=(url)=>{const s=new URL(url);const m=/^\/storage\/v1\/object\/authenticated\/(content-designs|video-inputs)\/(.+)$/.exec(s.pathname);return (s.origin===new URL(SUP).origin&&m)?{kind:'private',bucket:m[1],key:decodeURIComponent(m[2])}:{kind:'FETCH-ANYTHING',url};};
let n=0;const ok=x=>{n++;console.log('PASS',x);};
const valid=[
 [`${SUP}/storage/v1/object/authenticated/content-designs/${U}/${V}/output.png`,{kind:'private',bucket:'content-designs',key:`${U}/${V}/output.png`}],
 [`${SUP}/storage/v1/object/authenticated/content-designs/${U}/${V}/reel-cover.png`,{kind:'private',bucket:'content-designs',key:`${U}/${V}/reel-cover.png`}],
 [`${SUP}/storage/v1/object/authenticated/video-inputs/${U}/${V}/reel.mp4`,{kind:'private',bucket:'video-inputs',key:`${U}/${V}/reel.mp4`}],
 [`${SUP}/storage/v1/object/authenticated/video-inputs/${U}/${V}/my%20video%20%D8%B9%D8%B1%D8%A8%D9%8A.mp4`,{kind:'private',bucket:'video-inputs',key:`${U}/${V}/my video عربي.mp4`}],
 [`${SUP}/storage/v1/object/public/video-outputs/${U}.mp4`,{kind:'public',url:`${SUP}/storage/v1/object/public/video-outputs/${U}.mp4`}],
 [`${SUP}/storage/v1/object/public/video-outputs/${U}/attempt-02/output.mp4`,{kind:'public',url:`${SUP}/storage/v1/object/public/video-outputs/${U}/attempt-02/output.mp4`}],
 [`${SUP}/storage/v1/object/public/video-outputs/${U}.mp4?t=1700000000`,{kind:'public',url:`${SUP}/storage/v1/object/public/video-outputs/${U}.mp4`}],
 [`${SUP}/storage/v1/object/public/meta-publish-assets/${U}.jpg`,{kind:'public',url:`${SUP}/storage/v1/object/public/meta-publish-assets/${U}.jpg`}]];
for(const [u,want] of valid){assert.deepEqual(meta(u,SUP),want,'meta '+u);assert.deepEqual(tiktok(u,SUP),want,'tiktok '+u);}
ok(`V1 ${valid.length} valid content URLs (private content-designs/video-inputs incl. reel cover and percent-encoded Arabic names, public video-outputs incl. the attempt-scoped path and a cache-busting query, public meta-publish-assets) are accepted with the expected bucket/key in BOTH publishers`);
const old=valid.filter(([u,w])=>w.kind==='private').every(([u,w])=>{const o=oldRule(u);return o.kind==='private'&&o.bucket===w.bucket&&o.key===w.key;});assert.ok(old);
ok('V2 NO regression for private storage URLs: the new helper returns exactly the bucket and key the old regex rule produced');
const hostile=[];
const ORIG='abcdefghijklmnopqrst.supabase.co';
for(const h of ['evil.example',ORIG+'.evil.example','evil'+ORIG,'x.'+ORIG,'169.254.169.254','127.0.0.1','localhost','[::1]','metadata.google.internal','10.0.0.5','kong:8000',ORIG+'@evil.example','evil.example@'+ORIG,ORIG+':8443','api.openai.com'])for(const p of ['/storage/v1/object/public/video-outputs/a.mp4','/storage/v1/object/authenticated/content-designs/a/b.png','/latest/meta-data/','/'])hostile.push('https://'+h+p);
hostile.push(`http://${ORIG}/storage/v1/object/public/video-outputs/a.mp4`,`ftp://${ORIG}/storage/v1/object/public/video-outputs/a.mp4`,`file:///etc/passwd`,`data:image/png;base64,AAAA`,`javascript:alert(1)`,`//${ORIG}/storage/v1/object/public/video-outputs/a.mp4`,`${ORIG}/storage/v1/object/public/video-outputs/a.mp4`,`/storage/v1/object/public/video-outputs/a.mp4`,'',' ',
 // same origin, wrong place
 `${SUP}/rest/v1/content_items?select=*`,`${SUP}/auth/v1/user`,`${SUP}/auth/v1/admin/users`,`${SUP}/functions/v1/claude-automation`,`${SUP}/realtime/v1/websocket`,`${SUP}/storage/v1/bucket`,`${SUP}/storage/v1/object/list/video-outputs`,`${SUP}/storage/v1/object/info/public/video-outputs/a.mp4`,`${SUP}/storage/v1/object/sign/video-outputs/a.mp4?token=abc`,`${SUP}/storage/v1/object/upload/sign/video-outputs/a.mp4?token=abc`,`${SUP}/storage/v1/render/image/public/video-outputs/a.png`,
 // buckets that must NEVER be fetched by a publisher
 ...['patient-files','patient-documents','patient-verification','automation-kit','brand-logos','design-scenes','video-assets','contracting-documents','lead-invoices','staff-photos','secrets','x'].flatMap(b=>[`${SUP}/storage/v1/object/authenticated/${b}/a/b.png`,`${SUP}/storage/v1/object/public/${b}/a/b.png`]),
 // bucket/kind mismatch
 `${SUP}/storage/v1/object/public/content-designs/${U}/${V}/output.png`,`${SUP}/storage/v1/object/public/video-inputs/${U}/x.mp4`,`${SUP}/storage/v1/object/authenticated/video-outputs/${U}.mp4`,`${SUP}/storage/v1/object/authenticated/meta-publish-assets/${U}.jpg`,
 // traversal / encoding tricks
 `${SUP}/storage/v1/object/authenticated/content-designs/../patient-files/a.png`,`${SUP}/storage/v1/object/authenticated/content-designs/%2e%2e/patient-files/a.png`,`${SUP}/storage/v1/object/authenticated/content-designs/a%2F..%2F..%2Fpatient-files%2Fa.png`,`${SUP}/storage/v1/object/public/video-outputs/a%2F..%2Fb`,`${SUP}/storage/v1/object/public/video-outputs//a.mp4`,`${SUP}/storage/v1/object/public/video-outputs/a%00.mp4`,`${SUP}/storage/v1/object/public/video-outputs/`,`${SUP}/storage/v1/object/public/video-outputs`,`${SUP}/storage/v1/object/public/`,`${SUP}/storage/v1/object/public//video-outputs/a.mp4`,`${SUP}/storage/v1/object/public/Video-Outputs/a.mp4`,`${SUP}/storage/v1/object/public/video_outputs/a.mp4`,
 `https://user:pw@${ORIG}/storage/v1/object/public/video-outputs/a.mp4`,`https://${ORIG}:443/storage/v1/object/public/video-outputs/a.mp4`.replace(':443',':8080'),`https://drive.google.com/file/d/1AbC_dEf-GhIjKlMnOpQrStUvWxYz012/view`);
assert.deepEqual(meta(`${SUP}/storage/v1/object/public/video-outputs/./a.mp4`,SUP),{kind:'public',url:`${SUP}/storage/v1/object/public/video-outputs/a.mp4`});   // URL parsing normalises ./ to the genuine path: harmless, not a bypass
assert.deepEqual(meta(`${SUP}/storage/v1/object/authenticated/content-designs/x/../y/a.png`,SUP),{kind:'private',bucket:'content-designs',key:'y/a.png'});   // normalised inside the same bucket
const badMeta=hostile.filter(u=>meta(u,SUP)!==null),badTik=hostile.filter(u=>tiktok(u,SUP)!==null);
assert.deepEqual(badMeta,[],'meta must reject: '+badMeta.join(' | '));assert.deepEqual(badTik,[],'tiktok must reject: '+badTik.join(' | '));
ok(`A1 ${hostile.length} hostile/out-of-scope URLs are ALL rejected by both publishers: foreign/lookalike/internal/metadata/IP/localhost hosts, userinfo and port tricks, non-https schemes, relative forms, same-origin REST/auth/functions/realtime/storage-admin paths, signed and render URLs, 12 non-content buckets (patient-files etc.) in both kinds, kind/bucket mismatches, traversal (plain ../ out of the bucket, %2e, %2F, //, NUL; ./ and in-bucket ../ are normalised by URL parsing to a path inside the allowed bucket) and case/underscore variants`);
for(const v of [null,undefined,42,{},[],true])assert.equal(meta(v,SUP),null);assert.equal(meta(valid[0][0],'not a url'),null);assert.equal(meta(valid[0][0],undefined),null);
ok('A2 non-string URL inputs and an unusable SUPABASE_URL fall back to null (reject) without throwing');
const oldFetches=hostile.filter(u=>{try{return oldRule(u).kind==='FETCH-ANYTHING'}catch{return false}});assert.ok(oldFetches.length>=90);
ok(`F1 PRE-PATCH fallback would have sent a server-side fetch for ${oldFetches.length} of the ${hostile.length} hostile URLs (any host, internal IPs, cloud metadata, other buckets via signed URLs...): the tests fail on the old rule`);
// static checks on the patched sources
for(const [name,src] of Object.entries(files)){
 assert.ok(!/fetch\(sourceUrl\)/.test(src)&&!/fetch\(source\)/.test(src),name+' has no unguarded fetch(source[Url])');
 assert.equal((src.match(/redirect: ?"error"/g)||[]).length,1,name+' public fetch refuses redirects');
 assert.ok(/UNSUPPORTED_FILE_SOURCE/.test(src),name+' rejects with a clear error code');
}
assert.ok(/driveId \? await res\.text\(\)\.catch\(\(\) => ""\) : ""/.test(files.meta),'meta echoes response bodies only for the Drive API');
assert.ok(!/body\.slice/.test(files.tiktok));
ok('S1 static checks: no unguarded fetch(sourceUrl|source) remains in either publisher, the single remaining same-origin fetch refuses redirects, rejection uses UNSUPPORTED_FILE_SOURCE, and meta no longer echoes response bodies of non-Drive sources into job error messages');
for(const [name,src] of Object.entries(files)){assert.ok(!/(const|let|var|function)\s+URL\b/.test(src),name+' must not declare an identifier named URL (it would shadow the global URL class used by every parser)');}
assert.ok(/const SUPABASE_URL\s*=/.test(files.tiktok)&&!/createClient\(URL\b/.test(files.tiktok)&&/contentSource\(source,SUPABASE_URL\)/.test(files.tiktok),'tiktok defines SUPABASE_URL and uses it');
ok('S2 DRIFT FIX: the REPO copy of tiktok-publish-process declared `const URL = Deno.env.get("SUPABASE_URL")`, shadowing the global URL class, so in that copy every `new URL(...)` (the Drive parser, the storage origin check) threw; the deployed text uses SUPABASE_URL. The patch renames it and a static test forbids any identifier named URL in both publishers');
console.log('PASS publisher content-source allowlist: '+n+' groups');
