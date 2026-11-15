// Contract marketing worker keys: the printed public key verifies the worker's own signatures, and the
// edge-function verifier accepts keys from CONTRACT_MARKETING_WORKER_PUBKEYS only (no built-in key).
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {execFileSync} from 'node:child_process';import crypto from 'node:crypto';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cmk-'));const cfg=path.join(dir,'c.json');const secret='x'.repeat(40);
await fs.writeFile(cfg,JSON.stringify({secret}));
const pub=execFileSync(process.execPath,['scripts/contract-marketing-worker.mjs','--print-public-key'],{env:{...process.env,SWNW_CONTRACT_CONFIG:cfg}}).toString().trim();
assert.match(pub,/^[A-Za-z0-9_-]{43}$/);assert(!pub.includes(secret));
const priv=crypto.createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),crypto.createHash('sha256').update(secret).digest()]),format:'der',type:'pkcs8'});
const stamp=String(Date.now()),sig=crypto.sign(null,Buffer.from(stamp),priv).toString('base64url');
// Run the Deno verifier under Node: strip the TS types and provide Deno.env.
for(const fn of ['contract-marketing','content-ai']){
 let src=await fs.readFile(`supabase/functions/${fn}/worker-auth.ts`,'utf8');
 src=src.replace(/:Promise<boolean>/g,'').replace(/:string\[\]/g,'').replace(/\(value:string,extra:string\|undefined=/,'(value,extra=').replace(/\(extra:string\|undefined\)/,'(extra)').replace(/\(s:string\)/g,'(s)');
 const mod=path.join(dir,fn+'.mjs');await fs.writeFile(mod,'const Deno={env:{get:()=>undefined}};\n'+src);
 const {verifyWorkerToken,workerPublicKeys}=await import(mod);
 assert.equal(workerPublicKeys('').length,0);assert.equal(workerPublicKeys('bad, '+pub).length,1);
 assert.equal(await verifyWorkerToken('Bearer CM.'+stamp+'.'+sig,''),false,fn+': unknown key refused');
 assert.equal(await verifyWorkerToken('Bearer CM.'+stamp+'.'+sig,pub),true,fn+': extra key accepted');
 assert.equal(await verifyWorkerToken('Bearer CM.'+String(Date.now()-600000)+'.'+sig,pub),false,fn+': stale stamp refused');
}
assert.throws(()=>execFileSync(process.execPath,['scripts/contract-marketing-worker.mjs','--once'],{env:{...process.env,SWNW_CONTRACT_CONFIG:cfg,SWNW_CONTRACT_MODE:'bogus'},stdio:'pipe'}));
console.log('PASS contract worker keys: printed public key verifies, extra keys via env only, stale stamps refused, mode validated');
