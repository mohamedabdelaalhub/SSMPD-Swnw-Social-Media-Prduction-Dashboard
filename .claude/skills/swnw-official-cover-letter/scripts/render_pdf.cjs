// node render_pdf.cjs <html-file> <pdf-out>  — A4 PDF via Chromium (fonts must already be loaded by the HTML).
const fs=require('fs');const {chromium}=require('playwright');
(async()=>{
  // The repo may resolve a Playwright version whose bundled browser is missing; fall back to the system Chromium.
  let b;try{b=await chromium.launch()}catch(e){const p=['/opt/pw-browsers/chromium','/usr/bin/chromium','/usr/bin/google-chrome'].find(x=>fs.existsSync(x));if(!p)throw e;b=await chromium.launch({executablePath:p,args:['--no-sandbox']})}
  const p=await b.newPage();
  await p.goto('file://'+process.argv[2]);await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(500);
  await p.pdf({path:process.argv[3],format:'A4',printBackground:true,preferCSSPageSize:true});await b.close()})();
