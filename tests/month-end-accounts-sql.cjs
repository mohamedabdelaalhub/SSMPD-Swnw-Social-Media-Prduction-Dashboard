// «حسابات آخر الشهر» (20261126110000): platform commission % of the executed booked service, external lab cost from the confirmed
// price-list link, dental-lab cases and مركز الطاهرة referrals entered by reception, monthly settlement with maker-checker posting
// Dr 5233/5234/5235 Cr main cash / bank, and the receivable Dr wallet Cr 4121. PGlite with small fixtures.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite'),{randomUUID}=require('crypto');
(async()=>{const db=new PGlite(),id=()=>randomUUID(),q=(s,p)=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0];
 const M='supabase/migrations/20261126110000_month_end_accounts.sql',R='supabase/rollbacks/20261126110000_month_end_accounts.rollback.sql';
 const P={rec:[id(),id(),'reception'],acc:[id(),id(),'accountant'],fm:[id(),id(),'financial_manager'],gm:[id(),id(),'general_manager'],sa:[id(),id(),'super_admin']};
 const W=id(),WT=id(),RM=id(),SM=id(),SV1=id(),SV2=id(),SL=id(),PS=id(),PV=id(),PI=id();
 try{await db.exec(`create role authenticated;create role anon;create schema auth;create schema clinic_finance;create schema clinic_reception;create schema clinic_labs;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table admins(id uuid primary key,user_id uuid,name text,role text);
  create function my_admin_id() returns uuid language sql stable security definer as $$select id from admins where user_id=auth.uid()$$;
  create function has_role(r text) returns boolean language sql stable security definer as $$select exists(select 1 from admins where user_id=auth.uid() and role=r)$$;
  create function clinic_finance.lock_day() returns void language sql as $$select$$;
  create table clinic_finance.audit(id bigserial,actor uuid,action text,entity_id uuid,detail jsonb);
  create table clinic_finance.accounts(code text primary key,name text,kind text);
  create table clinic_finance.account_config(code text primary key,is_system boolean default false);
  create table clinic_finance.registers(id uuid primary key,treasury_kind text);
  create table clinic_finance.shifts(id uuid primary key,register_id uuid,status text default 'open',ended_at timestamptz,opened_at timestamptz default now());
  create table clinic_finance.entries(id uuid primary key default gen_random_uuid(),source text,source_id uuid,description text,shift_id uuid);
  create table clinic_finance.lines(entry_id uuid,account text,debit numeric default 0,credit numeric default 0);
  create function clinic_finance.post(p_source text,p_source_id uuid,p_description text,p_shift uuid,p_debit text,p_credit text,p_amount numeric) returns uuid language plpgsql security definer as $f$declare v uuid;begin
   if (p_debit='1111' or p_credit='1111') and p_shift is null then raise exception 'cash needs a shift';end if;
   insert into clinic_finance.entries(source,source_id,description,shift_id) values(p_source,p_source_id,p_description,p_shift) returning id into v;
   insert into clinic_finance.lines values(v,p_debit,p_amount,0),(v,p_credit,0,p_amount);return v;end$f$;
  create table clinic_reception.workspaces(id uuid primary key,mode text);
  create table clinic_reception.services(id uuid primary key,workspace_id uuid,name text,pricing_service_id uuid);
  create table clinic_reception.appointments(id uuid primary key default gen_random_uuid(),workspace_id uuid,service_id uuid,starts_at timestamptz,source text);
  create table clinic_reception.visits(id uuid primary key default gen_random_uuid(),workspace_id uuid,appointment_id uuid,visit_no bigint generated always as identity);
  create table clinic_reception.orders(id uuid primary key default gen_random_uuid(),workspace_id uuid,visit_id uuid,service_id uuid,status text,price numeric,quantity numeric default 1,discount numeric default 0,net_revenue numeric,completed_at timestamptz default now(),created_at timestamptz default now());
  create table clinic_labs.price_versions(id uuid primary key,lab_name text,version int,imported_at timestamptz default now());
  create table clinic_labs.price_items(id uuid primary key,version_id uuid,cost numeric);
  create table clinic_labs.item_links(item_id uuid,service_id uuid,status text);`);
  for(const [k,[a,u,r]] of Object.entries(P))await q("insert into admins values($1,$2,$3,$4)",[a,u,k,r]);
  await q("insert into clinic_finance.registers values($1,'main')",[RM]);await q("insert into clinic_finance.shifts(id,register_id) values($1,$2)",[SM,RM]);
  await q("insert into clinic_reception.workspaces values($1,'live'),($2,'trial')",[W,WT]);
  await q("insert into clinic_reception.services values($1,$4,'كشف جلدية',null),($2,$4,'جلسة',null),($3,$4,'صورة دم كاملة',$5)",[SV1,SV2,SL,W,PS]);
  await q("insert into clinic_labs.price_versions values($1,'معمل دريم',1)",[PV]);await q("insert into clinic_labs.price_items values($1,$2,55)",[PI,PV]);await q("insert into clinic_labs.item_links values($1,$2,'confirmed')",[PI,PS]);
  // 2 vezeeta visits (kashf 500 net 450 after 10% discount; 600), 1 clinidu, 1 walk-in, 1 trial-workspace vezeeta, 1 vezeeta not executed
  const visit=async(ws,src,svc,orders)=>{const a=await one("insert into clinic_reception.appointments(workspace_id,service_id,starts_at,source) values($1,$2,now(),$3) returning id",[ws,svc,src]);
    const v=await one("insert into clinic_reception.visits(workspace_id,appointment_id) values($1,$2) returning id",[ws,a.id]);
    for(const [s,st,price,net,qty] of orders)await q("insert into clinic_reception.orders(workspace_id,visit_id,service_id,status,price,net_revenue,quantity) values($1,$2,$3,$4,$5,$6,$7)",[ws,v.id,s,st,price,net,qty||1]);};
  await visit(W,'vezeeta',SV1,[[SV1,'completed',500,450],[SV2,'completed',1000,1000]]);
  await visit(W,'vezeeta',SV1,[[SV1,'completed',600,600],[SL,'completed',200,200,2]]);
  await visit(W,'clinidu',SV1,[[SV1,'completed',400,400]]);
  await visit(W,'walk_in',SV1,[[SV1,'completed',400,400]]);
  await visit(WT,'vezeeta',SV1,[[SV1,'completed',999,999]]);
  await visit(W,'vezeeta',SV1,[[SV1,'ordered',500,null]]);
  await db.exec(fs.readFileSync(M,'utf8'));await assert.rejects(()=>db.exec(fs.readFileSync(M,'utf8')),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  const as=k=>db.exec(`select set_config('request.jwt.claim.sub','${P[k][1]}',false)`);const call=(a,p)=>one("select clinic_finance_month_end($1,$2) r",[a,p||{}]).then(x=>x.r);
  const party=(st,k)=>st.parties.find(x=>x.key===k);
  await as('rec');await assert.rejects(()=>call('statement'),/للحسابات والإدارة/);
  // reception records a Tahera referral and a dental-lab case
  let t=await call('add_item',{party:'tahera',ref:'زيارة 12',description:'أشعة رنين على الركبة',amount:'4500',token:id()});assert.equal(+t.amount,4500);
  await call('add_item',{party:'dental_lab',ref:'زيارة 13',description:'زيركون — د. معتز',amount:'1350',token:id()});
  assert.equal((await call('my_items')).items.length,2);assert.equal(+(await call('my_items')).tahera_percent,30);
  await assert.rejects(()=>call('set_rate',{party:'vezeeta',percent:'15'}),/النسب يحددها/);
  // accountant: platforms not counted before the percent is set
  await as('acc');let st=await call('statement');assert.equal(+party(st,'vezeeta').accrued,0);assert.equal(party(st,'vezeeta').count,0);
  assert.equal(+party(st,'lab').accrued,110,'2 × lab cost 55');assert.equal(+party(st,'dental_lab').accrued,1350);assert.equal(+party(st,'tahera').accrued,1350,'30% of 4500');
  await as('fm');await call('set_rate',{party:'vezeeta',percent:'20'});await call('set_rate',{party:'clinidu',percent:'15'});
  await assert.rejects(()=>call('set_rate',{party:'lab',percent:'5'}),/مالهاش نسبة/);
  st=await call('statement');assert.equal(+party(st,'vezeeta').accrued,210,'20% × (450 + 600) — live, executed, booked service only');assert.equal(party(st,'vezeeta').count,2);
  assert.equal(+party(st,'clinidu').accrued,60);assert.equal(+party(st,'akshef').accrued,0);
  const ln=await call('lines',{party:'vezeeta'});assert.equal(ln.lines.length,2);assert.deepEqual(ln.lines.map(x=>+x.base).sort((a,b)=>a-b),[450,600]);
  // settlement: request by the accountant, approve by another person
  await as('acc');await assert.rejects(()=>call('settle_request',{party:'vezeeta',amount:'300',method:'cash',reference:'سداد فيزيتا نوفمبر',token:id()}),/أكبر من المتبقي/);
  let s=await call('settle_request',{party:'vezeeta',amount:'210',method:'cash',reference:'سداد فيزيتا نوفمبر',token:id()});assert.equal(s.status,'pending');assert.equal(s.shift_id,SM);
  assert.equal(+party(await call('statement'),'vezeeta').remaining,0,'pending counts as reserved');
  await assert.rejects(()=>call('settle_review',{id:s.id,ok:true}),/اعتماد السداد/);
  await as('fm');let r=await call('settle_review',{id:s.id,ok:true});assert.equal(r.status,'approved');
  let e=(await q("select l.account,l.debit,l.credit,e.shift_id from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id where e.source_id=$1 order by l.debit desc",[s.id])).rows;
  assert.deepEqual(e.map(x=>[x.account,+x.debit,+x.credit]),[['5233',210,0],['1111',0,210]]);assert.equal(e[0].shift_id,SM);
  // the creator cannot approve his own (FM asks, GM approves); bank → 1112 with no shift
  s=await call('settle_request',{party:'lab',amount:'110',method:'bank',reference:'تحويل معمل دريم',token:id()});
  await assert.rejects(()=>call('settle_review',{id:s.id,ok:true}),/انت عامله/);
  await as('gm');await call('settle_review',{id:s.id,ok:true});
  e=(await q("select l.account,l.debit,e.shift_id from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id where e.source_id=$1 and l.credit>0",[s.id])).rows;assert.equal(e[0].account,'1112');assert.equal(e[0].shift_id,null);
  // Tahera receivable to the wallet: Dr 1115 / Cr 4121; reject needs a reason
  await as('acc');s=await call('settle_request',{party:'tahera',amount:'1350',method:'wallet',reference:'فودافون كاش الطاهرة',token:id()});
  await as('sa');await assert.rejects(()=>call('settle_review',{id:s.id,ok:false}),/سبب الرفض/);await call('settle_review',{id:s.id,ok:true});
  e=(await q("select l.account,l.debit,l.credit from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id where e.source_id=$1 order by l.debit desc",[s.id])).rows;
  assert.deepEqual(e.map(x=>[x.account,+x.debit,+x.credit]),[['1115',1350,0],['4121',0,1350]]);
  // void a wrong dental entry (reason required) → accrued drops
  await as('acc');const it=(await call('lines',{party:'dental_lab'})).items[0];await assert.rejects(()=>call('void_item',{id:it.id}),/سبب الإلغاء/);
  await call('void_item',{id:it.id,reason:'اتسجلت مرتين'});assert.equal(+party(await call('statement'),'dental_lab').accrued,0);
  // rollback
  await db.exec(fs.readFileSync(R,'utf8'));assert.equal((await q("select 1 from pg_proc where proname='clinic_finance_month_end'")).rows.length,0);
  assert.equal((await one("select count(*)::int n from clinic_finance.month_end_settlements_rolled_back")).n,3,'history kept');
  console.log('PASS month-end accounts SQL: platform % of executed booked service (live only), lab cost from confirmed link, dental/Tahera entries, rates by FM/SA, settle request ≤ remaining, maker-checker posting (main cash / bank / wallet), void, rollback');
 }catch(e){console.error(e.message,e.where||'');process.exitCode=1;}
})();
