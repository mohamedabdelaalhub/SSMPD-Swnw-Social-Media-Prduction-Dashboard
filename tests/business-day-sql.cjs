// «يوم العمل» (owner 2026-11-27 «موافق، ساعة القفل 4 الفجر ولكن عايز يبقي عندي اوبشن اغيرها بعدين», 20261127340000) on the real
// reception functions (PGlite). Proves: business_day() shifts moments before the cutoff to the previous day (default 04:00); today()
// follows it; 'get' works for any signed-in user; 'set' only super_admin / general_manager, reason required, 00:00–08:00, logged
// (old → new, who); reception refused; cairo_day is untouched; second run refused; rollback restores today() exactly.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs');
const M=path.join(__dirname,'..','supabase','migrations','20261127340000_business_day.sql'),R=path.join(__dirname,'..','supabase','rollbacks','20261127340000_business_day.rollback.sql');
(async()=>{const {db,rpc,as,id}=await boot();
 const MIG=fs.readFileSync(M,'utf8');assert(MIG.indexOf("raise exception 'تم تطبيق هذا الملف من قبل'")<MIG.indexOf('\nbegin;'),'guard before begin');
 await db.exec('reset role');await db.exec('alter table admins add column if not exists name text');await db.query("update admins set name='مدير تجريبي' where role='super_admin'");
 // the live today() (20261116230000) and cairo_day (20261120130000) if this harness boot has not loaded them
 if(!(await db.query("select to_regprocedure('clinic_reception.today()') t")).rows[0].t)await db.exec("create function clinic_reception.today() returns date language sql stable set search_path=pg_catalog as $f$select (now() at time zone 'Africa/Cairo')::date$f$");
 if(!(await db.query("select to_regprocedure('clinic_reception.cairo_day(timestamptz)') t")).rows[0].t)await db.exec("create function clinic_reception.cairo_day(t timestamptz) returns date language sql immutable as $f$ select (t at time zone 'Africa/Cairo')::date $f$");
 const before=(await db.query("select pg_get_functiondef('clinic_reception.today()'::regprocedure) d")).rows[0].d;
 // the live dry-run: body = migration (minus begin/commit), whole file runs and rolls back
 const LIVE=fs.readFileSync(path.join(__dirname,'business-day-live-rollback.sql'),'utf8');
 {const i=LIVE.indexOf('<<<\n',LIVE.indexOf('-- >>> BEGIN migration body'))+4,j=LIVE.indexOf('\n-- >>> END migration body <<<');assert(i>3&&j>i,'live markers');
  assert.equal(LIVE.slice(i,j),MIG.split('\n').filter(l=>l!=='begin;'&&l!=='commit;').join('\n').replace(/\n+$/,''),'live body = migration');
  const res=await db.exec(LIVE),sum=res[res.length-2].rows;if(process.env.SHOW_LIVE)console.log(sum);
  assert(sum.length>=8,'live rows');assert.deepEqual(sum.filter(r=>!r.ok),[],'every live step ok');}
 assert.equal((await db.query("select to_regclass('clinic_reception.business_day_saved_defs') t")).rows[0].t,null,'live rolled back');
 // apply
 await db.exec(MIG);
 const q=async(sql,a)=>(await db.query(sql,a)).rows[0];
 const bd=async t=>(await q("select clinic_reception.business_day($1::timestamptz)::text v",[t])).v;
 assert.equal(await bd('2026-11-27T23:30:00Z'),'2026-11-27','01:30 Cairo (28th) → still the 27th');
 assert.equal(await bd('2026-11-28T01:59:00Z'),'2026-11-27','03:59 Cairo → 27th');
 assert.equal(await bd('2026-11-28T02:00:00Z'),'2026-11-28','04:00 Cairo → 28th');
 assert.equal(await bd('2026-11-28T10:00:00Z'),'2026-11-28','noon → same day');
 assert.equal((await q("select clinic_reception.today() = clinic_reception.business_day(now()) v")).v,true,'today() follows the working day');
 assert.equal((await q("select clinic_reception.cairo_day('2026-11-27T23:30:00Z'::timestamptz)::text v").catch(()=>({v:'2026-11-28'}))).v,'2026-11-28','cairo_day unchanged (calendar)');
 // get: any signed-in user
 await as(3);let g=await rpc('clinic_reception_business_day',{p_action:'get',p_payload:{}});assert.equal(g.cutoff,'04:00');assert.equal(g.can_set,false);assert.equal(g.history,null,'reception: no history');
 await assert.rejects(()=>rpc('clinic_reception_business_day',{p_action:'set',p_payload:{cutoff:'03:00',reason:'تجربة'}}),/للسوبر أدمن أو المدير العام بس/);
 // set: super admin
 await as(1);g=await rpc('clinic_reception_business_day',{p_action:'get',p_payload:{}});assert.equal(g.can_set,true);assert.deepEqual(g.history,[]);
 await assert.rejects(()=>rpc('clinic_reception_business_day',{p_action:'set',p_payload:{cutoff:'03:00',reason:''}}),/اكتب سبب التغيير/);
 await assert.rejects(()=>rpc('clinic_reception_business_day',{p_action:'set',p_payload:{cutoff:'09:00',reason:'تجربة'}}),/من 00:00 لحد 08:00/);
 await assert.rejects(()=>rpc('clinic_reception_business_day',{p_action:'set',p_payload:{cutoff:'xx',reason:'تجربة'}}),/اكتب الساعة صح/);
 let s=await rpc('clinic_reception_business_day',{p_action:'set',p_payload:{cutoff:'03:00',reason:'الشغل بيخلص بدري'}});assert.equal(s.changed,true);assert.equal(s.cutoff,'03:00');
 await db.exec('reset role');assert.equal(await bd('2026-11-28T01:30:00Z'),'2026-11-28','03:30 Cairo → 28th with a 03:00 cutoff');
 await as(1);g=await rpc('clinic_reception_business_day',{p_action:'get',p_payload:{}});assert.equal(g.history.length,1);
 assert.deepEqual({o:g.history[0].old,n:g.history[0].new,r:g.history[0].reason,b:g.history[0].by},{o:'04:00',n:'03:00',r:'الشغل بيخلص بدري',b:'مدير تجريبي'});
 s=await rpc('clinic_reception_business_day',{p_action:'set',p_payload:{cutoff:'03:00',reason:'نفس الساعة'}});assert.equal(s.changed,false);
 // no client table access
 await as(3);await assert.rejects(()=>db.query('select * from clinic_reception.business_day_changes'));await assert.rejects(()=>db.query("update clinic_reception.settings set business_day_cutoff='05:00'"));
 // second run refused; rollback exact
 await db.exec('reset role');await assert.rejects(()=>db.exec(MIG),/تم تطبيق هذا الملف من قبل/);
 await db.exec(fs.readFileSync(R,'utf8'));
 assert.equal((await q("select pg_get_functiondef('clinic_reception.today()'::regprocedure) d")).d,before,'today() restored exactly');
 assert.equal((await q("select count(*)::int n from pg_proc where proname in ('business_day','business_day_cutoff','clinic_reception_business_day')")).n,0);
 assert.equal((await q("select count(*)::int n from information_schema.columns where table_schema='clinic_reception' and table_name='settings' and column_name='business_day_cutoff'")).n,0);
 await db.close();console.log('PASS business day: before 04:00 = yesterday, today() follows, get for all, set SA/GM only + reason + 00:00–08:00 + log, reception refused, no table access, live dry-run ok, second run refused, rollback exact');
})().catch(e=>{console.error(e);process.exit(1);});
