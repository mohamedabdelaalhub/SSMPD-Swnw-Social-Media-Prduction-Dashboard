const {createCanvas,loadImage,GlobalFonts}=require('@napi-rs/canvas');
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');
assert(GlobalFonts.registerFromPath(root+'/assets/fonts/BigVesta-Bold.woff2','SonoDesign')); 
assert(GlobalFonts.registerFromPath(root+'/assets/fonts/BigVesta-Regular.woff2','SonoDesign')); 
assert(GlobalFonts.registerFromPath(root+'/assets/fonts/Hiragino-W6.woff2','SonoLatin')); 
class ImageAdapter{
 set src(url){loadImage(new URL(url).pathname).then(img=>{Object.assign(this,{width:img.width,height:img.height});this.img=img;this.onload();}).catch(e=>this.onerror(e));}
}
const context={window:{},document:{currentScript:{src:'file://'+root+'/assets/js/design-composer.js'},fonts:{add(){}}},FontFace:class{load(){return Promise.resolve(this);}},Image:ImageAdapter,URL};
vm.runInNewContext(fs.readFileSync(root+'/assets/js/design-composer.js','utf8'),context);
(async()=>{
 const scene=createCanvas(1536,1024);scene.getContext('2d').fillStyle='#ddeaf0';scene.getContext('2d').fillRect(0,0,1536,1024);
 function canvas(){const c=createCanvas(1080,1350),ctx=c.getContext('2d'),draw=ctx.drawImage.bind(ctx);ctx.drawImage=(img,...args)=>draw(img.img||img,...args);return c;}
 const base={headlineSize:64,subtitle:'اعرف إمتى تحتاج تقييمًا طبيًا',cta:'تواصل معنا',zoom:1,x:50,y:50};
 for(const headline of ['التعب المستمر يستحق الاهتمام','آلام الظهر','الكبد الدهني']){const c=canvas();await context.window.SSMPDDesignComposer.render(c,scene,{...base,headline});assert.equal(c.width,1080);assert.equal(c.height,1350);fs.writeFileSync('/tmp/sono-template-preview.png',c.toBuffer('image/png'));}
 await assert.rejects(context.window.SSMPDDesignComposer.render(canvas(),scene,{...base,headline:'كلمة '.repeat(150)}),/خارج المساحة|أكبر من عرض|متداخلة/);
 // Footer pixels must equal the overlay at export size.
 const c=canvas();await context.window.SSMPDDesignComposer.render(c,scene,{...base,headline:'آلام الظهر'});
 const overlay=await loadImage(root+'/assets/design-templates/sono-white/overlay.png'),ref=createCanvas(1080,1350);ref.getContext('2d').drawImage(overlay,0,0,1080,1350);
 assert.deepEqual(c.getContext('2d').getImageData(0,1190,1080,160).data,ref.getContext('2d').getImageData(0,1190,1080,160).data);
 const topReference=createCanvas(1080,1350),topCtx=topReference.getContext('2d');
 topCtx.fillStyle='#fff';topCtx.fillRect(0,0,1080,1350);topCtx.drawImage(overlay,0,0,1080,1350);
 for(const titlePosition of ['top','bottom','right','left']) {
   const result=canvas();
   await context.window.SSMPDDesignComposer.render(result,scene,{...base,headline:'التعب المستمر',subtitle:'اعرف السبب',titlePosition,headlineSize:64,subtitleSize:32,zoom:2,x:100,y:0});
   const sampleX=titlePosition==='right'?500:1050;
   assert(result.getContext('2d').getImageData(sampleX,20,1,1).data[0]<250,'Photograph reaches the top instead of a full-width white band');
   assert(!context.window.SSMPDDesignComposer.scenePrompt('clinic',{titlePosition}).includes('TOP 20 percent'));
   assert(context.window.SSMPDDesignComposer.scenePrompt('clinic',{titlePosition}).includes('upper-left corner'));
 }
 await context.window.SSMPDDesignComposer.render(canvas(),scene,{...base,headline:'التعب',headlineSize:130,headlineOffset:-120,ctaSize:40,ctaOffset:20});
 await assert.rejects(context.window.SSMPDDesignComposer.render(canvas(),scene,{...base,headline:'التعب',ctaOffset:60,ctaSize:80}),/خارج المساحة|متداخلة/);
 // Reverse complete text blocks without changing their content, font size or styling.
 for(const titlePosition of ['top','bottom','right','left']) {
   for(const multiline of [false,true]) {
     const headline=multiline?'هل العلاقة دي\nتستنزفك؟':'تستنزفك؟';
     const subtitle=multiline?'السطر التوضيحي\nللتصميم':'هل العلاقة دي';
     const settings={headline,subtitle,cta:'',headlineSize:64,subtitleSize:32,titlePosition};
     async function record(textOrder) {
       const output=canvas(),ctx=output.getContext('2d'),draw=ctx.fillText.bind(ctx),calls=[];
       ctx.fillText=(text,x,y)=>{if(ctx.fillStyle==='#07599d'||ctx.fillStyle==='#272727')calls.push({text,x,y,font:ctx.font});draw(text,x,y);};
       await context.window.SSMPDDesignComposer.render(output,scene,{...settings,textOrder});
       return {output,calls};
     }
     const normal=await record('headline_first'),reversed=await record('subtitle_first'),legacy=await record(undefined);
     assert.deepEqual(legacy.calls,normal.calls,'Existing designs keep the previous default order');
     assert.deepEqual(normal.calls.map(({text,font})=>({text,font})),reversed.calls.map(({text,font})=>({text,font})));
     const titles=reversed.calls.filter(c=>c.font.startsWith('700 ')),subtitles=reversed.calls.filter(c=>c.font.startsWith('400 '));
     assert(Math.max(...subtitles.map(c=>c.y))<Math.min(...titles.map(c=>c.y)),'Entire subtitle block must precede the title');
     assert.deepEqual(reversed.output.getContext('2d').getImageData(0,0,1080,160).data,normal.output.getContext('2d').getImageData(0,0,1080,160).data,'Reordering text does not change the logo or photograph');
   }
 }
 for(const text of [{headline:'العنوان فقط',subtitle:''},{headline:'',subtitle:'السطر فقط'}]) {
   await context.window.SSMPDDesignComposer.render(canvas(),scene,{...text,textOrder:'subtitle_first'});
 }
 // The image continues beyond the fade. A dark source must meet the fixed panel without a seam.
 const dark=createCanvas(1536,1024);dark.getContext('2d').fillStyle='#000';dark.getContext('2d').fillRect(0,0,1536,1024);
 const faded=canvas();await context.window.SSMPDDesignComposer.render(faded,dark,{headline:'',subtitle:'',cta:''});
 const pixels=faded.getContext('2d');
 assert(pixels.getImageData(540,800,1,1).data[0]<250,'Image still extends into the lower fade');
 assert(pixels.getImageData(540,905,1,1).data[0]>=253,'Fade completes before the opaque lower panel');
 const lateFade=canvas();await context.window.SSMPDDesignComposer.render(lateFade,dark,{headline:'',subtitle:'',cta:'',fadeStartY:820,fadeEndY:900});
 assert(lateFade.getContext('2d').getImageData(540,790,1,1).data[0]+20<pixels.getImageData(540,790,1,1).data[0],'Moving the fade down keeps the image visible longer');
 const deepFade=canvas();await context.window.SSMPDDesignComposer.render(deepFade,dark,{headline:'',subtitle:'',cta:'',fadeStartY:940,fadeEndY:1080});
 assert(deepFade.getContext('2d').getImageData(540,860,1,1).data[0]+20<pixels.getImageData(540,860,1,1).data[0],'The fade can move well below its default end');
 const earlyFade=canvas();await context.window.SSMPDDesignComposer.render(earlyFade,dark,{headline:'',subtitle:'',cta:'',fadeStartY:600,fadeEndY:750});
 assert(earlyFade.getContext('2d').getImageData(540,760,1,1).data[0]>=253,'Moving the fade up clears the image sooner');
 // A portrait that exactly fits vertically previously had zero available crop travel.
 const portrait=createCanvas(1080,1260),pc=portrait.getContext('2d');
 const gradient=pc.createLinearGradient(0,0,0,1260);gradient.addColorStop(0,'#000000');gradient.addColorStop(1,'#ffffff');pc.fillStyle=gradient;pc.fillRect(0,0,1080,1260);
 const samples=[];
 for(const imageOffsetY of [-200,0,200]) {
   const moved=canvas();await context.window.SSMPDDesignComposer.render(moved,portrait,{headline:'',zoom:1,imageOffsetY});
   samples.push(moved.getContext('2d').getImageData(900,400,1,1).data[0]);
   assert.deepEqual(moved.getContext('2d').getImageData(0,1190,1080,160).data,ref.getContext('2d').getImageData(0,1190,1080,160).data);
 }
 assert(samples[0]>samples[1]+20 && samples[1]>samples[2]+20,'Direct vertical movement works both ways at zoom 1');
 const shrunk=canvas();await context.window.SSMPDDesignComposer.render(shrunk,dark,{headline:'',subtitle:'',cta:'',zoom:.5});
 assert(shrunk.getContext('2d').getImageData(20,300,1,1).data[0]>=253,'Zoom below 1 can shrink the image');
 console.log('PASS: 3 Arabic titles, output size, overflow rejection, exact footer pixels. Native canvas only, not browser QA.');
})().catch(e=>{console.error(e);process.exitCode=1;});
