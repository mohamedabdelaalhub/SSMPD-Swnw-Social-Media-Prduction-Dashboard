// Company & branches legal data (تاب بيانات الشركة والفروع): super admin only (owner decision), RLS on every table,
// no anon, private storage bucket with super-admin-only read/upload/delete, audit by trigger, file of a document is
// immutable, branch path must match its branch, IBAN/SWIFT format, bank linked to the finance ledger bank account.
// PGlite with small stand-ins for the live helpers (same names and signatures).
const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite(),id=n=>'71000000-0000-4000-8000-'+String(n).padStart(12,'0');
await db.exec(`create role anon;create role authenticated;grant usage on schema public to authenticated,anon;
create table admins(id uuid primary key,name text,role text,active boolean default true);
create function my_admin_id() returns uuid language sql stable as $$select a.id from admins a where a.id=nullif(current_setting('test.admin',true),'')::uuid and a.active$$;
create function has_role(r text) returns boolean language sql stable as $$select exists(select 1 from admins where id=nullif(current_setting('test.admin',true),'')::uuid and role=r and active)$$;
create table inventory_branches(id uuid primary key default gen_random_uuid(),name text not null unique,active boolean not null default true,created_at timestamptz not null default now());
insert into inventory_branches(id,name) values('00000000-0000-4000-8000-000000000002','الفرع الحالي');
create schema clinic_finance;create table clinic_finance.accounts(code text primary key,name text not null,kind text not null);
insert into clinic_finance.accounts values('1111','الخزينة','asset'),('1112','البنك','asset'),('111201','بنك مصر','asset');
create schema storage;grant usage on schema storage to authenticated;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text);
alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;
create policy other_bucket on storage.objects for select to authenticated using(bucket_id='public-stuff');`);
for(const [n,role,active] of [[1,'super_admin',true],[2,'general_manager',true],[3,'financial_manager',true],[4,'reception',true],[5,'super_admin',false]])
 await db.query('insert into admins(id,name,role,active) values($1,$2,$3,$4)',[id(n),role,role,active]);
const sql=fs.readFileSync('supabase/migrations/20261117010000_org_legal_profile.sql','utf8');
await db.exec(sql);await db.exec(sql); // re-runnable
const as=async n=>{await db.exec('reset role');await db.query("select set_config('test.admin',$1,false)",[n?id(n):'']);await db.exec('set role authenticated');};
const q=async(s,a=[])=>(await db.query(s,a)).rows;
const su=async(s,a)=>{await db.exec('reset role');return q(s,a);};
const B='00000000-0000-4000-8000-000000000002',U='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

// 1) Bucket is private with a size/type limit; the existing branch got its empty details row; company row exists.
let r=await su("select public,file_size_limit,allowed_mime_types from storage.buckets where id='org-legal-documents'");
assert.equal(r[0].public,false);assert.equal(Number(r[0].file_size_limit),15728640);assert.ok(r[0].allowed_mime_types.includes('application/pdf'));
assert.equal((await su('select count(*)::int c from org_branch_details'))[0].c,1);
assert.equal((await su('select count(*)::int c from org_company'))[0].c,1);

// 2) Only an active super admin sees anything: GM, financial manager, reception, inactive super admin and anon see nothing / are refused.
for(const n of [2,3,4,5]){await as(n);
 assert.equal((await q('select * from org_company')).length,0,'role '+n+' reads company');
 assert.equal((await q('select * from org_branch_details')).length,0);
 const u=await q("update org_company set cr_number='x' where id=1 returning id");assert.equal(u.length,0);
 await assert.rejects(()=>q('select public.org_branches()'),/للسوبر أدمن بس/);
 await assert.rejects(()=>q("select public.org_branch_create('فرع')"),/للسوبر أدمن بس/);
 await assert.rejects(()=>q("insert into org_documents(branch_id,doc_type,title,storage_path,mime_type,size_bytes) values(null,'tax_card','بطاقة','company/"+U+".pdf','application/pdf',10)"),/row-level security/);
 await assert.rejects(()=>q("insert into storage.objects(bucket_id,name) values('org-legal-documents','company/"+U+".pdf')"),/row-level security/);
}
await db.exec('reset role');await db.exec('set role anon');
await assert.rejects(()=>q('select * from org_company'),/permission denied/);
await assert.rejects(()=>q('select * from org_documents'),/permission denied/);
await assert.rejects(()=>q('select public.org_data_access()'),/permission denied/);

// 3) Super admin edits company data; updated_by is forced to the real actor; cannot insert a second company row or delete it.
await as(1);
r=await q("update org_company set legal_name_ar='شركة سونو',cr_number='12345',cr_expiry_date='2027-01-10',tax_card_number='999-888-777',phones=array['0233334444'],updated_by=$1 returning updated_by",[id(2)]);
assert.equal(r[0].updated_by,id(1));
await assert.rejects(()=>q('insert into org_company(id) values(1)'),/permission denied/);
await assert.rejects(()=>q('delete from org_company'),/permission denied/);
await assert.rejects(()=>q("update org_company set cr_issue_date='2027-02-01' where id=1"),/check constraint/);

