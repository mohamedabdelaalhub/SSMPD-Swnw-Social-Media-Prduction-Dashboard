// Owner 2026-11-21: Masa payouts copied with their expense account; net = income - payouts, finance only.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite'),{randomUUID}=require('crypto');
(async()=>{const db=new PGlite(),q=(s,p)=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0],id=()=>randomUUID();
 const fin=id(),rec=id();const as=async u=>db.exec(`select set_config('test.user','${u}',false)`);
 await db.exec(`create role authenticated;create role anon;create role service_role;create schema clinic_finance;create schema clinic_reception;
  create table admins(id uuid primary key,name text,role text,active boolean default true);
  create function my_admin_id() returns uuid language sql stable as $$select nullif(current_setting('test.user',true),'')::uuid$$;
  create function clinic_finance.allowed(a text) returns boolean language sql stable as $$select exists(select 1 from admins where id=my_admin_id() and role='accountant')$$;
  create table clinic_reception.providers(id uuid primary key,name text);
  create table clinic_reception.masa_doctor_links(masa_doctor_id int primary key,provider_id uuid,masa_name text);
  create table clinic_reception.masa_bookings(official_booking_id text primary key,masa_doctor_id int,patient_name text,phone text);
  create function clinic_reception_fallback_api(p_op text,p_payload jsonb) returns jsonb language sql as $$select jsonb_build_object('ok',true,'op',p_op)$$;`);
 await q("insert into admins values($1,'محاسب','accountant'),($2,'استقبال','reception')",[fin,rec]);
 const P=fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(x=>x.includes('_masa_payments.sql')),'utf8');
 await db.exec(P);
 const api=(op,p)=>one("select clinic_reception_fallback_api($1,$2) r",[op,p]).then(x=>x.r);
 await api('masa_payments_import',{date:'2026-11-19',payment_types:[{id:147,name:'نقدي',is_cash:true}],invoices:[],receipts:[
  {masa_receipt_id:'1',paid_at:'2026-11-19T10:00:00',lines:[{payment_type_id:147,amount:1000}]},
  {masa_receipt_id:'old:2',paid_at:'2025-01-05T10:00:00',lines:[{payment_type_id:147,amount:400}]}]});
 const M=fs.readFileSync('supabase/migrations/20261120320000_masa_payouts_net.sql','utf8');
 await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 assert.equal((await api('health',{})).op,'health','other ops pass through');
 const acc=(n,d,c)=>({account_code:'1',account_name:n,debit:d,credit:c});
 const day={date:'2026-11-19',source:'masa',payouts:[
  {masa_payout_id:'50',paid_at:'2026-11-19T11:00:00',total:0,lines:[{payment_type_id:147,amount:300,safe_id:119}],accounts:[acc('ايجار المركز',300,0),acc('الخزينه الرئيسيه',0,300)]},
  {masa_payout_id:'51',paid_at:'2026-11-19T12:00:00',total:100,lines:[{amount:100}],accounts:[acc('جارى شريك (د/ دينا)',100,0)]},
  {masa_payout_id:'52',paid_at:'2026-11-19T13:00:00',total:50,lines:[{amount:50}],accounts:[acc('خزينه user1',50,0)]},
  {masa_payout_id:'53',paid_at:'2026-11-19T14:00:00',total:70,lines:[{amount:70}],accounts:[]},
  {masa_payout_id:'54',paid_at:'2026-11-19T15:00:00',total:999,is_deleted:true,lines:[{amount:999}],accounts:[acc('ايجار المركز',999,0)]},
  {masa_payout_id:''}]};
 assert.deepEqual(await api('masa_payouts_import',day),{ok:true,payouts_upserted:5,skipped:1});
 assert.deepEqual(await api('masa_payouts_import',day),{ok:true,payouts_upserted:5,skipped:1},'idempotent');
 assert.equal((await one("select count(*)::int n from clinic_finance.masa_payout_accounts where masa_payout_id='50'")).n,2,'accounts replaced as a set');
 assert.equal(Number((await one("select total from clinic_finance.masa_payouts where masa_payout_id='50'")).total),300,'total from the lines when 0');
 await api('masa_payouts_import',{date:'2025-01-05',source:'old',payouts:[{masa_payout_id:'old:9',paid_at:'2025-01-05T09:00:00',total:80,lines:[{amount:80}],accounts:[acc('مصاريف مركز',80,0)]}]});
 assert.equal((await one("select source from clinic_finance.masa_payouts where masa_payout_id='old:9'")).source,'old');
 assert.equal((await api('masa_payouts_import',{})).error,'date_required');
 assert.equal((await api('masa_payouts_import',{date:'2026-11-19'})).error,'payouts_required');
 await as(rec);await assert.rejects(()=>q("select clinic_finance_masa_net('report','{}')"),/للمالية بس/);
 await as(fin);
 let r=(await one("select clinic_finance_masa_net('report',$1) r",[{from:'2026-11-19',to:'2026-11-19'}])).r;
 const T=r.totals;
 assert.equal(Number(T.income),1000);assert.equal(Number(T.operating),300,'rent only; the payout without an account is unclassified');assert.equal(Number(T.partner_draw),100);assert.equal(Number(T.transfer),50);
 assert.equal(Number(T.unclassified),70);assert.equal(Number(T.net_cash),1000-300-70-100,'transfers excluded, voided ignored');assert.equal(Number(T.net_operating),1000-300-70);
 assert.equal(r.by_period.length,1);assert.equal(r.by_period[0].period,'2026-11');
 r=(await one("select clinic_finance_masa_net('report',$1) r",[{from:'2025-01-01',to:'2026-11-30'}])).r;
 assert.equal(Number(r.totals.income),1400,'old + current income');assert.equal(Number(r.totals.operating),300+80);assert.equal(r.by_period.map(x=>x.period).join(),'2025-01,2026-11');
 await one("select clinic_finance_masa_net('classify',$1)",[{account_name:'خزينه user1',kind:'operating',category:'ايراد'}]);
 r=(await one("select clinic_finance_masa_net('report',$1) r",[{from:'2026-11-19',to:'2026-11-19'}])).r;
 assert.equal(Number(r.totals.transfer),0,'classification overrides the default');assert.equal(Number(r.totals.operating),350);
 await as(rec);await assert.rejects(()=>q("select clinic_finance_masa_net('classify',$1)",[{account_name:'x',kind:'ignore'}]),/للمالية بس/);
 await assert.rejects(()=>db.exec("set role authenticated;select * from clinic_finance.masa_payouts"),/permission denied/);
 console.log('masa payouts net ok');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
