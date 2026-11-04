/* Runs the REAL helpers + the REAL legacy handleVideoArchive_ from apps-script/Code.gs together with the DRAFT attempt actions against an in-memory fake
   DriveApp/LockService/Utilities. No Drive, no network. Usage: node tests/video-archive-attempt-gs.cjs */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.join(__dirname,'..');
const code=cp.execSync('git show origin/main:apps-script/Code.gs',{cwd:root,encoding:'utf8'});
const draft=fs.readFileSync(path.join(root,'apps-script/drafts/VideoArchiveAttempt.draft.gs'),'utf8');
const fn=n=>{const i=code.indexOf('function '+n+'(');assert.ok(i>=0,n);let d=0,j=code.indexOf('{',i);for(let k=j;k<code.length;k++){if(code[k]==='{')d++;if(code[k]==='}'){d--;if(!d)return code.slice(i,k+1);}}};
let ids=0;
class File{constructor(name,bytes){this.n=name;this.b=bytes;this.d='';this.id='f'+(++ids);}getDescription(){return this.d;}setDescription(x){this.d=x;}getId(){return this.id;}getUrl(){return 'https://drive.google.com/file/d/'+this.id;}}
class Folder{constructor(name){this.n=name;this.folders=[];this.files=[];this.trashed=false;this.id='d'+(++ids);}
 getFoldersByName(n){const a=this.folders.filter(f=>f.n===n&&!f.trashed);let i=0;return{hasNext:()=>i<a.length,next:()=>a[i++]};}
 createFolder(n){const f=new Folder(n);this.folders.push(f);return f;}
 getFilesByName(n){const a=this.files.filter(f=>f.n===n);let i=0;return{hasNext:()=>i<a.length,next:()=>a[i++]};}
 createFile(blob){const f=new File(blob.name,blob.bytes);this.files.push(f);return f;}
 setTrashed(v){this.trashed=v;}getUrl(){return 'https://drive.google.com/drive/folders/'+this.id;}}
const ROOT=new Folder('root');
const sandbox={DriveApp:{getFolderById:()=>ROOT},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({s,setMimeType(){return this;}})},CATEGORY_FOLDER_IDS:{design:'ROOT'},
 Utilities:{base64Decode:b=>Array.from(Buffer.from(b,'base64')),DigestAlgorithm:{SHA_256:'sha256'},
  computeDigest:(a,bytes)=>Array.from(crypto.createHash('sha256').update(Buffer.from(bytes)).digest()).map(b=>b>127?b-256:b),
  formatDate:(d,tz,f)=>f==='yyyy'?String(d.getUTCFullYear()):String(d.getUTCMonth()+1).padStart(2,'0'),newBlob:(bytes,mime,name)=>({bytes,mime,name})},Date,Error,Number,isFinite,String,Array,JSON,RegExp,Math};
