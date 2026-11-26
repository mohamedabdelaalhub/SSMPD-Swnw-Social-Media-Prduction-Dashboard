// Doctor fee after the platform's share (20261126200000): vezeeta كشف 600 at 50% → 225; «فيزيتا شامل», walk-in, متابعة, a second
// service on the platform visit and a trial workspace keep the full base; one-time correction of completed live platform orders
// (Dr 2120 / Cr 5111 with the original dimensions, receivable 1194 when already paid out), anchor check, re-apply refusal, rollback.
// PGlite with a stub service_operation carrying the exact production fee line.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite'),{randomUUID}=require('crypto');
(async()=>{const db=new PGlite(),id=()=>randomUUID(),q=(s,p)=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0];
 const M='supabase/migrations/20261126200000_platform_doctor_fee.sql',R='supabase/rollbacks/20261126200000_platform_doctor_fee.rollback.sql';
 const ck=fs.readFileSync('supabase/migrations/20261124210000_auto_book_consult_only.sql','utf8').match(/create function clinic_reception\.consult_kind[\s\S]*?\n\$\$;/)[0];
 const W=id(),WT=id(),K=id(),F=id(),G=id(),AG=id(),PR=id(),ADM=id();
 try{await db.exec(`create role authenticated;create role anon;create schema clinic_finance;create schema clinic_reception;
  create table admins(id uuid primary key);
  create table clinic_finance.platform_audits(id uuid);
  create table clinic_finance.month_end_parties(key text primary key,percent numeric);
  insert into clinic_finance.month_end_parties values('vezeeta',25),('clinidu',25),('akshef',25),('kafaret',25),('lab',null),('tahera',30);
  create table clinic_finance.desk_payout_rx(payout_id uuid,rx_invoice_id uuid);
  create table clinic_reception.workspaces(id uuid primary key,mode text);
  create table clinic_reception.services(id uuid primary key,name text);
  create table clinic_reception.appointments(id uuid primary key default gen_random_uuid(),service_id uuid,source text,discount_kind text);
  create table clinic_reception.visits(id uuid primary key default gen_random_uuid(),appointment_id uuid,visit_no bigint generated always as identity);
  create table clinic_reception.doctor_agreements(id uuid primary key,rate numeric,deduct_material_cost boolean default false);
  create table clinic_reception.orders(id uuid primary key default gen_random_uuid(),workspace_id uuid,visit_id uuid,service_id uuid,status text default 'ordered',price numeric,quantity numeric default 1,discount numeric default 0,
    net_revenue numeric,doctor_fee numeric default 0,agreement_id uuid,completed_at timestamptz,created_at timestamptz default now());
  create table clinic_reception.journal(id uuid primary key default gen_random_uuid(),workspace_id uuid,source text,source_id uuid,description text,dimensions jsonb,unique(workspace_id,source,source_id));
  create table clinic_reception.journal_lines(entry_id uuid,account text,debit numeric,credit numeric);
  create function clinic_reception.event_post(p_workspace uuid,p_source text,p_id uuid,p_description text,p_debit text,p_credit text,p_amount numeric,p_dimensions jsonb default '{}') returns uuid language plpgsql as $f$declare v uuid;begin
   if p_amount=0 then return null;end if;insert into clinic_reception.journal(workspace_id,source,source_id,description,dimensions) values(p_workspace,p_source,p_id,p_description,p_dimensions) returning id into v;
   insert into clinic_reception.journal_lines values(v,p_debit,p_amount,0),(v,p_credit,0,p_amount);return v;end$f$;
  create function clinic_reception.post(p_workspace uuid,p_source text,p_id uuid,p_description text,p_debit text,p_credit text,p_amount numeric,p_dimensions jsonb default '{}') returns uuid language sql as $f$select clinic_reception.event_post(p_workspace,p_source,p_id,p_description,p_debit,p_credit,p_amount,p_dimensions)$f$;
  create function clinic_reception.balance(p_workspace uuid,p_account text,p_dimension text default null,p_value text default null) returns numeric language sql stable as $f$
   select coalesce(sum(l.debit-l.credit),0) from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id where j.workspace_id=p_workspace and l.account=p_account and (p_dimension is null or j.dimensions->>p_dimension=p_value)$f$;
  -- stub of the production 'execute' path: same variable names and the exact fee line
  create function clinic_reception.service_operation(p_workspace uuid,p_action text,p_payload jsonb,p_me uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $f$
  declare o clinic_reception.orders%rowtype;agreement clinic_reception.doctor_agreements%rowtype;net numeric;included_cost numeric:=0;fee numeric;dims jsonb;inv uuid:=gen_random_uuid();begin
   select * into o from clinic_reception.orders where id=(p_payload->>'order_id')::uuid;select * into agreement from clinic_reception.doctor_agreements where id=o.agreement_id;
   net:=round(o.price*o.quantity,2)-round(o.price*o.quantity*o.discount/100,2);
   fee:=round(greatest(0,net-case when agreement.deduct_material_cost then included_cost else 0 end)*agreement.rate/100,2);
   dims:=jsonb_build_object('provider_id','${PR}','invoice_id',inv,'order_id',o.id);
   if fee>0 then perform clinic_reception.post(p_workspace,'doctor_fee',o.id,'استحقاق طبيب لخدمة منفذة','5111','2120',fee,dims);end if;
   update clinic_reception.orders set status='completed',completed_at=now(),doctor_fee=fee,net_revenue=net where id=o.id;return jsonb_build_object('fee',fee,'invoice',inv);end$f$;`+ck);
  await q("insert into admins values($1)",[ADM]);await q("insert into clinic_reception.workspaces values($1,'live'),($2,'trial')",[W,WT]);
  await q("insert into clinic_reception.services values($1,'كشف الاستشاري'),($2,'متابعة باطنة'),($3,'رسم قلب')",[K,F,G]);
  await q("insert into clinic_reception.doctor_agreements values($1,50,false)",[AG]);
  const order=async(ws,src,svc,price,dk,extraSvc)=>{const a=await one("insert into clinic_reception.appointments(service_id,source,discount_kind) values($1,$2,$3) returning id",[svc,src,dk||null]);
    const v=await one("insert into clinic_reception.visits(appointment_id) values($1) returning id,visit_no",[a.id]);
    const o=await one("insert into clinic_reception.orders(workspace_id,visit_id,service_id,price,agreement_id) values($1,$2,$3,$4,$5) returning id",[ws,v.id,extraSvc||svc,price,AG]);return o.id;};
  const exec=async oid=>(await one("select clinic_reception.service_operation($1,'execute',$2,$3) r",[W,{order_id:oid},ADM])).r;
  // BEFORE: two completed live vezeeta کشف orders with the old fee (300), one already paid out with nothing left on 2120
  const old1=await order(W,'vezeeta',K,600),old2=await order(W,'kafaret',K,400),oldWalk=await order(W,'walk_in',K,600);
  for(const o of [old1,old2,oldWalk])await exec(o);
  assert.equal(+(await one("select doctor_fee f from clinic_reception.orders where id=$1",[old1])).f,300,'the bug: fee on the full 600');
  const inv2=(await one("select dimensions->>'invoice_id' i from clinic_reception.journal where source='doctor_fee' and source_id=$1",[old2])).i;
  await q("insert into clinic_finance.desk_payout_rx values(gen_random_uuid(),$1)",[inv2]);
  await q("insert into clinic_reception.journal(workspace_id,source,source_id,description,dimensions) values($1,'doctor_payout',gen_random_uuid(),'صرف',jsonb_build_object('provider_id',$2::text))",[W,PR]);
  const pj=(await one("select id from clinic_reception.journal where source='doctor_payout'")).id;
  const bal=-(+(await one("select clinic_reception.balance($1,'2120','provider_id',$2) b",[W,PR])).b);
  await q("insert into clinic_reception.journal_lines values($1,'2120',$2,0),($1,'1111',0,$2)",[pj,bal]); // everything paid out → liability 0
  // apply
  await db.exec(fs.readFileSync(M,'utf8'));await assert.rejects(()=>db.exec(fs.readFileSync(M,'utf8')),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  const fix=(await q("select order_id,old_fee::float o,new_fee::float n,paid_out,receivable::float r,platform_cut::float c from clinic_finance.platform_fee_fixes order by visit_no")).rows;
  assert.deepEqual(fix.map(x=>[x.o,x.n,x.c,x.paid_out]),[[300,225,150,false],[200,150,100,true]],'vezeeta 600 and kafaret 400 corrected; walk-in untouched');
  assert.equal(+(await one("select doctor_fee f from clinic_reception.orders where id=$1",[old1])).f,225);
  assert.equal(+(await one("select doctor_fee f from clinic_reception.orders where id=$1",[oldWalk])).f,300);
  const jl=async(src,oid)=>(await q("select l.account,l.debit::float d,l.credit::float c from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id where j.source=$1 and j.source_id=$2 order by l.debit desc",[src,oid])).rows.map(x=>[x.account,x.d,x.c]);
  assert.deepEqual(await jl('doctor_fee_platform',old1),[['2120',75,0],['5111',0,75]]);
  assert.deepEqual(await jl('doctor_fee_platform',old2),[['2120',50,0],['5111',0,50]]);
  assert.equal(fix[1].r,50,'already paid → the doctor owes it back');assert.deepEqual(await jl('doctor_receivable_platform',old2),[['1194',50,0],['2120',0,50]]);
  assert.equal((await one("select dimensions->>'invoice_id' i from clinic_reception.journal where source='doctor_fee_platform' and source_id=$1",[old2])).i,inv2,'original dimensions kept');
  // AFTER: new executions
  const cases=[['vezeeta كشف 600',await order(W,'vezeeta',K,600),225],['«فيزيتا شامل»',await order(W,'vezeeta',K,600,'vezeeta'),300],['walk-in',await order(W,'walk_in',K,600),300],
   ['vezeeta متابعة',await order(W,'vezeeta',F,600),300],['second service on a vezeeta visit',await order(W,'vezeeta',K,600,null,G),300],['clinidu كشف',await order(W,'clinidu',K,400),150],
   ['trial workspace',await order(WT,'vezeeta',K,600),300]];
  for(const [n,o,want] of cases){const r=await exec(o);assert.equal(+r.fee,want,n);}
  await q("update clinic_finance.month_end_parties set percent=null where key='akshef'");
  assert.equal(+(await exec(await order(W,'akshef',K,600))).fee,300,'no percent → no cut');
  assert.equal(+(await one("select net_revenue n from clinic_reception.orders where id=$1",[cases[0][1]])).n,600,'revenue stays at the patient net');
  // rollback: full base again, corrections kept
  await db.exec(fs.readFileSync(R,'utf8'));assert.equal(+(await exec(await order(W,'vezeeta',K,600))).fee,300);
  assert.equal((await one("select count(*)::int n from clinic_finance.platform_fee_fixes_rolled_back")).n,2);assert.equal(+(await one("select doctor_fee f from clinic_reception.orders where id=$1",[old1])).f,225);
  console.log('PASS platform doctor fee SQL: (net − 25%) × rate on a booked كشف/استشارة from a platform (225 on 600 at 50%); «شامل», walk-in, متابعة, other services, trial, no-percent unchanged; revenue unchanged; one-time correction Dr 2120 / Cr 5111 (+1194 when already paid) with original dimensions; rollback');
 }catch(e){console.error(e.message,e.where||'');process.exitCode=1;}
})();
