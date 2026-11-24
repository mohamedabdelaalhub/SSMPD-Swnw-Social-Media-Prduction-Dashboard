// 20261124210000 (owner bug 2026-11-24, ENT follow-up auto-booked as «أخذ عينة من الأذن…»): when the booking source names no
// service and the doctor has no saved one, auto booking picks only a consultation-type service of his department
// (كشف → استشارة → متابعة) or NULL (= staff review 'service'), never a procedure. Steps 1–2 unchanged. Rollback restores.
const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('node:assert/strict');
const fn=(file,name)=>{const s=fs.readFileSync('supabase/migrations/'+file,'utf8'),i=s.indexOf('create function clinic_reception.'+name+'(');assert(i>=0,name);const j=s.indexOf('$$;',s.indexOf('$$',s.indexOf(' as $$',i)+6))+3;return s.slice(i,j);};
(async()=>{const db=new PGlite();const q=(t,p)=>db.query(t,p),one=async(t,p)=>(await q(t,p)).rows[0];
 await db.exec(`create role anon;create role authenticated;create schema clinic_reception;
  create table clinic_reception.providers(id uuid primary key,workspace_id uuid,name text,department text);
  create table clinic_reception.services(id uuid primary key default gen_random_uuid(),workspace_id uuid,code text,name text,department text,minutes int default 15,active boolean default true,placeholder boolean not null default false);
  create table clinic_reception.provider_departments(provider_id uuid,department text);
  create table clinic_reception.external_bookings(id uuid primary key default gen_random_uuid(),state text,review_kind text,reason text,attempts int default 0,updated_at timestamptz,day date);
  create function clinic_reception.cairo_day(t timestamptz) returns date language sql as $$select (t at time zone 'Africa/Cairo')::date$$;
  create table clinic_reception.appointments(id uuid primary key default gen_random_uuid(),provider_id uuid,service_id uuid,status text default 'booked');
  create table clinic_reception.auto_book_services(provider_id uuid,service_code text);
  create table clinic_reception.provider_service_scopes(provider_id uuid,service_code text);
  create table clinic_reception.auto_time_saved_defs(name text primary key,def text not null);`);
 await db.exec(fn('20261121100000_auto_book_masa_service_name.sql','service_name_key')+';');
 await db.exec(fn('20261120130000_reception_auto_book.sql','auto_book_service'));
 await db.exec(fn('20261121100000_auto_book_masa_service_name.sql','auto_book_service_for'));
 await db.exec(fn('20261122330000_masa_day_only_auto_time.sql','auto_time_service'));
 const ws='00000000-0000-4000-8000-000000000001',ent='00000000-0000-4000-8000-0000000000e1',der='00000000-0000-4000-8000-0000000000d1',gyn='00000000-0000-4000-8000-0000000000a1';
 await q("insert into clinic_reception.providers values($1,$4,'د. أنف','أنف وأذن'),($2,$4,'د. جلدية','الجلدية'),($3,$4,'د. نسا','النساء')",[ent,der,gyn,ws]);
 const svc=async(code,name,dep,min)=>(await one("insert into clinic_reception.services(workspace_id,code,name,department,minutes) values($1,$2,$3,$4,$5) returning id",[ws,code,name,dep,min])).id;
 const sample=await svc('0001202','أخذ عينة من الأذن تحت مخدر موضعي','أنف وأذن',10),entCons=await svc('0001150','استشارة أنف وأذن','أنف وأذن',15),entFollow=await svc('0001151','متابعة أنف وأذن','أنف وأذن',10);
 const laser=await svc('0001300','إزالة ثآليل','الجلدية',5),derKashf=await svc('0001310','كشف جلدية','الجلدية',15);
 const gynProc=await svc('0001400','تركيب لولب','النساء',10);
 const pick=async(p,needed=null)=>(await one('select clinic_reception.auto_time_service($1,$2,$3) v',[ws,p,needed])).v;
 // before: the bug
 assert.equal(await pick(ent),sample,'old behaviour reproduced: ENT HAS «استشارة» but no «كشف» → the shortest service, the procedure «أخذ عينة…»');
 await q("delete from clinic_reception.services where id=$1",[entCons]);await q("update clinic_reception.services set active=false where id=$1",[entFollow]);
 await q("update clinic_reception.services set active=true where id=$1",[entFollow]);
 for(let i=0;i<3;i++)await q("insert into clinic_reception.appointments(provider_id,service_id) values($1,$2),($3,$4)",[der,laser,ent,sample]);
 assert.equal(await pick(ent),sample,'old: the most used service wins even when it is a procedure');
 assert.equal(await pick(der),derKashf,'old: the department\'s single «كشف…» service (step 2) was already right');
 // apply
 await q("insert into clinic_reception.external_bookings(state,review_kind,day) values('review','service',current_date+1),('review','full_day',current_date+1),('review','service',current_date-3)");
 await db.exec(fs.readFileSync('supabase/migrations/20261124210000_auto_book_consult_only.sql','utf8'));
 assert.deepEqual((await q("select state from clinic_reception.external_bookings order by day,review_kind")).rows.map(r=>r.state),['review','review','pending'],'future review/service re-queued; full_day and past untouched');
 assert.equal(await pick(ent),entFollow,'ENT: no كشف/استشارة → متابعة (consultation-type), not the procedure');
 const entCons2=await svc('0001152','استشاره انف واذن','أنف وأذن',15);
 assert.equal(await pick(ent),entCons2,'ENT: استشارة preferred over متابعة');
 assert.equal(await pick(der),derKashf,'كشف');
 for(let i=0;i<2;i++)await q("insert into clinic_reception.appointments(provider_id,service_id) values($1,$2)",[der,derKashf]);
 assert.equal(await pick(der),derKashf);
 assert.equal(await pick(gyn),null,'department with no consultation service → NULL (staff review)');
 // steps 1–2 unchanged: a named service and a saved service still win, even a procedure
 assert.equal(await pick(ent,'أخذ عينة من الأذن تحت مخدر موضعي'),sample,'source names the service → used');
 await q("insert into clinic_reception.auto_book_services values($1,'0001400')",[gyn]);
 assert.equal(await pick(gyn),gynProc,'saved per-doctor service → used');
 // a doctor whose services live in an EXTRA department (home department has none): used to be NULL → review 'service'
 const neu='00000000-0000-4000-8000-0000000000b1';await q("insert into clinic_reception.providers values($1,$2,'د. أعصاب','مخ وأعصاب')",[neu,ws]);
 await q("insert into clinic_reception.provider_departments values($1,'المخ والأعصاب')",[neu]);
 const nk=await svc('0001500','كشف مخ وأعصاب','المخ والأعصاب',15),ns=await svc('0001501','استشارة مخ وأعصاب','المخ والأعصاب',15),ne=await svc('0001502','رسم مخ','المخ والأعصاب',5);
 assert.equal(await pick(neu),nk,'extra department: كشف (not NULL, not the 5-min procedure)');
 assert.equal(await pick(neu,'كشف جديد'),nk,'«كشف جديد» → كشف');
 assert.equal(await pick(neu,'استشارة'),ns,'«استشارة» → استشارة');
 // a scope row also counts
 const lone='00000000-0000-4000-8000-0000000000c1';await q("insert into clinic_reception.providers values($1,$2,'د. وحيد','قسم فاضي')",[lone,ws]);
 assert.equal(await pick(lone),null,'serves nothing → NULL');
 await q("insert into clinic_reception.provider_service_scopes values($1,'0001501')",[lone]);assert.equal(await pick(lone),ns,'scope row → its consultation');
 // the parked «اختار الخدمة» rows were re-queued by the migration
 // rollback
 await db.exec(fs.readFileSync('supabase/rollbacks/20261124210000_auto_book_consult_only.rollback.sql','utf8'));
 assert.equal(await pick(ent),sample,'rollback restores the old picker');
 assert.equal((await one("select count(*)::int n from clinic_reception.auto_time_saved_defs")).n,0);
 console.log('PASS auto-book consult only: no named/saved service → كشف / استشارة / متابعة of the department or NULL (review), never a procedure; named + saved services unchanged; rollback restores.');
})().catch(e=>{console.error(e);process.exit(1);});
