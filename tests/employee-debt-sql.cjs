// «على حساب الموظف — يتخصم من المرتب» (20261126210000): request → FM / owner approval (never the requester) → books; convert a
// wrong cash receipt (open / ended shift) through the REAL cash_line_guard + ended_shift_entry_guard; automatic payroll
// deduction of due installments; rollback. PGlite with stubs around the reception / HR tables.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite'),{randomUUID}=require('crypto');
(async()=>{const id=()=>randomUUID();
 const M=fs.readFileSync('supabase/migrations/20261126210000_employee_debt.sql','utf8'),R=fs.readFileSync('supabase/rollbacks/20261126210000_employee_debt.rollback.sql','utf8');
 const tr=fs.readFileSync('supabase/migrations/20261018205000_accountant_chart_treasury.sql','utf8');
 const guard=tr.slice(tr.indexOf('create function clinic_finance.cash_line_guard()'),tr.indexOf('create trigger treasury_cash_line'));
 const ho=fs.readFileSync('supabase/migrations/20261019001000_treasury_shift_handover.sql','utf8');
 const ended=ho.slice(ho.indexOf('create function clinic_finance.ended_shift_entry_guard()'),ho.indexOf('create trigger treasury_ended_entry'))
   .replace("new.source not in('treasury_transfer_out','treasury_binding')","new.source not in('treasury_transfer_out','treasury_binding','cash_case_settlement')");
 const P={mazen:[id(),id(),'reception'],nada:[id(),id(),'reception'],fm:[id(),id(),'financial_manager'],sa:[id(),id(),'super_admin'],acc:[id(),id(),'accountant'],gm:[id(),id(),'general_manager']};
 async function setup(){const db=new PGlite(),q=(s,p)=>db.query(s,p);
  await db.exec(`create role authenticated;create role anon;create schema auth;create schema clinic_finance;create schema clinic_reception;create schema clinic_people;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table admins(id uuid primary key,user_id uuid,name text,role text,active boolean default true);
  create function my_admin_id() returns uuid language sql stable security definer as $$select id from admins where user_id=auth.uid()$$;
  create function my_role() returns text language sql stable security definer as $$select role from admins where user_id=auth.uid()$$;
  create function has_role(r text) returns boolean language sql stable security definer as $$select my_role()=r$$;
  create function clinic_finance.allowed(a text) returns boolean language sql stable security definer as $$select my_role() in ('accountant','financial_manager','super_admin')$$;
  create function clinic_finance.require_access(a text) returns uuid language plpgsql security definer as $f$begin if not clinic_finance.allowed(a) then raise exception 'no access';end if;return my_admin_id();end$f$;
  create function clinic_finance.lock_day() returns void language sql as $$select$$;
  create table clinic_finance.audit(id bigserial,actor uuid,action text,entity_id uuid,detail jsonb);
  create table clinic_finance.accounts(code text primary key,name text,kind text);insert into clinic_finance.accounts values('1142','سلف العاملين','asset'),('1122','مدينو المرضى','asset'),('1111','الخزنة','asset');
  create table clinic_finance.account_config(code text primary key,is_system boolean default false,active boolean default true,archived boolean default false,is_postable boolean default true);
  create table clinic_finance.cash_accounts(code text primary key);insert into clinic_finance.cash_accounts values('1111'),('1131');
  create function clinic_finance.is_cash_account(c text) returns boolean language sql stable as $$select exists(select 1 from clinic_finance.cash_accounts where code=c)$$;
  create table clinic_finance.registers(id uuid primary key,name text,treasury_kind text,account_code text);
  create table clinic_finance.shifts(id uuid primary key,register_id uuid,cashier_id uuid,status text default 'open',ended_at timestamptz,is_main boolean default false,opening_book numeric default 0);
  create table clinic_finance.entries(id uuid primary key default gen_random_uuid(),source text,source_id uuid,description text,shift_id uuid,created_by uuid not null,business_date date default current_date);
  create table clinic_finance.lines(id uuid primary key default gen_random_uuid(),entry_id uuid,account text,debit numeric default 0,credit numeric default 0);
  create table clinic_finance.business_requests(id uuid primary key default gen_random_uuid(),kind text,subject text,reference text unique,amount numeric,payload jsonb,created_by uuid,token uuid,created_at timestamptz default now(),status text default 'pending',reviewed_by uuid,review_note text);
  create function clinic_finance.employee_advance(p text) returns numeric language sql stable as $$select coalesce(sum(case when kind='advance' then amount when kind='payroll' then -coalesce((payload->>'recovery')::numeric,0) else 0 end),0) from clinic_finance.business_requests where subject=p and status='approved'$$;
  create function public.clinic_finance_business_command(p_action text,p_payload jsonb,p_token uuid) returns uuid language plpgsql security definer as $f$declare v uuid;r clinic_finance.business_requests%rowtype;begin
   if p_action='request' then select id into v from clinic_finance.business_requests where token=p_token and created_by=my_admin_id();if found then return v;end if;
    insert into clinic_finance.business_requests(kind,subject,reference,amount,payload,created_by,token) values(p_payload->>'kind',p_payload->>'subject',p_payload->>'reference',5000,p_payload,my_admin_id(),p_token) returning id into v;return v;end if;
   select * into r from clinic_finance.business_requests where id=(p_payload->>'id')::uuid;
   if (p_payload->>'approve')::boolean then if coalesce((r.payload->>'recovery')::numeric,0)>clinic_finance.employee_advance(r.subject) then raise exception 'استرداد السلفة يتجاوز رصيد الموظف';end if;
    update clinic_finance.business_requests set status='approved' where id=r.id;else update clinic_finance.business_requests set status='rejected' where id=r.id;end if;return r.id;end$f$;
  create table clinic_people.people(id uuid primary key,full_name text,code text,finance_subject text unique);
  create table clinic_reception.workspaces(id uuid primary key,mode text);
  create table clinic_reception.patients(id uuid primary key,workspace_id uuid,name text);
  create table clinic_reception.appointments(id uuid primary key,discount_staff_id uuid);
  create table clinic_reception.visits(id uuid primary key,appointment_id uuid,visit_no bigint);
  create table clinic_reception.invoices(id uuid primary key,workspace_id uuid,patient_id uuid,visit_id uuid,package_id uuid,amount numeric,payer_amount numeric default 0,credit_amount numeric default 0,invoice_no bigint generated always as identity);
  create table clinic_reception.registers(id uuid primary key,finance_register_id uuid);
  create table clinic_reception.shifts(id uuid primary key,workspace_id uuid,register_id uuid,cashier_id uuid,status text default 'open',finance_shift_id uuid);
  create table clinic_reception.payments(id uuid primary key,workspace_id uuid,patient_id uuid,method text,shift_id uuid,amount numeric,receipt_no text,created_at timestamptz default now());
  create table clinic_reception.allocations(id uuid primary key default gen_random_uuid(),workspace_id uuid,invoice_id uuid,payment_id uuid,source text not null check(source in ('payment','package','credit')),amount numeric,created_at timestamptz default now());
  create table clinic_reception.journal(id uuid primary key default gen_random_uuid(),workspace_id uuid,source text,source_id uuid,description text,dimensions jsonb default '{}',actor_id uuid not null,created_at timestamptz default now(),finance_entry_id uuid,event_no bigint generated always as identity,unique(workspace_id,source,source_id));
  create table clinic_reception.journal_lines(entry_id uuid,account text,debit numeric,credit numeric);
  create function clinic_reception.account(p_code text) returns text language sql immutable as $$select case p_code when '1123' then '1121' else p_code end$$;
  create function clinic_reception.due(p_invoice uuid) returns numeric language sql stable as $$select i.amount-i.payer_amount-i.credit_amount-coalesce((select sum(amount) from clinic_reception.allocations where invoice_id=i.id),0) from clinic_reception.invoices i where i.id=p_invoice$$;
  create function clinic_reception.access(p_workspace uuid,p_action text) returns uuid language plpgsql security definer as $f$begin if my_role() not in ('reception','super_admin') then raise exception 'مش مسموح';end if;return my_admin_id();end$f$;
  create table clinic_reception.staff_map(patient_id uuid,person_id uuid,relation text);
  create function clinic_reception.staff_for_patient(p_patient uuid,p_day date) returns table(person_id uuid,name text,code text,relation text) language sql stable as $$select p.id,p.full_name,p.code,m.relation from clinic_reception.staff_map m join clinic_people.people p on p.id=m.person_id where m.patient_id=p_patient$$;`);
  await db.exec(guard+';create trigger treasury_cash_line before insert on clinic_finance.lines for each row execute function clinic_finance.cash_line_guard();');
  await db.exec(ended+';create trigger treasury_ended_entry before insert on clinic_finance.entries for each row execute function clinic_finance.ended_shift_entry_guard();');
  for(const [k,[a,u,r]] of Object.entries(P))await q("insert into admins(id,user_id,name,role) values($1,$2,$3,$4)",[a,u,k,r]);
  return {db,q,one:async(s,p)=>(await q(s,p)).rows[0]};}
 const T=await setup(),{db,q,one}=T;
 const WS=id(),WT=id(),RM=id(),RR=id(),FS=id(),FS2=id(),RS=id(),RS2=id(),RG=id(),HUDA=id(),HP=id(),KID=id(),OUT=id(),AP=id(),V195=id(),V200=id();
 await q("insert into clinic_finance.registers values($1,'الرئيسية','main','1111'),($2,'خزينة مازن','collection','1131')",[RM,RR]);
 await q("insert into clinic_finance.shifts(id,register_id,cashier_id) values($1,$2,$3),($4,$2,$5)",[FS,RR,P.mazen[0],FS2,P.nada[0]]);
 await q("insert into clinic_reception.workspaces values($1,'live'),($2,'trial')",[WS,WT]);
 await q("insert into clinic_reception.registers values($1,$2)",[RG,RR]);
 await q("insert into clinic_reception.shifts values($1,$2,$3,$4,'open',$5),($6,$2,$3,$7,'open',$8)",[RS,WS,RG,P.mazen[0],FS,RS2,P.nada[0],FS2]);
 await q("insert into clinic_people.people values($1,'هدى','E-12','EMP-12')",[HUDA]);
 await q("insert into clinic_reception.patients values($1,$4,'هدى'),($2,$4,'ابن هدى'),($3,$4,'مريض عادي')",[HP,KID,OUT,WS]);
 await q("insert into clinic_reception.staff_map values($1,$3,'self'),($2,$3,'child')",[HP,KID,HUDA]);
 await q("insert into clinic_reception.appointments values($1,$2)",[AP,HUDA]);
 await q("insert into clinic_reception.visits values($1,$2,195),($3,null,200)",[V195,AP,V200]);
 const inv=async(p,v,amt,pkg)=>{const x=id();await q("insert into clinic_reception.invoices(id,workspace_id,patient_id,visit_id,package_id,amount) values($1,$2,$3,$4,$5,$6)",[x,WS,p,v,pkg||null,amt]);return x;};
 const I1=await inv(KID,V200,360),I2=await inv(HP,V195,360),I3=await inv(OUT,null,200),I4=await inv(HP,null,500,id());
 // visit 195: recorded as CASH by mistake in Mazen's open shift (journal + mirror like the live collection)
 const PAY=id();await q("insert into clinic_reception.payments values($1,$2,$3,'cash',$4,360,'R-195')",[PAY,WS,HP,RS]);
 await q("insert into clinic_reception.allocations(workspace_id,invoice_id,payment_id,source,amount) values($1,$2,$3,'payment',360)",[WS,I2,PAY]);
 const cashIn=async(shift,amt)=>{const e=(await one("insert into clinic_finance.entries(source,source_id,description,shift_id,created_by) values('reception_invoice_payment',gen_random_uuid(),'x',$1,$2) returning id",[shift,P.mazen[0]])).id;
  await q("insert into clinic_finance.lines(entry_id,account,debit,credit) values($1,'1111',$2,0),($1,'1122',0,$2)",[e,amt]);};
 await cashIn(FS,360);
 const shiftCash=async s=>+(await one("select coalesce(sum(l.debit-l.credit),0) v from clinic_finance.entries e join clinic_finance.lines l on l.entry_id=e.id where e.shift_id=$1 and l.account in ('1111','1131')",[s])).v;
 assert.equal(await shiftCash(FS),360);
 await db.exec(M);
 const as=async(who,fn)=>{await db.exec('begin');try{await q("select set_config('request.jwt.claim.sub',$1,true)",[P[who][1]]);const r=await fn();await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}};
 const rpc=(who,a,p)=>as(who,async()=>(await one('select public.clinic_finance_employee_debt($1,$2::jsonb) r',[a,JSON.stringify(p||{})])).r);
 const err=async(pr,re)=>{await assert.rejects(pr,e=>{assert.match(e.message,re);return true;});};
 const next=(await rpc('mazen','options',{workspace_id:WS,invoice_id:I1})).next_month;

 // ---- options: eligible staff + default person from the visit's staff discount
 let o=await rpc('mazen','options',{workspace_id:WS,invoice_id:I2});assert.equal(o.live,true);assert.equal(o.staff.length,1);assert.equal(o.default_person,HUDA);assert.equal(+o.due,0);
 o=await rpc('mazen','options',{workspace_id:WS,invoice_id:I3});assert.equal(o.staff.length,0);
 await err(rpc('fm','options',{workspace_id:WS,invoice_id:I1}),/مش مسموح/);

 // ---- service: request (reception) → refusals → FM approves
 await err(rpc('mazen','request',{kind:'service',invoice_id:I3,person_id:HUDA,months:1,reason:'خدمة لموظف',token:id()}),/الدرجة الأولى/);
 await err(rpc('mazen','request',{kind:'service',invoice_id:I4,person_id:HUDA,months:1,reason:'باكدج',token:id()}),/الباكدج/);
 await err(rpc('mazen','request',{kind:'service',invoice_id:I1,person_id:HUDA,months:13,reason:'كتير',token:id()}),/من 1 لـ 12/);
 await err(rpc('mazen','request',{kind:'service',invoice_id:I1,person_id:HUDA,months:3,first_month:'2020-01-01',reason:'قديم',token:id()}),/3 شهور/);
 const tk=id();let s1=await rpc('mazen','request',{kind:'service',invoice_id:I1,person_id:HUDA,months:3,reason:'كشف ابن هدى — يتخصم من المرتب',token:tk});
 assert.equal(s1.status,'pending');assert.equal(+s1.amount,360);assert.equal(+s1.installment,120);assert.equal(s1.relation,'child');
 assert.equal((await rpc('mazen','request',{kind:'service',invoice_id:I1,person_id:HUDA,months:3,reason:'كشف ابن هدى — يتخصم من المرتب',token:tk})).id,s1.id,'idempotent per token');
 await err(rpc('nada','request',{kind:'service',invoice_id:I1,person_id:HUDA,months:1,reason:'تاني',token:id()}),/عليه طلب بالفعل/);
 assert.equal(+(await one('select clinic_reception.due($1) v',[I1])).v,360,'still unpaid until approval');
 assert.equal((await rpc('mazen','options',{workspace_id:WS,invoice_id:I1})).open.status,'pending');
 await err(rpc('mazen','review',{id:s1.id,ok:true}),/المالي أو المالك/);
 await err(rpc('acc','review',{id:s1.id,ok:true}),/المالي أو المالك/);
 await err(rpc('gm','review',{id:s1.id,ok:true}),/المالي أو المالك/);
 let L=await rpc('fm','list',{});assert.equal(L.can_review,true);assert.equal(L.inbox.length,1);
 s1=await rpc('fm','review',{id:s1.id,ok:true});assert.equal(s1.status,'approved');
 assert.equal(+(await one('select clinic_reception.due($1) v',[I1])).v,0,'paid by the employee debt');
 let j=await one("select j.*,(select json_agg(json_build_object('a',account,'d',debit,'c',credit) order by debit desc) from clinic_reception.journal_lines where entry_id=j.id) l from clinic_reception.journal j where source='employee_debt'");
 assert.deepEqual(j.l.map(x=>[x.a,+x.d,+x.c]),[['1142',360,0],['1122',0,360]]);assert.equal(j.dimensions.invoice_id,I1);assert.equal(j.dimensions.person_id,HUDA);
 let fe=await one("select e.*,(select json_agg(json_build_object('a',account,'d',debit,'c',credit) order by debit desc) from clinic_finance.lines where entry_id=e.id) l from clinic_finance.entries e where source='reception_employee_debt'");
 assert.equal(fe.source_id,j.id);assert.equal(fe.shift_id,null);assert.equal(j.finance_entry_id,fe.id);assert.deepEqual(fe.l.map(x=>[x.a,+x.d,+x.c]),[['1142',360,0],['1122',0,360]]);
 assert.deepEqual((await q("select i.amount::numeric a from clinic_finance.employee_debt_installments i where i.debt_id=$1 order by i.month",[s1.id])).rows.map(r=>+r.a),[120,120,120]);
 let adv=await one("select * from clinic_finance.business_requests where kind='advance' and payload->>'debt_id'=$1",[s1.id]);assert.equal(adv.subject,'EMP-12');assert.equal(+adv.amount,360);assert.equal(adv.status,'approved');
 assert.equal((await rpc('fm','review',{id:s1.id,ok:true})).status,'approved','re-approve is a no-op');
 assert.equal((await q("select count(*)::int n from clinic_reception.journal where source='employee_debt'")).rows[0].n,1);

 // ---- convert visit 195 (cash by mistake, OPEN shift): requester = Mazen, approver ≠ requester
 const cv=await rpc('mazen','convertible',{workspace_id:WS});assert.equal(cv.items.length,1);assert.equal(cv.items[0].payment_id,PAY);assert.equal(cv.items[0].visit_no,195);assert.equal(cv.items[0].shift_open,true);
 let c1=await rpc('mazen','request',{kind:'convert',payment_id:PAY,person_id:HUDA,months:1,first_month:next,reason:'اتسجل كاش بالغلط — هيتخصم من المرتب',token:id()});
 assert.equal(+c1.amount,360);assert.equal(c1.status,'pending');
 // nobody can push the cash-out entry by hand before / without the approved debt
 await err(as('sa',async()=>{const e=(await one("insert into clinic_finance.entries(source,source_id,description,shift_id,created_by) values('reception_employee_debt_convert',gen_random_uuid(),'x',$1,$2) returning id",[FS,P.sa[0]])).id;
   await q("insert into clinic_finance.lines(entry_id,account,debit,credit) values($1,'1142',360,0),($1,'1111',0,360)",[e]);}),/الصرف من الخزينة الرئيسية فقط/);
 await err(rpc('mazen','review',{id:c1.id,ok:true}),/المالي أو المالك/);
 await q("update admins set role='super_admin' where id=$1",[P.mazen[0]]);
 await err(rpc('mazen','review',{id:c1.id,ok:true}),/غير اللي طلب/);
 await q("update admins set role='reception' where id=$1",[P.mazen[0]]);
 c1=await rpc('sa','review',{id:c1.id,ok:true});assert.equal(c1.status,'approved');assert.equal(c1.shift_open,true);
 assert.equal(await shiftCash(FS),0,'expected cash in the open drawer drops by 360');
 j=await one("select j.*,(select json_agg(json_build_object('a',account,'d',debit,'c',credit) order by debit desc) from clinic_reception.journal_lines where entry_id=j.id) l from clinic_reception.journal j where source='employee_debt_convert'");
 assert.deepEqual(j.l.map(x=>[x.a,+x.d,+x.c]),[['1142',360,0],['1111',0,360]]);assert.equal(j.dimensions.payment_id,PAY);assert.equal(j.dimensions.shift_id,RS);
 fe=await one("select e.*,(select json_agg(json_build_object('a',account,'d',debit,'c',credit) order by debit desc) from clinic_finance.lines where entry_id=e.id) l from clinic_finance.entries e where source='reception_employee_debt_convert'");
 assert.equal(fe.shift_id,FS);assert.deepEqual(fe.l.map(x=>[x.a,+x.d,+x.c]),[['1142',360,0],['1131',0,360]],'1111 → the register account');
 assert.equal((await q("select count(*)::int n from clinic_reception.payments where id=$1",[PAY])).rows[0].n,1,'receipt kept');
 // the door closes after use: a replay with the same journal id is refused
 await err(as('sa',async()=>{const e=(await one("insert into clinic_finance.entries(source,source_id,description,shift_id,created_by) values('reception_employee_debt_convert',$1,'x',$2,$3) returning id",[j.id,FS,P.sa[0]])).id;
   await q("insert into clinic_finance.lines(entry_id,account,debit,credit) values($1,'1142',360,0),($1,'1111',0,360)",[e]);}),/الصرف من الخزينة الرئيسية فقط/);
 await err(rpc('nada','request',{kind:'convert',payment_id:PAY,person_id:HUDA,months:1,reason:'تاني',token:id()}),/عليه طلب بالفعل/);

 // ---- convert on an ENDED shift (Nada's): adjustment on that shift; other sources still refused there
 const I5=await inv(HP,null,250),PAY2=id();await q("insert into clinic_reception.payments values($1,$2,$3,'cash',$4,250,'R-2')",[PAY2,WS,HP,RS2]);
 await q("insert into clinic_reception.allocations(workspace_id,invoice_id,payment_id,source,amount) values($1,$2,$3,'payment',250)",[WS,I5,PAY2]);
 await as('nada',async()=>{const e=(await one("insert into clinic_finance.entries(source,source_id,description,shift_id,created_by) values('reception_invoice_payment',gen_random_uuid(),'x',$1,$2) returning id",[FS2,P.nada[0]])).id;await q("insert into clinic_finance.lines(entry_id,account,debit,credit) values($1,'1111',250,0),($1,'1122',0,250)",[e]);});
 const c2=await rpc('nada','request',{kind:'convert',payment_id:PAY2,person_id:HUDA,months:2,first_month:next,reason:'اتسجل كاش بالغلط',token:id()});
 await q("update clinic_finance.shifts set ended_at=now(),status='submitted' where id=$1",[FS2]);
 await err(as('sa',async()=>{await q("insert into clinic_finance.entries(source,source_id,description,shift_id,created_by) values('reception_invoice_payment',gen_random_uuid(),'x',$1,$2)",[FS2,P.sa[0]]);}),/انتهت الوردية/);
 const c2a=await rpc('fm','review',{id:c2.id,ok:true});assert.equal(c2a.status,'approved');assert.equal(c2a.shift_open,false);assert.equal(await shiftCash(FS2),0);
 // reject path
 const I6=await inv(HP,null,100);const r6=await rpc('mazen','request',{kind:'service',invoice_id:I6,person_id:HUDA,months:1,reason:'خدمة',token:id()});
 await err(rpc('fm','review',{id:r6.id,ok:false}),/سبب الرفض/);
 assert.equal((await rpc('fm','review',{id:r6.id,ok:false,note:'يدفع كاش'})).status,'rejected');assert.equal(+(await one('select clinic_reception.due($1) v',[I6])).v,100);
 const r7=await rpc('mazen','request',{kind:'service',invoice_id:I6,person_id:HUDA,months:1,reason:'تاني مرة',token:id()});assert.equal((await rpc('mazen','cancel',{id:r7.id})).status,'cancelled');
 await err(rpc('nada','cancel',{id:r7.id}),/مش موجود/);
 // trial workspace refused
 await err(rpc('mazen','request',{kind:'service',invoice_id:await (async()=>{const x=id();await q("insert into clinic_reception.invoices(id,workspace_id,patient_id,amount) values($1,$2,$3,50)",[x,WT,HP]);return x;})(),person_id:HUDA,months:1,reason:'تجريبي',token:id()}),/الحقيقية بس/);

 // ---- payroll: due installments are added to 'recovery' automatically; reject releases; retry does not double
 L=await rpc('fm','list',{});const b=L.balances.find(x=>x.person_id===HUDA);assert.equal(+b.total,970);assert.equal(+b.recovered,0);
 const tokP=id();const pay1=await as('acc',async()=>(await one("select public.clinic_finance_business_command('request',$1::jsonb,$2) v",[JSON.stringify({kind:'payroll',subject:'EMP-12',month:next,recovery:'50'}),tokP])).v);
 let pr=await one('select * from clinic_finance.business_requests where id=$1',[pay1]);
 assert.equal(+pr.payload.employee_debt,120+360+125);assert.equal(+pr.payload.recovery,50+605);
 assert.equal((await q("select count(*)::int n from clinic_finance.employee_debt_installments where payroll_id=$1",[pay1])).rows[0].n,3);
 assert.equal(await as('acc',async()=>(await one("select public.clinic_finance_business_command('request',$1::jsonb,$2) v",[JSON.stringify({kind:'payroll',subject:'EMP-12',month:next,recovery:'50'}),tokP])).v),pay1,'retry → same request, no double');
 await as('fm',async()=>one("select public.clinic_finance_business_command('review',$1::jsonb,$2) v",[JSON.stringify({id:pay1,approve:false}),id()]));
 assert.equal((await q("select count(*)::int n from clinic_finance.employee_debt_installments where payroll_id is not null")).rows[0].n,0,'rejected payroll releases the installments');
 const pay2=await as('acc',async()=>(await one("select public.clinic_finance_business_command('request',$1::jsonb,$2) v",[JSON.stringify({kind:'payroll',subject:'EMP-12',month:next}),id()])).v);
 assert.equal(+(await one('select * from clinic_finance.business_requests where id=$1',[pay2])).payload.recovery,605);
 await as('fm',async()=>one("select public.clinic_finance_business_command('review',$1::jsonb,$2) v",[JSON.stringify({id:pay2,approve:true}),id()]));
 L=await rpc('fm','list',{});assert.equal(+L.balances.find(x=>x.person_id===HUDA).recovered,605);
 const mon2=(await one("select to_char(($1::date + interval '1 month')::date,'YYYY-MM-DD') m",[next])).m;
 const pay3=await as('acc',async()=>(await one("select public.clinic_finance_business_command('request',$1::jsonb,$2) v",[JSON.stringify({kind:'payroll',subject:'EMP-12',month:mon2}),id()])).v);
 assert.equal(+(await one('select * from clinic_finance.business_requests where id=$1',[pay3])).payload.employee_debt,120+125,'month 2: the next installments only');
 // other payroll / other actions untouched
 const pay4=await as('acc',async()=>(await one("select public.clinic_finance_business_command('request',$1::jsonb,$2) v",[JSON.stringify({kind:'payroll',subject:'EMP-99',month:next,recovery:'10'}),id()])).v);
 assert.equal((await one('select * from clinic_finance.business_requests where id=$1',[pay4])).payload.recovery,'10');
 // nada (reception) sees her own only
 L=await rpc('nada','list',{});assert.equal(L.can_review,false);assert.equal(L.inbox.length,0);assert.ok(L.items.every(x=>x.mine));assert.equal(L.balances.length,0);

 // ---- rollback: refused with approved debts; clean on a DB with none
 await err(db.exec(R),/اتعتمدت/);
 const T2=await setup();const gd=async(t)=> (await t.one("select md5(pg_get_functiondef('clinic_finance.cash_line_guard()'::regprocedure)) a,md5(pg_get_functiondef('clinic_finance.ended_shift_entry_guard()'::regprocedure)) b,md5(pg_get_functiondef('public.clinic_finance_business_command(text,jsonb,uuid)'::regprocedure)) c"));
 const before=await gd(T2);await T2.db.exec(M);assert.notEqual((await gd(T2)).a,before.a);await T2.db.exec(R);assert.deepEqual(await gd(T2),before);
 assert.equal((await T2.one("select to_regclass('clinic_finance.employee_debts') x")).x,null);
 await T2.db.exec(M);
 console.log('employee-debt-sql: OK');
})().catch(e=>{console.error(e);process.exit(1);});
