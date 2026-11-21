// Owner 2026-11-21 item 3 «صاحب الرقم»: a phone already on another file needs the relationship (archive «مريض جديد» via
// patients-create, automatic-bookings «ملف جديد»); tag next to the phone; chips in the forms.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite'),{JSDOM}=require('jsdom');
(async()=>{const db=new PGlite(),q=(s,p)=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0];
 const ab=fs.readFileSync('supabase/migrations/20261120130000_reception_auto_book.sql','utf8');
 // the two lines the migration patches, exactly as shipped in the real function
 const ins=ab.match(/      insert into public\.patients\(full_name, phone, phone_normalized, age, created_by\)\n        values \(regexp_replace\(trim\(coalesce\(nullif\(trim\(p_payload->>'full_name'\)[\s\S]*?returning id into pid;/)[0];
 try{await db.exec(`create role authenticated;create role anon;create schema psychcare;create schema clinic_reception;
  create table cur(id uuid);insert into cur values('00000000-0000-0000-0000-0000000000a1');
  create function public.my_admin_id() returns uuid language sql as $$select id from cur$$;
  create function public.has_archive_access() returns boolean language sql as $$select true$$;
  create function public.can_access_leads() returns boolean language sql as $$select false$$;
  create table public.admins(id uuid,has_archive_reception_access boolean);
  create function psychcare.phone(v text) returns text language sql immutable as $$select regexp_replace(coalesce(v,''),'[^0-9]','','g')$$;
  create table public.patients(id uuid primary key default gen_random_uuid(),patient_code text,full_name text,phone text,phone_normalized text,age int,created_by uuid,status text default 'active',created_at timestamptz default now());
  create table clinic_reception.external_bookings(id uuid primary key,phone text,customer_name text,patient_created boolean);
  create function public.clinic_reception_auto_book(p_workspace uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql as $f$
  declare b clinic_reception.external_bookings%rowtype; me uuid := public.my_admin_id(); ph text; pid uuid;
  begin select * into b from clinic_reception.external_bookings where id=(p_payload->>'id')::uuid;
      ph := psychcare.phone(coalesce(nullif(p_payload->>'phone', ''), b.phone));
${ins}
    return jsonb_build_object('pid',pid); end $f$;
  insert into public.patients(patient_code,full_name,phone,status) values('P-1','منى تجريبية','01000000000','active'),('P-9','قديم تجريبي','01099999999','archived');
  insert into clinic_reception.external_bookings values('00000000-0000-0000-0000-0000000000e1','01000000000','يوسف تجريبي',false),('00000000-0000-0000-0000-0000000000e2','01011111111','سارة تجريبية',false);`);
  const M=fs.readFileSync('supabase/migrations/20261121110000_patient_phone_owner.sql','utf8');
  await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  const run=p=>one("select public.clinic_reception_auto_book(null,'resolve_patient',$1) r",[p]);
  await assert.rejects(()=>run({id:'00000000-0000-0000-0000-0000000000e1',age:'7'}),/اختار صاحب الرقم/,'shared phone needs the relationship');
  let r=(await run({id:'00000000-0000-0000-0000-0000000000e1',age:'7',phone_owner:'mother'})).r;
  let p=await one('select full_name,phone_owner from public.patients where id=$1',[r.pid]);assert.equal(p.phone_owner,'mother');assert.equal(p.full_name,'يوسف تجريبي');
  await assert.rejects(()=>run({id:'00000000-0000-0000-0000-0000000000e1',age:'7',phone_owner:'cousin'}),/صاحب الرقم غير معروف/);
  r=(await run({id:'00000000-0000-0000-0000-0000000000e2',age:'30'})).r;assert.ok(r.pid,'phone not shared: no relationship needed');
  r=(await run({id:'00000000-0000-0000-0000-0000000000e1',age:'40',phone_owner:'other',phone_owner_note:'الجدة'})).r;
  assert.equal((await one('select phone_owner_note from public.patients where id=$1',[r.pid])).phone_owner_note,'الجدة');
  await q("insert into public.patients(full_name,phone,status) values('اختبار أرشيف','01099999999','active')");   // archived file on that phone doesn't count
  const peers=(await one("select public.patient_phone_peers('01000000000') x")).x;
  assert.deepEqual(peers.map(x=>x.phone_owner),[null,'mother','other']);
  assert.equal((await one("select has_function_privilege('anon','public.patient_phone_peers(text,uuid)','execute') x")).x,false);
  assert.equal((await one("select has_function_privilege('authenticated','clinic_reception.require_phone_owner(text,text,uuid)','execute') x")).x,false);
  await db.exec(fs.readFileSync('supabase/rollbacks/20261121110000_patient_phone_owner.rollback.sql','utf8'));
  assert.ok(!(await one("select prosrc from pg_proc where proname='clinic_reception_auto_book'")).prosrc.includes('phone_owner'),'rollback restores');
  // edge function + UI wiring
  const ed=fs.readFileSync('supabase/functions/patients-create/index.ts','utf8');
  assert(/phone_owner_required/.test(ed)&&/\.eq\("phone_normalized", phoneNormalized\)\.eq\("status", "active"\)/.test(ed)&&/phone_owner: phoneOwner/.test(ed),'patients-create requires + stores');
  assert.equal((fs.readFileSync('supabase/functions/patient-files-list/index.ts','utf8').match(/phone_owner, phone_owner_note/g)||[]).length,2,'list returns it');
  const rp=fs.readFileSync('assets/js/render-patients.js','utf8');
  const helpers=rp.slice(rp.indexOf('  var PHONE_OWNERS ='),rp.indexOf('  function openEditPatientModal('));
  const dom=new JSDOM('<body></body>',{runScripts:'outside-only'}),w=dom.window;
  w.eval('function escapeHtml(s){return String(s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}'+helpers+';window.H={phoneOwnerTag:phoneOwnerTag,phoneOwnerField:phoneOwnerField,wirePhoneOwner:wirePhoneOwner,readPhoneOwner:readPhoneOwner,markPhoneOwnerRequired:markPhoneOwnerRequired};');
  const H=w.H;assert.match(H.phoneOwnerTag({phone_owner:'mother'}),/رقم الأم/);assert.equal(H.phoneOwnerTag({phone_owner:'self'}),'');
  assert.match(H.phoneOwnerTag({phone_owner:'other',phone_owner_note:'الأخ'}),/رقم الأخ/);
  w.document.body.innerHTML=H.phoneOwnerField('np','','');H.wirePhoneOwner(w.document.body);
  H.markPhoneOwnerRequired(w.document.body,true);assert.equal(w.document.querySelector('[data-po-hint]').hidden,false,'hint when shared');
  w.document.querySelector('[data-po="other"]').click();assert.equal(w.document.querySelector('[data-po-note]').hidden,false);
  w.document.querySelector('[data-po-note]').value='الجدة';assert.deepEqual({...H.readPhoneOwner(w.document.body)},{phone_owner:'other',phone_owner_note:'الجدة'});
  w.document.querySelector('[data-po="other"]').click();assert.deepEqual({...H.readPhoneOwner(w.document.body)},{phone_owner:null,phone_owner_note:null},'click again clears');
  assert(/poBox\.dataset\.required&&!po\.phone_owner/.test(rp)&&/phone_owner: po\.phone_owner/.test(rp)&&/patch\.phone_owner = epo\.phone_owner/.test(rp),'np/ep wiring');
  assert(/markPhoneOwnerRequired\(backdrop,rows\.length>0\)/.test(rp),'lookup marks it required');
  const abjs=fs.readFileSync('assets/js/reception-auto-book.js','utf8');
  assert(/data-ab-po/.test(abjs)&&/p\.phone_owner=po\.getAttribute\('data-po'\)/.test(abjs),'auto-book chips');
  console.log('PASS patient phone owner');
 }catch(e){console.error(e);process.exitCode=1;}finally{await db.close();}})();
