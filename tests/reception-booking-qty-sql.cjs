// Owner 2026-11-20: quantity per booked service, «جلسة استكمال» at no charge, «لم يرد» call attempts.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite'),{randomUUID}=require('crypto');
(async()=>{const db=new PGlite(),id=()=>randomUUID(),q=(s,p)=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0];
 const U=id(),A=id(),ws=id(),d1=id(),crown=id(),crown2=id(),fill=id(),p1=id(),p2=id();
 const M='supabase/migrations/'+fs.readdirSync('supabase/migrations').find(x=>x.includes('_reception_booking_qty_continuation_no_answer.sql'));
 const R='supabase/rollbacks/'+fs.readdirSync('supabase/rollbacks').find(x=>x.includes('_reception_booking_qty_continuation_no_answer.'));
 try{await db.exec(`create role authenticated;create role anon;create schema auth;create schema clinic_reception;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table admins(id uuid primary key,user_id uuid,name text);
  create function my_admin_id() returns uuid language sql stable security definer as $$select id from admins where user_id=auth.uid()$$;
  create table clinic_reception.providers(id uuid primary key,name text);
  create table clinic_reception.services(id uuid primary key,code text,name text,price numeric);
  create table clinic_reception.appointments(id uuid primary key default gen_random_uuid(),workspace_id uuid,patient_id uuid,provider_id uuid,service_id uuid,package_id uuid,starts_at timestamptz,status text default 'booked',confirmed_at timestamptz);
  create table clinic_reception.visits(id uuid primary key default gen_random_uuid(),appointment_id uuid unique,patient_id uuid);
  create table clinic_reception.orders(id uuid primary key default gen_random_uuid(),workspace_id uuid,visit_id uuid,service_id uuid,provider_id uuid,quantity numeric default 1,price numeric,discount numeric default 0,snapshot jsonb,status text default 'ordered',entitlement_id uuid,created_at timestamptz default now(),completed_at timestamptz);
  create table clinic_reception.invoices(id uuid primary key default gen_random_uuid(),order_id uuid unique,amount numeric,payer_amount numeric default 0);
  create table clinic_reception.allocations(id uuid primary key default gen_random_uuid(),invoice_id uuid,amount numeric);
  create table clinic_reception.audit(id serial,workspace_id uuid,actor_id uuid,action text,entity_id uuid,detail jsonb);
  create table clinic_reception.commands(workspace_id uuid,actor_id uuid,token uuid,action text,payload jsonb,response jsonb,primary key(workspace_id,actor_id,token));
  create function clinic_reception.access(w uuid,a text) returns uuid language plpgsql security definer as $$begin if my_admin_id() is null then raise exception 'سجل الدخول';end if;return my_admin_id();end $$;
  create function clinic_reception_command(p_workspace uuid,p_action text,p_payload jsonb,p_token uuid) returns jsonb language plpgsql security definer as $$
  declare v uuid;vis uuid;a record;s record;begin
   if p_payload ? 'quantity' or p_payload ? 'continuation_of' then raise exception 'inner got extra keys';end if;
   if p_action in ('book','walk_in') then
    insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,package_id,starts_at) values(p_workspace,(p_payload->>'patient_id')::uuid,(p_payload->>'provider_id')::uuid,(p_payload->>'service_id')::uuid,nullif(p_payload->>'package_id','')::uuid,coalesce(nullif(p_payload->>'starts_at','')::timestamptz,now())) returning id into v;
   elsif p_action='reschedule' then update clinic_reception.appointments set starts_at=(p_payload->>'starts_at')::timestamptz where id=(p_payload->>'id')::uuid returning id into v;
   elsif p_action='confirm' then update clinic_reception.appointments set confirmed_at=now() where id=(p_payload->>'id')::uuid returning id into v;
   elsif p_action='arrive' then select * into a from clinic_reception.appointments where id=(p_payload->>'id')::uuid;
    insert into clinic_reception.visits(appointment_id,patient_id) values(a.id,a.patient_id) returning id into vis;select * into s from clinic_reception.services where id=a.service_id;
    insert into clinic_reception.orders(workspace_id,visit_id,service_id,provider_id,price,snapshot) values(p_workspace,vis,s.id,a.provider_id,s.price,to_jsonb(s)) returning id into v;
    update clinic_reception.appointments set status='arrived' where id=a.id;
   end if;return jsonb_build_object('id',v);end $$;`);
  await q("insert into admins values($1,$2,'دينا')",[A,U]);await db.exec(`select set_config('request.jwt.claim.sub','${U}',false)`);
  await q("insert into clinic_reception.providers values($1,'د. أسنان')",[d1]);
  await q("insert into clinic_reception.services values($1,'CRW','طربوش زيركون',4000),($2,'CRW','طربوش زيركون',4200),($3,'FIL','حشو عصب',1500)",[crown,crown2,fill]);
  await db.exec(fs.readFileSync(M,'utf8'));await assert.rejects(()=>db.exec(fs.readFileSync(M,'utf8')),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  const cmd=(a,p)=>one("select clinic_reception_command($1,$2,$3,gen_random_uuid()) r",[ws,a,p]).then(x=>x.r);
  const order=async(app)=>one("select o.* from clinic_reception.orders o join clinic_reception.visits v on v.id=o.visit_id where v.appointment_id=$1",[app]);
  // 1. quantity → arrival order quantity
  let r=await cmd('book',{patient_id:p1,provider_id:d1,service_id:crown,starts_at:'2030-01-01T17:00:00+02',quantity:'3',continuation_of:''});
  assert.equal((await one("select quantity,continuation_of from clinic_reception.appointments where id=$1",[r.id])).quantity,3);
  await cmd('arrive',{id:r.id});let o=await order(r.id);assert.equal(+o.quantity,3);assert.equal(+o.price,4000);
  const paidCrown=o.id;
  const bill=async(oid,amount,paid)=>{const i=(await one("insert into clinic_reception.invoices(order_id,amount) values($1,$2) returning id",[oid,amount])).id;if(paid)await q("insert into clinic_reception.allocations(invoice_id,amount) values($1,$2)",[i,paid]);return i;};
  const cands=async(p,s)=>(await one("select clinic_reception_continuation_candidates($1,$2,$3) c",[ws,p,s])).c;
  // quantity multiplies the price: 3 × 4000
  assert.equal(+o.price*+o.quantity,12000);
  // not billed yet → not a candidate; partly paid → not a candidate; fully paid → candidate
  assert.equal((await cands(p1,crown)).length,0,'no invoice');
  const inv=await bill(paidCrown,12000,5000);assert.equal((await cands(p1,crown)).length,0,'partly paid');
  await q("insert into clinic_reception.allocations(invoice_id,amount) values($1,7000)",[inv]);
  // bad quantities
  for(const bad of ['0','100','2.5','x'])await assert.rejects(()=>cmd('book',{patient_id:p1,provider_id:d1,service_id:crown,quantity:bad}),/العدد لازم يكون رقم صحيح/);
  // no extra keys: untouched (quantity default 1)
  r=await cmd('book',{patient_id:p2,provider_id:d1,service_id:fill});const r2=r.id;await cmd('arrive',{id:r.id});o=await order(r.id);assert.equal(+o.quantity,1);assert.equal(+o.price,1500);
  // 2. continuation: candidates match by service code (new price version), not for other patients
  let c=(await one("select clinic_reception_continuation_candidates($1,$2,$3) c",[ws,p1,crown2])).c;assert.equal(c.length,1);assert.equal(c[0].id,paidCrown);assert.equal(+c[0].amount,12000);
  assert.equal((await cands(p2,crown)).length,0,'other patient');assert.equal((await cands(p1,fill)).length,0,'other service');
  // another patient's fully paid order cannot be used
  const p2fill=(await order(r2)).id;await bill(p2fill,1500,1500);assert.equal((await cands(p2,fill)).length,1);
  await assert.rejects(()=>cmd('book',{patient_id:p1,provider_id:d1,service_id:fill,continuation_of:p2fill}),/مالوش جلسة سابقة/);
  await assert.rejects(()=>cmd('book',{patient_id:p2,provider_id:d1,service_id:crown,continuation_of:paidCrown}),/مالوش جلسة سابقة/);
  await assert.rejects(()=>cmd('book',{patient_id:p1,provider_id:d1,service_id:fill,continuation_of:paidCrown}),/مالوش جلسة سابقة/);
  await assert.rejects(()=>cmd('book',{patient_id:p1,provider_id:d1,service_id:crown,package_id:id(),continuation_of:paidCrown}),/الباكج/);
  r=await cmd('book',{patient_id:p1,provider_id:d1,service_id:crown2,starts_at:'2030-01-08T17:00:00+02',quantity:'2',continuation_of:paidCrown});
  const ap=await one("select quantity,continuation_of from clinic_reception.appointments where id=$1",[r.id]);assert.equal(ap.quantity,1);assert.equal(ap.continuation_of,paidCrown);
  await cmd('arrive',{id:r.id});o=await order(r.id);assert.equal(+o.price,0);assert.equal(o.snapshot.continuation_of,paidCrown);
  // a continuation order (price 0) is not itself a candidate
  assert.equal((await one("select clinic_reception_continuation_candidates($1,$2,$3) c",[ws,p1,crown])).c.length,1);
  // old orders (> 180 days) and cancelled ones are not candidates
  await q("update clinic_reception.orders set created_at=now()-interval '200 days' where id=$1",[paidCrown]);
  assert.equal((await one("select clinic_reception_continuation_candidates($1,$2,$3) c",[ws,p1,crown])).c.length,0);
  // reschedule keeps quantity unless sent; sent quantity updates
  r=await cmd('book',{patient_id:p2,provider_id:d1,service_id:crown,quantity:'4'});
  await cmd('reschedule',{id:r.id,starts_at:'2030-02-01T10:00:00+02'});assert.equal((await one("select quantity from clinic_reception.appointments where id=$1",[r.id])).quantity,4);
  await cmd('reschedule',{id:r.id,starts_at:'2030-02-01T11:00:00+02',quantity:'2',continuation_of:''});assert.equal((await one("select quantity from clinic_reception.appointments where id=$1",[r.id])).quantity,2);
  // 3. no answer
  const tok=randomUUID();let n=(await one("select clinic_reception_command($1,'no_answer',$2,$3) r",[ws,{id:r.id},tok])).r;assert.equal(n.no_answer_count,1);
  n=(await one("select clinic_reception_command($1,'no_answer',$2,$3) r",[ws,{id:r.id},tok])).r;assert.equal(n.no_answer_count,1,'same token is not counted twice');
  n=await cmd('no_answer',{id:r.id});assert.equal(n.no_answer_count,2);
  const row=await one("select status,no_answer_count,last_no_answer_by from clinic_reception.appointments where id=$1",[r.id]);assert.equal(row.status,'booked');assert.equal(row.last_no_answer_by,A);
  assert.equal((await one("select count(*)::int n from clinic_reception.audit where action='no_answer' and entity_id=$1",[r.id])).n,2);
  await cmd('arrive',{id:r.id});await assert.rejects(()=>cmd('no_answer',{id:r.id}),/مش متاح/);
  // other actions pass through
  assert.ok(await cmd('confirm',{id:r.id}));
  // rollback restores the previous command
  await db.exec(fs.readFileSync(R,'utf8'));assert.equal((await cmd('no_answer',{id:r.id})).no_answer_count,undefined);
  assert.equal((await one("select to_regprocedure('public.clinic_reception_continuation_candidates(uuid,uuid,uuid)') f")).f,null);
  await db.exec(fs.readFileSync(M,'utf8'));
  console.log('PASS reception booking quantity / continuation / no-answer');
 }catch(e){console.error('FAIL',e);process.exit(1);}})();
