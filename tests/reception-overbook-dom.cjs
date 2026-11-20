// «تسجيل موعد يدوي» screen (owner 2026-11-20): modal, conflict warning, reason rules, payload, card tag, wiring.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{const dom=new JSDOM('<!doctype html><body></body>',{runScripts:'outside-only'});const w=dom.window,d=w.document,sent=[];
 w.eval(fs.readFileSync('assets/js/reception-overbook.js','utf8'));const O=w.SSMPDReceptionOverbook;
 const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let saveFn=null;
 const ctx={esc,data:{patients:[{id:'p1',name:'<b>مريض</b>',file_no:'P-1'}],providers:[{id:'d1',name:'د. أسنان',department:'الأسنان'}],services:[{id:'s1',name:'كشف أسنان'}],
   appointments:[{id:'a1',provider_id:'d1',patient_id:'p9',service_id:'s1',service_name:'كشف أسنان',status:'booked',starts_at:'2030-01-01T15:00:00Z',ends_at:'2030-01-01T15:20:00Z'}]},
  lookup:(k,id)=>id==='p9'?'مريض تجريبي':id,cairoISO:s=>s.replace(/^(.*)T(\d\d:\d\d)$/,(m,a,b)=>new Date(a+'T'+b+':00+02:00').toISOString()),
  field:(n,t,type,v,extra)=>'<label>'+esc(t)+'<input name="'+n+'" type="'+(type||'text')+'" value="'+esc(v||'')+'" '+(extra||'required')+'></label>',
  select:(n,t,rows)=>'<label>'+esc(t)+'<select name="'+n+'" required><option value="">اختر</option>'+rows.map(r=>'<option value="'+esc(r[0])+'">'+esc(r[1])+'</option>').join('')+'</select></label>',
  modal:(title,body,save)=>{const r=d.createElement('div');r.className='rx-modal';r.innerHTML='<h3>'+esc(title)+'</h3><form>'+body+'</form>';d.body.appendChild(r);saveFn=save;return r;},
  command:async(a,p,k)=>{sent.push([a,p,k]);return {id:'n1'};}};
 const r=O.open(ctx);const f=r.querySelector('form');
 assert.match(r.textContent,/تسجيل موعد يدوي/);assert.ok(!r.querySelector('select b'),'escaped');
 assert.equal(f.querySelectorAll('[name="reason_kind"]').length,5);
 // conflict warning
 f.elements.provider_id.value='d1';f.elements.day.value='2030-01-01';f.elements.time.value='17:05';f.elements.time.dispatchEvent(new w.Event('change'));
 const warn=r.querySelector('[data-rob-warn]');assert.equal(warn.hidden,false);assert.match(warn.textContent,/عنده حجز في نفس الوقت/);assert.match(warn.textContent,/مريض تجريبي/);
 f.elements.time.value='19:00';f.elements.time.dispatchEvent(new w.Event('change'));assert.match(warn.textContent,/فاضي/);
 // «سبب تاني» makes the text required, and save refuses without it
 const other=[...f.querySelectorAll('[name="reason_kind"]')].find(x=>x.value==='سبب تاني');other.checked=true;other.dispatchEvent(new w.Event('change'));
 assert.equal(f.querySelector('[data-rob-reason]').required,true);
 assert.throws(()=>saveFn({reason_kind:'سبب تاني',reason:'',day:'2030-01-01',time:'17:05'}),/اكتب السبب/);
 // payload
 await saveFn({patient_id:'p1',provider_id:'d1',service_id:'s1',day:'2030-01-01',time:'17:05',reason_kind:'طلب الدكتور',reason:' '},'k1');
 assert.deepEqual(JSON.parse(JSON.stringify(sent[0])),['overbook',{patient_id:'p1',provider_id:'d1',service_id:'s1',starts_at:'2030-01-01T15:05:00.000Z',reason_kind:'طلب الدكتور',reason:''},'k1']);
 // card tag
 assert.match(O.tag({overbook:true,overbook_reason:'طلب "الدكتور"'}),/إضافي ✍/);assert.ok(!O.tag({overbook:true,overbook_reason:'"'}).includes('title=""'));assert.equal(O.tag({overbook:false}),'');
 // wiring
 const src=fs.readFileSync('assets/js/reception-workspace.js','utf8');assert.match(src,/btn\('overbook','','✍ تسجيل موعد يدوي'\)/);assert.match(src,/SSMPDReceptionOverbook\.open\(context\(\)\)/);assert.match(src,/SSMPDReceptionOverbook\.tag\(a\)/);
 const html=fs.readFileSync('index.html','utf8');assert.ok(html.indexOf('reception-overbook.js')<html.indexOf('reception-workspace.js?v='));assert.ok(html.includes('reception-overbook.css?v='));
 console.log('PASS reception overbook screen.');
})().catch(e=>{console.error(e);process.exit(1);});
