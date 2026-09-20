const {PGlite}=require('@electric-sql/pglite');
const fs=require('fs'),assert=require('assert/strict');
const path=require('path'),root=path.resolve(__dirname,'..');
(async()=>{
 const db=new PGlite();
 await db.exec(`create role authenticated; create role anon; create role service_role; create schema auth;
 create function auth.role() returns text language sql as $$select 'authenticated'::text$$;
 create function public.my_admin_id() returns uuid language sql as $$select nullif(current_setting('test.me',true),'')::uuid$$;
 create function public.my_role() returns text language sql as $$select current_setting('test.role',true)$$;
 create function public.has_role(r text) returns boolean language sql as $$select public.my_role()=r$$;
 create function public.can_manage_all_content() returns boolean language sql as $$select public.my_role() in ('super_admin','general_manager')$$;
 create table admins(id uuid primary key,role text,active boolean);
 create table admin_extra_roles(admin_id uuid,role text);
 create table content_items(id uuid primary key default gen_random_uuid(),created_by uuid,stage text default 'initial_approval',assigned_designer uuid,design_received_at timestamptz,design_file_url text,
 title text,brand text,specialty text,content_format text,script_text text,caption_text text,cta_type text,cta_text text,target_duration_min_seconds integer,target_duration_max_seconds integer,video_template text,video_media_mode text default 'auto',video_music_mood text default 'calm',cover_settings jsonb default '{}');
 create table video_jobs(id uuid primary key default gen_random_uuid(),content_id uuid,created_by uuid,status text,title text,brand text,specialty text,script_text text,caption_text text,cta_type text,cta_text text,duration_min_seconds integer,duration_max_seconds integer,video_template text,media_mode text,music_mood text,input_assets jsonb,cover_settings jsonb,input_schema_version integer,created_at timestamptz default now(),drive_video_url text,output_video_url text);
 create table brand_logos(id uuid primary key default gen_random_uuid(),brand text,variant text,storage_path text,file_name text);
 create table video_assets(id uuid,content_id uuid,asset_type text,storage_path text,file_name text,mime_type text,file_size bigint,created_at timestamptz,asset_role text);
 create table activity_log(content_id uuid,actor_id uuid,action text,from_stage text,to_stage text);
 create table design_templates(id uuid primary key default gen_random_uuid(),template_key text);
 create table design_jobs(id uuid primary key default gen_random_uuid(),content_id uuid,created_by uuid,template_id uuid,request_key uuid unique,status text,scene_prompt text,image_model text,image_quality text,attempt_count integer,estimated_cost_usd numeric,created_at timestamptz default now(),scene_storage_path text);
 create table design_versions(id uuid primary key default gen_random_uuid(),content_id uuid,created_by uuid,scene_job_id uuid,source_file_url text,output_file_url text,settings jsonb,created_at timestamptz default now());`);
 const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260920_ai_design_routing.sql'),'utf8');
 await db.exec(migration); await db.exec(migration); // repeatable migration
 await db.exec(`create trigger content_items_guard before update on content_items for each row execute function guard_content_transition();`);
 const owner='00000000-0000-4000-8000-000000000001',reviewer='00000000-0000-4000-8000-000000000002',designer='00000000-0000-4000-8000-000000000003';
 async function identity(id,role){await db.query("select set_config('test.me',$1,false),set_config('test.role',$2,false)",[id,role]);}
 async function add(format='image_post',script='script',brand='sono') {return (await db.query(`insert into content_items(created_by,title,brand,content_format,script_text,target_duration_min_seconds,target_duration_max_seconds,video_template,cover_settings) values($1,'Title',$2,$3,$4,25,30,'quick_tips','{"logo_variant":"alternate"}') returning id`,[owner,brand,format,script])).rows[0].id;}
 async function route(id,target='ai',who=null){return (await db.query('select route_content_design($1,$2,$3) as item',[id,target,who])).rows[0].item;}
 await db.query('insert into admins values($1,\'designer\',true)',[designer]);
 await db.exec("insert into brand_logos(brand,variant,storage_path,file_name) values('sono','primary','primary.png','primary.png'),('sono','alternate','alternate.png','alternate.png'); insert into design_templates(template_key) values('sono-white-v1');");
 await identity(owner,'page_manager'); const image=await add();
 await assert.rejects(route(image),/مسؤول اعتماد/);
 await identity(reviewer,'approver');
 assert.equal((await route(image)).design_execution,'ai');
 assert.equal((await route(image)).stage,'in_design');
 await assert.rejects(db.query('select submit_ai_design($1)',[image]),/أكمل الإنتاج/);
 // Reviewers can reserve a scene only after routing, and request keys remain idempotent.
 const key='00000000-0000-4000-8000-000000000004';
 const reserve=()=>db.query("select reserve_design_scene($1,$2,'a scene without any text','medium') as data",[image,key]);
 assert.equal((await reserve()).rows[0].data.new,true);assert.equal((await reserve()).rows[0].data.new,false);
 await db.query("select save_design_version($1,'https://example.test/image.png',null,null,'{}')",[image]);
 await identity(owner,'page_manager');
 const submitted=(await db.query('select submit_ai_design($1) as item',[image])).rows[0].item;
 assert.equal(submitted.stage,'final_approval');
 await assert.rejects(db.query("update content_items set stage='ready_to_publish' where id=$1",[image]),/غير مسموح/);
 await identity(reviewer,'approver');
 const human=await add();assert.equal((await route(human,'human',designer)).assigned_designer,designer);
 const unsupported=await add('image_post','script','dr_dina');await assert.rejects(route(unsupported),/متاح/);
 const badVideo=await add('video','');await assert.rejects(route(badVideo),/السكريبت/);
 assert.equal((await db.query('select stage from content_items where id=$1',[badVideo])).rows[0].stage,'initial_approval');
 const video=await add('video'); await route(video);await route(video);
 const jobs=(await db.query('select * from video_jobs where content_id=$1',[video])).rows;
 assert.equal(jobs.length,1);assert.equal(jobs[0].cover_settings.logo_variant,'alternate');assert.equal(jobs[0].music_mood,'calm');
 await assert.rejects(db.query('select submit_ai_design($1)',[video]),/أكمل الإنتاج/);
 await db.query("update video_jobs set status='ready',output_video_url='https://example.test/video.mp4' where content_id=$1",[video]);
 assert.equal((await db.query('select submit_ai_design($1) as item',[video])).rows[0].item.stage,'final_approval');
 console.log('PASS — SQL migration repeatable; role gates, human/AI routing, video rollback, deduplication, logo/music snapshots, scene reservation and final approval tested.');
 await db.close();
})().catch(e=>{console.error(e.message);process.exitCode=1;});
