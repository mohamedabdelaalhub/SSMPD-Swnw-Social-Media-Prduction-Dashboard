// Live bug 2026-11-20: a three-word Arabic name refused as «اسم المريض مطلوب من كلمتين على الأقل». The DB guard
// psychcare.check_basics accepts letters/spaces only; invisible marks (RLM, ZWNJ, bidi, BOM), tatweel and harakat broke it.
// The archive form and the patients-create edge function now clean the name first (same rule in both files).
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
(async()=>{const src=fs.readFileSync('assets/js/render-patients.js','utf8'),edge=fs.readFileSync('supabase/functions/patients-create/index.ts','utf8');
 const clean=new Function('return '+src.slice(src.indexOf('function cleanPatientName'),src.indexOf('\n  }\n',src.indexOf('function cleanPatientName'))+4))();
 const body=f=>f.slice(f.indexOf('.replace(/[\\u200B'),f.indexOf('.trim()',f.indexOf('.replace(/[\\u200B')));
 assert.equal(body(src).replace(/\s+/g,''),body(edge).replace(/\s+/g,''),'same rule in the form and the edge function');
 assert.match(edge,/const fullName = cleanName\(/);assert.match(src,/cleanPatientName\(document\.getElementById\("np-name"\)\.value\)/);assert.match(src,/cleanPatientName\(document\.getElementById\("ep-name"\)\.value\)/);
 const db=new PGlite();const mig=fs.readFileSync('supabase/migrations/20261017224904_psychology_specialist.sql','utf8');
 await db.exec('create schema psychcare;'+mig.slice(mig.indexOf('create function psychcare.phone'),mig.indexOf('create function psychcare.patient_basics_guard')));
 const ok=async n=>{try{await db.query('select psychcare.check_basics($1,$2,$3)',[n,'01000000000',39]);return true;}catch(e){return false;}};
 const cases={'سارة تجريبية أولى':'سارة تجريبية أولى','سارة‏ تجريبية أولى‏':'سارة تجريبية أولى','‫سارة تجريبية‬':'سارة تجريبية','سارة‌تجريبية أولى':'سارةتجريبية أولى',
  'سـارة تجريبية':'سارة تجريبية','مُحَمَّد علي':'محمد علي','سارة تجريبية':'سارة تجريبية','  سارة   تجريبية  ':'سارة تجريبية','﻿سارة تجريبية':'سارة تجريبية'};
 for(const [raw,want] of Object.entries(cases)){const c=clean(raw);assert.equal(c,want,JSON.stringify(raw));assert.equal(await ok(c),true,'cleaned passes the DB guard: '+JSON.stringify(raw));}
 assert.equal(await ok('سارة‏ تجريبية'),false,'the raw RLM name is what the DB refused');assert.equal(await ok('سارة'),false,'one word is still refused');
 console.log('PASS patient name cleaning');
})().catch(e=>{console.error(e);process.exit(1);});
