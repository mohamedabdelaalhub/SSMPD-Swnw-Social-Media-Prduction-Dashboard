// Owner 2026-11-25 (main chat, help 267): every file picker also takes drag & drop and paste (Ctrl+V / long-press «لصق»). One global enhancer
// adds a drop zone under each visible <input type=file> (also later ones), sets input.files via DataTransfer and fires change (existing upload
// code unchanged), respects accept / multiple / data-max-mb, routes a paste to ONE input (zone used last → the open modal/form → the only fit),
// never hijacks a paste into a text field, and leaves inputs that already have their own drop/paste (.pp, #design-file-input) alone. Real browser.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const html=`<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;padding:12px">
<form id="f1"><label>صورة الكارنيه <input type="file" id="card" accept="image/*"></label><input id="txt" placeholder="ملاحظة"></form>
<div class="pp"><input type="file" id="own" accept="image/*"></div><span id="hidwrap"><button type="button">رفع</button><input type="file" id="hid" accept="image/*,application/pdf" style="display:none"></span>
<div id="m" class="modal-backdrop" hidden><div class="modal"><input type="file" id="pdf" accept=".pdf,application/pdf"><input type="file" id="img" accept="image/png,image/jpeg" data-max-mb="1"><input type="file" id="many" multiple></div></div></body></html>`;
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});try{for(const width of [1280,390]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://fdp.test/',r=>r.fulfill({contentType:'text/html',body:html}));await page.goto('https://fdp.test/');
 await page.addStyleTag({content:fs.readFileSync('assets/css/file-drop-paste.css','utf8')});
 await page.evaluate(()=>{window.__ch={};document.addEventListener('change',e=>{if(e.target.type==='file')window.__ch[e.target.id]=(window.__ch[e.target.id]||0)+1;},true);
  window.mkFile=(name,type,size)=>new File([new Uint8Array(size||10)],name,{type});
  window.dropOn=(id,files)=>{const z=document.getElementById(id).__fdpZone,dt=new DataTransfer();files.forEach(f=>dt.items.add(f));z.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));};
  window.pasteFiles=(files,target)=>{const dt=new DataTransfer();files.forEach(f=>dt.items.add(f));(target||document.activeElement||document.body).dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));};});
 await page.addScriptTag({content:fs.readFileSync('assets/js/file-drop-paste.js','utf8')});await page.waitForTimeout(50);
 const zoneOf=async id=>page.evaluate(id=>{const n=document.getElementById(id).__fdpZone;return !!(n&&n.isConnected);},id);
 assert.equal(await zoneOf('card'),true,'visible input gets a zone');assert(await page.evaluate(()=>!document.querySelector('label .fdp-zone')),'zone placed outside the label');assert.equal(await zoneOf('own'),false,'inputs with their own drop/paste are skipped');assert.equal(await zoneOf('hid'),false,'hidden input: no zone');
 assert((await page.locator('#f1 label + .fdp-zone').innerText()).includes('اختار ملف أو اسحبه هنا، أو الصقه'));
 // card look: header + big zone + «ارفع ملف» + limits; the native picker is visually hidden but still focusable
 assert((await page.locator('#f1 label + .fdp-zone .fdp-head').innerText()).includes('ارفع ملف'));
 assert(await page.evaluate(()=>{const i=document.getElementById('card');return i.classList.contains('fdp-native')&&getComputedStyle(i).display!=='none';}));
 // drop
 await page.evaluate(()=>dropOn('card',[mkFile('card.png','image/png',2000)]));
 assert.equal(await page.evaluate(()=>document.getElementById('card').files[0].name),'card.png');assert.equal(await page.evaluate(()=>__ch.card),1,'change fired once');
 assert(await page.locator('#f1 label + .fdp-zone .fdp-row img').isVisible(),'thumbnail');assert((await page.locator('#f1 label + .fdp-zone .fdp-nm').innerText()).includes('card.png'));
 await page.evaluate(()=>dropOn('card',[mkFile('notes.txt','text/plain')]));
 assert.equal(await page.evaluate(()=>document.getElementById('card').files[0].name),'card.png','wrong type rejected');assert.equal((await page.locator('#f1 label + .fdp-zone .fdp-msg').innerText()).trim(),'نوع الملف ده مش مقبول هنا');
 // paste into a text field: left alone
 await page.focus('#txt');await page.evaluate(()=>pasteFiles([mkFile('x.png','image/png')]));assert.equal(await page.evaluate(()=>__ch.card),1,'paste in a text field is not hijacked');
 // modal open: paste routes to the one input in the modal that accepts the file
 await page.evaluate(()=>{document.getElementById('m').hidden=false;document.activeElement.blur();});await page.waitForTimeout(60);
 assert.equal(await zoneOf('pdf'),true,'zones added when the modal opens');assert((await page.locator('#img + .fdp-zone .fdp-head small').innerText()).includes('أقصى حجم 1 ميجا'));
 await page.evaluate(()=>pasteFiles([mkFile('','image/png',500)]));
 const img=await page.evaluate(()=>{const f=document.getElementById('img').files[0];return f&&f.name;});assert(img&&/^صورة-ملصقة-\d+\.png$/.test(img),'pasted screenshot named and routed to the image input: '+img);
 assert.equal(await page.evaluate(()=>__ch.pdf||0),0);assert.equal(await page.evaluate(()=>__ch.card),1,'never two inputs at once');
 // size limit
 await page.evaluate(()=>dropOn('img',[mkFile('big.png','image/png',2*1048576)]));assert.equal((await page.locator('#img + .fdp-zone .fdp-msg').innerText()).trim(),'الملف أكبر من 1 ميجا');
 // «الصق هنا» picks the target
 await page.evaluate(()=>{document.getElementById('pdf').__fdpZone.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));pasteFiles([mkFile('r.pdf','application/pdf')],document.body);});assert.equal(await page.evaluate(()=>document.getElementById('pdf').files[0].name),'r.pdf');
 // multiple / single
 await page.evaluate(()=>dropOn('many',[mkFile('a.png','image/png'),mkFile('b.png','image/png')]));assert.equal(await page.evaluate(()=>document.getElementById('many').files.length),2);
 await page.evaluate(()=>{document.getElementById('m').hidden=true;});await page.evaluate(()=>dropOn('card',[mkFile('1.png','image/png'),mkFile('2.png','image/png')]));assert.equal(await page.evaluate(()=>document.getElementById('card').files.length),1,'single input keeps one');
 // hidden input behind a button: its visible wrapper takes drops, no extra zone
 await page.evaluate(()=>{const a=document.getElementById('hidwrap'),dt=new DataTransfer();dt.items.add(mkFile('h.pdf','application/pdf'));a.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));});
 assert.equal(await page.evaluate(()=>document.getElementById('hid').files[0].name),'h.pdf');assert(await page.evaluate(()=>document.getElementById('hidwrap').classList.contains('fdp-target')));
 // added later
 await page.evaluate(()=>{const i=document.createElement('input');i.type='file';i.id='late';document.body.appendChild(i);});await page.waitForTimeout(60);assert.equal(await zoneOf('late'),true,'late inputs enhanced');
 if(process.env.FDP_QA)await page.screenshot({path:process.env.FDP_QA+'/fdp-'+width+'.png',fullPage:true});
 const sw=await page.evaluate(()=>document.scrollingElement.scrollWidth);assert(sw<=width+1,'no sideways scroll '+sw);
 assert.deepEqual(errors,[]);await page.close();}
 console.log('PASS file drop/paste 1280/390: zones on visible inputs (own-handler + hidden skipped, late ones added), drop sets files + change, accept/size/multiple respected, paste routed to one input (modal fit / «الصق هنا»), text-field paste untouched, thumbnail + name.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
