// Migration 20261122030000 compiles; the alerts rows also read customer_bookings (dash-less ref) for patient / doctor / date / time.
const fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const {PGlite}=require('@electric-sql/pglite');const db=new PGlite();
 await db.exec("create schema clinic_reception;");
 await db.exec(fs.readFileSync('supabase/migrations/20261122030000_fallback_alerts_customer_booking.sql','utf8'));
 const def=(await db.query("select pg_get_functiondef('public.clinic_reception_fallback(uuid,text,jsonb)'::regprocedure) d")).rows[0].d;
 assert(/left join public\.customer_bookings cb on replace\(cb\.booking_request_id, '-', ''\) = a\.ref/.test(def),'join on dash-less ref');
 assert(/cb\.customer_name/.test(def)&&/cb\.doctor_name/.test(def)&&/cb\.appointment_date/.test(def)&&/cb\.appointment_time/.test(def),'fallback fields');
 console.log('PASS fallback alerts migration compiles and joins customer_bookings.');process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
