// Owner 2026-11-16: reception sees active contracting entities in the new-patient form (names only).
const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create table admins(id uuid primary key,role text);
create function my_admin_id() returns uuid language sql stable as $$select nullif(current_setting('test.admin',true),'')::uuid$$;
create function has_archive_access() returns boolean language sql stable security definer as $$select exists(select 1 from admins where id=my_admin_id() and role in ('reception','super_admin'))$$;
create function can_manage_contracting_entities() returns boolean language sql stable security definer as $$select exists(select 1 from admins where id=my_admin_id() and role in ('super_admin','contract_manager'))$$;
create table contracting_entities(id uuid primary key default gen_random_uuid(),name text);
create table contracting_entity_contracts(id uuid primary key default gen_random_uuid(),entity_id uuid,status text,start_date date,end_date date,discount_percent numeric,cashback_percent numeric,terms_notes text);
alter table contracting_entity_contracts enable row level security;alter table contracting_entities enable row level security;
create policy m on contracting_entity_contracts for all using (can_manage_contracting_entities());create policy m on contracting_entities for all using (can_manage_contracting_entities());
grant select on contracting_entity_contracts,contracting_entities to authenticated;grant usage on schema public to authenticated;
insert into admins values('10000000-0000-4000-8000-000000000001','reception'),('10000000-0000-4000-8000-000000000002','page_manager');
with e as (insert into contracting_entities(name) values('شركة تأمين (تجربة)'),('نقابة (تجربة)'),('جهة منتهية (تجربة)') returning id,name)
insert into contracting_entity_contracts(entity_id,status,start_date,end_date,discount_percent) select id,case when name like 'جهة منتهية%' then 'active' else 'active' end,'2026-01-01',case when name like 'جهة منتهية%' then date '2026-01-31' else null end,10 from e;
insert into contracting_entity_contracts(entity_id,status,start_date) select id,'negotiation','2026-01-01' from contracting_entities where name like 'نقابة%';`);
await db.exec(fs.readFileSync('supabase/migrations/20261117110000_registration_contract_options.sql','utf8'));
const as=async n=>{await db.exec('reset role');await db.query("select set_config('test.admin',$1,false)",['10000000-0000-4000-8000-00000000000'+n]);await db.exec('set role authenticated');};
await as(1);
assert.equal((await db.query('select * from contracting_entity_contracts')).rows.length,0,'reception cannot read the table directly (the bug)');
const r=(await db.query('select * from list_active_contracts_for_registration()')).rows;
assert.deepEqual(r.map(x=>x.entity_name),['شركة تأمين (تجربة)','نقابة (تجربة)'],'active + current only, sorted, no expired, no negotiation');
assert.deepEqual(Object.keys(r[0]).sort(),['contract_id','end_date','entity_name','start_date'],'names only — no discount/cashback/terms');
await as(2);await assert.rejects(db.query('select * from list_active_contracts_for_registration()'),e=>/not allowed/.test(e.message));
await db.exec('reset role');await db.exec("set role anon");await assert.rejects(db.query('select * from list_active_contracts_for_registration()'),e=>/permission denied/.test(e.message));
await db.close();console.log('PASS registration contract options: reception gets active current contracts (id + entity name only), others refused, anon has no execute.');
})().catch(e=>{console.error(e);process.exit(1);});
