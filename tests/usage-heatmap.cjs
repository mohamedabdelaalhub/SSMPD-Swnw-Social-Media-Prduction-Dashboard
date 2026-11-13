// Usage heatmap: per-role daily counters (no user id) + tracker privacy rules.
const {PGlite}=require('@electric-sql/pglite'),{JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 await db.exec(`create schema auth;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('t.uid',true),'')::uuid$$;
  create role anon;create role authenticated;create role service_role;
  create table public.admins(id uuid primary key default gen_random_uuid(),user_id uuid,role text,active boolean default true);
  insert into public.admins(user_id,role) values('00000000-0000-0000-0000-0000000000a1','reception'),('00000000-0000-0000-0000-0000000000b1','nursing');`);
 const mig=fs.readFileSync('supabase/migrations/20261113230000_ui_usage_heatmap.sql','utf8');await db.exec(mig);await db.exec(mig);
 const call=async(uid,items)=>{await db.exec(`set t.uid='${uid}'`);return (await db.query('select public.ui_usage_track($1::jsonb) n',[JSON.stringify(items)])).rows[0].n;};
 assert.equal(await call('00000000-0000-0000-0000-0000000000a1',[{a:'home',e:'goto:tasks',n:3},{a:'tasks',e:'view'}]),2);
 assert.equal(await call('00000000-0000-0000-0000-0000000000a1',[{a:'home',e:'goto:tasks',n:2},{a:'',e:'x'},{a:'home',e:'y'.repeat(81)}]),1,'invalid rows skipped');
 assert.equal(await call('00000000-0000-0000-0000-0000000000b1',[{a:'home',e:'goto:tasks',n:9999}]),1);
 assert.equal(await call('00000000-0000-0000-0000-0000000000ff',[{a:'home',e:'goto:tasks'}]),0,'unknown user records nothing');
 const rows=(await db.query("select role,area,element,hits from public.ui_usage_daily order by role,area")).rows;
 assert.deepEqual(rows.map(r=>[r.role,r.area,r.element,r.hits]),[['nursing','home','goto:tasks',500],['reception','home','goto:tasks',5],['reception','tasks','view',1]]);
 const cols=(await db.query("select column_name from information_schema.columns where table_name='ui_usage_daily'")).rows.map(r=>r.column_name).sort();
 assert.deepEqual(cols,['area','day','element','hits','role'],'no user column');
 await db.exec(fs.readFileSync('supabase/rollbacks/20261113230000_ui_usage_heatmap.rollback.sql','utf8'));assert.equal((await db.query("select to_regclass('public.ui_usage_daily') t")).rows[0].t,null);await db.close();
 const dom=new JSDOM('<main><button data-goto="tasks">المهام</button><button data-action="open-task" data-id="123e4567-e89b-12d3-a456-426614174000">فتح المهمة</button><button>حفظ</button><button>01001234567</button><table><tr><td><button>أحمد محمود</button></td></tr></table><button id="user-menu-btn">☰</button><article data-patient-id="p1"><button>منى علي</button></article></main>',{runScripts:'outside-only',url:'https://dash.test/'});
 const w=dom.window;w.sessionStorage.setItem('ssmpd_active_tab','reception_services');w.eval(fs.readFileSync('assets/js/usage-heatmap.js','utf8'));
 w.document.querySelectorAll('button').forEach(b=>b.click());
 const keys=Object.keys(w.SSMPDUsageHeatmap._buf()).map(k=>k.replace('\u0001','|')).sort();
 assert.deepEqual(keys,['menu|goto:tasks','reception_services|#user-menu-btn','reception_services|action:open-task','reception_services|text:حفظ']);
 dom.window.close();console.log('PASS usage heatmap: per-role daily counters, invalid/unknown skipped, hits capped, no user column, rollback; tracker keeps keys/short labels only (no ids, phones, names in tables).');
})().catch(e=>{console.error(e);process.exit(1);});
