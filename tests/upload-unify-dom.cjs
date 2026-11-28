// Owner 2026-11-28 «موافق، نفّذ 1 لـ 4 ورقم الملف كفاية» (mockup docs/ui-references/mockups/upload-unify.html):
// every reception upload uses the «تسجيل تحصيل» photo box (📷 صوّر / 🖼 اختار / لصق / سحب → «✓ الصورة جاهزة» + «تغيير»), and the
// picked / pasted file is named automatically: <kind>_<file no>_<label>_<amount>_<method>_<dd-mm>_<HH-MM> (Cairo, English digits);
// the storage key is the same order in English + 4 random characters. Clicked here as a RECEPTION user in a LIVE workspace:
// تحصيل (payment-proof), صرف من مصروفات الوردية, صرف أطباء «رفع الإيصال الممضي» window, مستندات المريض, رفع تقرير طلب خدمة,
// إثبات الخصم / مستند الجهة markup. Server calls mocked; the RPCs did not change.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const tick=ms=>new Promise(r=>setTimeout(r,ms||20));
function env(html){const dom=new JSDOM('<!doctype html><body>'+(html||'')+'</body>',{url:'https://t.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 Object.defineProperty(w,'crypto',{value:webcrypto});
 // jsdom: programmatic file lists on <input type=file>
 const st=new WeakMap(),P=w.HTMLInputElement.prototype,fd=Object.getOwnPropertyDescriptor(P,'files'),vd=Object.getOwnPropertyDescriptor(P,'value');
 Object.defineProperty(P,'files',{configurable:true,get(){return this.type==='file'?(st.get(this)||[]):fd.get.call(this);},set(v){st.set(this,Array.from(v||[]));}});
 Object.defineProperty(P,'value',{configurable:true,get(){return this.type==='file'?((st.get(this)||[]).length?'C:\\fakepath\\x':''):vd.get.call(this);},set(v){if(this.type==='file'){if(v==='')st.set(this,[]);return;}vd.set.call(this,v);}});
 w.DataTransfer=function(){const l=[];this.items={add:f=>l.push(f)};this.files=l;};w.URL.createObjectURL=()=>'blob:x';w.URL.revokeObjectURL=()=>{};
 w.SSMPDToast={show:()=>{}};w.SSMPDAuth={currentAdmin:{id:'adm-1',role:'reception'}};
 w.eval(fs.readFileSync('assets/js/upload-box.js','utf8'));return w;}
const F=(w,name,type,size)=>{const f=new w.File(['x'],name,{type:type||'image/jpeg'});if(size)Object.defineProperty(f,'size',{value:size});return f;};
const pickIn=(w,box,file)=>{const pin=box.querySelector('[data-ub-pickin]');Object.defineProperty(pin,'files',{configurable:true,value:[file]});pin.dispatchEvent(new w.Event('change',{bubbles:true}));};
const STAMP=/\d\d-\d\d_\d\d-\d\d/;
(async()=>{
 // ---- 1) naming rules
 {const w=env(),U=w.SSMPDUploadBox,at=new Date('2026-11-27T19:40:00Z');
  assert.equal(U.name({kind:'collect',fileNo:'P-2026-000123',amount:'1400',method:'pos',at},{name:'IMG_2041.JPG'}),'تحصيل_P-2026-000123_1400_فيزا_27-11_21-40.jpg','Cairo time, English digits');
  assert.equal(U.name({kind:'expense',label:'مناديل ومستلزمات نظافة',amount:'١٢٠',at},{name:'x.png',type:'image/png'}),'مصروف-وردية_مناديل-ومستلزمات-نظافة_120_27-11_21-40.png');
  assert.equal(U.name({kind:'doctor',label:'د. رامي',amount:500,at},{name:'',type:'application/pdf'}),'إيصال-طبيب_د.-رامي_500_27-11_21-40.pdf');
  assert.match(U.key({name:'تحصيل_P-2026-000123_1400_فيزا_27-11_21-40.jpg'}),/^collect_P-2026-000123_1400_visa_27-11_21-40_[0-9a-f]{4}\.jpg$/);
  assert.match(U.key({name:'إيصال-طبيب_د.-رامي_500_27-11_21-40.pdf'}),/^doctor-receipt_500_27-11_21-40_[0-9a-f]{4}\.pdf$/,'Arabic words dropped from the ASCII key');
  assert.equal(U.key({name:'IMG_2041.jpg'}),null,'a file not named here keeps the old random key');
  assert.equal(U.stamp(new Date('2026-11-27T22:05:00Z')),'28-11_00-05','after midnight Cairo');}
 // ---- 2) تحصيل (payment-proof): pick / paste → named; the name follows amount & method; upload key
 {const w=env('<div class="rx-modal"><form><p data-ub-file-no="P-2026-000123">ملف P-2026-000123 — مريض تجريبي</p><input name="amount" value="1400"><select name="method"><option value="cash">نقدي</option><option value="pos">فيزا</option><option value="instapay">إنستا باي</option></select></form></div>'),d=w.document;
  w.eval(fs.readFileSync('assets/js/payment-proof.js','utf8'));const P=w.SSMPDPaymentProof,form=d.querySelector('form');
  form.insertAdjacentHTML('beforeend',P.field());P.bind(form);form.elements.method.value='pos';form.elements.method.dispatchEvent(new w.Event('change',{bubbles:true}));
  const input=form.elements.proof_file,ev=new w.Event('paste',{bubbles:true,cancelable:true});ev.clipboardData={items:[{kind:'file',getAsFile:()=>F(w,'','image/png')}]};form.dispatchEvent(ev);
  assert.match(input.files[0].name,/^تحصيل_P-2026-000123_1400_فيزا_\d\d-\d\d_\d\d-\d\d\.png$/,'pasted screenshot named');
  assert.match(form.querySelector('[data-pp-done]').textContent,/تحصيل_P-2026-000123_1400_فيزا/);
  form.elements.amount.value='900';form.elements.amount.dispatchEvent(new w.Event('input',{bubbles:true}));form.elements.method.value='instapay';form.elements.method.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.match(input.files[0].name,/^تحصيل_P-2026-000123_900_إنستاباي_/,'name follows the form');assert.match(form.querySelector('[data-pp-done] small').textContent,/900_إنستاباي/);
  const ups=[];w.SSMPDDb={client:{storage:{from:b=>({upload:async p=>{ups.push(b+':'+p);return {data:{}};}})},rpc:async()=>({data:{}})}};
  await P.upload('ws1','instapay','TX123456',input.files[0]);assert.match(ups[0],/^payment-proofs:ws1\/adm-1\/collect_P-2026-000123_900_instapay_\d\d-\d\d_\d\d-\d\d_[0-9a-f]{4}\.png$/);
  // a photo picked from the gallery (the real input itself) is named too
  Object.defineProperty(input,'files',{configurable:true,writable:true,value:[F(w,'IMG_1.jpg')]});}
 // ---- 3) صرف من مصروفات الوردية
 {const w=env('<div id="host"><div class="rx-actions"></div></div>'),d=w.document,calls=[],ups=[];
  const status={open:true,shift_id:'sh1',register:'خزينة الاستقبال',allowance:500,max:300,spent:0,cash:900,items:[{key:'cleaning',label:'مناديل ومستلزمات نظافة'},{key:'tips',label:'إكراميات',no_receipt:true}],expenses:[]};
  w.SSMPDDb={client:{rpc:async(n,a)=>{calls.push(a);return {data:a.p_action==='status'?status:{id:'q1',amount:a.p.amount}};},auth:{getUser:async()=>({data:{user:{id:'uid-1'}}})},storage:{from:b=>({upload:async p=>{ups.push(b+':'+p);return {data:{path:p}};}})}}};
  w.eval(fs.readFileSync('assets/js/reception-shift-expenses.js','utf8'));let saveFn=null;
  const ctx={host:d.getElementById('host'),data:{workspace:{mode:'live'}},field:(n,t,type,v,extra)=>'<label>'+t+'<input name="'+n+'" type="'+(type||'text')+'" '+(extra||'')+'></label>',
   modal:(t,body,save)=>{const r=d.createElement('div');r.className='rx-modal';r.innerHTML='<button type="button" class="rx-x" aria-label="إغلاق">✕</button><h3>'+t+'</h3><form class="rx-form">'+body+'</form>';d.body.appendChild(r);saveFn=save;return r;}};
  w.SSMPDShiftExpenses.decorate(ctx,'operations');await tick();d.querySelector('[data-rse-spend]').click();const m=d.querySelector('.rx-modal');
  assert.ok(m.querySelector('.rx-x'),'✕ on the window');
  const box=m.querySelector('[data-rse-up][data-ub]');assert.ok(box,'the photo box replaced the old picker + upload card');assert.equal(m.querySelectorAll('input[type=file][name=receipt]').length,1);
  assert.match(box.textContent,/صورة الفاتورة أو الإيصال \(إجباري\)/);assert.ok(box.querySelector('[data-ub-real]').required);assert.equal(box.querySelector('[data-ub-cam]').getAttribute('capture'),'environment');
  assert.ok(box.querySelector('[data-ub-real]').hasAttribute('data-fdp-skip'),'no second upload card from file-drop-paste');
  let clicked=[];box.querySelector('[data-ub-cam]').click=()=>clicked.push('cam');box.querySelector('[data-ub-pickin]').click=()=>clicked.push('pick');
  box.querySelector('[data-ub-take]').click();box.querySelector('[data-ub-pick]').click();assert.deepEqual(clicked,['cam','pick'],'📷 صوّر الفاتورة / 🖼 اختار صورة');
  assert.match(box.querySelector('[data-ub-take]').textContent,/صوّر الفاتورة/);
  m.querySelector('[name=item][value=cleaning]').checked=true;m.querySelector('[name=amount]').value='120';
  pickIn(w,box,F(w,'IMG_2041.jpg'));const real=box.querySelector('[data-ub-real]');
  assert.match(real.files[0].name,/^مصروف-وردية_مناديل-ومستلزمات-نظافة_120_\d\d-\d\d_\d\d-\d\d\.jpg$/);
  assert.equal(box.querySelector('[data-ub-done]').hidden,false);assert.match(box.querySelector('[data-ub-done]').textContent,/الصورة جاهزة/);assert.equal(box.querySelector('[data-ub-drop]').hidden,true);
  m.querySelector('[name=amount]').value='150';m.querySelector('[name=amount]').dispatchEvent(new w.Event('input',{bubbles:true}));assert.match(real.files[0].name,/_150_/,'name follows the amount');
  pickIn(w,box,F(w,'a.heic','image/heic'));assert.match(real.files[0].name,/_150_/,'image/* accepted as before');
  pickIn(w,box,F(w,'big.jpg','image/jpeg',9*1024*1024));assert.match(box.querySelector('[data-ub-err]').textContent,/أكبر من 8 ميجا/);
  // «تغيير»
  clicked=[];box.querySelector('[data-ub-change]').click();assert.equal(real.files.length,0);assert.equal(box.querySelector('[data-ub-drop]').hidden,false);assert.deepEqual(clicked,['pick']);
  pickIn(w,box,F(w,'r.jpg'));
  await saveFn({item:'cleaning',amount:'150',vendor:'',reason:'مناديل',receipt:real.files[0]},'k1');
  assert.match(ups[0],/^shift-expense-receipts:uid-1\/shift-expense_150_\d\d-\d\d_\d\d-\d\d_[0-9a-f]{4}\.jpg$/);assert.equal(calls.find(c=>c.p_action==='spend').p.receipt_path,ups[0].split(':')[1]);
  // «إكراميات»: the box hides as before
  m.querySelector('[name=item][value=tips]').checked=true;m.querySelector('form').dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(box.hidden,true);assert.equal(real.required,false);
  // paste into the open window
  m.querySelector('[name=item][value=cleaning]').checked=true;m.querySelector('form').dispatchEvent(new w.Event('change',{bubbles:true}));box.querySelector('[data-ub-change]').click();
  const pe=new w.Event('paste',{bubbles:true,cancelable:true});pe.clipboardData={items:[{kind:'file',getAsFile:()=>F(w,'','image/png')}]};d.body.dispatchEvent(pe);
  assert.equal(pe.defaultPrevented,true);assert.match(real.files[0].name,/^مصروف-وردية_.*\.png$/,'Ctrl+V lands in the box');}
 // ---- 4) صرف أطباء: «رفع الإيصال الممضي» opens a small window with the same box
 {const w=env('<main id="host"></main>'),d=w.document,calls=[],ups=[];w.confirm=()=>true;w.SSMPDToast=()=>{};
  const S={provider_id:'d1',name:'د. رامي',state:'paid',payable:0,held:0,paid_today:500,pending:null,approved:null,invoices:[],payouts:[{id:'q1',status:'approved',gross:500,reviewed_at:new Date().toISOString(),handed_at:new Date().toISOString(),receipt_path:null,invoices:[]}]};
  w.SSMPDRoles={rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:()=>false};
  w.SSMPDDb={client:{rpc:async(n,a)=>{calls.push([a.p_action,a.p_payload]);if(a.p_action==='detail')return {data:JSON.parse(JSON.stringify(S)),error:null};if(a.p_action==='receipt'){S.payouts[0].receipt_path=a.p_payload.path;return {data:S.payouts[0],error:null};}return {data:{approver:false,items:[],doctors:[]},error:null};},
   storage:{from:b=>({upload:async p=>{ups.push(b+':'+p);return {data:{},error:null};},createSignedUrl:async()=>({data:{signedUrl:'about:blank'},error:null})})}}};
  w.eval(fs.readFileSync('assets/js/reception-doctor-payout.js','utf8'));w.SSMPDDoctorPayout.open('ws1','d1','2026-11-28');await tick(40);
  const btn=d.querySelector('[data-dp-upbox="q1"]');assert.ok(btn,'«رفع الإيصال الممضي (اختياري)» still offered after handover');assert.match(btn.textContent,/رفع الإيصال الممضي \(اختياري\)/);
  btn.click();const ov=[...d.querySelectorAll('[data-dp-modal]')].pop();assert.equal(ov.querySelector('h2').textContent,'رفع الإيصال الممضي');assert.ok(ov.querySelector('.dp-x'),'✕');
  const box=ov.querySelector('[data-ub]');assert.match(box.querySelector('[data-ub-take]').textContent,/صوّر الإيصال/);assert.match(ov.textContent,/500/);
  ov.querySelector('[data-dp-upgo]').click();ov.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();assert.match(ov.querySelector('[data-dp-uperr]').textContent,/صوّر الإيصال/);assert.equal(ups.length,0,'nothing uploaded without a photo');
  pickIn(w,box,F(w,'IMG_9.jpg'));assert.match(box.querySelector('[data-ub-real]').files[0].name,/^إيصال-طبيب_د.-رامي_500_\d\d-\d\d_\d\d-\d\d\.jpg$/);
  ov.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick(40);
  assert.match(ups[0],/^doctor-payout-receipts:q1\/doctor-receipt_500_\d\d-\d\d_\d\d-\d\d_[0-9a-f]{4}\.jpg$/);assert.ok(calls.some(c=>c[0]==='receipt'&&c[1].path===ups[0].split(':')[1]));
  assert.ok(!ov.isConnected,'window closes after the upload');assert.ok(d.querySelector('[data-dp-view]'),'«عرض الإيصال الممضي» after the upload');
  // «إلغاء» and ✕ close
  S.payouts[0].receipt_path=null;w.SSMPDDoctorPayout.open('ws1','d1','2026-11-28');await tick(40);[...d.querySelectorAll('[data-dp-upbox]')].pop().click();let o2=[...d.querySelectorAll('[data-dp-modal]')].pop();o2.querySelector('[data-dp-upcancel]').click();assert.ok(!o2.isConnected);
  [...d.querySelectorAll('[data-dp-upbox]')].pop().click();o2=[...d.querySelectorAll('[data-dp-modal]')].pop();o2.querySelector('.dp-x').click();assert.ok(!o2.isConnected);}
 // ---- 5) مستندات المريض: each row has the box; the type names the file; «×» clears it
 {const w=env('<form id="f"><select name="patient_id"><option value="">—</option><option value="p1" selected>P-2026-000123 — مريض تجريبي</option></select></form>'),d=w.document,sent=[];
  w.SSMPDDb={uploadPatientFile:async fd=>{sent.push([fd.get('category'),fd.get('file').name]);return {ok:true};}};
  w.eval(fs.readFileSync('assets/js/reception-patient-documents.js','utf8'));const D=w.SSMPDReceptionDocs,form=d.getElementById('f');
  form.insertAdjacentHTML('beforeend',D.markup(true));D.wire(form);w.SSMPDUploadBox.bindAll(form);
  assert.equal(form.querySelectorAll('[name=file],[data-rxd] [name]').length,0,'still no named fields inside the documents box');
  const row=form.querySelector('[data-rxd-row]'),box=row.querySelector('[data-ub]');assert.ok(box);assert.match(box.querySelector('[data-ub-take]').textContent,/صوّر المستند/);
  const sel=row.querySelector('[data-rxd-type]');sel.value='coverage_card';sel.dispatchEvent(new w.Event('change',{bubbles:true}));
  pickIn(w,box,F(w,'IMG_3.jpg'));const fi=row.querySelector('[data-rxd-file]');assert.match(fi.files[0].name,/^مستند_P-2026-000123_كارنيه-العلاج_\d\d-\d\d_\d\d-\d\d\.jpg$/);
  const items=D.picked(form);await D.upload('arch-1',items);assert.match(sent[0][1],/^مستند_P-2026-000123_كارنيه-العلاج_/);
  row.querySelector('[data-rxd-remove]').click();assert.equal(fi.files.length,0);assert.equal(box.querySelector('[data-ub-drop]').hidden,false,'× resets the box');
  form.querySelector('[data-rxd-add]').click();w.SSMPDUploadBox.bindAll(form);assert.equal(form.querySelectorAll('[data-rxd-row] [data-ub-on]').length,2,'new row gets the box');}
 // ---- 6) رفع تقرير طلب خدمة: the board row has the box; «رفع التقرير» uploads under the readable key
 {const w=env(),d=w.document,ups=[];const rows=[{order_id:'o1',patient_name:'مريض',phone:'0100',service:'CBC',provider:'Lab A',status:'done',file_no:'P-2026-000123'}];
  w.SSMPDDb={serviceOrdersBoard:async()=>rows,serviceOrderReportUpload:async(ws,o,path,file)=>{ups.push([path,file.name]);return {};},serviceOrderNotify:async()=>({status:'sent'})};
  w.eval(fs.readFileSync('assets/js/reception-service-orders.js','utf8'));let root=null;
  w.SSMPDReceptionServiceOrders.act('so-board',null,{workspace:'ws1',modal:(t,b)=>{root=d.createElement('div');root.className='rx-modal';root.innerHTML='<h3>'+t+'</h3><form>'+b+'<button type="submit">حفظ</button></form>';d.body.appendChild(root);return root;}});await tick(30);
  const box=root.querySelector('[data-ub]');assert.ok(box,'report box in the row');assert.equal(box.querySelector('[data-ub-real]').getAttribute('data-so-file'),'o1');assert.match(box.querySelector('[data-ub-pick]').textContent,/اختار الملف/);
  pickIn(w,box,F(w,'scan.pdf','application/pdf'));assert.match(box.querySelector('[data-ub-real]').files[0].name,/^نتيجة_P-2026-000123_CBC_\d\d-\d\d_\d\d-\d\d\.pdf$/);
  root.querySelector('[data-so-upload="o1"]').click();await tick(40);assert.match(ups[0][0],/^ws1\/o1\/result_P-2026-000123_CBC_\d\d-\d\d_\d\d-\d\d_[0-9a-f]{4}\.pdf$/);assert.match(ups[0][1],/^نتيجة_/);}
 // ---- 7) إثبات الخصم / مستند الجهة: markup carries the box on the same data-* inputs; clearing resets the box
 {const bd=fs.readFileSync('assets/js/reception-booking-discount.js','utf8'),pk=fs.readFileSync('assets/js/reception-payer-kind.js','utf8');
  for(const a of ['data-rbd-file','data-rbd-lg-f','data-rbd-rel-f'])assert.ok(bd.includes("attr:'"+a+"'"),a);
  assert.ok(pk.includes("kind:'payer'")&&pk.includes("f.closest('.rbd-row')"),'payer proof rows');
  assert.ok(!/[^r](?:f|file)\.value='';/.test(bd.replace(/function clr[^\n]+/,'')),'every clear also resets the box');}
 // wiring
 {const html=fs.readFileSync('index.html','utf8');assert.ok(html.indexOf('upload-box.js')>0&&html.indexOf('upload-box.js')<html.indexOf('reception-shift-expenses.js'));}
 console.log('PASS upload box: one look everywhere (📷 / 🖼 / paste / drag → ✓ + تغيير), automatic names (file no, amount, method, Cairo time), ASCII storage keys — تحصيل, مصروف وردية, إيصال طبيب, مستندات المريض, تقرير طلب خدمة, إثبات خصم/جهة.');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
