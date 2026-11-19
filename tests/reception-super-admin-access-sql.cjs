// Owner 2026-11-17: super admin / GM pass every reception action on the LIVE workspace (archive search was refused for the super admin).
// Loads the real current body of clinic_reception.access_before_management_pilot (20261103_reception_journey_action_permissions.sql) over small stubs,
// applies the migration, checks before/after, refuses a second apply, and rolls back.
const { PGlite } = require('@electric-sql/pglite'), fs = require('fs'), assert = require('node:assert/strict');
(async () => {
  const db = new PGlite();
  await db.exec(`create schema clinic_reception; create schema clinic_finance;
    create table admins(id uuid primary key, role text, active boolean default true);
    create function my_admin_id() returns uuid language sql stable as $$ select nullif(current_setting('test.admin',true),'')::uuid $$;
    create function has_role(r text) returns boolean language sql stable as $$ select exists(select 1 from admins where id=my_admin_id() and role=r) $$;
    create function clinic_finance.allowed(a text) returns boolean language sql stable as $$ select false $$;
    create table clinic_reception.workspaces(id uuid primary key, mode text);
    create table clinic_reception.settings(id boolean primary key default true, live_enabled boolean default true);
    insert into clinic_reception.settings default values;
    create function clinic_reception.workspace_access(w uuid, a text) returns uuid language plpgsql as $$ begin raise exception 'ليس لديك صلاحية هذه المساحة'; end $$;`);
  const src = fs.readFileSync('supabase/migrations/20261103_reception_journey_action_permissions.sql', 'utf8');
  await db.exec(src.slice(0, src.indexOf('\ndo $$')));
  const L = '00000000-0000-4000-8000-000000000001', T = '00000000-0000-4000-8000-000000000002';
  await db.exec(`insert into clinic_reception.workspaces values ('${L}','live'),('${T}','trial');
    insert into admins values ('00000000-0000-4000-8000-0000000000a1','super_admin'),('00000000-0000-4000-8000-0000000000a2','general_manager'),('00000000-0000-4000-8000-0000000000a3','reception'),('00000000-0000-4000-8000-0000000000a4','accountant');`);
  const as = async n => db.query("select set_config('test.admin',$1,false)", ['00000000-0000-4000-8000-0000000000a' + n]);
  const ok = async (ws, a) => { try { await db.query('select clinic_reception.access_before_management_pilot($1,$2)', [ws, a]); return true; } catch (e) { return false; } };
  await as(1); assert.equal(await ok(L, 'book'), false, 'before: super admin refused (the bug)');
  const mig = fs.readFileSync('supabase/migrations/20261117180000_reception_super_admin_access.sql', 'utf8');
  await db.exec(mig);
  await assert.rejects(() => db.exec(mig), /تم تطبيق هذا الملف/); await db.exec('rollback');
  for (const n of [1, 2]) { await as(n); for (const a of ['view', 'book', 'execute', 'manage']) assert.equal(await ok(L, a), true, 'admin ' + n + ' ' + a); assert.equal(await ok(T, 'book'), false, 'trial unchanged'); }
  await as(3); assert.equal(await ok(L, 'book'), true); assert.equal(await ok(L, 'manage'), false, 'reception unchanged');
  await as(4); assert.equal(await ok(L, 'book'), false, 'other roles unchanged');
  await db.exec(fs.readFileSync('supabase/rollbacks/20261117180000_reception_super_admin_access.rollback.sql', 'utf8'));
  await as(1); assert.equal(await ok(L, 'book'), false, 'rollback restores');
  await db.close(); console.log('PASS reception super admin access: super admin + GM pass every action on the live workspace; trial, reception, other roles unchanged; idempotent guard; rollback.');
})().catch(e => { console.error(e); process.exit(1); });
