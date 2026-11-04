/* Drive URL shape contract (review #112), mocks only (no Drive, no network):
   (a) which URL shapes the Apps Script bridge produces (file.getUrl()/folder.getUrl()),
   (b) the DB commit validator regex taken verbatim from supabase/drafts/20261104_video_job_fencing.sql,
   (c) the three DEPLOYED consumers' URL parsers, copied verbatim from the sources read read-only on 2026-11-04 (website-publish-process driveImageId,
       meta-publish-process googleDriveFileId, tiktok-publish-process driveId),
   (d) a MODEL of Drive ACL inheritance for nested attempt-NN folders (documented Drive behaviour, NOT proof: a model of the documented expectation).
   Usage: node tests/drive-url-shape.cjs */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const sql=fs.readFileSync(path.join(__dirname,'..','supabase/drafts/20261104_video_job_fencing.sql'),'utf8');
const m=/drive_re constant text := '([^']+)'/.exec(sql);assert.ok(m,'validator regex found in the draft');
const dbRe=new RegExp(m[1]);                                   // POSIX ERE used by Postgres; same syntax for this pattern in JS
// ---- verbatim copies of the deployed parsers
function websiteDriveImageId(value){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||u.hostname!=='drive.google.com')return null;const match=/^\/file\/d\/([\w-]+)(?:\/|$)/.exec(u.pathname);const id=match?match[1]:['/open','/uc'].includes(u.pathname)?u.searchParams.get('id'):null;return id&&/^[\w-]+$/.test(id)?id:null;}catch{return null;}}
function metaGoogleDriveFileId(url){const pathMatch=/\/file\/d\/([^/?#]+)/.exec(url);if(pathMatch)return pathMatch[1];try{const u=new URL(url);if(u.hostname.endsWith("drive.google.com"))return u.searchParams.get("id");}catch{}return null;}
const tiktokDriveId=metaGoogleDriveFileId;                    // identical source text in tiktok-publish-process
const ID='1AbC_dEf-GhIjKlMnOpQrStUvWxYz012';
const bridgeShapes=[`https://drive.google.com/file/d/${ID}/view?usp=drivesdk`,`https://drive.google.com/file/d/${ID}/view`,`https://drive.google.com/file/d/${ID}`,`https://drive.google.com/open?id=${ID}`,`https://drive.google.com/uc?id=${ID}`];
const folderShape=`https://drive.google.com/drive/folders/${ID}`;
let n=0;const ok=x=>{n++;console.log('PASS',x);};
for(const u of bridgeShapes){assert.ok(dbRe.test(u),'DB accepts '+u);assert.equal(websiteDriveImageId(u),ID,'website '+u);assert.equal(metaGoogleDriveFileId(u),ID,'meta '+u);assert.equal(tiktokDriveId(u),ID,'tiktok '+u);}
ok('D1 every Apps Script file URL shape (view?usp=drivesdk, /view, bare, open?id, uc?id) is accepted by the DB validator AND yields the same file id in the website, Meta and TikTok parsers (the attempt-scoped files use the same shape as today\'s final.mp4)');
assert.ok(dbRe.test(folderShape));assert.equal(websiteDriveImageId(folderShape),null);ok('D2 folder URLs pass the DB validator (drive_folder_url) and are never parsed as files by the consumers');
const hostile=['http://drive.google.com/file/d/'+ID,'https://drive.google.com.evil.example/file/d/'+ID,'https://evil.example/file/d/'+ID,'https://drive.google.com@evil.example/file/d/'+ID,'https://user:pw@drive.google.com/file/d/'+ID,'https://drive.google.com:8443/file/d/'+ID,'javascript:alert(1)','https://drive.google.com/file/d/'+ID+'\n','https://drive.google.com/file/d/ID with space','ftp://drive.google.com/file/d/'+ID,'//drive.google.com/file/d/'+ID,'https://DRIVE.GOOGLE.COM.evil.example/'];
for(const u of hostile)assert.equal(dbRe.test(u),false,'DB must reject '+JSON.stringify(u));
ok('D3 the DB validator rejects http, lookalike hosts, userinfo tricks (@), ports, javascript:, newlines, spaces, ftp and protocol-relative URLs (12 hostile forms)');
const NEWLINE='https://drive.google.com/file/d/'+ID+'\n';   // the WHATWG URL parser strips trailing whitespace: host stays drive.google.com, harmless; the DB validator is stricter
const strictWeb=hostile.filter(u=>u!==NEWLINE&&websiteDriveImageId(u)!==null);assert.deepEqual(strictWeb,[],'website parser is strict');assert.equal(websiteDriveImageId(NEWLINE),ID);ok('D4 the WEBSITE parser is strict: it rejects 11 of 12 hostile forms; the 12th (trailing newline) is normalised by URL parsing to the genuine drive.google.com URL, harmless, and the DB validator rejects it anyway');
// FINDING: the Meta/TikTok parsers match /file/d/<id> ANYWHERE in the string, before looking at the host
const lenient=hostile.filter(u=>u!==NEWLINE&&metaGoogleDriveFileId(u)!==null);
assert.ok(lenient.includes('https://evil.example/file/d/'+ID)&&lenient.includes('https://drive.google.com.evil.example/file/d/'+ID));
ok('D5 FINDING (pre-existing, outside video_jobs): meta-publish-process and tiktok-publish-process extract a Drive file id from ANY URL containing /file/d/<id> (host not checked), e.g. https://evil.example/file/d/<id> -> '+JSON.stringify(ID)+'; with the drive.readonly service account that lets whoever can set content_items.design_file_url make the publisher read ANY Drive file the account can see ('+lenient.length+' of the 11 non-normalised hostile forms are accepted). The video path is protected at the source by the DB validator; the publishers should reuse the website parser (narrow remediation, own approval)');
// ---- (d) ACL inheritance model
class Node{constructor(name,parent,perms){this.name=name;this.parent=parent;this.perms=new Set(perms||(parent?parent.perms:[]));this.restricted=false;}
 child(name,opts={}){const c=new Node(name,this);if(opts.restricted)c.perms=new Set(opts.keep||[]);return c;}}
const canRead=(node,who)=>node.perms.has(who);
const SA='publisher-sa@project.iam';
const design=new Node('design(category root)',null,[SA,'owner']);                       // service account shared on the category folder (documented expectation for today's setup)
const attempt1=design.child('Videos').child('sono').child('2026').child('09').child('content_job').child('attempt-01');
const file=attempt1.child('final.mp4');
assert.ok(canRead(file,SA));ok('A1 MODEL: a service account shared on an ancestor folder can read a new nested attempt-NN/final.mp4 (children inherit the parent\'s sharing at creation)');
const legacyOnlyRoot=new Node('Videos',null,['owner']);const legacyFile=legacyOnlyRoot.child('x').child('final.mp4');legacyFile.perms.add(SA);
const newAttempt=legacyOnlyRoot.child('x').child('attempt-01').child('final.mp4');
assert.ok(canRead(legacyFile,SA)&&!canRead(newAttempt,SA));ok('A2 MODEL: if the service account was shared only on INDIVIDUAL legacy files, a NEW nested attempt file is NOT readable: the canary must check this');
const restricted=design.child('Videos').child('restricted',{restricted:true,keep:['owner']});assert.ok(!canRead(restricted.child('attempt-01').child('final.mp4'),SA));ok('A3 MODEL: a folder with limited access (inheritance cut) hides nested files from the service account');
console.log('PASS Drive URL shape + ACL model: '+n+'+3 checks. ACL cases are a MODEL of documented behaviour; real access is only provable at the dummy canary.');
