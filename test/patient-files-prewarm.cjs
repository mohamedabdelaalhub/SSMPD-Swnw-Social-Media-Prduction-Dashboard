// Prewarm: one OPTIONS to patient-files-list when a patient list appears; throttled; never sends auth.
const {JSDOM}=require('jsdom'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const dom=new JSDOM('<div id="list"></div>',{runScripts:'outside-only'}),w=dom.window,calls=[];
w.SSMPD_CONFIG={supabase:{url:'https://api.example.test/',anonKey:'pk_test'}};
w.fetch=(u,o)=>{calls.push([u,o]);return Promise.resolve({});};
let session={access_token:'jwt-staff'};
w.SSMPDDb={client:{auth:{getSession:()=>Promise.resolve({data:{session}})}}};
w.eval(fs.readFileSync(path.join(__dirname,'../assets/js/patient-files-prewarm.js'),'utf8'));
const tick=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  await tick(400);assert.equal(calls.length,0,'no patient rows, no request');
  w.document.getElementById('list').innerHTML='<button data-open="p1">x</button>';await tick(400);
  assert.equal(calls.length,1);
  const [u,o]=calls[0];assert.equal(u,'https://api.example.test/functions/v1/patient-files-list');
  assert.equal(o.method,'OPTIONS');assert.equal(JSON.stringify(o.headers),JSON.stringify({apikey:'pk_test',Authorization:'Bearer jwt-staff'}),'staff JWT, no patient id');
  w.document.querySelector('[data-open]').dispatchEvent(new w.Event('pointerover',{bubbles:true}));
  w.document.getElementById('list').innerHTML+='<button data-open="p2">y</button>';await tick(400);
  assert.equal(calls.length,1,'throttled');
  w.SSMPDPatientFilesPrewarm._reset();w.document.querySelector('[data-open]').dispatchEvent(new w.Event('pointerover',{bubbles:true}));
  await tick(20);assert.equal(calls.length,2,'hover warms after the window');
  session=null;w.SSMPDPatientFilesPrewarm._reset();w.SSMPDPatientFilesPrewarm.warm();await tick(20);
  assert.equal(calls.length,2,'no session, no request');
  console.log('patient files prewarm: OK');
})().catch(e=>{console.error(e);process.exit(1);});