// 4) Branches: list (with ledger bank accounts only), create a new one (goes to the shared inventory branch list), duplicate refused.
let L=(await q('select public.org_branches() v'))[0].v;assert.equal(L.branches.length,1);assert.deepEqual(L.bank_accounts.map(a=>a.code),['1112','111201']);
const nb=(await q("select public.org_branch_create(' فرع أكتوبر ') v"))[0].v;
await assert.rejects(()=>q("select public.org_branch_create('فرع أكتوبر')"),/بنفس الاسم/);
await assert.rejects(()=>q("select public.org_branch_create('x')"),/اسم الفرع/);
assert.equal((await su('select name from inventory_branches where id=$1',[nb]))[0].name,'فرع أكتوبر');
await as(1);
// bank details: IBAN/SWIFT format checked, ledger link must be a real account
await assert.rejects(()=>q("update org_branch_details set iban='eg12 34' where branch_id=$1",[B]),/check constraint/);
await assert.rejects(()=>q("update org_branch_details set swift='12' where branch_id=$1",[B]),/check constraint/);
await assert.rejects(()=>q("update org_branch_details set finance_account_code='9999' where branch_id=$1",[B]),/foreign key/);
r=await q("update org_branch_details set bank_name='بنك مصر',bank_account_number='1234567890',iban='EG380019000500000000263180002',swift='BMISEGCXXXX',finance_account_code='111201',emails=array['info@swnwclinics.com'] where branch_id=$1 returning updated_by",[B]);
assert.equal(r[0].updated_by,id(1));

// 5) Documents: path must match owner (company/… vs <branch_id>/…), file is immutable, metadata editable, uploader forced.
const doc=(p,b,t='commercial_register')=>q("insert into org_documents(branch_id,doc_type,title,storage_path,mime_type,size_bytes,expiry_date,uploaded_by) values($1,$2,'مستند',$3,'application/pdf',2048,'2026-12-01',$4) returning id,uploaded_by",[b,t,p,id(2)]);
await assert.rejects(()=>doc(B+'/'+U+'.pdf',null),/check constraint/);
await assert.rejects(()=>doc('company/'+U+'.pdf',B),/check constraint/);
await assert.rejects(()=>doc(nb+'/'+U+'.pdf',B,'license'),/check constraint/);
await assert.rejects(()=>doc('company/../x.pdf',null),/check constraint/);
await assert.rejects(()=>doc('company/'+U+'.exe',null),/check constraint/);
const d1=(await doc('company/'+U+'.pdf',null))[0];assert.equal(d1.uploaded_by,id(1));
const d2=(await doc(B+'/'+U.replace('a','b')+'.pdf',B,'license'))[0];
await assert.rejects(()=>q("update org_documents set storage_path=$2 where id=$1",[d1.id,'company/'+U.replace('a','c')+'.pdf']),/ارفع مستند جديد/);
await assert.rejects(()=>q("update org_documents set branch_id=$2 where id=$1",[d2.id,nb]),/ارفع مستند جديد|check constraint/);
assert.equal((await q("update org_documents set title='سجل تجاري محدث',doc_number='55' where id=$1 returning title",[d1.id]))[0].title,'سجل تجاري محدث');
await assert.rejects(()=>q("insert into org_documents(doc_type,title,storage_path,mime_type,size_bytes) values('other','كبير','company/"+U.replace('a','d')+".pdf','application/pdf',99999999)"),/check constraint/);
// a branch with documents cannot be removed from the inventory list
await assert.rejects(()=>su('delete from inventory_branches where id=$1',[B]),/foreign key/);

// 6) Storage: super admin uploads only to the strict path pattern and reads only this bucket's files; other roles read nothing.
await as(1);
await q("insert into storage.objects(bucket_id,name) values('org-legal-documents','company/"+U+".pdf')");
await assert.rejects(()=>q("insert into storage.objects(bucket_id,name) values('org-legal-documents','evil/../"+U+".pdf')"),/row-level security/);
await assert.rejects(()=>q("insert into storage.objects(bucket_id,name) values('org-legal-documents','company/"+U+".html')"),/row-level security/);
assert.equal((await q("select name from storage.objects where bucket_id='org-legal-documents'")).length,1);
for(const n of [2,3,4,5]){await as(n);assert.equal((await q("select name from storage.objects where bucket_id='org-legal-documents'")).length,0);
 assert.equal((await q("delete from storage.objects where bucket_id='org-legal-documents' returning id")).length,0);}
await as(1);assert.equal((await q("delete from storage.objects where bucket_id='org-legal-documents' returning id")).length,1);

// 7) Audit: every change logged with the actor; only super admin reads it; nobody writes it directly.
await as(1);assert.equal((await q('delete from org_documents where id=$1 returning id',[d2.id])).length,1);
r=await q("select table_name,action,actor_id from org_audit where actor_id is not null order by id");
assert.deepEqual([...new Set(r.map(x=>x.table_name))].sort(),['org_branch_details','org_company','org_documents']);
assert.ok(r.some(x=>x.table_name==='org_documents'&&x.action==='delete'));assert.ok(r.every(x=>x.actor_id===id(1)));
await assert.rejects(()=>q("insert into org_audit(table_name,action,record_id) values('x','y','z')"),/permission denied/);
await as(2);assert.equal((await q('select * from org_audit')).length,0);

// 8) Rollback drops everything it added and leaves the shared branch list.
await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261117010000_org_legal_profile.rollback.sql','utf8'));
r=await q("select to_regclass('public.org_company') a,to_regclass('public.org_documents') b,to_regprocedure('public.org_data_access()') c");
assert.deepEqual(r[0],{a:null,b:null,c:null});assert.equal((await q('select count(*)::int c from inventory_branches'))[0].c,2);
assert.equal((await q("select count(*)::int c from pg_policies where tablename='objects' and policyname like 'org legal%'"))[0].c,0);
await db.close();console.log('PASS org legal profile SQL: super-admin-only RLS (GM/finance/reception/inactive/anon refused), private bucket + strict paths, company single row, branches shared with inventory, IBAN/SWIFT/ledger link checks, immutable document files, audit by trigger, rollback.');
})().catch(e=>{console.error(e.message,e.where||'',e.stack);process.exitCode=1;});
