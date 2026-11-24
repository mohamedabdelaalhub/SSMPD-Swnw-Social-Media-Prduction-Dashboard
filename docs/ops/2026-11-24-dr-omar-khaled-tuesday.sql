-- د. عمر خالد احمد (provider 4f1132cd, EMP-000038, الباطنة) — owner 2026-11-24 via main chat 5: «الاثنين والثلاثاء من 5-9»,
-- «نفتحله حجوزات يدوية». He already exists live (provider, 6 scopes, contracts 40 % / 50 % like د.أحمد علي / د.أمل علي, كشف
-- الأخصائي 0001371 = 500). Only gap: Tuesday was 18:00–21:00 → now 17:00–21:00 (Monday 17:00–21:00 unchanged).
-- «حجوزات يدوية» needs no new flag: reception books him by hand at any free time inside 17–21 from the normal booking screen;
-- a time outside the window (or a taken slot) uses the existing «حجز بميعاد يدوي» (manual_time, reason «اتفاق مع الدكتور»).
-- Future WEEKLY availability rows of his Tuesdays (generated 18:00–21:00) are replaced, then the next 28 days regenerated;
-- manual / walk-in availability rows and every appointment are untouched. Self-contained and idempotent; dry-run with ROLLBACK first.
begin;
do $$
declare ws uuid; p record; n int; g int;
begin
  select pr.* into p from clinic_reception.providers pr join clinic_reception.workspaces w on w.id = pr.workspace_id and w.mode = 'live'
   where pr.id::text like '4f1132cd%' and pr.name like '%عمر خالد%';
  if p.id is null then raise exception 'provider 4f1132cd «عمر خالد» not found in the live workspace'; end if;
  ws := p.workspace_id;
  raise notice 'provider % (%), dept %, capacity %, gap %', p.name, p.id, p.department, p.capacity, p.booking_gap;
  -- Tuesday (dow 2) → 17:00–21:00
  delete from clinic_reception.weekly_slots where provider_id = p.id and dow = 2 and starts <> time '17:00';
  get diagnostics n = row_count;
  insert into clinic_reception.weekly_slots(workspace_id, provider_id, dow, starts, ends)
    values (ws, p.id, 2, '17:00', '21:00') on conflict (provider_id, dow, starts) do update set ends = excluded.ends;
  raise notice 'Tuesday slot → 17:00–21:00 (% old Tuesday rows removed)', n;
  -- future generated Tuesday windows (18:00–21:00) → regenerate from the schedule
  delete from clinic_reception.availability a where a.provider_id = p.id and a.source = 'weekly' and a.starts_at > now()
     and extract(dow from (a.starts_at at time zone 'Africa/Cairo')) = 2;
  get diagnostics n = row_count;
  g := clinic_reception.weekly_generate(ws, p.id, 28);
  raise notice 'future Tuesday weekly windows removed: %, regenerated (28 days): % rows', n, g;
  raise notice 'schedule now: %', (select string_agg(dow || ' ' || starts || '–' || ends, ' | ' order by dow, starts) from clinic_reception.weekly_slots where provider_id = p.id);
end $$;
commit;
