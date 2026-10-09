const assert=require('assert/strict'),fs=require('fs'),vm=require('vm'),{stripTypeScriptTypes}=require('module'),{webcrypto,generateKeyPairSync}=require('crypto');
(async()=>{
 const {imageBytes}=await import('../supabase/functions/website-publish-process/transport.mjs');
 const origin='https://project.supabase.co',png=new Uint8Array([137,80,78,71,13,10,26,10,1]);let calls=[],status=200,large=false;
 const keys=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
 const ctx=vm.createContext({URL,URLSearchParams,TextEncoder,TextDecoder,Uint8Array,Response,AbortSignal,crypto:webcrypto,btoa,atob,Deno:{env:{get:()=>JSON.stringify({client_email:'test@example.invalid',private_key:keys.privateKey,token_uri:'https://invalid.example'})}},fetch:async(url,opts)=>{calls.push({url,opts});if(url.includes('oauth2.googleapis.com'))return new Response(JSON.stringify({access_token:'mock-token',expires_in:3600}),{headers:{'content-type':'application/json'}});return new Response(large?new Uint8Array(5*1024*1024+1):png,{status});}});
 const source=fs.readFileSync('supabase/functions/website-publish-process/index.ts','utf8');const helper=source.split('// Begin website-image helpers (also exercised with mocked network/storage).\n')[1].split('// End website-image helpers.')[0];vm.runInContext(stripTypeScriptTypes(helper),ctx);
 const db={storage:{from:bucket=>({download:async key=>{calls.push({bucket,key});return {data:new Blob([png])};}})}};
 for(const form of ['authenticated','sign','public']){const result=await ctx.readWebsiteImage(db,origin+'/storage/v1/object/'+form+'/content-designs/item/output.png?token=expired',origin);assert.equal(imageBytes(result).mime,'image/png');assert.equal(calls.at(-1).key,'item/output.png');}
 await ctx.readWebsiteImage(db,origin+'/storage/v1/object/public/meta-publish-assets/old.jpg',origin);
 for(const url of ['https://drive.google.com/file/d/legacy-id/view','https://drive.google.com/open?id=legacy-id','https://drive.google.com/uc?id=legacy-id']){assert.equal(imageBytes(await ctx.readWebsiteImage(db,url,origin)).mime,'image/png');assert.equal(calls.at(-1).opts.headers.Authorization,'Bearer mock-token');assert.equal(calls.at(-1).opts.redirect,'error');}
 assert.equal(calls.filter(c=>c.url?.includes('oauth2.googleapis.com')).length,1,'reuses OAuth token');
 assert.equal(calls.find(c=>c.url?.includes('oauth2.googleapis.com')).url,'https://oauth2.googleapis.com/token','fixed credential endpoint');
 for(const url of ['https://drive.google.com.evil.test/file/d/id/view','http://drive.google.com/file/d/id/view','https://user:password@drive.google.com/file/d/id/view','https://evil.test/storage/v1/object/public/content-designs/a.png',origin+'/storage/v1/object/public/patient-files/a.png']){const n=calls.length;await assert.rejects(ctx.readWebsiteImage(db,url,origin),/UNSUPPORTED_IMAGE_SOURCE|INVALID_FILE/);assert.equal(calls.length,n);}
 status=403;await assert.rejects(ctx.readWebsiteImage(db,'https://drive.google.com/file/d/forbidden/view',origin),/DRIVE_IMAGE_ACCESS_DENIED/);status=200;large=true;await assert.rejects(ctx.readWebsiteImage(db,'https://drive.google.com/file/d/large/view',origin),/INVALID_FILE/);
 large=false;ctx.Deno.env.get=()=>undefined;vm.runInContext('googleTokenCache=null',ctx);await assert.rejects(ctx.readWebsiteImage(db,'https://drive.google.com/file/d/id/view',origin),/DRIVE_SERVICE_ACCOUNT_MISSING/);
 // Syntax-check the entire function after stripping TS/imports, without invoking a live service.
 new vm.Script(stripTypeScriptTypes(source.replace(/^import .*\n/gm,'')));
 console.log('PASS: authenticated/signed/public storage, legacy Meta assets, Drive links, real JWT signing with mock OAuth, token reuse, fixed endpoints, host/bucket rejection, denied access, oversized stream, missing credentials, full function syntax. No live publication.');
})().catch(e=>{console.error(e);process.exit(1);});
