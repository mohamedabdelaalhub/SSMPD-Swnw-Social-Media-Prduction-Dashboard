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
 const base={subtitle:'اعرف إمتى تحتاج تقييمًا طبيًا',cta:'تواصل معنا',zoom:1,x:50,y:50};
 for(const headline of ['التعب المستمر يستحق الاهتمام','آلام الظهر','الكبد الدهني']){const c=canvas();await context.window.SSMPDDesignComposer.render(c,scene,{...base,headline});assert.equal(c.width,1080);assert.equal(c.height,1350);fs.writeFileSync('/tmp/sono-template-preview.png',c.toBuffer('image/png'));}
 await assert.rejects(context.window.SSMPDDesignComposer.render(canvas(),scene,{...base,headline:'كلمة '.repeat(150)}),/النص أطول/);
 // Footer pixels must equal the overlay at export size.
 const c=canvas();await context.window.SSMPDDesignComposer.render(c,scene,{...base,headline:'آلام الظهر'});
 const overlay=await loadImage(root+'/assets/design-templates/sono-white/overlay.png'),ref=createCanvas(1080,1350);ref.getContext('2d').drawImage(overlay,0,0,1080,1350);
 assert.deepEqual(c.getContext('2d').getImageData(0,1190,1080,160).data,ref.getContext('2d').getImageData(0,1190,1080,160).data);
 console.log('PASS: 3 Arabic titles, output size, overflow rejection, exact footer pixels. Native canvas only, not browser QA.');
})().catch(e=>{console.error(e);process.exitCode=1;});
