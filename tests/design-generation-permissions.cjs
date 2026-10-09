/* Run with @electric-sql/pglite on NODE_PATH. No live project or paid API calls. */
const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite();await db.exec(`
create role authenticated;
create table content_items(id uuid primary key,brand text,content_format text,stage text,created_by uuid,assigned_designer uuid,design_execution text);
create table design_templates(id uuid primary key default gen_random_uuid(),template_key text unique);
create table design_jobs(id uuid primary key default gen_random_uuid(),content_id uuid,created_by uuid,template_id uuid,request_key uuid unique,status text,scene_prompt text,image_model text,image_quality text,attempt_count integer,estimated_cost_usd numeric,created_at timestamptz default now());
create function my_admin_id() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create function has_role(role text) returns boolean language sql stable as $$select current_setting('test.role',true)=role$$;
create function can_manage_all_content() returns boolean language sql stable as $$select current_setting('test.role',true) in ('super_admin','general_manager')$$;
insert into design_templates(template_key) values('sono-white-v1'),('dina-post-v1');
`);const privateSql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261006_private_design_files.sql'),'utf8');await db.exec(privateSql.slice(privateSql.indexOf('create or replace function public.can_write_private_design'),privateSql.indexOf('-- Reading follows')));await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261010_design_generation_permissions.sql'),'utf8'));
const actor='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002',id='00000000-0000-0000-0000-000000000010';let request=100;
async function state(role,brand,stage,owner,designer=null,execution='ai'){await db.query("select set_config('test.actor',$1,false),set_config('test.role',$2,false)",[actor,role]);await db.exec('delete from design_jobs;delete from content_items;');await db.query('insert into content_items values($1,$2,$3,$4,$5,$6,$7)',[id,brand,'image_post',stage,owner,designer,execution]);}
async function reserve(key){return (await db.query('select reserve_design_scene($1,$2,$3,$4) as r',[id,key||'00000000-0000-0000-0000-'+String(request++).padStart(12,'0'),'medical education scene','medium'])).rows[0].r;}
await state('page_manager','dr_dina','in_design',actor);const key='00000000-0000-0000-0000-000000000099';let job=await reserve(key);assert(job.new);assert.equal(job.job.template_id,(await db.query("select id from design_templates where template_key='dina-post-v1'")).rows[0].id);assert.equal((await reserve(key)).new,false,'repeated request does not charge again');
await state('approver','dr_dina','final_approval',other);assert((await reserve()).new,'approver may regenerate while editing final approval');
await state('designer','dr_dina','in_design',other,actor,'human');assert((await reserve()).new);
await state('super_admin','dr_dina','in_design',other);assert((await reserve()).new);
await state('page_manager','sono','in_design',actor);assert((await reserve()).new,'Sono remains supported');
for(const stage of ['published','scheduled','ready_to_publish']){await state('super_admin','dr_dina',stage,actor);await assert.rejects(reserve(),/غير مسموح/);}
await state('page_manager','dr_dina','in_design',other);await assert.rejects(reserve(),/غير مسموح/);
await state('viewer','dr_dina','in_design',actor);await assert.rejects(reserve(),/غير مسموح/);
await state('super_admin','unknown','in_design',actor);await assert.rejects(reserve(),/غير مسموح/);
await state('page_manager','dr_dina','in_design',actor);for(let i=0;i<3;i++){let j=await reserve();await db.query("update design_jobs set status='failed' where id=$1",[j.job.id]);}await assert.rejects(reserve(),/٣ محاولات/);
await state('page_manager','dr_dina','in_design',actor);await db.query("insert into design_jobs(estimated_cost_usd,attempt_count) values(5,0)");await assert.rejects(reserve(),/٥ دولارات/);
await db.close();console.log('PASS: real PostgreSQL permission function, Dina/Sono routing, final approval, denial, idempotency and quota checks.');})().catch(e=>{console.error(e);process.exitCode=1;});
