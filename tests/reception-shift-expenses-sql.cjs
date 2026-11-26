// «مصروفات الوردية» (owner 2026-11-20): reception spends small items from its own open shift — limits, receipt, posting,
// cash_line_guard exception only for source 'shift_expense', finance post-review, rollback.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite'),{randomUUID}=require('crypto');
(async()=>{const db=new PGlite(),id=()=>randomUUID(),q=(s,p)=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0];
 const U1=id(),A1=id(),U2=id(),A2=id(),RM=id(),RR=id(),S1=id();
 const M='supabase/migrations/'+fs.readdirSync('supabase/migrations').find(x=>x.includes('_reception_shift_expenses.sql'));
 const R='supabase/rollbacks/'+fs.readdirSync('supabase/rollbacks').find(x=>x.includes('_reception_shift_expenses.'));
 const tr=fs.readFileSync('supabase/migrations/20261018205000_accountant_chart_treasury.sql','utf8');
 const guard=tr.slice(tr.indexOf('create function clinic_finance.cash_line_guard()'),tr.indexOf('create trigger treasury_cash_line'));
 try{await db.exec(`create role authenticated;create role anon;create schema auth;create schema clinic_finance;create schema storage;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table admins(id uuid primary key,user_id uuid,name text,reviewer boolean default false);
  create function my_admin_id() returns uuid language sql stable security definer as $$select id from admins where user_id=auth.uid()$$;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
  create function storage.foldername(n text) returns text[] language sql as $$select string_to_array(n,'/')$$;
  create function clinic_finance.allowed(a text) returns boolean language sql stable security definer as $$select my_admin_id() is not null and (a<>'review' or (select reviewer from admins where id=my_admin_id()))$$;
  create function clinic_finance.lock_day() returns void language sql as $$select$$;
  create table clinic_finance.audit(id bigserial,actor uuid,action text,entity_id uuid,detail jsonb);
  create table clinic_finance.account_config(code text primary key,active boolean default true,archived boolean default false,is_postable boolean default true);
  create table clinic_finance.cash_accounts(code text primary key);insert into clinic_finance.cash_accounts values('1111'),('1131');
  create function clinic_finance.is_cash_account(c text) returns boolean language sql stable as $$select exists(select 1 from clinic_finance.cash_accounts where code=c)$$;
  create table clinic_finance.registers(id uuid primary key,name text,treasury_kind text,account_code text);
  create table clinic_finance.shifts(id uuid primary key,register_id uuid,cashier_id uuid,status text default 'open',opened_at timestamptz default now(),opening_book numeric default 0);
  create table clinic_finance.requests(id uuid primary key default gen_random_uuid(),kind text not null,shift_id uuid,payment_id uuid,invoice_id uuid,amount numeric(14,2) not null check(amount>0),reason text not null check(length(trim(reason)) between 3 and 1000),evidence text not null check(length(trim(evidence)) between 2 and 200),payload jsonb not null,created_by uuid not null,token uuid not null,created_at timestamptz not null default now(),status text not null default 'pending',reviewed_by uuid,reviewed_at timestamptz,review_note text,unique(created_by,token));
  create table clinic_finance.entries(id uuid primary key default gen_random_uuid(),source text,source_id uuid,description text,shift_id uuid,created_by uuid);
  create table clinic_finance.lines(id uuid primary key default gen_random_uuid(),entry_id uuid,account text,debit numeric default 0,credit numeric default 0);
  create function clinic_finance.register_direction(p_shift uuid,p_direction text) returns void language plpgsql as $$begin end$$;
  create function clinic_finance.post(p_source text,p_source_id uuid,p_description text,p_shift uuid,p_debit text,p_credit text,p_amount numeric) returns uuid language plpgsql security definer as $$declare v_id uuid;begin
   if p_shift is not null then
   if p_credit='1111' and p_source<>'deposit' and not (p_source='doctor_payment' and false) then perform clinic_finance.register_direction(p_shift,'pay');end if;end if;
   insert into clinic_finance.entries(source,source_id,description,shift_id,created_by) values(p_source,p_source_id,p_description,p_shift,my_admin_id()) returning id into v_id;
   insert into clinic_finance.lines(entry_id,account,debit,credit) values(v_id,p_debit,p_amount,0),(v_id,p_credit,0,p_amount);return v_id;end $$;
  create function clinic_finance.shift_cash(p uuid) returns numeric language sql stable as $$select s.opening_book+coalesce((select sum(l.debit-l.credit) from clinic_finance.entries e join clinic_finance.lines l on l.entry_id=e.id where e.shift_id=s.id and clinic_finance.is_cash_account(l.account)),0) from clinic_finance.shifts s where s.id=p$$;`);
  await db.exec(guard+';create trigger treasury_cash_line before insert on clinic_finance.lines for each row execute function clinic_finance.cash_line_guard();');
  await q("insert into admins values($1,$2,'دينا',false),($3,$4,'محاسب',true)",[A1,U1,A2,U2]);
  await q("insert into clinic_finance.registers values($1,'الخزينة الرئيسية','main','1111'),($2,'خزينة الاستقبال','collection','1131')",[RM,RR]);
  await q("insert into clinic_finance.shifts(id,register_id,cashier_id,opening_book) values($1,$2,$3,0)",[S1,RR,A1]);
  const as=u=>db.exec(`select set_config('request.jwt.claim.sub','${u}',false)`);await as(U1);
  // collections put 1,000 in the drawer
  await q("select clinic_finance.post('payment',gen_random_uuid(),'تحصيل',$1,'1111','4110',1000)",[S1]);
  // before the migration a collection register cannot pay
  await assert.rejects(()=>q("select clinic_finance.post('shift_expense',gen_random_uuid(),'x',$1,'5216','1111',10)",[S1]),/الصرف من الخزينة الرئيسية فقط/);
  await db.exec(fs.readFileSync(M,'utf8'));await assert.rejects(()=>db.exec(fs.readFileSync(M,'utf8')),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  const call=(a,p)=>one("select clinic_finance_shift_expense($1,$2) r",[a,p]).then(x=>x.r);
  let st=await call('status',{});assert.equal(st.open,true);assert.equal(+st.allowance,500);assert.equal(+st.max,300);assert.equal(+st.cash,1000);assert.equal(st.items.length,9);
  const rec=U1+'/r1.jpg';await q("insert into storage.objects(bucket_id,name) values('shift-expense-receipts',$1)",[rec]);
  const spend=(extra)=>call('spend',{shift_id:S1,item:'cleaning',amount:'120',reason:'مناديل وصابون',vendor:'سوبر ماركت',receipt_path:rec,token:randomUUID(),...extra});
  let r=await spend({});assert.equal(+r.left,380);
  const req=await one("select * from clinic_finance.requests where id=$1",[r.id]);
  assert.equal(req.status,'approved');assert.equal(req.payload.source,'shift_allowance');assert.equal(req.post_review,'pending');assert.equal(req.evidence,rec);
  const ln=(await q("select l.account,l.debit,l.credit from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id where e.source='shift_expense' and e.source_id=$1 order by l.debit desc",[r.id])).rows;
  assert.deepEqual(ln.map(x=>[x.account,+x.debit,+x.credit]),[['5216',120,0],['1131',0,120]],'Dr 5216 / Cr the drawer account');
  assert.equal(+(await call('status',{})).cash,880);
  // electricity → 5219; same token → same answer
  const tok=randomUUID();r=await spend({item:'electricity',amount:'100',token:tok});const again=await spend({item:'electricity',amount:'100',token:tok});assert.equal(again.id,r.id);assert.equal(again.duplicate,true);
  assert.equal((await one("select l.account from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id where e.source_id=$1 and l.debit>0",[r.id])).account,'5219');
  // limits
  await assert.rejects(()=>spend({amount:'301'}),/حد المصروف الواحد \(300/);
  await spend({amount:'280'});
  await assert.rejects(()=>spend({amount:'10'}),/الباقي من مصروفات الوردية \(0/);
  // receipt, reason, item, shift ownership
  await q("update clinic_finance.registers set shift_expense_allowance=2000 where id=$1",[RR]);
  await assert.rejects(()=>spend({receipt_path:''}),/صوّر الإيصال/);
  await assert.rejects(()=>spend({receipt_path:U2+'/x.jpg'}),/صوّر الإيصال/);
  await assert.rejects(()=>spend({receipt_path:U1+'/missing.jpg'}),/صوّر الإيصال/);
  await assert.rejects(()=>spend({reason:'x'}),/السبب/);
  await assert.rejects(()=>spend({item:'rent'}),/البند/);
  // cash: the drawer has 500 left (1000 − 120 − 100 − 280); allowance/max raised → over cash refused
  await q("update clinic_finance.registers set shift_expense_max=1000 where id=$1",[RR]);
  await assert.rejects(()=>spend({amount:'501'}),/النقدية اللي في الوردية \(500/);
  // other sources still cannot pay from the drawer
  await assert.rejects(()=>q("select clinic_finance.post('expense',gen_random_uuid(),'x',$1,'5216','1111',10)",[S1]),/الصرف من الخزينة الرئيسية فقط/);
  // someone else's shift
  await as(U2);await assert.rejects(()=>call('spend',{shift_id:S1,item:'cleaning',amount:'10',reason:'مناديل',receipt_path:rec}),/ورديتك المفتوحة/);
  // finance list + review (not the spender; rejection needs a note)
  let L=await call('list',{});assert.equal(L.expenses.length,3);assert.equal(L.can_review,true);assert.ok(L.registers.find(x=>x.name==='خزينة الاستقبال'));
  await assert.rejects(()=>call('review',{id:L.expenses[0].id,ok:false}),/سبب الرفض/);
  await call('review',{id:L.expenses[0].id,ok:false,note:'مفيش فاتورة واضحة'});await call('review',{id:L.expenses[1].id,ok:true});
  L=await call('list',{});assert.deepEqual(L.expenses.map(x=>x.post_review).sort(),['ok','pending','rejected']);
  await as(U1);await assert.rejects(()=>call('review',{id:L.expenses[2].id,ok:true}),/للحسابات بس/);
  // limits setting: reviewers only
  await assert.rejects(()=>call('set_limits',{register_id:RR,allowance:600,max:200}),/للحسابات بس/);
  await as(U2);await call('set_limits',{register_id:RR,allowance:600,max:200});assert.equal(+(await one("select shift_expense_allowance a from clinic_finance.registers where id=$1",[RR])).a,600);
  // rollback restores the guard
  await db.exec(fs.readFileSync(R,'utf8'));
  assert.ok(!(await one("select pg_get_functiondef('clinic_finance.cash_line_guard()'::regprocedure) d")).d.includes('shift_expense'));
  await db.exec(fs.readFileSync(M,'utf8'));
  // 20261126010000: صيانة / تليفونات (receipt required) + إكراميات (no receipt, reason ≥ 5) — as the cashier
  const M2='supabase/migrations/20261126010000_shift_expense_more_items.sql',R2='supabase/rollbacks/20261126010000_shift_expense_more_items.rollback.sql';
  await q("update clinic_finance.registers set shift_expense_allowance=2000,shift_expense_max=300 where id=$1",[RR]);
  // live: collection registers are 'receive' only — before 20261126010000 every shift expense was refused by post()'s direction check
  await db.exec(`create or replace function clinic_finance.register_direction(p_shift uuid,p_direction text) returns void language plpgsql as $f$begin
    if p_direction='pay' and exists(select 1 from clinic_finance.shifts s join clinic_finance.registers r on r.id=s.register_id where s.id=p_shift and r.treasury_kind='collection') then raise exception 'الخزينة للاستلام فقط ولا تسمح بالصرف';end if;end $f$`);
  await as(U1);await assert.rejects(()=>spend({item:'cleaning',amount:'10',reason:'مناديل للاستقبال'}),/للاستلام فقط/,'the live bug is reproduced before the fix');
  await db.exec(fs.readFileSync(M2,'utf8'));await assert.rejects(()=>db.exec(fs.readFileSync(M2,'utf8')),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  await as(U1);st=await call('status',{});assert.equal(st.items.length,12);
  assert.deepEqual(st.items.filter(x=>['maintenance','phones','tips'].includes(x.key)).map(x=>[x.key,x.account,!!x.no_receipt]),[['maintenance','5224',false],['phones','5224',false],['tips','5216',true]]);
  await assert.rejects(()=>spend({item:'maintenance',receipt_path:''}),/صوّر الإيصال/);
  r=await spend({item:'maintenance',amount:'60',reason:'تصليح حنفية الحمام'});
  assert.equal((await one("select l.account from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id where e.source_id=$1 and l.debit>0",[r.id])).account,'5224');
  await assert.rejects(()=>spend({item:'tips',amount:'20',reason:'عامل',receipt_path:''}),/سبب الإكرامية/);
  await assert.rejects(()=>spend({item:'tips',amount:'20',reason:'عامل النظافة — توصيل مياه'}),/من غير إيصال/,'a receipt is refused for tips');
  r=await spend({item:'tips',amount:'20',reason:'عامل توصيل المياه',receipt_path:''});
  const tip=await one("select * from clinic_finance.requests where id=$1",[r.id]);assert.equal(tip.evidence,'no-receipt');assert.equal(tip.payload.item,'tips');assert.equal(tip.post_review,'pending');
  assert.equal((await one("select l.account from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id where e.source_id=$1 and l.debit>0",[r.id])).account,'5216');
  assert.match((await one("select pg_get_functiondef('clinic_finance.post(text,uuid,text,uuid,text,text,numeric)'::regprocedure) d")).d,/p_source<>'shift_expense'/);
  await db.exec(fs.readFileSync(R2,'utf8'));st=await call('status',{});assert.equal(st.items.length,9,'rollback restores the item list');
  await assert.rejects(()=>spend({item:'tips',amount:'20',reason:'عامل توصيل المياه',receipt_path:''}),/البند/);
  console.log('PASS reception shift expenses');
 }catch(e){console.error('FAIL',e);process.exit(1);}})();
