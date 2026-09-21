const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {JSDOM}=require('jsdom');
const {createCanvas,loadImage,GlobalFonts}=require('@napi-rs/canvas');
const root=path.resolve(__dirname,'..');
const dom=new JSDOM('<body></body>',{runScripts:'outside-only',url:'https://test.invalid'}),w=dom.window;
for(const [file,family] of [['BigVesta-Bold','SonoDesign'],['BigVesta-Regular','SonoDesign'],['Hiragino-W6','SonoLatin']])GlobalFonts.registerFromPath(root+'/assets/fonts/'+file+'.woff2',family);
Object.defineProperty(w.document,'currentScript',{value:{src:'file://'+root+'/assets/js/design-composer.js'}});
w.document.fonts={add(){}};w.FontFace=class{load(){return Promise.resolve(this)}};
w.Image=class{set src(url){loadImage(new URL(url).pathname).then(img=>{this.img=img;this.width=img.width;this.height=img.height;this.onload()}).catch(e=>this.onerror(e))}};
const native=new WeakMap();let calls=[];
w.HTMLCanvasElement.prototype.getContext=function(){
 if(!native.has(this)){
  const c=createCanvas(1080,1350),ctx=c.getContext('2d'),draw=ctx.drawImage.bind(ctx),fill=ctx.fillText.bind(ctx);
  ctx.drawImage=(img,...args)=>draw(native.get(img)||img.img||img,...args);
  ctx.fillText=(text,x,y)=>{calls.push({text,x,y,font:ctx.font});fill(text,x,y)};
  native.set(this,c);
 }
 return native.get(this).getContext('2d');
};
const query={select(){return this},eq(){return this},order(){return this},limit(){return Promise.resolve({data:[]})}};
w.SSMPDDb={client:{from(){return query},functions:{invoke:async()=>({data:{images:[{id:'test',url:'test-scene'}]}})}}};
w.eval(fs.readFileSync(root+'/assets/js/design-composer.js','utf8'));
const C=w.SSMPDDesignComposer,render=C.render;let latest=Promise.resolve();
C.render=(...args)=>latest=render(...args);
C.loadImage=async()=>createCanvas(1080,1350);
w.eval(fs.readFileSync(root+'/assets/js/design-studio.js','utf8'));
const field=name=>w.document.querySelector('[data-field="'+name+'"]');
async function change(name,value){calls=[];field(name).value=String(value);field(name).dispatchEvent(new w.Event('input'));await latest;await Promise.resolve();return calls.slice()}
(async()=>{
 w.SSMPDDesignStudio.open({id:'test',title:'بتستنزفك؟'});await latest;
 await w.document.querySelector('[data-library]').onclick();w.document.querySelector('[data-images] button').click();await Promise.resolve();await latest;
 await change('subtitle','هل العلاقة دي');await change('textOrder','subtitle_first');await change('headlineSize',120);await change('cta','احجز موعدك الآن');
 let small=await change('subtitleSize',20);
 let big=await change('subtitleSize',100);
 assert(small.find(x=>x.text==='هل العلاقة دي').font.includes('20px'));
 assert(big.find(x=>x.text==='هل العلاقة دي').font.includes('100px'));
 assert(w.document.querySelector('[data-status]').textContent.includes('متداخلة'));
 assert(w.document.querySelector('[data-save]').disabled);
 assert(w.document.querySelector('[data-download]').disabled);
 let moved=await change('headlineOffset',-150);
 assert(moved.find(x=>x.text==='بتستنزفك؟').y<big.find(x=>x.text==='بتستنزفك؟').y);
 assert.equal(w.document.querySelector('[data-download]').disabled,false);
 for(const size of [40,80,30,100])assert((await change('subtitleSize',size)).find(x=>x.text==='هل العلاقة دي').font.includes(size+'px'));
 let cta=await change('ctaSize',40);assert(cta.find(x=>x.text==='احجز موعدك الآن').font.includes('40px'));
 let shifted=await change('ctaOffset',20);assert.equal(shifted.find(x=>x.text==='احجز موعدك الآن').y,cta.find(x=>x.text==='احجز موعدك الآن').y+20);
 await change('headlineSize',64);await change('subtitleSize',32);
 for(const pos of ['left','right'])assert((await change('titlePosition',pos)).some(x=>x.text.includes('هل')));
 console.log('PASS: real studio input handlers + native canvas; 20→100px, repeated edits, overlap preview, save guard, recovery, CTA size/position, left/right. Not browser QA.');
 dom.window.close();
})().catch(e=>{console.error(e);process.exitCode=1;dom.window.close()});
