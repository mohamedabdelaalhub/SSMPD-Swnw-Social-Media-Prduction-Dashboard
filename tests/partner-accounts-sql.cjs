// «حساب الشريك» (20261126120000): partner deposits / withdrawals on the MAIN treasury, requested by FM / accountant, approved by
// another person, posted Dr cash|bank / Cr 331x (deposit) or the reverse; running statement; add partner by super admin; rollback.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite'),{randomUUID}=require('crypto');
(async()=>{const db=new PGlite(),id=()=>randomUUID(),q=(s,p)=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0];
 const M='supabase/migrations/20261126120000_partner_accounts.sql',R='supabase/rollbacks/20261126120000_partner_accounts.rollback.sql';
 const P={acc:[id(),id(),'accountant'],fm:[id(),id(),'financial_manager'],gm:[id(),id(),'general_manager'],sa:[id(),id(),'super_admin'],rec:[id(),id(),'reception']};
 const RM=id(),SM=id();
 try{await db.exec(`create role authenticated;create role anon;create schema auth;create schema clinic_finance;
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
  create table clinic_finance.entries(id uuid primary key default gen_random_uuid(),source text,source_id uuid,description text,shift_id uuid,created_at timestamptz default clock_timestamp());
  create table clinic_finance.lines(entry_id uuid,account text,debit numeric default 0,credit numeric default 0);
  create function clinic_finance.cash_limit(p uuid) returns numeric language sql stable as $$select coalesce(sum(l.debit-l.credit),0) from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id where e.shift_id=p and l.account='1111'$$;
  create function clinic_finance.post(p_source text,p_source_id uuid,p_description text,p_shift uuid,p_debit text,p_credit text,p_amount numeric) returns uuid language plpgsql security definer as $f$declare v uuid;begin
   if (p_debit='1111' or p_credit='1111') and p_shift is null then raise exception 'cash needs a shift';end if;
   if p_credit='1111' and p_amount>clinic_finance.cash_limit(p_shift) then raise exception 'الكاش المتاح لا يكفي للصرف';end if;
   insert into clinic_finance.entries(source,source_id,description,shift_id) values(p_source,p_source_id,p_description,p_shift) returning id into v;
   insert into clinic_finance.lines values(v,p_debit,p_amount,0),(v,p_credit,0,p_amount);return v;end$f$;`);
  for(const [k,[a,u,r]] of Object.entries(P))await q("insert into admins values($1,$2,$3,$4)",[a,u,k,r]);
  await q("insert into clinic_finance.registers values($1,'main')",[RM]);await q("insert into clinic_finance.shifts(id,register_id) values($1,$2)",[SM,RM]);
  await db.exec(fs.readFileSync(M,'utf8'));await assert.rejects(()=>db.exec(fs.readFileSync(M,'utf8')),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  const as=k=>db.exec(`select set_config('request.jwt.claim.sub','${P[k][1]}',false)`);const call=(a,p)=>one("select clinic_finance_partner($1,$2) r",[a,p||{}]).then(x=>x.r);
  await as('rec');await assert.rejects(()=>call('status'),/للحسابات والإدارة/);
  await as('acc');let st=await call('status');assert.deepEqual(st.partners.map(x=>[x.name,x.account,+x.balance]),[['د. دينا حسني','3311',0],['م. محمد','3312',0]]);assert.equal(st.can_review,false);
  const dina=st.partners[0].id,mo=st.partners[1].id;
  // deposit 27,000 cash from Dina → approved by FM
  let m=await call('request',{partner_id:dina,kind:'deposit',amount:'27000',method:'cash',reason:'توريد لدفع إيجار المركز',token:id()});assert.equal(m.status,'pending');assert.equal(m.shift_id,SM);
  await assert.rejects(()=>call('review',{id:m.id,ok:true}),/الاعتماد للمدير المالي/);
  await as('fm');m=await call('review',{id:m.id,ok:true});assert.equal(m.status,'approved');
  let ln=(await q("select account,debit,credit from clinic_finance.lines where entry_id=$1 order by debit desc",[m.entry_id])).rows;assert.deepEqual(ln.map(x=>[x.account,+x.debit,+x.credit]),[['1111',27000,0],['3311',0,27000]]);
  // withdrawal 4,525 to Dina by bank, asked by FM → FM cannot approve own → GM approves
  m=await call('request',{partner_id:dina,kind:'withdrawal',amount:'4525',method:'bank',reason:'صرف للشريك',token:id()});
  await assert.rejects(()=>call('review',{id:m.id,ok:true}),/انت عامله/);
  await as('gm');await assert.rejects(()=>call('request',{partner_id:dina,kind:'withdrawal',amount:'1',method:'bank',reason:'xxx',token:id()}),/للمدير المالي أو المحاسب/);
  m=await call('review',{id:m.id,ok:true});ln=(await q("select account,debit,credit from clinic_finance.lines where entry_id=$1 order by debit desc",[m.entry_id])).rows;
  assert.deepEqual(ln.map(x=>[x.account,+x.debit,+x.credit]),[['3311',4525,0],['1112',0,4525]]);
  // cash withdrawal bigger than the main cash is refused at approval; rejection needs a reason
  await as('acc');m=await call('request',{partner_id:mo,kind:'withdrawal',amount:'50000',method:'cash',reason:'صرف للشريك',token:id()});
  await as('sa');await assert.rejects(()=>call('review',{id:m.id,ok:true}),/لا يكفي/);await assert.rejects(()=>call('review',{id:m.id,ok:false}),/سبب الرفض/);
  m=await call('review',{id:m.id,ok:false,note:'الكاش مش كفاية'});assert.equal(m.status,'rejected');
  // statement with running balance
  st=await call('statement',{partner_id:dina});assert.equal(+st.balance,22475);assert.deepEqual(st.lines.map(x=>+x.balance),[27000,22475]);
  assert.equal(+(await call('status')).partners[0].balance,22475);
  // add partner: super admin only, next account 3313
  const np=await call('add_partner',{name:'شريك جديد'});assert.equal(np.account,'3313');await assert.rejects(()=>call('add_partner',{name:'شريك جديد'}),/موجود/);
  await as('fm');await assert.rejects(()=>call('add_partner',{name:'تاني'}),/للسوبر أدمن/);
  await db.exec(fs.readFileSync(R,'utf8'));assert.equal((await q("select 1 from pg_proc where proname='clinic_finance_partner'")).rows.length,0);
  assert.equal((await one("select count(*)::int n from clinic_finance.partner_moves_rolled_back")).n,3);
  console.log('PASS partner accounts SQL: deposit/withdrawal cash+bank, maker-checker, cash limit at approval, reject reason, running statement, add partner (SA), rollback');
 }catch(e){console.error(e.message,e.where||'');process.exitCode=1;}
})();
