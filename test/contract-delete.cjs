const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
(async()=>{
 const db=new PGlite();
 await db.exec(`create role authenticated; create role anon;
 create table admins(id uuid primary key); create table patients(id uuid primary key);
 create function has_role(r text) returns boolean language sql stable as $$select r=any(string_to_array(current_setting('test.roles',true),','))$$;
 create function my_admin_id() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;`);
 const schema=read('supabase/contracting_entities.sql');
 await db.exec(schema.slice(schema.indexOf('create or replace function public.can_manage_contracting_entities'),schema.indexOf('create or replace function public.contract_entity_financial_rows')));
 await db.exec(`create table patient_visits(id uuid primary key,contract_id uuid references contracting_entity_contracts(id) on delete restrict); grant select,delete on all tables in schema public to authenticated;`);
 await db.exec(read('supabase/contracting_entities_delete.sql'));
 // Running activation twice must remain valid.
 await db.exec(read('supabase/contracting_entities_delete.sql'));
 const id='00000000-0000-0000-0000-000000000001',cid='00000000-0000-0000-0000-000000000002',pid='00000000-0000-0000-0000-000000000003';
 async function seed(){await db.exec('reset role; truncate patient_visits,contract_patient_links,contracting_entities cascade;');await db.query("insert into contracting_entities(id,name,entity_type) values($1,'جهة','school')",[id]);await db.query("insert into contracting_entity_contracts(id,entity_id,start_date) values($1,$2,current_date)",[cid,id]);await db.query("insert into contracting_entity_contacts(entity_id,full_name) values($1,'مسؤول')",[id]);}
 async function actor(roles){await db.query("select set_config('test.roles',$1,false),set_config('test.actor',$2,false)",[roles,id]);await db.exec('set role authenticated;');}
 for(const role of ['contract_manager','page_manager','designer','approver','reception']){await seed();await actor(role);await assert.rejects(db.query('select delete_contracting_entity($1)',[id]),e=>String(e.message).includes("المدير فقط"));const result=await db.query('delete from contracting_entities where id=$1 returning id',[id]);assert.equal(result.rows.length,0,'Direct REST deletion denied for '+role);}
 for(const roles of ['general_manager','super_admin','contract_manager,general_manager']){await seed();await actor(roles);assert.equal((await db.query('select delete_contracting_entity($1) as id',[id])).rows[0].id,id);assert.equal((await db.query('select count(*) as n from contracting_entity_contacts')).rows[0].n,0);await assert.rejects(db.query('select delete_contracting_entity($1)',[id]),e=>String(e.message).includes("غير موجودة"));}
 await seed();await db.query('insert into patients values($1)',[pid]);await db.query('insert into contract_patient_links(contract_id,patient_id) values($1,$2)',[cid,pid]);await actor('super_admin');await assert.rejects(db.query('select delete_contracting_entity($1)',[id]),e=>String(e.message).includes("مرتبطة بمرضى"));assert.equal((await db.query('select count(*) as n from contracting_entity_contacts')).rows[0].n,1,'Failed delete rolls back cascades');
 await seed();await db.query('insert into patient_visits values($1,$2)',[pid,cid]);await actor('general_manager');await assert.rejects(db.query('select delete_contracting_entity($1)',[id]),e=>String(e.message).includes("مرتبطة بمرضى"));
 await db.exec('reset role;set role anon;');await assert.rejects(db.query('select delete_contracting_entity($1)',[id]),e=>String(e.message).includes("permission denied"));await db.close();
 let modal,calls=0,done=0,fail=false;const messages=[];
 const window={SSMPDAuth:{currentAdmin:{role:'contract_manager'}},SSMPDToast:{show:m=>messages.push(m)},SSMPDDb:{deleteContractingEntity:async entityId=>{assert.equal(entityId,'entity-1');calls++;if(fail)throw Error('مرتبط بمرضى');}}};
 const document={body:{appendChild:n=>{modal=n;}},createElement(){const controls={};return {remove(){this.removed=true;},querySelector:s=>controls[s]||=( {disabled:false})};}};
 const context=vm.createContext({window,document,console,Promise});vm.runInContext(read('assets/js/roles.js'),context);vm.runInContext(read('assets/js/render-contracting-entities.js').replace('window.SSMPDRenderContractingEntities = { render: render };','window.testDelete = openDelete;'),context);
 const open=()=>window.testDelete({id:'entity-1',name:'<img src=x>'},()=>done++),settle=()=>new Promise(r=>setImmediate(r));
 open();assert.equal(modal,undefined,'Contract manager cannot open delete dialog');
 window.SSMPDAuth.currentAdmin={role:'general_manager'};open();assert(modal.innerHTML.includes('&lt;img'));modal.querySelector('#ced-cancel').onclick();assert.equal(calls,0);
 open();modal.querySelector('#ced-confirm').onclick();modal.querySelector('#ced-confirm').onclick();await settle();assert.equal(calls,1);assert.equal(done,1);assert(modal.removed);
 fail=true;window.SSMPDAuth.currentAdmin={role:'contract_manager',roles:['contract_manager','super_admin']};open();modal.querySelector('#ced-confirm').onclick();await settle();assert.equal(modal.removed,undefined);assert.equal(modal.querySelector('#ced-confirm').disabled,false);assert.equal(messages.at(-1),'مرتبط بمرضى');
 console.log('PASS deletion: database roles/RLS/RPC, extra roles, linked records and cascade rollback, anonymous denial, confirmation/cancel/double click/retry.');
})().catch(e=>{console.error(e);process.exitCode=1;});
