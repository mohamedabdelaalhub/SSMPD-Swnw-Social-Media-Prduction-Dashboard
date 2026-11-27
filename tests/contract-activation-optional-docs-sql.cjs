// PGlite: contract activation without terms/signed document, single approver = super_admin or financial_manager.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception-bridge.cjs');
const mig=s=>fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(n=>n.endsWith('_'+s+'.sql')),'utf8');
const MIGRATION=process.env.ACTIVATION_SQL||'supabase/migrations/20261123080000_contract_activation_optional_docs.sql';
const ROLLBACK='supabase/rollbacks/20261123080000_contract_activation_optional_docs.rollback.sql';
(async()=>{const {db,as,call,owner,id}=await boot(['reception_canonical_catalog','reception_catalog_readiness','reception_catalog_lock_order']);try{
await db.exec("alter table admins add column if not exists email text;alter table contracting_entities add column category text default 'cash';alter table pricing_services add column created_by uuid;create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;");
for(const s of ['human_resources_workspace','price_lists_workspace','price_lists_booking_integration','contract_price_imports_and_service_identity','center_master_review_and_staff_onboarding','center_master_short_laboratory_names','service_mapping_review'])await db.exec(mig(s));
await as(1);await call('price_lists_command',['save',{name:'مصدر تهيئة',version:1,mode:'fixed',fallback:'block',valid_from:'2020-01-01',valid_to:'2020-12-31',items:[]}]);await owner('select 1');
for(const s of ['shared_price_references_and_list_permissions','price_section_edit_and_delete','price_clone_preflight_permissions'])await db.exec(mig(s));
// Stub table from the helper gets the real document columns and the activity log (supabase/contracting_entities.sql).
await db.exec("alter table contracting_entity_contracts add column if not exists agreement_date date,add column if not exists signed_by_name text,add column if not exists signed_document_url text;create table if not exists contracting_entity_activities(id uuid primary key default gen_random_uuid(),entity_id uuid not null,contract_id uuid,activity_type text not null default 'note' check(activity_type in ('call','meeting','whatsapp','email','note','status_change')),summary text not null,next_follow_up_date date,created_by uuid,created_at timestamptz not null default now());grant all on contracting_entity_contracts,contracting_entity_activities to authenticated;");
await db.exec(fs.readFileSync(MIGRATION,'utf8'));await db.exec(fs.readFileSync(MIGRATION,'utf8'));// idempotent re-apply
await owner("insert into admins(id,name,role) values($1,'مدير عقود','contract_manager')",[id(6)]);
await owner('update admins set has_price_lists_access=true where id=any($1)',[[id(1),id(6)]]);
const svc=(await owner("insert into pricing_services(name,category,base_price,supplies_used,profit_margin_percent,active,booking_code) values('كشف تأمين','عيادة',300,'[]',0,true,'INS1') returning id"))[0].id;
const ent=(await owner("insert into contracting_entities(name,category) values('ميد نت','insurance') returning id"))[0].id;
// A contract exactly like live: negotiating, no terms, no signer, no agreement date, no document.
const newContract=async()=>(await owner("insert into contracting_entity_contracts(entity_id,status,start_date,end_date,booking_service_ids,booking_billing_kind,booking_coverage) values($1,'negotiating','2026-01-01','2026-12-31',$2,'insurer',80) returning id",[ent,[svc]]))[0].id;
const contract=await newContract();
const row=async cid=>(await owner('select * from contracting_entity_contracts where id=$1',[cid]))[0];
assert.equal((await row(contract)).terms_notes,null);assert.equal((await row(contract)).signed_document_url,null);
// Super admin creates the list and links it (maker), still a draft, like live.
await as(1);const list=await call('price_lists_command',['save',{name:'لائحة ميد نت',version:1,mode:'fixed',fallback:'block',valid_from:'2026-01-01',valid_to:'2026-12-31',list_kind:'reference',items:[{service_id:svc,fixed_price:250}]}]);
await call('price_contract_list_command',['assign',{contract_id:contract,revision:1,list_id:list,service_terms:[]}]);
// Hidden roles: contract manager (who can edit the table) and accountant cannot activate in any way.
await as(6);await assert.rejects(()=>call('contracting_contract_activate',[contract]),/سوبر أدمن أو المدير المالي/);
await as(6);await assert.rejects(()=>db.query("update contracting_entity_contracts set status='active' where id=$1",[contract]),/سوبر أدمن أو المدير المالي/);
await as(2);await assert.rejects(()=>call('contracting_contract_activate',[contract]),/سوبر أدمن أو المدير المالي/);
await as(4);await assert.rejects(()=>call('contracting_contract_activate',[contract]),/سوبر أدمن أو المدير المالي/);
assert.equal((await row(contract)).status,'negotiating');
// Super admin, the same person who made the list and the link, activates alone, with no documents.
await as(1);const out=await call('contracting_contract_activate',[contract]);
assert.equal(out.status,'active');assert.equal(out.price_list,'active',out.price_list_message||'');
let c=await row(contract);assert.equal(c.status,'active');assert.equal(c.price_list_link_status,'active');assert.equal(c.price_list_reviewed_by,id(1));
assert.equal((await owner('select status,reviewed_by from clinic_prices.lists where id=$1',[list]))[0].status,'active');
assert.equal((await owner("select count(*)::int n from contracting_entity_activities where contract_id=$1 and activity_type='status_change'",[contract]))[0].n,1);
const quote=await call('price_lists_preview',[svc,'2026-06-01',contract]);assert.equal(Number(quote.price),250);
// Financial manager activates a second contract with no list at all.
const c2=await newContract();await as(3);const out2=await call('contracting_contract_activate',[c2]);assert.equal(out2.price_list,'not_linked');assert.equal((await row(c2)).status,'active');
// A list failing a pricing check does not block the contract; the reason is returned.
const c3=await newContract();await as(1);const empty=await call('price_lists_command',['save',{name:'لائحة فارغة',version:1,mode:'fixed',fallback:'block',valid_from:'2026-01-01',valid_to:'2026-12-31',list_kind:'reference',items:[]}]);
await call('price_contract_list_command',['assign',{contract_id:c3,revision:1,list_id:empty,service_terms:[]}]);
const out3=await call('contracting_contract_activate',[c3]);assert.equal((await row(c3)).status,'active');assert.equal(out3.price_list,'error');assert.match(out3.price_list_message,/سعر خدمة/);
assert.equal((await owner('select status from clinic_prices.lists where id=$1',[empty]))[0].status,'draft');
// Manual review path: single approver for super_admin, refused for others; note still required.
const l4=await call('price_lists_command',['save',{name:'لائحة مراجعة يدوية',version:1,mode:'fixed',fallback:'block',valid_from:'2026-01-01',valid_to:'2026-12-31',list_kind:'reference',items:[{service_id:svc,fixed_price:90}]}]);
await call('price_lists_command',['submit',{id:l4}]);
await as(6);await assert.rejects(()=>call('price_lists_command',['review',{id:l4,decision:'active',review_note:'مراجعة مدير عقود'}]),/سوبر أدمن أو المدير المالي/);
await as(1);await assert.rejects(()=>call('price_lists_command',['review',{id:l4,decision:'active',review_note:''}]),/سبب/);
await call('price_lists_command',['review',{id:l4,decision:'active',review_note:'اعتماد المالك'}]);
assert.equal((await owner('select status from clinic_prices.lists where id=$1',[l4]))[0].status,'active');
// Link approval by the same person who linked it.
const c5=await newContract();await as(1);await call('contracting_contract_activate',[c5]);await call('price_contract_list_command',['assign',{contract_id:c5,revision:1,list_id:l4,service_terms:[]}]);
await as(6);await assert.rejects(()=>call('price_contract_list_command',['approve',{contract_id:c5,revision:2}]),/سوبر أدمن أو المدير المالي/);
await as(1);await call('price_contract_list_command',['approve',{contract_id:c5,revision:2}]);assert.equal((await row(c5)).price_list_link_status,'active');
// Super admin may still save status=active directly from the edit form (table write) with no documents.
const c6=await newContract();await as(1);await db.query("update contracting_entity_contracts set status='active' where id=$1",[c6]);assert.equal((await row(c6)).status,'active');
// Other non-document rules are kept: delegated actions still work and check permissions.
await as(4);await assert.rejects(()=>call('price_lists_command',['save',{name:'x'}]),/لا تملك/);
await db.exec('reset role;set role anon');await assert.rejects(()=>call('contracting_contract_activate',[contract]),/permission denied/);
// Rollback in place, twice; four-eyes is back.
await db.exec('reset role');await db.exec(fs.readFileSync(ROLLBACK,'utf8'));await db.exec(fs.readFileSync(ROLLBACK,'utf8'));
assert.equal((await owner("select to_regprocedure('public.contracting_contract_activate(uuid)') is null gone"))[0].gone,true);
await as(1);const l7=await call('price_lists_command',['save',{name:'بعد الرجوع',version:1,mode:'fixed',fallback:'block',valid_from:'2026-01-01',valid_to:'2026-12-31',list_kind:'reference',items:[{service_id:svc,fixed_price:70}]}]);await call('price_lists_command',['submit',{id:l7}]);
await assert.rejects(()=>call('price_lists_command',['review',{id:l7,decision:'active',review_note:'اعتماد ذاتي'}]),/مراجع/);
await db.exec('reset role');await db.exec(fs.readFileSync(MIGRATION,'utf8'));
console.log('PASS contract activation SQL: no terms/document needed, super_admin and financial_manager activate alone, contract manager/accountant/reception refused, list+link approved in one call, failing list reported without blocking, manual review single approver with note, idempotent migration and rollback.');
}finally{await db.close();}})().catch(e=>{console.error(e.message,e.where||'');process.exitCode=1;});
