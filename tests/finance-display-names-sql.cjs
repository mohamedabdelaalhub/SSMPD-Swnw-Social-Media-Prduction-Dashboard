// 20261126030000: read-only display fields via outer wrappers — employee_balances name/pending, doctor statement patient_name at any
// depth, main treasury last_move source/from_register; signatures kept, inner functions ungranted, anon revoked; rollback restores.
const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite();
await db.exec(`create role authenticated;create role anon;create schema clinic_finance;create schema clinic_people;create schema clinic_reception;
create table public.patients(id uuid primary key default gen_random_uuid(),patient_code text,full_name text);
create table clinic_reception.workspaces(id uuid primary key,mode text);
create table clinic_reception.patients(id uuid primary key default gen_random_uuid(),workspace_id uuid,file_no text,name text,created_at timestamptz default now());
create table clinic_people.people(code text,finance_subject text,full_name text);
create table clinic_finance.business_requests(id uuid primary key default gen_random_uuid(),subject text,kind text,status text,payload jsonb default '{}',created_at timestamptz default now());
create table clinic_finance.registers(id uuid primary key,name text);
create table clinic_finance.shifts(id uuid primary key,register_id uuid);
create table clinic_finance.treasury_transfers(id uuid primary key,from_shift uuid);
create table clinic_finance.entries(id uuid primary key default gen_random_uuid(),event_no bigint,source text,source_id uuid);
create function public.clinic_finance_snapshot(p_from date,p_to date,p_offset integer default 0) returns jsonb language sql as $$select '{"x":1,"employee_balances":[{"subject":"EMP-000001","advance":0,"due":0},{"subject":"EMP-000002","advance":100,"due":0},{"subject":"EMP-000003","advance":0,"due":0}]}'::jsonb$$;
create function public.clinic_finance_doctor_statement(a text,b date,c date) returns jsonb language sql as $$select '{"summary":{"accrued":1},"invoices":[{"patient_ref":"P-2026-000001","lines":[{"x":1}]},{"patient_ref":"F-77","nested":{"patient_ref":"none"}}]}'::jsonb$$;
create function public.clinic_finance_doctor_statement_detail(a text,b date,c date) returns jsonb language sql as $$select '{"rows":[{"patient_ref":"P-2026-000001","patient_name":"keep"}]}'::jsonb$$;
create function public.clinic_finance_main_treasury_balance() returns jsonb language sql as $$select '{"balance":10,"last_move":{"event_no":7,"description":"استلام خزينة SHIFT-x"}}'::jsonb$$;`);
const W='00000000-0000-0000-0000-000000000001',R1='00000000-0000-0000-0000-000000000011',S1='00000000-0000-0000-0000-000000000021',T1='00000000-0000-0000-0000-000000000031';
await db.query("insert into public.patients(patient_code,full_name) values('P-2026-000001','هبة علي')");
await db.query("insert into clinic_reception.workspaces values($1,'live')",[W]);await db.query("insert into clinic_reception.patients(workspace_id,file_no,name) values($1,'F-77','مريض الاستقبال')",[W]);
await db.query("insert into clinic_people.people values('EMP-000001',null,'منار موسى')");
await db.query("insert into clinic_finance.business_requests(subject,kind,status,payload) values('EMP-000002','employment','approved','{\"employee_name\":\"مريم هشام\"}'),('EMP-000002','advance','pending','{}'),('EMP-000003','payroll','approved','{}')");
await db.query("insert into clinic_finance.registers values($1,'خزينة الاستقبال 1')",[R1]);await db.query("insert into clinic_finance.shifts values($1,$2)",[S1,R1]);await db.query("insert into clinic_finance.treasury_transfers values($1,$2)",[T1,S1]);
await db.query("insert into clinic_finance.entries(event_no,source,source_id) values(7,'treasury_transfer_in',$1)",[T1]);
const M=fs.readFileSync('supabase/migrations/20261126030000_finance_display_names.sql','utf8');await db.exec(M);
await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
const one=async s=>(await db.query(s)).rows[0].v;
let v=await one("select public.clinic_finance_snapshot('2026-11-01','2026-11-30') v");assert.equal(v.x,1);
assert.deepEqual(v.employee_balances.map(e=>[e.subject,e.name,+e.pending]),[['EMP-000001','منار موسى',0],['EMP-000002','مريم هشام',1],['EMP-000003',null,0]]);
v=await one("select public.clinic_finance_doctor_statement('EMP-1','2026-11-01','2026-11-30') v");
assert.equal(v.invoices[0].patient_name,'هبة علي');assert.equal(v.invoices[1].patient_name,'مريض الاستقبال');assert.equal(v.invoices[1].nested.patient_name,null);
assert.deepEqual(v.invoices[0].lines,[{x:1}]);assert.equal(v.summary.accrued,1);
v=await one("select public.clinic_finance_doctor_statement_detail('EMP-1','2026-11-01','2026-11-30') v");assert.equal(v.rows[0].patient_name,'keep','existing value untouched');
v=await one("select public.clinic_finance_main_treasury_balance() v");assert.equal(v.last_move.source,'treasury_transfer_in');assert.equal(v.last_move.from_register,'خزينة الاستقبال 1');assert.equal(v.balance,10);
const acl=async n=>(await db.query("select coalesce(proacl::text,'') a from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname||'.'||p.proname=$1",[n])).rows.map(r=>r.a).join();
for(const f of ['public.clinic_finance_snapshot','public.clinic_finance_doctor_statement','public.clinic_finance_doctor_statement_detail','public.clinic_finance_main_treasury_balance']){const a=await acl(f);assert(!/anon=/.test(a)&&/authenticated=X/.test(a),f+' '+a);}
for(const f of ['clinic_finance.snapshot_pre_names','clinic_finance.main_treasury_balance_pre_names','clinic_finance.with_patient_names']){const a=await acl(f);assert(!/authenticated=X|anon=X|=X\//.test(a.replace(/postgres=X\/postgres/g,'')),f+' '+a);}
await db.exec(fs.readFileSync('supabase/rollbacks/20261126030000_finance_display_names.rollback.sql','utf8'));
v=await one("select public.clinic_finance_main_treasury_balance() v");assert.equal(v.last_move.source,undefined,'rollback restores the original');
v=await one("select public.clinic_finance_snapshot('2026-11-01','2026-11-30') v");assert.equal(v.employee_balances[0].name,undefined);
await db.exec(M);
console.log('PASS finance display names SQL: employee name/pending, patient_name at any depth (existing kept), last_move source/from_register, grants, rollback + reapply');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
