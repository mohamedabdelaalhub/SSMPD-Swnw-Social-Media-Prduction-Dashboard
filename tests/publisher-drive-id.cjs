/* Offline regression + adversarial tests for the strict Drive-id parsers in supabase/functions/{meta,tiktok}-publish-process (review #114).
   Loads the PATCHED function text from the working tree, the website publisher's strict parser from the repo, and the PRE-PATCH parsers (embedded verbatim)
   to show the finding and prove the tests can fail. No network, no Drive. Usage: node tests/publisher-drive-id.cjs */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
function extract(src,startRe){const m=startRe.exec(src);assert.ok(m,'function found '+startRe);let i=m.index,d=0,j=src.indexOf('{',i);for(let k=j;k<src.length;k++){if(src[k]==='{')d++;if(src[k]==='}'){d--;if(!d)return src.slice(i,k+1);}}throw new Error('unbalanced');}
const load=(text,name)=>{const ctx=vm.createContext({URL,String,RegExp});vm.runInContext(text+';this.fn='+name,ctx);return ctx.fn;};
const stripTs=t=>t.replace(/\(url: string\): string \| null/,'(url)').replace(/\(url:string\):string\|null/,'(url)').replace(/\(value\)/,'(value)');
const meta=load(stripTs(extract(read('supabase/functions/meta-publish-process/index.ts'),/function googleDriveFileId\(/)),'googleDriveFileId');
const tiktok=load(stripTs(extract(read('supabase/functions/tiktok-publish-process/index.ts'),/function driveId\(/)),'driveId');
const website=load(extract(read('supabase/functions/website-publish-process/index.ts'),/function driveImageId\(/),'driveImageId');
// PRE-PATCH parsers, verbatim from origin/main on 2026-11-04 (identical in both functions)
const oldMeta=load('function f(url){const pathMatch=/\\/file\\/d\\/([^/?#]+)/.exec(url);if(pathMatch)return pathMatch[1];try{const u=new URL(url);if(u.hostname.endsWith("drive.google.com"))return u.searchParams.get("id");}catch{}return null;}','f');
const ID='1AbC_dEf-GhIjKlMnOpQrStUvWxYz012';
// ---- legitimate variants: must keep working (id returned)
const legit=[`https://drive.google.com/file/d/${ID}/view?usp=drivesdk`,`https://drive.google.com/file/d/${ID}/view?usp=sharing`,`https://drive.google.com/file/d/${ID}/view?resourcekey=0-abc`,`https://drive.google.com/file/d/${ID}/edit`,`https://drive.google.com/file/d/${ID}`,`https://drive.google.com/file/d/${ID}/`,
 `https://drive.google.com/open?id=${ID}`,`https://drive.google.com/open?id=${ID}&usp=drive_fs`,`https://drive.google.com/uc?id=${ID}`,`https://drive.google.com/uc?export=download&id=${ID}`,
 `https://drive.google.com/u/0/file/d/${ID}/view`,`https://drive.google.com/u/1/open?id=${ID}`,`HTTPS://DRIVE.GOOGLE.COM/file/d/${ID}/view`,`https://drive.google.com:443/file/d/${ID}/view`,`https://drive.google.com/file/d/${ID}/view#anchor`,`  https://drive.google.com/file/d/${ID}/view  `,`https://drive.google.com/file/d/${ID}/view\n`];
// ---- hostile: must return null
const hosts=['evil.example','drive.google.com.evil.example','evil-drive.google.com','xdrive.google.com','drive.google.com.','drive.google.co','drive.gооgle.com','docs.google.com','googleusercontent.com','169.254.169.254','localhost','127.0.0.1','[::1]','drive.google.com@evil.example','evil.example@evil.example','drive.google.com:8443','drive.google.com:80'];
const tpls=[`/file/d/${ID}`,`/file/d/${ID}/view`,`/open?id=${ID}`,`/uc?id=${ID}`,`/x?id=${ID}`,`/?id=${ID}`,`/redirect?u=/file/d/${ID}`,`/#/file/d/${ID}`,`/..//file/d/${ID}`];
const hostile=[];for(const h of hosts)for(const t of tpls)hostile.push('https://'+h+t);
hostile.push(`http://drive.google.com/file/d/${ID}`,`ftp://drive.google.com/file/d/${ID}`,`file:///file/d/${ID}`,`data:text/plain,/file/d/${ID}`,`javascript:alert('/file/d/${ID}')`,`blob:https://drive.google.com/${ID}`,`//drive.google.com/file/d/${ID}`,`drive.google.com/file/d/${ID}`,`/file/d/${ID}`,ID,'',' ',`https://user:pw@drive.google.com/file/d/${ID}`,`https://user@drive.google.com/open?id=${ID}`,
 `https://drive.google.com\\@evil.example/file/d/${ID}`,`https://drive.google.com/%66ile/d/${ID}`,`https://drive.google.com/file%2Fd/${ID}`,`https://drive.google.com/file/d/`,`https://drive.google.com/file/d//view`,`https://drive.google.com/file/d/${ID};rm`,`https://drive.google.com/file/d/${ID}%00`,`https://drive.google.com/file/d/${'A'.repeat(300)}`,`https://drive.google.com/file/d/short`,`https://drive.google.com/open?id=`,`https://drive.google.com/open?id=${ID}/../x`,`https://drive.google.com/drive/folders/${ID}`,`https://drive.google.com/u/x/file/d/${ID}`,`https://drive.google.com/uu/0/file/d/${ID}`,`https://drive.google.com/file/d/${ID}/..`.replace('/..','')+'' && `https://drive.google.com/files/d/${ID}`,
 `https://evil.example/path/file/d/${ID}/view?x=https://drive.google.com/open?id=${ID}`,`https://drive.google.com.attacker.test/open?id=${ID}`);
const nonStrings=[null,undefined,42,{},[],true];
let n=0;const ok=m=>{n++;console.log('PASS',m);};
for(const u of legit){assert.equal(meta(u),ID,'meta legit '+JSON.stringify(u));assert.equal(tiktok(u),ID,'tiktok legit '+JSON.stringify(u));}
ok(`R1 ${legit.length} legitimate Drive URL variants (usp=drivesdk/sharing, resourcekey, edit, trailing slash, open?id, uc?export, /u/N/ account prefix, upper-case scheme/host, explicit :443, fragment, surrounding whitespace/newline) still resolve to the id in BOTH patched publishers`);
const badMeta=hostile.filter(u=>meta(u)!==null),badTik=hostile.filter(u=>tiktok(u)!==null);
assert.deepEqual(badMeta,[],'meta must reject: '+badMeta.join(' | '));assert.deepEqual(badTik,[],'tiktok must reject: '+badTik.join(' | '));
ok(`A1 ${hostile.length} hostile URLs (foreign/lookalike/IDN/IP/localhost hosts x 9 path shapes, userinfo and backslash tricks, ports, schemes, relative/bare forms, encoded paths, bad/long/short/empty ids, folder URLs, similar prefixes) are ALL rejected by both patched publishers`);
for(const v of nonStrings){assert.equal(meta(v),null);assert.equal(tiktok(v),null);}ok('A2 non-string inputs (null, undefined, number, object, array, boolean) return null without throwing');
for(const u of [...legit,...hostile]){assert.equal(meta(u),tiktok(u),'meta/tiktok agree on '+JSON.stringify(u));}ok('A3 the two patched publishers agree on every input (same rules)');
const diffs=[...legit,...hostile].filter(u=>meta(u)!==website(u));
const explained=diffs.every(u=>/\/u\/\d{1,2}\//.test(u)||/[\w-]{201,}/.test(u)||/file\/d\/short/.test(u)||/file\/d\/[^/]{1,9}(\/|$)/.test(u)||/id=[\w-]{1,9}$/.test(u));
assert.ok(explained,'unexplained differences vs website parser: '+diffs.filter(u=>!(/\/u\/\d{1,2}\//.test(u))).map(u=>u.slice(0,90)).join(' | '));
ok(`C1 agreement with the website publisher's strict parser except ${diffs.length} deliberate differences (optional /u/<n>/ account prefix accepted; ids shorter than 10 or longer than 200 characters rejected)`);
const oldAccepted=hostile.filter(u=>oldMeta(u)!==null);assert.ok(oldAccepted.length>=20,'the pre-patch parser must accept many hostile inputs (test power)');
ok(`F1 PRE-PATCH parser (verbatim) accepted ${oldAccepted.length} of ${hostile.length} hostile URLs, e.g. ${oldAccepted[0]} -> ${JSON.stringify(oldMeta(oldAccepted[0]))}: the finding is real and these tests would fail on the old code`);
const lostLegit=legit.filter(u=>oldMeta(u)===ID&&meta(u)!==ID);assert.deepEqual(lostLegit,[]);
const oldOnlyLegitLooking=['drive.google.com/file/d/'+ID+'/view','http://drive.google.com/file/d/'+ID+'/view'].filter(u=>oldMeta(u)===ID&&meta(u)===null);
ok(`G1 behaviour change to be aware of: scheme-less or http:// Drive links (${oldOnlyLegitLooking.length} of 2 probes) that the old parser accepted are now rejected (they fall through to the non-Drive path); https links on drive.google.com are unaffected`);
console.log('PASS publisher strict Drive-id parsers: '+n+' groups');
