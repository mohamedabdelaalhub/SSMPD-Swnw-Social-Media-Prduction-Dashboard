const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {JSDOM}=require('jsdom');
(async()=>{
 const dom=new JSDOM('<body></body>',{runScripts:'outside-only',url:'https://test.invalid'}),w=dom.window;
 let settings;
 w.HTMLCanvasElement.prototype.getContext=()=>({drawImage(){}});
 w.SSMPDDesignComposer={render:async(canvas,scene,data)=>{settings=data;canvas.width=1080;canvas.height=1350;canvas.designIssues=[];canvas.designWarnings=[];}};
 w.SSMPDDesignFiles={canEdit:()=>true,latest:async()=>({id:'version',created_at:'2026-10-08',settings:{headline:'Saved title',headlineOffset:-40,subtitleOffset:35,ctaOffset:-100}})};
 w.SSMPDDb={listBrandLogos:async()=>[],client:{from:()=>({select(){return this},eq(){return this},order(){return this},limit:async()=>({data:[]})})}};
 w.eval(fs.readFileSync(path.resolve(__dirname,'../assets/js/design-studio.js'),'utf8'));
 w.SSMPDDesignStudio.open({id:'item',brand:'sono',title:'Title',hook_text:'Hook'});
 await new Promise(resolve=>setTimeout(resolve,20));
 const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
 for(const key of ['headlineOffset','subtitleOffset','ctaOffset']){
  const slider=w.document.querySelector('[data-field="'+key+'"]'),input=w.document.querySelector('[data-number-for="'+key+'"]');
  assert.equal(input.value,slider.value,'saved signed offsets restore to both controls');
  assert.equal(input.type,'text');assert.equal(input.inputMode,'text');
  w.document.querySelector('[data-offset-reset="'+key+'"]').click();await tick();assert.equal(input.value,'0');
  w.document.querySelector('[data-offset-step="'+key+'"][data-delta="-5"]').click();await tick();assert.equal(input.value,'-5');assert.equal(settings[key],'-5');
  w.document.querySelector('[data-offset-step="'+key+'"][data-delta="5"]').click();await tick();assert.equal(input.value,'0');
  w.document.querySelector('[data-offset-step="'+key+'"][data-delta="5"]').click();await tick();assert.equal(settings[key],'5');
  slider.value='-75';slider.dispatchEvent(new w.Event('input',{bubbles:true}));await tick();assert.equal(input.value,'-75');assert.equal(settings[key],'-75');
  input.value='-';input.dispatchEvent(new w.Event('input'));assert.equal(slider.value,'-75','typing a sign alone must not move the text');
  input.value='-123';input.dispatchEvent(new w.Event('input'));await tick();assert.equal(slider.value,'-123');assert.equal(settings[key],'-123');
  input.value='-9999';input.dispatchEvent(new w.Event('input'));await tick();assert.equal(slider.value,slider.min);
  w.document.querySelector('[data-offset-step="'+key+'"][data-delta="-5"]').click();await tick();assert.equal(slider.value,slider.min);
 }
 w.document.querySelector('[data-field="titlePosition"]').value='top';w.document.querySelector('[data-field="titlePosition"]').dispatchEvent(new w.Event('change'));await tick();
 for(const key of ['headlineOffset','subtitleOffset'])assert.equal(w.document.querySelector('[data-number-for="'+key+'"]').value,'0');
 console.log('PASS: restored offsets, up/down buttons, zero reset, slider sync, typed negative numbers, partial sign entry and bounds for all three text elements.');w.close();
})().catch(error=>{console.error(error);process.exit(1)});
