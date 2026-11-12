const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const [src,out,w,h]=process.argv.slice(2);const b=await chromium.launch();const p=await b.newPage({viewport:{width:+w||2400,height:+h||1700}});
await p.setContent('<body style="margin:0">'+fs.readFileSync(src,'utf8')+'</body>');await (await p.$('svg')).screenshot({path:out});await b.close()})();
