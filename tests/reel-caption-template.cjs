// قالب كابشن الريل (البوكس): لازم يحمّل خط البراند فعلاً (سونو BigVesta / دينا Tajawal) قبل التصوير، وإلا يقول font-missing
const path=require('path'),fs=require('fs'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),file=path.join(root,'docs/templates/reel-caption/caption.html');
(async()=>{
  const {chromium}=require('playwright');
  const b=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{}),...(process.env.PW_EXECUTABLE?{executablePath:process.env.PW_EXECUTABLE}:{})});
  try{
    const p=await b.newPage({viewport:{width:1080,height:1920}});
    for(const [brand,fam,hl] of [['sono','SwnwCap','rgb(241, 90, 34)'],['dina','DinaCap','rgb(227, 20, 27)']]){
      await p.goto('file://'+file+'?brand='+brand+'&text='+encodeURIComponent('رجلك نمّلت وإنت قاعد؟')+'&hl='+encodeURIComponent('نمّلت'));
      await p.waitForFunction(()=>document.body.dataset.ready);
      assert.equal(await p.evaluate(()=>document.body.dataset.ready),'1',brand+' font loaded');
      const r=await p.evaluate(f=>{const c=document.getElementById('c');return{fam:getComputedStyle(c).fontFamily,hl:getComputedStyle(c.querySelector('.hl')).color,text:c.textContent,w:c.getBoundingClientRect().width}},fam);
      assert.equal(r.fam,fam);assert.equal(r.hl,hl);assert.equal(r.text,'رجلك نمّلت وإنت قاعد؟');assert(r.w<=960&&r.w>200,'box hugs text');
      const png=await p.screenshot({omitBackground:true});assert(png.length>1000);
      if(process.env.CAPTION_SHOT)fs.writeFileSync(process.env.CAPTION_SHOT+'-'+brand+'.png',png);
    }
    // لو ملف الخط مش موجود: font-missing (عشان محدش يصوّر بخط بديل)
    const broken=fs.readFileSync(file,'utf8').replace('Tajawal-Bold.ttf','NOPE.ttf');const tmp=path.join(path.dirname(file),'.caption-broken.html');
    fs.writeFileSync(tmp,broken);
    try{await p.goto('file://'+tmp+'?brand=dina&text=test');await p.waitForFunction(()=>document.body.dataset.ready);
      assert.equal(await p.evaluate(()=>document.body.dataset.ready),'font-missing');}finally{fs.unlinkSync(tmp);}
    console.log('PASS reel caption template (BigVesta/Tajawal really loaded, brand highlight, box hugs text, font-missing guard)');
  }finally{await b.close();}
})().catch(e=>{console.error(e);process.exit(1);});
