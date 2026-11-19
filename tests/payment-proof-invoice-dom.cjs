// Owner 2026-11-19: non-cash collections need the slip/transfer photo (uploaded + registered before the command);
// the patient invoice prints ONE number per visit with every receipt number (approved mockup).
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{
 const d=new JSDOM('<body></body>',{runScripts:'outside-only'}),w=d.window;
 const calls=[];w.crypto.randomUUID=()=>'u-1';
 w.SSMPDAuth={currentAdmin:{id:'me-1'}};
 w.SSMPDDb={client:{storage:{from:b=>({upload:async(path,file,o)=>{calls.push(['upload',b,path,o.contentType]);return {data:{path}};}})},rpc:async(fn,args)=>{calls.push(['rpc',fn,args]);return {data:{id:'p1'}};}}};
 w.eval(fs.readFileSync('assets/js/payment-proof.js','utf8'));
 const P=w.SSMPDPaymentProof;
 const f=w.document.createElement('form');f.innerHTML='<select name="method"><option value="cash">نقدي</option><option value="pos">فيزا</option><option value="instapay">إنستا باي</option></select><input name="reference">'+P.field();w.document.body.appendChild(f);
 P.bind(f);const box=f.querySelector('[data-pay-proof]'),inp=f.elements.proof_file;
 assert.equal(box.hidden,true,'hidden for cash');assert.equal(inp.required,false);
 f.elements.method.value='pos';f.elements.method.dispatchEvent(new w.Event('change'));assert.equal(box.hidden,false,'shown for card');assert.equal(inp.required,true,'mandatory for card');
 f.elements.method.value='instapay';f.elements.method.dispatchEvent(new w.Event('change'));assert.equal(inp.required,true,'mandatory for instapay');
 // cash passes straight through
 let v=await P.attach('ws-1',{method:'cash',reference:'RC-1',amount:'100'});assert.equal(v.reference,'RC-1');assert.equal(calls.length,0);
 // non-cash without the photo → refused before anything is sent
 await assert.rejects(()=>P.attach('ws-1',{method:'pos',reference:'778899'}),/ارفع صورة/);
 const file=new w.File(['x'],'slip.JPG',{type:'image/jpeg'});
 await assert.rejects(()=>P.attach('ws-1',{method:'pos',reference:'7',proof_file:file}),/رقم العملية/);
 v=await P.attach('ws-1',{method:'pos',reference:' 778899 ',amount:'300',proof_file:file});
 assert.equal(v.proof_file,undefined,'file removed from the command payload');assert.equal(v.reference,'778899');
 assert.deepEqual(calls[0],['upload','payment-proofs','ws-1/me-1/u-1.jpg','image/jpeg']);
 assert.equal(JSON.stringify(calls[1]),JSON.stringify(['rpc','clinic_reception_payment_proof',{p_workspace:'ws-1',p_reference:'778899',p_path:'ws-1/me-1/u-1.jpg'}]));
 // invoice renderer
 w.eval(fs.readFileSync('assets/js/patient-invoice-print.js','utf8'));
 const data={invoice_no:'INV-2026-000001',service_date:'2026-11-19',patient:{name:'مريضة تجريبية',file_no:'F-1',phone:'01012345612'},
  lines:[{no:1,service:'كشف أطفال — استشاري',doctor:'د. إلهام قدري',department:'الأطفال',price:600,discount:0,net:600,insurer:0},{no:2,service:'أشعة صدر',doctor:'د. أشعة',department:'الأشعة',price:1000,discount:100,net:900,insurer:0}],
  payments:[{receipt_no:'RC-2026-000001',method:'cash',reference:null,amount:1000},{receipt_no:'RC-2026-000002',method:'pos',reference:'778899',amount:500,proof:true}],
  totals:{net:1500,insurer:0,paid:1500,due:0},printed_by:'دينا',printed_at:'2026-11-19T19:42:00Z'};
 const html=w.SSMPDPatientInvoicePrint.documentHtml(data);
 for(const s of ['INV-2026-000001','RC-2026-000001','RC-2026-000002','778899','مسدّدة بالكامل','توقيع المريض','ختم المركز','1,600.00','100.00','1,500.00','010••••••12','أكثر من طبيب'])assert(html.includes(s),'invoice shows '+s);
 assert(!html.includes('01012345612'),'phone masked');assert.equal((html.match(/class="pg"/g)||[]).length,1);
 const many=Object.assign({},data,{lines:Array.from({length:25},(_, i)=>Object.assign({},data.lines[0],{no:i+1}))});
 const h2=w.SSMPDPatientInvoicePrint.documentHtml(many);assert.equal((h2.match(/class="pg"/g)||[]).length,3,'paginates 12 lines per page');assert.equal((h2.match(/توقيع المريض/g)||[]).length,1,'signatures on the last page only');
 assert.throws(()=>w.SSMPDPatientInvoicePrint.documentHtml({invoice_no:'X',lines:[]}));
 console.log('PASS payment proof (mandatory photo for non-cash, uploaded + registered) and patient invoice print (one number, receipts, pagination).');
})().catch(e=>{console.error(e);process.exitCode=1;});
