-- Live rollback check: «تعديل البيانات» works for the real reception user (Mazen) on BOTH buttons, after the 2026-11-21 hotfix
-- 20261120360000 (patient_name_clean SECURITY DEFINER). ONE transaction ending in ROLLBACK, as postgres. Nothing is kept.
--   (A) archive «تعديل البيانات» (render-patients.js → updatePatientRecord): PATCH public.patients as authenticated (RLS);
--   (B) reception «تعديل بيانات المريض» (reception-workspace.js → clinic_reception_patient_basic(ws, 'update', {id,name,phone,gender,age})).
-- The same values are written back (name with one extra space, which patient_name_clean must collapse), so the row is unchanged.
begin;
create temp table pe_live(n serial, step text, expected text, actual text, ok boolean);
do $$
declare mazen uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; ws uuid; p record; rp record; n int; err text; nm text; r jsonb;
begin
  select id into ws from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  -- a reception patient linked to an archive patient, with a two-word name
  select x.* into rp from clinic_reception.patients x where x.workspace_id = ws and x.patient_id is not null order by x.created_at desc limit 1;
  select * into p from public.patients where id = rp.patient_id;
  insert into pe_live(step, expected, actual, ok) values ('fixture', 'a linked patient', coalesce(left(p.id::text, 8), 'none'), p.id is not null);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', mazen, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mazen::text, true);
  -- (A) archive edit
  begin
    execute 'set local role authenticated';
    update public.patients set full_name = p.full_name || ' ', phone = p.phone, age = p.age, gender = p.gender where id = p.id;
    get diagnostics n = row_count;
    execute 'reset role'; err := 'ok';
  exception when others then execute 'reset role'; err := sqlerrm; n := 0; end;
  select full_name into nm from public.patients where id = p.id;
  insert into pe_live(step, expected, actual, ok) values ('(A) Mazen archive «تعديل البيانات» (patients update)', 'ok · 1 row · name cleaned',
    err || ' · ' || n || ' row · ' || case when nm = p.full_name then 'cleaned' else 'NOT cleaned' end, err = 'ok' and n = 1 and nm = p.full_name);
  -- (B) reception edit
  begin
    execute 'set local role authenticated';
    r := public.clinic_reception_patient_basic(ws, 'update', jsonb_build_object('id', rp.id, 'name', p.full_name, 'phone', p.phone, 'gender', p.gender, 'age', p.age));
    execute 'reset role'; err := 'ok';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into pe_live(step, expected, actual, ok) values ('(B) Mazen reception «تعديل بيانات المريض» (clinic_reception_patient_basic update)', 'ok', err, err = 'ok');
end $$;
select step, expected, actual, ok from pe_live order by n;
rollback;
