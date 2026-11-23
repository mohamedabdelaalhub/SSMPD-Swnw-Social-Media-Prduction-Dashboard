const path=require('path'),root=path.resolve(__dirname,'..');process.chdir(root);
const scenario=require(root+'/tests/reception-management-pilot.cjs'),fs=require('fs');
(async()=>{const x=await scenario(true),{b}=x,{db,owner}=b;await owner('select 1');
for(const f of ['20261017194115_inventory_patient_supply.sql','20261017182845_inventory_invoice_expiry_pricing.sql','20261017190930_inventory_standard_markup_batch_codes.sql','20261122270000_inventory_supplies_flow.sql','20261122300000_medicines_pricing_discount.sql','MIGNUM_visit_usage_can_save.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
await owner('alter table admins add column if not exists user_id uuid');await owner('update admins set user_id=id');await owner('alter table patients add column if not exists created_by uuid');await db.exec("alter table patients add column if not exists patient_code text; create or replace function _pc() returns trigger language plpgsql as $$begin new.patient_code:=coalesce(new.patient_code,'P-T-'||left(new.id::text,8));return new;end$$; create trigger _pc before insert on patients for each row execute function _pc();");
const sql=fs.readFileSync('tests/inventory-buttons-live-rollback.sql','utf8');
const r=await db.exec(sql);const t=r.find(x=>x.rows&&x.rows.length&&'button' in x.rows[0]);console.table((t?t.rows:[]).map(x=>({b:x.button,role:x.role,shown:x.shown,passed:x.passed,ok:x.ok,err:(x.error||'').slice(0,50)})));
await db.close();})().catch(e=>{console.error(e.message,e.where||'');process.exit(1);});
