const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
const R=(process.env.SSMPD_REPO||require('path').resolve(__dirname,'../..'))+'/assets/fonts/';
const f=(n)=>fs.readFileSync(R+n).toString('base64');
const css=`@font-face{font-family:'BigVesta Arabic';font-weight:400;src:url(data:font/woff2;base64,${f('BigVesta-Regular.woff2')}) format('woff2')}
@font-face{font-family:'BigVesta Arabic';font-weight:700;src:url(data:font/woff2;base64,${f('BigVesta-Bold.woff2')}) format('woff2')}
@font-face{font-family:'BigVesta Arabic';font-weight:800;src:url(data:font/woff2;base64,${f('BigVesta-Bold.woff2')}) format('woff2')}
@font-face{font-family:'BigVesta Arabic';font-weight:900;src:url(data:font/woff2;base64,${f('BigVesta-Bold.woff2')}) format('woff2')}
@font-face{font-family:'Hiragino Kaku';font-weight:400;src:url(data:font/woff2;base64,${f('Hiragino-W3.woff2')}) format('woff2')}
@font-face{font-family:'Hiragino Kaku';font-weight:700;src:url(data:font/woff2;base64,${f('Hiragino-W6.woff2')}) format('woff2')}
@font-face{font-family:'Hiragino Kaku';font-weight:900;src:url(data:font/woff2;base64,${f('Hiragino-W8.woff2')}) format('woff2')}`;
(async()=>{
 const [dir,outdir,ext,start,end]=process.argv.slice(2);
 const files=fs.readdirSync(dir).filter(x=>x.endsWith('.svg')).sort();
 const a=start?+start:0,b=end?+end:files.length;
 fs.mkdirSync(outdir,{recursive:true});
 const br=await chromium.launch();const pg=await br.newPage({viewport:{width:1080,height:1920}});
 await pg.setContent(`<html><head><style>${css}</style></head><body style="margin:0;background:#fff"><span style="font-family:'BigVesta Arabic';font-weight:700">ابج</span><span style="font-family:'BigVesta Arabic';font-weight:400">ابج</span><span style="font-family:'Hiragino Kaku';font-weight:400">Swnw 123</span></body></html>`);
 await pg.evaluate(async()=>{await document.fonts.load('700 40px "BigVesta Arabic"');await document.fonts.load('400 40px "BigVesta Arabic"');await document.fonts.load('400 40px "Hiragino Kaku"');await document.fonts.ready;});
 for(let i=a;i<b;i++){
  const svg=fs.readFileSync(path.join(dir,files[i]),'utf8');
  await pg.evaluate(s=>{
    document.body.innerHTML=s;
    document.querySelectorAll('g.cap').forEach(g=>{
      const t=g.querySelector('.capt');const bb=t.getBBox();
      const pad=30;
      for(const [sel,dy] of [['.capr2',6],['.capr',0]]){const r=g.querySelector(sel);
        r.setAttribute('x',bb.x-pad);r.setAttribute('width',bb.width+pad*2);r.setAttribute('y',bb.y-12+dy);r.setAttribute('height',bb.height+24);}
    });
  },svg);
  await pg.screenshot({path:path.join(outdir,files[i].replace('.svg','.'+ext)),type:ext==='jpg'?'jpeg':'png',quality:ext==='jpg'?90:undefined});
 }
 await br.close();console.log('done',a,b);
})();
