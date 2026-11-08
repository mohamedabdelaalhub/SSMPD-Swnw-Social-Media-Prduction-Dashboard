// Item 8: «أدائي» for nursing/head_nursing/sono_doctor + policies use all roles (migration 20261108220000).
const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
(async()=>{
 const ctx={window:{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('assets/js/roles.js','utf8'),ctx);const R=ctx.window.SSMPDRoles;
 for(const r of ['nursing','head_nursing','sono_doctor','reception','general_manager'])assert.equal(R.canSeeTab({id:'x',role:r},'my_kpi'),true,r);
 assert.equal(R.canSeeTab({id:'x',role:'accountant'},'my_kpi'),false);assert.equal(R.canSeeTab({id:'x',role:'general_manager'},'patients'),false,'GM archive via per-user flag only');
 const mig=fs.readFileSync('supabase/migrations/20261108220000_policies_all_roles.sql','utf8'),code=mig.split('\n').filter(l=>!l.startsWith('--')).join('\n');
 assert(!code.includes('my_role()'),'no my_role() left');assert.equal((code.match(/^alter policy/gm)||[]).length,26);
 const db=new PGlite();
 await db.exec(`create schema auth;create function auth.uid() returns uuid language sql as $$select current_setting('t.uid',true)::uuid$$;
  create table public.admins(id uuid primary key,user_id uuid,role text,active boolean default true);create table public.admin_extra_roles(admin_id uuid,role text);
  insert into public.admins values('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a1','reception',true),('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000b1','nursing',false);
  insert into public.admin_extra_roles values('00000000-0000-0000-0000-00000000000a','nursing'),('00000000-0000-0000-0000-00000000000b','super_admin');
  create role authenticated;create role service_role;`);
 await db.exec(code.slice(0,code.indexOf('alter policy')));
 const has=async(uid,arr)=>{await db.exec(`set t.uid='${uid}'`);return (await db.query(`select public.has_any_role(array[${arr.map(x=>`'${x}'`).join(',')}]) v`)).rows[0].v;};
 assert.equal(await has('00000000-0000-0000-0000-0000000000a1',['nursing']),true,'extra role counts');
 assert.equal(await has('00000000-0000-0000-0000-0000000000a1',['reception','x']),true,'primary role counts');
 assert.equal(await has('00000000-0000-0000-0000-0000000000a1',['super_admin']),false);
 assert.equal(await has('00000000-0000-0000-0000-0000000000b1',['super_admin','nursing']),false,'inactive admin gets nothing');
 const rb=fs.readFileSync('supabase/rollbacks/20261108220000_policies_all_roles.rollback.sql','utf8');assert.equal((rb.match(/^alter policy/gm)||[]).length,26);assert(rb.includes('drop function if exists public.has_any_role'));
 await db.close();console.log('PASS roles visibility: my_kpi for nursing/head_nursing/sono_doctor, 26 policies off my_role(), has_any_role = primary+extra roles of active admin only, rollback complete.');
})().catch(e=>{console.error(e);process.exit(1);});
