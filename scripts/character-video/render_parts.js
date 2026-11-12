const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
(async()=>{const dir=process.argv[2];const files=fs.readdirSync(dir+'/svg').filter(f=>f.endsWith('.svg')).sort();
 const br=await chromium.launch();const pg=await br.newPage({viewport:{width:3600,height:3600}});
 await pg.setContent('<html><body style="margin:0;background:transparent"></body></html>');
 for(const f of files){const s=fs.readFileSync(dir+'/svg/'+f,'utf8');
  await pg.evaluate(x=>{document.body.innerHTML=x},s);
  await (await pg.$('svg')).screenshot({path:dir+'/png/'+f.replace('.svg','.png'),omitBackground:true});}
 await br.close();console.log('rendered',files.length);})();
