// «اللي اتعلمته من تعليقاتك»: مراجعة التعليقات القديمة، تفعيل تلقائي بعد تكرارين، قفل المالك ثابت، صلاحيات، والتراجع.
const {PGlite}=require('@electric-sql/pglite');
const fs=require('fs'),assert=require('assert/strict'),path=require('path'),root=path.resolve(__dirname,'..');
const CLAUDE='a0fbdfee-d147-4282-b988-186a9ae3e88c',OWNER='00000000-0000-0000-0000-000000000001',STAFF='00000000-0000-0000-0000-000000000002';
(async()=>{
  const db=new PGlite();
  await db.exec(`create role authenticated; create role anon; create role service_role;
  create function public.my_admin_id() returns uuid language sql as $$select nullif(current_setting('test.me',true),'')::uuid$$;
  create function public.can_manage_all_content() returns boolean language sql as $$select current_setting('test.role',true) in ('super_admin','general_manager')$$;
  create table admins(id uuid primary key,name text);
  insert into admins values ('${CLAUDE}','Claude Creative'),('${OWNER}','محمد'),('${STAFF}','موظف');
  create table content_items(id uuid primary key default gen_random_uuid(),title text,brand text,content_format text,stage text);
  create table comments(id uuid primary key default gen_random_uuid(),content_id uuid references content_items(id) on delete cascade,author_id uuid,body text,status text default 'pending',created_at timestamptz default now());`);
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261114200000_content_comment_lessons.sql'),'utf8');
  await db.exec(sql);await db.exec(sql); // مرتين: لازم يبقى idempotent
  const one=async(q,p)=>(await db.query(q,p)).rows;
  const [v]=await one(`insert into content_items(title,brand,content_format,stage) values ('ريل','sono','video','published') returning id`);
  const add=async(body,author=OWNER,at='2026-10-01')=>(await one(`insert into comments(content_id,author_id,body,created_at) values ($1,$2,$3,$4) returning id`,[v.id,author,body,at]))[0].id;
  const c1=await add('الخط صغير',OWNER,'2026-09-01'),c2=await add('كبّر الخط شوية',OWNER,'2026-10-01'),c3=await add('غيّر الصورة دي',OWNER,'2026-10-02'),c4=await add('تمام نفّذت',CLAUDE,'2026-10-03');
  // التعليقات القديمة كلها بتظهر، الأقدم الأول، من غير تعليقات Claude نفسه
  let un=await one(`select comment_id,brand,content_format from content_comment_lessons_unscanned(200)`);
  assert.deepEqual(un.map(r=>r.comment_id),[c1,c2,c3]);assert.equal(un[0].brand,'sono');assert.equal(un[0].content_format,'video');
  // درس من تعليق واحد = مرشّح؛ التعليق التاني بنفس المعنى يفعّله تلقائي
  const [{content_comment_lesson_record:L}]=await one(`select content_comment_lesson_record(array[$1]::uuid[],null,'sono','video','font','خط الكابشن في الريلز يبقى أكبر','الخط صغير')`,[c1]);
  let [l]=await one(`select status,hits from content_comment_lessons where id=$1`,[L]);assert.deepEqual(l,{status:'candidate',hits:1});
  await one(`select content_comment_lesson_record(array[$1,$1]::uuid[],$2)`,[c2,L]);
  [l]=await one(`select status,hits from content_comment_lessons where id=$1`,[L]);assert.deepEqual(l,{status:'active',hits:2},'active after 2 distinct comments');
  await one(`select content_comment_lesson_record(array[$1]::uuid[],$2)`,[c2,L]);
  [l]=await one(`select hits from content_comment_lessons where id=$1`,[L]);assert.equal(l.hits,2,'same comment does not count twice');
  await one(`select content_comment_lesson_skip(array[$1]::uuid[],'خاص بالمادة')`,[c3]);
  assert.equal((await one(`select * from content_comment_lessons_unscanned(200)`)).length,0,'all read');
  // صلاحيات: موظف عادي مايقدرش يقفل؛ المالك يقدر؛ والدرس المقفول مايتفعّلش لوحده تاني
  await db.exec(`select set_config('test.me','${STAFF}',false); select set_config('test.role','designer',false)`);
  await assert.rejects(db.query(`select content_comment_lesson_set_status($1,'disabled')`,[L]),/not allowed/);
  await db.exec(`select set_config('test.me','${OWNER}',false); select set_config('test.role','super_admin',false)`);
  await one(`select content_comment_lesson_set_status($1,'disabled')`,[L]);
  const c5=await add('الخط لسه صغير',OWNER,'2026-11-01');
  await one(`select content_comment_lesson_record(array[$1]::uuid[],$2)`,[c5,L]);
  [l]=await one(`select status,hits,status_changed_by from content_comment_lessons where id=$1`,[L]);
  assert.deepEqual(l,{status:'disabled',hits:3,status_changed_by:OWNER},'disabled stays disabled');
  await assert.rejects(db.query(`select content_comment_lesson_set_status($1,'candidate')`,[L]),/bad status/);
  // الصلاحيات: الواجهة بتقرا بس؛ دوال Claude لـservice_role بس
  const g=await one(`select routine_name,grantee from information_schema.role_routine_grants where routine_name like 'content_comment_lesson%' and grantee in ('authenticated','anon','service_role') order by 1,2`);
  const has=(fn,role)=>g.some(r=>r.routine_name===fn&&r.grantee===role);
  assert(has('content_comment_lesson_set_status','authenticated'));
  for(const fn of ['content_comment_lessons_unscanned','content_comment_lesson_record','content_comment_lesson_skip']){assert(has(fn,'service_role'),fn);assert(!has(fn,'authenticated'),fn+' not for staff');assert(!has(fn,'anon'));}
  const tg=await one(`select privilege_type from information_schema.role_table_grants where table_name='content_comment_lessons' and grantee='authenticated'`);
  assert.deepEqual(tg.map(r=>r.privilege_type),['SELECT']);
  // حذف التعليق بيشيل سجل القراءة؛ والتراجع بيشيل كل حاجة من غير ما يلمس comments
  await db.exec(fs.readFileSync(path.join(root,'supabase/rollbacks/20261114200000_content_comment_lessons.rollback.sql'),'utf8'));
  assert.equal((await one(`select to_regclass('public.content_comment_lessons') r`))[0].r,null);
  assert.equal((await one(`select count(*)::int n from comments`))[0].n,5);
  console.log('PASS comment lessons SQL (backfill oldest-first, auto-activate at 2, no double count, owner disable sticks, grants, rollback)');
})().catch(e=>{console.error(e);process.exit(1);});
