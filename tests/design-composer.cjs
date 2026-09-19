const { chromium }=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(e,b)=>{if(e)res.writeHead(404).end();else{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.woff2')?'font/woff2':file.endsWith('.png')?'image/png':'text/html');res.end(b);}});
 }).listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));
 let browser;
 try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage();
 await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
 const results=await page.evaluate(async()=>{
  const composer=window.SSMPDDesignComposer;
  const scene=document.createElement('canvas');scene.width=1536;scene.height=1024;
  scene.getContext('2d').fillStyle='#ddeaf0';scene.getContext('2d').fillRect(0,0,1536,1024);
  const topics=['التعب المستمر يستحق الاهتمام','آلام الظهر','الكبد الدهني'];
  for(const headline of topics){const c=document.createElement('canvas');await composer.render(c,scene,{headline,subtitle:'اعرف إمتى تحتاج تقييمًا طبيًا',cta:'تواصل معنا',zoom:1,x:50,y:50});if(c.width!==1080||c.height!==1350)throw Error('Wrong dimensions');}
  let rejected=false;try{await composer.render(document.createElement('canvas'),scene,{headline:'كلمة '.repeat(150),x:50,y:50});}catch(e){rejected=true;}if(!rejected)throw Error('Overflow not rejected');
  const canvas=document.createElement('canvas');await composer.render(canvas,scene,{headline:'آلام الظهر',subtitle:'متى يكون التقييم الطبي مهمًا؟',cta:'تواصل معنا',x:50,y:50});
  document.body.replaceChildren(canvas);canvas.style.width='540px';canvas.style.height='675px';
  return {topics:topics.length,overflowRejected:rejected,fonts:document.fonts.check('700 40px SonoDesign')};
 });console.log(results);await page.screenshot({path:'/tmp/sono-template-preview.png'});
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
