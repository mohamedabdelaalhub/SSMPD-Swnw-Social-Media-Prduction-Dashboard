// refresh_content_learnings (migration 20261114120000): character reels vs normal reels of the same page, min 3 of each, plus the old dimensions untouched.
const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 await db.exec(`create table public.content_items(id uuid primary key default gen_random_uuid(),content_angle text);
  create table public.content_learnings(id uuid primary key default gen_random_uuid(),brand text,dimension text,value text,verdict text,confidence text,evidence jsonb,note text,source text,week_end date,expires_at timestamptz,active boolean default true,created_at timestamptz default now());
  create table public.perf(content_id uuid,brand text,content_format text,cta_type text,specialty text,daypart text,weekday text,engagement bigint);
  create function public.content_performance(d int) returns table(content_id uuid,brand text,title text,content_format text,cta_type text,specialty text,made_by_claude boolean,published_at timestamptz,daypart text,weekday text,reach bigint,engagement bigint,rating text) language sql as $$
   select content_id,brand,null::text,content_format,cta_type,specialty,true,now(),daypart,weekday,0::bigint,engagement,null::text from public.perf $$;`);
 const add=async(brand,fmt,angle,eng,n)=>{for(let i=0;i<n;i++){const id=(await db.query("insert into public.content_items(content_angle) values($1) returning id",[angle])).rows[0].id;
   await db.query("insert into public.perf values($1,$2,$3,'booking','pediatrics','noon','2',$4)",[id,brand,fmt,eng]);}};
 // sono: 4 normal reels @100, 3 character reels @200 (=2x), 6 posts @50 ; dr_dina: 3 normal @100, 3 character @60 (0.6x) ; both have >= 6 rows for the base
 await add('sono','video',null,100,4);await add('sono','video','character_reel',200,3);await add('sono','image_post',null,50,6);
 await add('dr_dina','video',null,100,3);await add('dr_dina','video','character_reel',60,3);
 await db.exec(fs.readFileSync('supabase/migrations/20261114120000_character_reel_learning.sql','utf8'));
 const n=(await db.query("select public.refresh_content_learnings() n")).rows[0].n;
 const rows=(await db.query("select brand,dimension,value,verdict,confidence,evidence from public.content_learnings where source='system' and active order by brand,dimension")).rows;
 const rs=rows.filter(r=>r.dimension==='reel_style');
 const s=rs.find(r=>r.brand==='sono'),d=rs.find(r=>r.brand==='dr_dina');
 assert(s&&s.verdict==='do_more'&&s.value==='character_reel'&&s.evidence.ratio==2&&s.evidence.character_reels===3&&s.evidence.normal_reels===4,'sono: 2x the normal reels -> do_more');
 assert(d&&d.verdict==='do_less'&&d.evidence.ratio===0.6,'dr_dina: 0.6x -> do_less');
 assert(rows.some(r=>r.dimension==='format'),'old dimensions still computed');
 // fewer than 3 character reels -> no verdict
 await db.exec("delete from public.perf where content_id in (select id from public.content_items where content_angle='character_reel') and brand='sono' and engagement=200 and ctid in (select ctid from public.perf where brand='sono' and engagement=200 limit 1)");
 await db.exec("select public.refresh_content_learnings()");
 assert(!(await db.query("select 1 from public.content_learnings where active and source='system' and dimension='reel_style' and brand='sono'")).rows.length,'2 character reels are not enough');
 // idempotent: old system rows are deactivated, not duplicated
 await db.exec("select public.refresh_content_learnings()");
 assert.equal((await db.query("select count(*)::int n from public.content_learnings where active and source='system' and dimension='reel_style'")).rows[0].n,1);
 await db.close();console.log('PASS character-reel learning: compares with normal reels per page (>=3 each), do_more/do_less by ratio, nothing under 3, old dimensions kept, re-run safe.');
})().catch(e=>{console.error(e);process.exit(1);});