vm.createContext(sandbox);
vm.runInContext([fn('getOrCreateFolder_'),fn('jsonOut'),fn('handleVideoArchive_'),draft].join('\n'),sandbox);
const JOB='11111111-1111-1111-1111-111111111111',CONTENT='22222222-2222-2222-2222-222222222222';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const att=(attempt,kind,bytes,extra={})=>JSON.parse(sandbox.handleVideoArchiveAttempt_(Object.assign({jobId:JOB,contentId:CONTENT,brand:'sono',createdAt:'2026-09-08T00:00:00Z',contentTitle:'t',attempt,kind,sha256:sha(bytes),base64:Buffer.from(bytes).toString('base64')},extra)).s);
const clean=(attempts,extra={})=>JSON.parse(sandbox.handleVideoArchiveCleanup_(Object.assign({jobId:JOB,contentId:CONTENT,brand:'sono',createdAt:'2026-09-08T00:00:00Z',attempts},extra)).s);
const legacy=(kind,bytes)=>JSON.parse(sandbox.handleVideoArchive_({jobId:JOB,contentId:CONTENT,brand:'sono',createdAt:'2026-09-08T00:00:00Z',contentTitle:'t',kind,sha256:sha(bytes),base64:Buffer.from(bytes).toString('base64')}).s);
const jobFolder=()=>ROOT.folders[0].folders[0].folders[0].folders[0].folders[0];
const names=f=>f.folders.filter(x=>!x.trashed).map(x=>x.n).sort();
let n=0;const ok=m=>{n++;console.log('PASS',m);};
(async()=>{
 let r=att(1,'video',Buffer.from('A1'));assert.equal(r.ok,true);assert.equal(r.attempt,1);assert.deepEqual(names(jobFolder()),['attempt-01']);ok('G1 stage creates Videos/sono/2026/09/<content>_<job>/attempt-01');
 let r2=att(1,'video',Buffer.from('A1'));assert.equal(r2.fileId,r.fileId);assert.equal(jobFolder().folders[0].files.length,1);ok('G2 duplicate stage callback (same attempt, same bytes) is idempotent: one file, same id');
 assert.throws(()=>att(1,'video',Buffer.from('A1-OTHER')),/Attempt archive checksum conflict/);ok('G3 different bytes inside ONE attempt is a conflict');
 const r3=att(2,'video',Buffer.from('A2-DIFFERENT'));assert.equal(r3.ok,true);assert.notEqual(r3.fileId,r.fileId);assert.deepEqual(names(jobFolder()),['attempt-01','attempt-02']);ok('G4 attempt 2 with different bytes succeeds next to attempt 1');
 att(2,'cover',Buffer.from('C2'));att(2,'cover_1',Buffer.from('C2b'));assert.equal(jobFolder().folders[1].files.length,3);ok('G4b cover and cover_N land in the same attempt folder');
 // legacy action is untouched and first-writer-wins as before (final.mp4 lives in the JOB folder, not in attempt folders)
 const l=legacy('video',Buffer.from('LEGACY'));assert.equal(l.archiveVersion,1);assert.equal(jobFolder().files.length,1);assert.throws(()=>legacy('video',Buffer.from('LEGACY2')),/checksum conflict/);ok('G5 legacy video_archive unchanged (archiveVersion 1, first writer wins) and independent of attempt folders');
 assert.throws(()=>clean([1,2],{keepAttempt:2}),/Refusing to remove the kept attempt/);assert.deepEqual(names(jobFolder()),['attempt-01','attempt-02']);ok('G6 cleanup refuses to remove the kept (committed) attempt');
 const c1=clean([1],{keepAttempt:2});assert.equal(c1.removed,1);assert.deepEqual(names(jobFolder()),['attempt-02']);assert.equal(jobFolder().files.length,1);ok('G7 cleanup trashes only attempt-01; attempt-02 and the legacy final.mp4 stay');
 const c2=clean([1],{keepAttempt:2});assert.equal(c2.removed,0);ok('G8 duplicate cleanup callback is harmless (removed 0)');
 for(const bad of [[0],[100],[1.5],['../x'],['1; drop'],[]]) assert.throws(()=>clean(bad),/Invalid/);assert.throws(()=>clean(Array.from({length:21},(_,i)=>i+1)),/Invalid attempts/);ok('G9 cleanup rejects out-of-range, non-integer, path-like and oversized attempt lists');
 assert.equal(clean([3]).removed,0);ok('G10 cleanup of a never-staged attempt is a no-op');
 assert.throws(()=>att(1,'video',Buffer.from('x'),{sha256:'0'.repeat(64)}),/Checksum mismatch/);assert.throws(()=>att(0,'video',Buffer.from('x')),/Invalid attempt/);assert.throws(()=>att(1,'video',Buffer.from('x'),{jobId:'nope'}),/Invalid video identity/);assert.throws(()=>att(1,'evil',Buffer.from('x')),/Invalid archive kind/);ok('G11 validation: checksum, attempt, identity, kind');
 const jf=clean([9],{jobId:'33333333-3333-3333-3333-333333333333'});assert.equal(jf.removed,0);ok('G12 cleanup for an unknown job does not create folders and removes nothing');
 console.log('PASS draft Apps Script attempt actions: '+n+' checks against the real Code.gs helpers and legacy handler');
})().catch(e=>{console.error(e);process.exit(1);});
