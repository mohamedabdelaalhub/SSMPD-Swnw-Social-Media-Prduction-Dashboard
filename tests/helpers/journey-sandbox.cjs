const fs=require('node:fs');
module.exports=async()=>{
 const b=await require('./reception-bridge.cjs')(['reception_canonical_catalog','reception_native_cutover','reception_management_pilot']);
 await b.db.exec("reset role;alter table clinic_reception.outbox add column if not exists payload jsonb not null default '{}';alter table leads add column if not exists do_not_contact boolean default false;");
 await b.db.exec(fs.readFileSync('tests/fixtures/journey-backend.sql','utf8'));
 const migration=fs.readdirSync('supabase/migrations').find(f=>f.endsWith('_patient_journey_sandbox.sql'));
 await b.db.exec(fs.readFileSync('supabase/migrations/'+migration,'utf8'));
 // Strongest live isolation condition: existing pilot stays enabled.
 await b.db.exec("update clinic_reception.settings set pilot_only=true,live_enabled=true,cutover_at=now(),communications_enabled=true");
 await b.owner("insert into clinic_reception.pilot_participants(admin_id) values($1)",[b.id(1)]);
 await b.as(1);
 return b;
};
