// «طلب صرف من الدرج» (20261126100000): request → two approvals (advance / incentive) or the accountant (supplier) → the SAME
// cashier pays from HIS open collection shift. The cash-out exception is narrow: only source 'drawer_payout' for an approved,
// unpaid request, on the requester's own open shift, for exactly the approved amount. PGlite, real cash_line_guard.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite'),{randomUUID}=require('crypto');
(async()=>{const db=new PGlite(),id=()=>randomUUID(),q=(s,p)=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0];
 const M='supabase/migrations/20261126100000_drawer_payout_requests.sql',R='supabase/rollbacks/20261126100000_drawer_payout_requests.rollback.sql';
 const tr=fs.readFileSync('supabase/migrations/20261018205000_accountant_chart_treasury.sql','utf8');
 const guard=tr.slice(tr.indexOf('create function clinic_finance.cash_line_guard()'),tr.indexOf('create trigger treasury_cash_line'));
 const P={cashier:[id(),id(),'reception'],other:[id(),id(),'reception'],gm:[id(),id(),'general_manager'],sa:[id(),id(),'super_admin'],fm:[id(),id(),'financial_manager'],acc:[id(),id(),'accountant']};
 const RM=id(),RR=id(),RR2=id(),S1=id(),S2=id(),SUP=id();
 try{await db.exec(`create role authenticated;create role anon;create schema auth;create schema clinic_finance;create schema storage;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table admins(id uuid primary key,user_id uuid,name text,role text,active boolean default true);
  create function my_admin_id() returns uuid language sql stable security definer as $$select id from admins where user_id=auth.uid()$$;
  create function my_role() returns text language sql stable security definer as $$select role from admins where user_id=auth.uid()$$;
  create function has_role(r text) returns boolean language sql stable security definer as $$select my_role()=r$$;
  create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
  create table inventory_suppliers(id uuid primary key,name text,active boolean default true);
  create function clinic_finance.allowed(a text) returns boolean language sql stable security definer as $$select my_role() in ('accountant','financial_manager','super_admin')$$;
  create function clinic_finance.require_access(a text) returns uuid language plpgsql security definer as $f$begin if not clinic_finance.allowed(a) then raise exception 'no access';end if;return my_admin_id();end$f$;
  create function clinic_finance.lock_day() returns void language sql as $$select$$;
  create table clinic_finance.audit(id bigserial,actor uuid,action text,entity_id uuid,detail jsonb);
  create table clinic_finance.accounts(code text primary key,name text,kind text);
  create table clinic_finance.account_config(code text primary key,is_system boolean default false,active boolean default true,archived boolean default false,is_postable boolean default true);
  create table clinic_finance.cash_accounts(code text primary key);insert into clinic_finance.cash_accounts values('1111'),('1131'),('1132');
  create function clinic_finance.is_cash_account(c text) returns boolean language sql stable as $$select exists(select 1 from clinic_finance.cash_accounts where code=c)$$;
  create table clinic_finance.registers(id uuid primary key,name text,treasury_kind text,account_code text,operation_mode text);
  create table clinic_finance.shifts(id uuid primary key,register_id uuid,cashier_id uuid,status text default 'open',opened_at timestamptz default now(),ended_at timestamptz,is_main boolean default false,opening_book numeric default 0);
  create table clinic_finance.entries(id uuid primary key default gen_random_uuid(),source text,source_id uuid,description text,shift_id uuid,created_by uuid);
  create table clinic_finance.lines(id uuid primary key default gen_random_uuid(),entry_id uuid,account text,debit numeric default 0,credit numeric default 0);
  create function clinic_finance.register_direction(p_shift uuid,p_direction text) returns void language plpgsql as $f$begin
    if p_direction='pay' and exists(select 1 from clinic_finance.shifts s join clinic_finance.registers r on r.id=s.register_id where s.id=p_shift and r.operation_mode='receive') then raise exception 'الخزينة للاستلام فقط ولا تسمح بالصرف';end if;end$f$;
  create function clinic_finance.cash_limit(p uuid) returns numeric language sql stable as $$select greatest(0,coalesce((select sum(l.debit-l.credit) from clinic_finance.entries e join clinic_finance.lines l on l.entry_id=e.id where e.shift_id=p and clinic_finance.is_cash_account(l.account)),0))$$;
  create function clinic_finance.post(p_source text,p_source_id uuid,p_description text,p_shift uuid,p_debit text,p_credit text,p_amount numeric) returns uuid language plpgsql security definer as $f$declare v_id uuid;begin
   if p_shift is not null then
   if p_credit='1111' and p_source<>'deposit' and p_source<>'shift_expense' and not (p_source='doctor_payment' and false) then perform clinic_finance.register_direction(p_shift,'pay');end if;end if;
   if p_credit='1111' and p_amount>clinic_finance.cash_limit(p_shift) then raise exception 'الكاش المتاح لا يكفي للصرف';end if;
   insert into clinic_finance.entries(source,source_id,description,shift_id,created_by) values(p_source,p_source_id,p_description,p_shift,my_admin_id()) returning id into v_id;
   insert into clinic_finance.lines(entry_id,account,debit,credit) values(v_id,p_debit,p_amount,0),(v_id,p_credit,0,p_amount);return v_id;end $f$;
  create table clinic_finance.business_requests(id uuid primary key default gen_random_uuid(),kind text,subject text,reference text unique,amount numeric,payload jsonb,created_by uuid,token uuid,created_at timestamptz default now(),status text default 'pending',reviewed_by uuid,review_note text);
  create function clinic_finance.employee_advance(p text) returns numeric language sql stable as $$select coalesce(sum(amount),0) from clinic_finance.business_requests where subject=p and kind='advance' and status='approved'$$;
  create table clinic_finance.supplier_events(supplier_id uuid,amount numeric);
  create table clinic_finance.supplier_actions(id uuid primary key default gen_random_uuid(),kind text,supplier_id uuid,amount numeric,method text,shift_id uuid,reference text,note text,payload jsonb,created_by uuid,token uuid,status text,reviewed_by uuid,reviewed_at timestamptz,review_note text);
  create function clinic_finance.supplier_balance(p uuid) returns numeric language sql stable as $$select coalesce((select sum(amount) from clinic_finance.supplier_events where supplier_id=p),0)-coalesce((select sum(amount) from clinic_finance.supplier_actions where supplier_id=p and status='approved' and kind='supplier_payment'),0)$$;`);
  await db.exec(guard+';create trigger treasury_cash_line before insert on clinic_finance.lines for each row execute function clinic_finance.cash_line_guard();');
  for(const [k,[a,u,r]] of Object.entries(P))await q("insert into admins(id,user_id,name,role) values($1,$2,$3,$4)",[a,u,k,r]);
  await q("insert into clinic_finance.registers values($1,'الرئيسية','main','1111','both'),($2,'خزينة منار','collection','1131','receive'),($3,'خزينة تانية','collection','1132','receive')",[RM,RR,RR2]);
  await q("insert into clinic_finance.shifts(id,register_id,cashier_id) values($1,$2,$3),($4,$5,$6)",[S1,RR,P.cashier[0],S2,RR2,P.other[0]]);
  await q("insert into clinic_finance.business_requests(kind,subject,reference,amount,payload,created_by,token,status) values('employment','EMP-7','EMP-C-7',5000,'{\"employee_name\":\"منار موسى\",\"to\":\"2099-12-31\"}',$1,gen_random_uuid(),'approved')",[P.fm[0]]);
  await q("insert into inventory_suppliers values($1,'صيدلية العزبي')",[SUP]);
  const as=k=>db.exec(`select set_config('request.jwt.claim.sub','${P[k][1]}',false)`);
  await as('cashier');await q("select clinic_finance.post('payment',gen_random_uuid(),'تحصيل',$1,'1111','4110',1000)",[S1]);
  await as('other');await q("select clinic_finance.post('payment',gen_random_uuid(),'تحصيل',$1,'1111','4110',1000)",[S2]);
  await db.exec(fs.readFileSync(M,'utf8'));await assert.rejects(()=>db.exec(fs.readFileSync(M,'utf8')),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  const call=(a,p)=>one("select clinic_finance_drawer_request($1,$2) r",[a,p||{}]).then(x=>x.r);
  // a direct drawer_payout post without an approved request is still refused by both guards
  await as('cashier');await assert.rejects(()=>q("select clinic_finance.post('drawer_payout',gen_random_uuid(),'x',$1,'1142','1111',10)",[S1]),/للاستلام فقط/);
  let st=await call('status');assert.equal(st.shift_id,S1);assert.equal(+st.cash,1000);assert.equal(st.employees[0].name,'منار موسى');assert.equal(st.suppliers.length,1);assert.equal(st.can_first,false);
  // ---- advance: request → GM → FM → pay
  const tok=randomUUID();let a=await call('request',{kind:'advance',subject:'EMP-7',amount:'400',reason:'سلفة شخصية',token:tok});assert.equal(a.status,'pending');
  assert.equal((await call('request',{kind:'advance',subject:'EMP-7',amount:'400',reason:'سلفة شخصية',token:tok})).id,a.id,'same token = same request');
  await assert.rejects(()=>call('request',{kind:'advance',subject:'NOPE',amount:'10',reason:'xxx',token:randomUUID()}),/عقد معتمد/);
  await assert.rejects(()=>call('pay',{id:a.id}),/مستني الموافقة/);
  await assert.rejects(()=>call('review',{id:a.id,ok:true}),/مينفعش توافق على طلبك/);
  await as('fm');await assert.rejects(()=>call('review',{id:a.id,ok:true}),/الموافقة الأولى/,'FM cannot give the first approval');
  await as('gm');assert.equal((await call('status')).inbox.length,1);a=await call('review',{id:a.id,ok:true});assert.equal(a.status,'first_ok');
  await as('sa');await assert.rejects(()=>call('review',{id:a.id,ok:true}),/التانية/,'second step is the FM only');
  await as('cashier');await assert.rejects(()=>call('pay',{id:a.id}),/مستني الموافقة/);
  await as('fm');a=await call('review',{id:a.id,ok:true});assert.equal(a.status,'approved');
  // another cashier cannot pay it, not even with a direct post on his own shift
  await as('other');await assert.rejects(()=>call('pay',{id:a.id}),/مش موجود/);
  await assert.rejects(()=>q("select clinic_finance.post('drawer_payout',$1,'x',$2,'1142','1111',400)",[a.id,S2]),/للاستلام فقط/,'not the requester shift');
  await as('cashier');await assert.rejects(()=>q("select clinic_finance.post('drawer_payout',$1,'x',$2,'1142','1111',300)",[a.id,S1]),/للاستلام فقط/,'not the approved amount');
  a=await call('pay',{id:a.id});assert.equal(a.status,'paid');
  const ln=(await q("select l.account,l.debit,l.credit from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id where e.source='drawer_payout' and e.source_id=$1 order by l.debit desc",[a.id])).rows;
  assert.deepEqual(ln.map(x=>[x.account,+x.debit,+x.credit]),[['1142',400,0],['1131',0,400]],'Dr 1142 / Cr the drawer account');
  assert.equal(+(await one("select clinic_finance.employee_advance('EMP-7') v")).v,400,'employee advance balance counts it');
  assert.equal((await call('pay',{id:a.id})).status,'paid','paying twice is a no-op');
  assert.equal((await q("select 1 from clinic_finance.entries where source='drawer_payout'")).rows.length,1);
  await assert.rejects(()=>q("select clinic_finance.post('drawer_payout',$1,'x',$2,'1142','1111',400)",[a.id,S1]),/للاستلام فقط/,'a paid request opens nothing');
  // ---- incentive bigger than the drawer cash is refused at pay time
  let n=await call('request',{kind:'incentive',subject:'EMP-7',amount:'700',reason:'باقي نسبة الشهر',token:randomUUID()});
  await as('sa');n=await call('review',{id:n.id,ok:true});await as('fm');n=await call('review',{id:n.id,ok:true});
  await as('cashier');await assert.rejects(()=>call('pay',{id:n.id}),/أقل من المبلغ/);
  await q("select clinic_finance.post('payment',gen_random_uuid(),'تحصيل',$1,'1111','4110',200)",[S1]);
  n=await call('pay',{id:n.id});assert.equal(n.status,'paid');
  assert.equal((await one("select l.account from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id where e.source_id=$1 and l.debit>0",[n.id])).account,'5212');
  // ---- rejection needs a reason; cancel by the requester
  let x=await call('request',{kind:'incentive',subject:'EMP-7',amount:'50',reason:'حافز',token:randomUUID()});
  await as('gm');await assert.rejects(()=>call('review',{id:x.id,ok:false}),/سبب الرفض/);x=await call('review',{id:x.id,ok:false,note:'مش متفق عليه'});assert.equal(x.status,'rejected');
  await as('cashier');let c=await call('request',{kind:'incentive',subject:'EMP-7',amount:'50',reason:'حافز',token:randomUUID()});assert.equal((await call('cancel',{id:c.id})).status,'cancelled');
  // ---- supplier: invoice photo required, accountant approves only while the supplier balance covers it
  await assert.rejects(()=>call('request',{kind:'supplier',supplier_id:SUP,amount:'150',reason:'أدوية',evidence:'',token:randomUUID()}),/فاتورة المورد/);
  const ev=P.cashier[1]+'/inv.jpg';await q("insert into storage.objects(bucket_id,name) values('shift-expense-receipts',$1)",[ev]);
  let s=await call('request',{kind:'supplier',supplier_id:SUP,amount:'150',reason:'أدوية من الصيدلية',evidence:ev,token:randomUUID()});
  await as('gm');await assert.rejects(()=>call('review',{id:s.id,ok:true}),/للمحاسب أو المدير المالي/);
  await as('acc');await assert.rejects(()=>call('review',{id:s.id,ok:true}),/سجّل فاتورة المورد/);
  await q("insert into clinic_finance.supplier_events values($1,150)",[SUP]);s=await call('review',{id:s.id,ok:true});assert.equal(s.status,'approved');
  await as('cashier');await q("select clinic_finance.post('payment',gen_random_uuid(),'تحصيل',$1,'1111','4110',300)",[S1]);s=await call('pay',{id:s.id});assert.equal(s.status,'paid');
  assert.equal(+(await one("select clinic_finance.supplier_balance($1) v",[SUP])).v,0,'supplier balance settled');
  assert.equal((await one("select l.account from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id where e.source_id=$1 and l.debit>0",[s.id])).account,'2111');
  // ---- finance list; any other payout from the collection register is still refused
  await as('acc');assert.equal((await call('list',{})).items.length,5);
  await as('cashier');await assert.rejects(()=>call('list',{}),/no access/);
  await assert.rejects(()=>q("select clinic_finance.post('expense',gen_random_uuid(),'x',$1,'5216','1111',1)",[S1]),/للاستلام فقط/);
  // ---- rollback restores both guards and keeps the history
  await db.exec('reset role');await db.exec(fs.readFileSync(R,'utf8'));
  assert.equal((await q("select 1 from pg_proc where proname='clinic_finance_drawer_request'")).rows.length,0);
  assert.equal((await one("select count(*)::int n from clinic_finance.drawer_requests_rolled_back")).n,5,'history kept');
  assert.doesNotMatch((await one("select pg_get_functiondef('clinic_finance.post(text,uuid,text,uuid,text,text,numeric)'::regprocedure) d")).d,/drawer_payout/);
  console.log('PASS drawer payout requests SQL: two-step approval (GM/SA → FM, different people), supplier by accountant with balance check, pay only by the requester from his own open shift for the exact amount, cash limit, idempotent token/pay, narrow guard exception, rollback');
 }catch(e){console.error(e.message,e.where||'');process.exitCode=1;}
})();
