// 20261121130000: a home doctor visit is a basic service (open to every doctor); home nursing / labs / imaging are not.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
(async()=>{const db=new PGlite(),one=async(s,p)=>(await db.query(s,p)).rows[0];
 try{const base=fs.readFileSync('supabase/migrations/20261117130000_reception_basic_services_readiness.sql','utf8');
  await db.exec('create schema clinic_reception;'+base.slice(base.indexOf('create or replace function clinic_reception.norm_ar'),base.indexOf('-- Wrap the existing')));
  const b=async(n,dep='الباطنة')=>(await one('select clinic_reception.is_basic_service($1,$2) x',[dep,n])).x;
  assert.equal(await b('زيارة منزلية للطبيب'),false,'before: not basic');
  await db.exec(fs.readFileSync('supabase/migrations/20261121130000_home_consult_basic.sql','utf8'));
  for(const n of ['زيارة منزلية للطبيب','كشف منزلي','استشارة في المنزل','زياره منزليه'])assert.equal(await b(n),true,n);
  for(const n of ['تمريض منزلي','زيارة تمريض منزلي','سحب عينة من المنزل','أشعة منزلية','سونار منزلي','جلسة علاج طبيعي منزلية'])assert.equal(await b(n,'الطوارئ'),false,n);
  assert.equal(await b('كشف الأخصائي'),true,'old rules kept');assert.equal(await b('أي خدمة','خدمات الكشف'),true);assert.equal(await b('رسم قلب','الاشعة'),false);
  await db.exec(fs.readFileSync('supabase/rollbacks/20261121130000_home_consult_basic.rollback.sql','utf8'));
  assert.equal(await b('زيارة منزلية للطبيب'),false,'rollback');
  console.log('home consult basic: ok');
 }catch(e){console.error(e);process.exitCode=1;}finally{await db.close();}})();
