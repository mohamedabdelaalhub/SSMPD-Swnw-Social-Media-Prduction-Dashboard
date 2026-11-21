// Migration 20261122020000 compiles and only adds creator_name / reviewer_name to controls_snapshot's requests rows.
const fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const {PGlite}=require('@electric-sql/pglite');const db=new PGlite();
 await db.exec("create schema clinic_reception;create table public.admins(id uuid primary key,name text);");
 const sql=fs.readFileSync('supabase/migrations/20261122020000_reception_requests_names.sql','utf8');
 await db.exec(sql);
 const r=await db.query("select pg_get_functiondef('clinic_reception.controls_snapshot(uuid,date,date)'::regprocedure) d");
 const def=r.rows[0].d;
 assert(/creator_name/.test(def)&&/reviewer_name/.test(def),'names added');
 assert.equal((def.match(/'requests',/g)||[]).length,1,'single requests key');
 console.log('PASS requests names migration compiles; controls_snapshot rows carry creator_name / reviewer_name.');process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
