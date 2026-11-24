// 20261125020000 (owner 2026-11-25): a package's expiry counts from the Cairo date, whatever the server time zone.
// The session time zone is set far from Cairo (UTC+14 / UTC−10) so the server date differs from the Cairo date.
const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite();const one=async(t,p)=>(await db.query(t,p)).rows[0];
 await db.exec(`create role anon;create role authenticated;create schema clinic_reception;
  create table clinic_reception.packages(id uuid primary key default gen_random_uuid(),name text,expires_on date,legacy_paid_on date);`);
 await db.exec(fs.readFileSync('supabase/migrations/20261125020000_package_expiry_cairo_day.sql','utf8'));
 for(const tz of ['Pacific/Kiritimati','Pacific/Honolulu','UTC','Africa/Cairo']){
  await db.exec(`set timezone='${tz}'`);
  const r=await one("insert into clinic_reception.packages(name,expires_on) values('عرض',current_date+120) returning expires_on::text e, ((now() at time zone 'Africa/Cairo')::date+120)::text want, current_date::text srv, (now() at time zone 'Africa/Cairo')::date::text cairo");
  assert.equal(r.e,r.want,tz+': expiry = Cairo date + 120 (server date '+r.srv+', Cairo '+r.cairo+')');
  const l=await one("insert into clinic_reception.packages(name,expires_on,legacy_paid_on) values('قديم','2027-01-01','2026-11-15') returning expires_on::text e");
  assert.equal(l.e,'2027-01-01',tz+': a legacy package keeps the typed date');
 }
 await db.exec(fs.readFileSync('supabase/rollbacks/20261125020000_package_expiry_cairo_day.rollback.sql','utf8'));
 await db.exec("set timezone='Pacific/Kiritimati'");
 const r=await one("insert into clinic_reception.packages(name,expires_on) values('بعد التراجع',current_date+120) returning (expires_on = current_date+120) ok");assert.equal(r.ok,true,'rollback: server date again');
 console.log('PASS package expiry Cairo day: in UTC+14 / UTC−10 / UTC / Cairo sessions a sold package expires on Cairo date + validity; legacy packages keep the typed date; rollback restores.');
})().catch(e=>{console.error(e);process.exit(1);});
