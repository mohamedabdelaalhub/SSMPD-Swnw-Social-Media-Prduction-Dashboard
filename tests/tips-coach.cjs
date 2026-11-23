// «نصايح الشغل» (owner «طبقه» 2026-11-22, mockup docs/ui-references/mockups/tips-coach.html).
// 1) migration 20261122230000 on PGlite: seen / learned / snooze / never / reset per user, own rows only, team view gated, grants, rollback.
// 2) UI: context first (doctor «وصل» → «اربط الدكتور بالعيادة» with the reason), animated slides, «جرّبها دلوقتي» opens the screen,
//    «كمّل اتعلّم» opens the video, «فهمت» saved, 3 a day / 20 min gap / never over an open form, finance set for accountants,
//    library + team view for managers, phone bottom sheet without overflow, English digits.
const fs=require('fs'),assert=require('node:assert/strict');
async function sql(){
 const {PGlite}=require('@electric-sql/pglite');const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;
  create table admins(id uuid primary key default gen_random_uuid(),name text,role text,active boolean default true);
  create table admin_extra_roles(admin_id uuid,role text);
  create function public.my_admin_id() returns uuid language sql stable as $$ select nullif(current_setting('t.me',true),'')::uuid $$;
  create function public.has_role(r text) returns boolean language sql stable as $$ select coalesce(current_setting('t.roles',true),'') like '%'||r||'%' $$;
  create function public.is_super() returns boolean language sql stable as $$ select public.has_role('super_admin') $$;`);
 await db.exec(fs.readFileSync('supabase/migrations/20261122230000_tips_coach_progress.sql','utf8'));
 const q=async(s,p=[])=>(await db.query(s,p)).rows;const [r1,r2,acc,gm]=(await q(`insert into admins(name,role) values('منى','reception'),('سارة','reception'),('رحاب','accountant'),('المدير','general_manager') returning id`)).map(x=>x.id);
 const as=async(roles,me)=>db.exec(`set t.roles='${roles}';set t.me='${me}'`);const call=async(f,a=[])=>(await q(`select public.${f}(${a.map((_,i)=>'$'+(i+1)).join(',')}) r`,a))[0].r;
 await as('reception',r1);for(const x of ['seen','seen','learned'])await call('tip_progress_mark',['room',x]);await call('tip_progress_mark',['call','snooze']);await call('tip_progress_mark',['collect','never']);
 let mine=await call('tip_progress_mine');const by=Object.fromEntries(mine.map(m=>[m.tip,m]));
 assert.equal(by.room.seen,2);assert.equal(by.room.learned,true);assert(Date.parse(by.call.snoozed_until)>Date.now()+3600e3,'snoozed ~2h');assert.equal(by.collect.never,true);
 await call('tip_progress_mark',['collect','reset']);assert.equal((await call('tip_progress_mine')).find(m=>m.tip==='collect').never,false,'reset brings it back');
 await assert.rejects(call('tip_progress_mark',['Bad Tip!','seen']),/bad tip/);await assert.rejects(call('tip_progress_mark',['room','delete']),/bad action/);
 await as('reception',r2);assert.deepEqual(JSON.parse(JSON.stringify(await call('tip_progress_mine'))),[],'own rows only');
 await assert.rejects(call('tip_progress_team'),/FORBIDDEN/);
 await as('general_manager',gm);const team=await call('tip_progress_team');const mona=team.find(t=>t.name==='منى');assert.equal(mona.seen,1);assert.equal(mona.learned,1);assert.equal(team.length,3,'reception + accountant staff only');
 const g=await q(`select p.proname,has_function_privilege('anon',p.oid,'execute') a from pg_proc p where proname like 'tip_progress%'`);assert.equal(g.length,3);g.forEach(x=>assert.equal(x.a,false));
 assert.equal((await q(`select has_table_privilege('authenticated','public.tip_progress','select') x`))[0].x,false);
 await db.exec(fs.readFileSync('supabase/rollbacks/20261122230000_tips_coach_progress.rollback.sql','utf8'));assert.equal((await q(`select to_regclass('public.tip_progress') x`))[0].x,null);
}
async function ui(){
 const {chromium}=require('playwright');const b=await chromium.launch();
 try{for(const [width,role] of [[1280,'reception'],[390,'reception'],[390,'accountant']]){const p=await b.newPage({viewport:{width,height:844}}),errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.setContent('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="user-dropdown"><div class="ud-items"></div></div><main id="view-container"><div class="journey-docline-list"><span class="journey-docline-item"><b>د. سارة علي</b> وصل</span></div><div class="journey-card"><span class="journey-chip-name">يحيى أحمد</span><button class="journey-pay journey-pay-due">التحصيل</button></div><button data-ft-go="shifts">استلم كاش من الخزن · استلم</button></main></body></html>');
  await p.addStyleTag({content:fs.readFileSync('assets/css/styles.css','utf8')+fs.readFileSync('assets/css/tips-coach.css','utf8')});
  await p.evaluate(r=>{window.calls=[];window.goto=[];window.videos=[];window.setInterval=()=>0;window.SSMPDAuth={currentAdmin:{id:'A1',role:r}};window.SSMPDRoles={rolesOf:a=>[a.role],canSeeTab:()=>true};
   window.SSMPDDb={client:{rpc:async(n,a)=>{calls.push([n,a]);return n==='tip_progress_mine'?{data:[]}:n==='tip_progress_team'?{data:[{name:'منى',role:'reception',seen:3,learned:2}]}:{data:{ok:true}};}}};
   window.SSMPDGotoTab=t=>goto.push(t);window.SSMPDTrainingVideos={open:f=>videos.push(f)};window.SSMPDToast={show(){}};},role);
  await p.addScriptTag({content:fs.readFileSync('assets/js/tips-coach.js','utf8')});
  await p.evaluate(()=>SSMPDTipsCoach._reset());
  assert.equal(await p.evaluate(()=>SSMPDTipsCoach.check(true)),true);await p.waitForSelector('.tc-tip');
  if(role==='reception'){
   assert.equal(await p.locator('.tc-tip').getAttribute('data-tip'),'room','context first: doctor arrived → link to a clinic');
   assert.match(await p.locator('.tc-why').innerText(),/د\. سارة علي وصل — اتأكد إنه مربوط بعيادة/);
   assert.match(await p.locator('.tc-cap').innerText(),/^1\. /);await p.locator('[data-tc="next"]').click();assert.match(await p.locator('.tc-cap').innerText(),/^2\. .*الدكتور/);
   const st=await p.locator('.tc-stage').boundingBox(),cu=await p.locator('.tc-cursor').boundingBox(),hl=await p.locator('.tc-stage .hl').boundingBox();
   assert(Math.abs((cu.x+cu.width/2)-(hl.x+hl.width/2))<20&&Math.abs((cu.y+cu.height/2)-(hl.y+hl.height/2))<20,'pointer lands on the highlighted button');
   assert.equal(await p.locator('.tc-vid.missing').count(),1,'«الفيديو جاي قريب» when no video yet');
   await p.locator('[data-tc="learned"]').click();assert.equal(await p.locator('.tc-tip').count(),0);
   assert(await p.evaluate(()=>calls.some(c=>c[0]==='tip_progress_mark'&&c[1].p_tip==='room'&&c[1].p_action==='learned')),'«فهمت» saved');
   // next: the collect tip (patient owes money), «جرّبها دلوقتي» opens reception
   await p.evaluate(()=>SSMPDTipsCoach.check(true));assert.equal(await p.locator('.tc-tip').getAttribute('data-tip'),'collect');
   await p.locator('[data-tc="try"]').click();assert.deepEqual(await p.evaluate(()=>goto),['reception_services']);
   // a tip with a video
   await p.evaluate(()=>SSMPDTipsCoach.show('call',''));await p.locator('[data-tc="video"]').click();assert.deepEqual(await p.evaluate(()=>videos),['02-call-start.mp4']);
   // limits: never over an open form, 3 a day
   await p.evaluate(()=>{const m=document.createElement('div');m.className='modal-backdrop';m.id='m';document.body.appendChild(m);});assert.equal(await p.evaluate(()=>SSMPDTipsCoach.check(true)),false,'not over a form');
   await p.evaluate(()=>document.getElementById('m').remove());
   assert.equal(await p.evaluate(()=>SSMPDTipsCoach.check(false)),false,'daily cap / gap respected (2 already shown today, 20 min gap)');
  }else{
   assert.equal(await p.locator('.tc-tip').getAttribute('data-tip'),'receive_cash','finance set + context for accountants');assert.match(await p.locator('.tc-t small').innerText(),/الحسابات/);
   await p.locator('[data-tc="close"]').click();
  }
  if(width<600){await p.evaluate(()=>SSMPDTipsCoach.show(SSMPDTipsCoach.tips[document.title||'reception']?'arrive':'arrive',''));const r=await p.locator('.tc-tip').boundingBox();assert(r.x<=1&&Math.abs(r.x+r.width-width)<=1,'bottom sheet on phones');
   assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no sideways scroll');await p.locator('[data-tc="close"]').click();}
  // library
  await p.evaluate(()=>SSMPDTipsCoach.library());await p.waitForSelector('.tc-lib');assert(await p.locator('.tc-row').count()>=10);assert.equal(await p.locator('[data-tc-set="team"]').count(),0,'team view for managers only');
  await p.locator('[data-tc-close]').click();
  const txt=await p.evaluate(()=>document.body.innerText);assert(!/[٠-٩]/.test(txt),'English digits');assert.deepEqual(errs,[]);await p.close();}
  // manager: library + team view
  const p=await b.newPage({viewport:{width:1280,height:844}});await p.setContent('<html dir="rtl"><body><div id="user-dropdown"><div class="ud-items"></div></div></body></html>');
  await p.evaluate(()=>{window.setInterval=()=>0;window.SSMPDAuth={currentAdmin:{id:'G',role:'general_manager'}};window.SSMPDRoles={rolesOf:a=>[a.role]};window.SSMPDDb={client:{rpc:async n=>n==='tip_progress_team'?{data:[{name:'منى',role:'reception',seen:3,learned:2}]}:{data:[]}}};});
  await p.addScriptTag({content:fs.readFileSync('assets/js/tips-coach.js','utf8')});await p.evaluate(()=>SSMPDTipsCoach._reset());
  assert.equal(await p.evaluate(()=>SSMPDTipsCoach.check(true)),false,'no popups for managers');
  await p.evaluate(()=>SSMPDTipsCoach.library());await p.locator('[data-tc-set="team"]').click();await p.waitForSelector('.tc-team');assert.match(await p.locator('.tc-team').innerText(),/منى[\s\S]*شاف 3 · اتعلّم 2 من 14/);
 }finally{await b.close();}
}
(async()=>{await sql();await ui();console.log('PASS tips coach: per-user progress (seen/learned/snooze/never/reset, own rows, gated team view, grants, rollback); context-first tips with animated slides, try/video/learned, limits, finance set, library + team view, phone bottom sheet, English digits.');})().catch(e=>{console.error(e);process.exit(1);});
