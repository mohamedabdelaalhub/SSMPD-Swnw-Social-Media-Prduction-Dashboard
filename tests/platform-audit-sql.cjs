// Booking platforms (20261126180000 on top of 20261126110000): 25% of the كشف / استشارة only (متابعة and «فيزيتا شامل» = 0),
// كفارة وسلامتك as a 4th platform, period audit ours / theirs / agreed with maker-checker posting Dr 5233 Cr 2112 + the deduction to
// 4122 / a payable / another account (FM only), overlap and changed-number refusals, settlement from the audited balance (Dr 2112),
// the non-platform paths untouched, and the rollback. PGlite with small fixtures.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite'),{randomUUID}=require('crypto');
(async()=>{const db=new PGlite(),id=()=>randomUUID(),q=(s,p)=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0];
 const M0='supabase/migrations/20261126110000_month_end_accounts.sql',M='supabase/migrations/20261126180000_platform_audit.sql',R='supabase/rollbacks/20261126180000_platform_audit.rollback.sql';
 const ck=fs.readFileSync('supabase/migrations/20261124210000_auto_book_consult_only.sql','utf8').match(/create function clinic_reception\.consult_kind[\s\S]*?\n\$\$;/)[0];
 const P={rec:[id(),id(),'reception'],acc:[id(),id(),'accountant'],fm:[id(),id(),'financial_manager'],gm:[id(),id(),'general_manager'],sa:[id(),id(),'super_admin']};
 const W=id(),RM=id(),SM=id(),K=id(),S=id(),F=id(),G=id();
 try{await db.exec(`create role authenticated;create role anon;create schema auth;create schema clinic_finance;create schema clinic_reception;create schema clinic_labs;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table admins(id uuid primary key,user_id uuid,name text,role text);
  create function my_admin_id() returns uuid language sql stable security definer as $$select id from admins where user_id=auth.uid()$$;
  create function has_role(r text) returns boolean language sql stable security definer as $$select exists(select 1 from admins where user_id=auth.uid() and role=r)$$;
  create function clinic_finance.lock_day() returns void language sql as $$select$$;
  create table clinic_finance.audit(id bigserial,actor uuid,action text,entity_id uuid,detail jsonb);
  create table clinic_finance.accounts(code text primary key,name text,kind text);
  create table clinic_finance.account_config(code text primary key,is_system boolean default false,active boolean not null default true,archived boolean not null default false);
  insert into clinic_finance.accounts values('1111','الخزينة','asset'),('1112','البنك','asset'),('1115','المحافظ','asset'),('2111','مستحقات الموردين','liability'),('2120','مستحقات الأطباء','liability'),('4110','الإيرادات','income');
  create table clinic_finance.registers(id uuid primary key,treasury_kind text);
  create table clinic_finance.shifts(id uuid primary key,register_id uuid,status text default 'open',ended_at timestamptz,opened_at timestamptz default now());
  create table clinic_finance.entries(id uuid primary key default gen_random_uuid(),source text,source_id uuid,description text,shift_id uuid);
  create table clinic_finance.lines(entry_id uuid,account text,debit numeric default 0,credit numeric default 0);
  create function clinic_finance.post(p_source text,p_source_id uuid,p_description text,p_shift uuid,p_debit text,p_credit text,p_amount numeric) returns uuid language plpgsql security definer as $f$declare v uuid;begin
   if (p_debit='1111' or p_credit='1111') and p_shift is null then raise exception 'cash needs a shift';end if;
   if not exists(select 1 from clinic_finance.accounts where code=p_debit) or not exists(select 1 from clinic_finance.accounts where code=p_credit) then raise exception 'unknown account';end if;
   insert into clinic_finance.entries(source,source_id,description,shift_id) values(p_source,p_source_id,p_description,p_shift) returning id into v;
   insert into clinic_finance.lines values(v,p_debit,p_amount,0),(v,p_credit,0,p_amount);return v;end$f$;
  create table clinic_reception.workspaces(id uuid primary key,mode text);
  create table clinic_reception.services(id uuid primary key,workspace_id uuid,name text,pricing_service_id uuid);
  create table clinic_reception.appointments(id uuid primary key default gen_random_uuid(),workspace_id uuid,service_id uuid,starts_at timestamptz,source text,discount_kind text);
  create table clinic_reception.visits(id uuid primary key default gen_random_uuid(),workspace_id uuid,appointment_id uuid,visit_no bigint generated always as identity);
  create table clinic_reception.orders(id uuid primary key default gen_random_uuid(),workspace_id uuid,visit_id uuid,service_id uuid,status text,price numeric,quantity numeric default 1,discount numeric default 0,net_revenue numeric,completed_at timestamptz default now(),created_at timestamptz default now());
  create table clinic_labs.price_versions(id uuid primary key,lab_name text,version int,imported_at timestamptz default now());
  create table clinic_labs.price_items(id uuid primary key,version_id uuid,cost numeric);
  create table clinic_labs.item_links(item_id uuid,service_id uuid,status text);`+ck);
  for(const [k,[a,u,r]] of Object.entries(P))await q("insert into admins values($1,$2,$3,$4)",[a,u,k,r]);
  await q("insert into clinic_finance.registers values($1,'main')",[RM]);await q("insert into clinic_finance.shifts(id,register_id) values($1,$2)",[SM,RM]);
  await q("insert into clinic_reception.workspaces values($1,'live')",[W]);
  await q("insert into clinic_reception.services values($1,$5,'كشف جلدية',null),($2,$5,'استشارة باطنة',null),($3,$5,'متابعة جلدية',null),($4,$5,'جلسة ليزر',null)",[K,S,F,G,W]);
  const visit=async(src,svc,net,dk,extra)=>{const a=await one("insert into clinic_reception.appointments(workspace_id,service_id,starts_at,source,discount_kind) values($1,$2,now(),$3,$4) returning id",[W,svc,src,dk||null]);
    const v=await one("insert into clinic_reception.visits(workspace_id,appointment_id) values($1,$2) returning id",[W,a.id]);
    await q("insert into clinic_reception.orders(workspace_id,visit_id,service_id,status,price,net_revenue) values($1,$2,$3,'completed',$4,$4)",[W,v.id,svc,net]);
    if(extra)await q("insert into clinic_reception.orders(workspace_id,visit_id,service_id,status,price,net_revenue) values($1,$2,$3,'completed',$4,$4)",[W,v.id,G,extra]);};
  await visit('vezeeta',K,450,null,1000);   // counts: 450 (the laser session on the same visit does not)
  await visit('vezeeta',S,400);             // استشارة counts
  await visit('vezeeta',F,300);             // متابعة: excluded
  await visit('vezeeta',K,600,'vezeeta');   // «فيزيتا شامل»: nothing owed
  await visit('kafaret',K,400);             // كفارة وسلامتك: 25% of 400
  await visit('clinidu',K,200);
  await visit('akshef',K,100);
  await db.exec(fs.readFileSync(M0,'utf8'));await db.exec(fs.readFileSync(M,'utf8'));
  await assert.rejects(()=>db.exec(fs.readFileSync(M,'utf8')),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  const as=k=>db.exec(`select set_config('request.jwt.claim.sub','${P[k][1]}',false)`);const call=(a,p)=>one("select clinic_finance_month_end($1,$2) r",[a,p||{}]).then(x=>x.r);
  const party=(st,k)=>st.parties.find(x=>x.key===k);const month=new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Cairo'}).slice(0,7)+'-01';
  const lines=async sid=>(await q("select l.account,l.debit::float d,l.credit::float c from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id where e.source_id=$1 order by e.description,l.debit desc",[sid])).rows.map(x=>[x.account,x.d,x.c]);
  // statement: 4 platforms at 25%, كشف + استشارة only
  await as('acc');let st=await call('statement');
  assert.deepEqual(['vezeeta','clinidu','akshef','kafaret'].map(k=>+party(st,k).percent),[25,25,25,25]);
  assert.equal(+party(st,'vezeeta').accrued,212.5,'25% × (450 + 400) — not متابعة, not «فيزيتا شامل», not the laser');assert.equal(party(st,'vezeeta').count,2);
  assert.equal(+party(st,'kafaret').accrued,100);assert.equal(party(st,'kafaret').name,'كفارة وسلامتك');assert.equal(party(st,'vezeeta').platform,true);
  assert.equal(+party(st,'vezeeta').remaining,0,'nothing payable before an approved audit');assert.equal(st.can_audit,true);assert.equal(st.can_account_dest,false);
  await assert.rejects(()=>call('settle_request',{party:'vezeeta',amount:'10',method:'bank',reference:'سداد',token:id()}),/راجع الفترة الأول/);
  await as('rec');await assert.rejects(()=>call('audits'),/للحسابات والإدارة/);await assert.rejects(()=>call('platforms'),/للحسابات والإدارة/);
  // preview + request (accountant): ours 212.50, theirs 300, agreed 180 → deduction 32.50
  await as('acc');const pv=await call('audit_preview',{party:'vezeeta',from:month});assert.equal(+pv.ours,212.5);assert.equal(pv.cases,2);assert.equal(pv.overlap,false);
  const base={party:'vezeeta',from:month,to:month,theirs:'300',theirs_ref:'فاتورة فيزيتا 1125',agreed_mode:'amount',agreed_value:'180',reason:'كشفين اتلغوا ومتحسبين عندهم'};
  await assert.rejects(()=>call('audit_request',{...base,token:id()}),/يروح فين/);
  await assert.rejects(()=>call('audit_request',{...base,dest_kind:'account',dest_account:'4110',token:id()}),/للمدير المالي بس/);
  await assert.rejects(()=>call('audit_request',{...base,dest_kind:'payable',dest_account:'1111',token:id()}),/مينفعش يستقبل/);
  await assert.rejects(()=>call('audit_request',{...base,dest_kind:'payable',dest_account:'2112',token:id()}),/مينفعش يستقبل/);
  await assert.rejects(()=>call('audit_request',{...base,to:'2099-01-01',dest_kind:'income',token:id()}),/شهر أو شهرين|لسه مجتش/);
  const tok=id();let a1=await call('audit_request',{...base,dest_kind:'income',token:tok});assert.equal(a1.status,'pending');assert.equal(+a1.ours,212.5);assert.equal(+a1.agreed,180);assert.equal(a1.dest_account,'4122');
  assert.equal((await call('audit_request',{...base,dest_kind:'income',token:tok})).id,a1.id,'idempotent token');
  await assert.rejects(()=>call('audit_request',{...base,dest_kind:'income',token:id()}),/اتراجعت قبل كده/);
  await assert.rejects(()=>call('audit_review',{id:a1.id,ok:true}),/اعتماد المراجعة/);
  let au=await call('audits');assert.equal(au.audits[0].mine,true);assert.equal(+au.audits[0].deduction,32.5);assert.equal(au.other_accounts.length,0,'other accounts only for the FM');
  assert.ok(au.payable_accounts.some(x=>x.code==='2111')&&!au.payable_accounts.some(x=>x.code==='2112'));
  // FM approves → accrual 212.50 + deduction 32.50 to 4122
  await as('fm');let r=await call('audit_review',{id:a1.id,ok:true});assert.equal(r.status,'approved');assert.equal(r.entry_ids.length,2);
  assert.deepEqual((await lines(a1.id)).sort(),[['2112',0,212.5],['2112',32.5,0],['4122',0,32.5],['5233',212.5,0]].sort());
  let pl=(await call('platforms')).platforms.find(x=>x.party==='vezeeta');assert.deepEqual([+pl.audited,+pl.deducted,+pl.balance],[212.5,32.5,180]);
  // kafaret: FM asks agreed 110% of ours (100) → extra 10, no destination needed; FM cannot approve his own; GM approves
  a1=await call('audit_request',{party:'kafaret',from:month,theirs:'110',theirs_ref:'مطالبة كفارة',agreed_mode:'percent',agreed_value:'110',reason:'اتفاق على حالة زيادة',token:id()});
  assert.equal(+a1.agreed,110);assert.equal(a1.dest_kind,null);
  await assert.rejects(()=>call('audit_review',{id:a1.id,ok:true}),/انت عاملها/);
  await as('gm');await call('audit_review',{id:a1.id,ok:true});assert.deepEqual((await lines(a1.id)).sort(),[['2112',0,100],['2112',0,10],['5233',100,0],['5233',10,0]].sort());
  // clinidu: deduction to a payable (2111) asked by the accountant, approved by SA; FM may pick any non-asset account
  await as('fm');assert.ok((await call('audits')).other_accounts.some(x=>x.code==='4110'));
  await as('acc');a1=await call('audit_request',{party:'clinidu',from:month,theirs:'50',theirs_ref:'كلينيدو 11',agreed_mode:'amount',agreed_value:'40',reason:'خصم متفق عليه',dest_kind:'payable',dest_account:'2111',token:id()});
  await as('sa');await assert.rejects(()=>call('audit_review',{id:a1.id,ok:false}),/سبب الرفض/);await call('audit_review',{id:a1.id,ok:true});
  assert.deepEqual((await lines(a1.id)).sort(),[['2111',0,10],['2112',0,50],['2112',10,0],['5233',50,0]].sort());
  // akshef: our number changes after the request → approval refused; then rejected with a reason
  await as('acc');a1=await call('audit_request',{party:'akshef',from:month,theirs:'25',theirs_ref:'اكشف 11',agreed_mode:'percent',agreed_value:'100',reason:'زي ما هو',token:id()});
  await visit('akshef',K,100);await as('fm');await assert.rejects(()=>call('audit_review',{id:a1.id,ok:true}),/اتغيّر/);
  r=await call('audit_review',{id:a1.id,ok:false,note:'الرقم اتغير'});assert.equal(r.status,'rejected');assert.equal((await lines(a1.id)).length,0);
  // settlement from the audited balance: Dr 2112 / Cr 1111
  await as('acc');await assert.rejects(()=>call('settle_request',{party:'vezeeta',amount:'180.01',method:'cash',reference:'سداد فيزيتا',token:id()}),/أكبر من المستحق المعتمد/);
  let s=await call('settle_request',{party:'vezeeta',amount:'180',method:'cash',reference:'سداد فيزيتا',token:id()});assert.equal(s.shift_id,SM);
  assert.equal(+party(await call('statement'),'vezeeta').remaining,0,'pending is reserved');
  await assert.rejects(()=>call('settle_review',{id:s.id,ok:true}),/اعتماد السداد/);
  await as('fm');await call('settle_review',{id:s.id,ok:true});assert.deepEqual(await lines(s.id),[['2112',180,0],['1111',0,180]]);
  pl=(await call('platforms')).platforms;assert.deepEqual(pl.map(x=>[x.party,+x.balance]),[['vezeeta',0],['clinidu',40],['akshef',0],['kafaret',110]]);
  // non-platform paths still go to the previous function (lab cost path, dental item)
  await as('rec');await call('add_item',{party:'dental_lab',ref:'زيارة 9',description:'زيركون',amount:'300',token:id()});
  await as('acc');s=await call('settle_request',{party:'dental_lab',amount:'300',method:'bank',reference:'معمل الأسنان',token:id()});
  await as('gm');await call('settle_review',{id:s.id,ok:true});assert.deepEqual(await lines(s.id),[['5235',300,0],['1112',0,300]]);
  // rollback restores the previous function and lines (platform percents back to empty)
  await db.exec(fs.readFileSync(R,'utf8'));await as('acc');st=await call('statement');
  assert.equal(+party(st,'vezeeta').accrued,0);assert.equal(party(st,'vezeeta').platform,undefined);
  assert.equal((await one("select count(*)::int n from clinic_finance.platform_audits_rolled_back")).n,4,'history kept');
  assert.equal((await q("select 1 from pg_proc where proname='platform_balances'")).rows.length,0);
  console.log('PASS platform audit SQL: 25% of كشف/استشارة only (متابعة, «فيزيتا شامل» and other services excluded), كفارة وسلامتك, ours/theirs/agreed (amount or %), deduction → 4122 / payable / FM-only account, extra → 5233, overlap + changed-number + self-approval refusals, settlement Dr 2112 from the audited balance, other parties unchanged, rollback');
 }catch(e){console.error(e.message,e.where||'');process.exitCode=1;}
})();
