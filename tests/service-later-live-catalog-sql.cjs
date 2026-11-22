// 20261122090000: on the live workspace the department placeholder («الخدمة تتحدد عند الحضور») survives sync_catalog's
// "no pricing link → inactive" sweep and passes the live book pricing check; normal services keep both rules; rollback.
// The anchors are taken from the real migration sources, so a drift in those texts fails here first.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
(async()=>{const db=new PGlite();
 const shared=fs.readFileSync('supabase/migrations/20261028215551_shared_price_references_and_list_permissions.sql','utf8');
 const sweep=shared.split('\n').find(l=>l.startsWith(' update clinic_reception.services r set active=false where r.workspace_id=p_workspace and (r.pricing_service_id is null or'));
 const cat=fs.readFileSync('supabase/migrations/20261017130324_reception_canonical_catalog.sql','utf8');
 const check=cat.split('\n').find(l=>l.includes("pricing_service_id is not null) then raise exception 'الخدمة تغيرت أو غير مفعلة في التسعير"));
 assert(sweep&&check,'source anchors present');
 try{await db.exec(`create role authenticated;create role anon;create schema clinic_reception;
  create table public.pricing_services(id uuid primary key,active boolean,booking_enabled boolean);
  create table clinic_reception.services(id uuid primary key,workspace_id uuid,pricing_service_id uuid,active boolean,placeholder boolean not null default false);
  create function clinic_reception.sync_catalog(p_workspace uuid) returns void language plpgsql as $f$begin
${sweep}
  end $f$;
  create function clinic_reception.catalog_command(p_workspace uuid,p_action text,p_payload jsonb) returns text language plpgsql as $f$begin
  perform clinic_reception.sync_catalog(p_workspace);
${check}
  return 'ok';end $f$;
  insert into clinic_reception.services values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000aa',null,true,true),
   ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-0000000000aa',null,true,false);`);
  const ws='00000000-0000-4000-8000-0000000000aa',book=id=>db.query("select clinic_reception.catalog_command($1,'book',jsonb_build_object('service_id',$2::text)) r",[ws,id]);
  await assert.rejects(()=>book('00000000-0000-4000-8000-000000000001'),/غير مفعلة في التسعير/,'before the fix: refused (the owner screenshot)');
  await db.exec("update clinic_reception.services set active=true");
  await db.exec(fs.readFileSync('supabase/migrations/20261122090000_service_later_live_catalog.sql','utf8'));
  assert.equal((await book('00000000-0000-4000-8000-000000000001')).rows[0].r,'ok','placeholder booked');
  const rows=(await db.query('select placeholder,active from clinic_reception.services order by id')).rows;
  assert.equal(rows[0].active,true,'placeholder not swept');assert.equal(rows[1].active,false,'normal unpriced service still swept');
  await assert.rejects(()=>book('00000000-0000-4000-8000-000000000002'),/غير مفعلة في التسعير/,'normal unpriced service still refused');
  await db.exec("update clinic_reception.services set active=false where placeholder");
  await assert.rejects(()=>book('00000000-0000-4000-8000-000000000001'),/غير مفعلة في التسعير/,'inactive placeholder refused (order_add path)');
  await assert.rejects(()=>db.exec(fs.readFileSync('supabase/migrations/20261122090000_service_later_live_catalog.sql','utf8')),/anchor|found/,'not applied twice');
  await db.exec('rollback').catch(()=>{});
  await db.exec(fs.readFileSync('supabase/rollbacks/20261122090000_service_later_live_catalog.rollback.sql','utf8'));
  await db.exec("update clinic_reception.services set active=true");
  await assert.rejects(()=>book('00000000-0000-4000-8000-000000000001'),/غير مفعلة في التسعير/,'rollback restores both');
  console.log('PASS service later live catalog: placeholder survives the sweep and passes the live pricing check; normal services unchanged; rollback');
 }catch(e){console.error(e);process.exitCode=1;}finally{await db.close();}})();
