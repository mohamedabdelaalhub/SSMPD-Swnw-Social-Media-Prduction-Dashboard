// Prewarm: one HEAD to patient-files-list when a patient list appears; throttled; never sends auth.
const {JSDOM}=require('jsdom'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const dom=new JSDOM('<div id="list"></div>',{runScripts:'outside-only'}),w=dom.window,calls=[];
w.SSMPD_CONFIG={supabase:{url:'https://api.example.test/',anonKey:'pk_test'}};
w.fetch=(u,o)=>{calls.push([u,o]);return Promise.resolve({});};
w.eval(fs.readFileSync(path.join(__dirname,'../assets/js/patient-files-prewarm.js'),'utf8'));
const tick=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  await tick(400);assert.equal(calls.length,0,'no patient rows, no request');
  w.document.getElementById('list').innerHTML='<button data-open="p1">x</button>';await tick(400);
  assert.equal(calls.length,1);
  const [u,o]=calls[0];assert.equal(u,'https://api.example.test/functions/v1/patient-files-list');
  assert.equal(o.method,'HEAD');assert.equal(JSON.stringify(o.headers),JSON.stringify({apikey:'pk_test'}),'no Authorization, no patient id');
  w.document.querySelector('[data-open]').dispatchEvent(new w.Event('pointerover',{bubbles:true}));
  w.document.getElementById('list').innerHTML+='<button data-open="p2">y</button>';await tick(400);
  assert.equal(calls.length,1,'throttled');
  w.SSMPDPatientFilesPrewarm._reset();w.document.querySelector('[data-open]').dispatchEvent(new w.Event('pointerover',{bubbles:true}));
  assert.equal(calls.length,2,'hover warms after the window');
  console.log('patient files prewarm: OK');
})().catch(e=>{console.error(e);process.exit(1);});
