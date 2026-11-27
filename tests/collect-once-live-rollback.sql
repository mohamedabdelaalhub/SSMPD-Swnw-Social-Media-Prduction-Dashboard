-- Live rollback test for 20261127110000_collect_once.sql («التحصيل بضغطة واحدة»).
-- Run the WHOLE file as postgres, BEFORE the apply. ONE transaction, ends with ROLLBACK — no receipt, no money, nothing kept.
-- Acts as Mazen (reception, auth sub f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb) on the LIVE reception workspace with 1.00 «إنستا باي»
-- receipts on one reception patient file (proof rows for the references are inserted inside the txn; the unrelated cash-shift guard
-- is stubbed inside the txn if Mazen has no open shift). Prints flags and counts only (no names, no amounts per patient).
-- Rows: 0 before the fix a second identical collect is ACCEPTED (repro) · 1 first collect ok · 2 same token replay → same answer, no new
-- receipt · 3 a NEW identical collect → refused, hint duplicate_collect, nothing recorded · 4 confirm_duplicate → saved, noted ·
-- 5 different amount → no warning · 6 rollback body. Output: one table (step, expected, actual, ok).
do $$ begin
  if to_regprocedure('clinic_reception.command_before_collect_once(uuid,text,jsonb,uuid)') is not null then
    raise exception '20261127110000 already applied — this dry-run is for before the apply'; end if;
end $$;

begin;
create temp table co_live(n serial, step text, expected text, actual text, ok boolean);
create temp table co_fx(sub uuid, me uuid, w uuid, pat uuid, tag text);
do $$ declare sub uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; me uuid; w uuid; pat uuid; tag text := 'CO' || to_char(clock_timestamp(), 'HH24MISSMS'); g jsonb; r text;
begin
  select id into me from public.admins where user_id = sub;
  select id into w from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  if me is null or w is null then raise exception 'Mazen / live workspace missing'; end if;
  select p.id into pat from clinic_reception.patients p where p.workspace_id = w and p.patient_id is not null order by p.created_at desc limit 1;
  foreach r in array array['-R0A','-R0B','-R1','-R3','-R4','-R5'] loop
    insert into clinic_reception.payment_proofs(workspace_id, admin_id, reference, path) values (w, me, tag || r, 'dry-run/' || tag || r || '.jpg');
  end loop;
  insert into co_fx values (sub, me, w, pat, tag);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', sub::text, true);
  if to_regprocedure('clinic_reception.shift_guard_check(uuid)') is not null then
    begin g := clinic_reception.shift_guard_state();
      if coalesce((g->>'locked')::boolean, false) then
        execute 'create or replace function clinic_reception.shift_guard_check(p_workspace uuid) returns void language plpgsql as $f$ begin return; end $f$';
        insert into co_live(step, expected, actual, ok) values ('shift guard (unrelated)', 'open shift, or stubbed in this txn', 'stubbed (Mazen had no open shift)', true);
      end if;
    exception when others then insert into co_live(step, expected, actual, ok) values ('shift guard (unrelated)', 'state readable', sqlerrm, true); end;
  end if;
  insert into co_live(step, expected, actual, ok) values ('fixture', 'live workspace + one reception file', 'patient file found ' || (pat is not null), pat is not null);
end $$;

-- 0) BEFORE: two identical collects in two windows are both accepted (the bug)
do $$ declare f co_fx; n0 int; n1 int; err text := 'ok';
begin select * into f from co_fx;
  select count(*) into n0 from clinic_reception.payments where workspace_id = f.w and patient_id = f.pat;
  execute 'set local role authenticated';
  begin
    perform public.clinic_reception_command(f.w, 'collect', jsonb_build_object('patient_id', f.pat, 'amount', 1, 'method', 'instapay', 'reference', f.tag || '-R0A'), gen_random_uuid());
    perform public.clinic_reception_command(f.w, 'collect', jsonb_build_object('patient_id', f.pat, 'amount', 1, 'method', 'instapay', 'reference', f.tag || '-R0B'), gen_random_uuid());
  exception when others then err := sqlerrm; end;
  execute 'reset role';
  select count(*) into n1 from clinic_reception.payments where workspace_id = f.w and patient_id = f.pat;
  insert into co_live(step, expected, actual, ok) values ('0 before fix: two identical collects', 'both accepted (repro)', err || ' · new receipts ' || (n1 - n0), err = 'ok' and n1 - n0 = 2);
  -- age them so they do not interfere with the rows below
  update clinic_reception.payments set created_at = created_at - interval '10 minutes' where workspace_id = f.w and patient_id = f.pat and reference like f.tag || '-R0_';
end $$;

-- >>> MIGRATION BODY: supabase/migrations/20261127110000_collect_once.sql (between its begin; / commit;) >>>

do $$ begin
  if to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') is null or to_regclass('clinic_reception.commands') is null then
    raise exception 'clinic_reception_command / commands غير موجودة'; end if;
  if to_regprocedure('clinic_reception.command_before_collect_once(uuid,text,jsonb,uuid)') is not null then
    raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter function public.clinic_reception_command(uuid, text, jsonb, uuid) rename to command_before_collect_once;
alter function public.command_before_collect_once(uuid, text, jsonb, uuid) set schema clinic_reception;

create function clinic_reception.collect_method_label(p text) returns text language sql immutable set search_path = pg_catalog as $$
  select case p when 'cash' then 'نقدي' when 'pos' then 'فيزا' when 'bank' then 'تحويل بنكي' when 'instapay' then 'إنستا باي'
                when 'wallet' then 'محفظة' else coalesce(p, '') end $$;

create function public.clinic_reception_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); v_patient uuid; v_amount numeric; v_method text; prev record; secs int; out jsonb; pid uuid;
  v_note text;
begin
  if p_action not in ('collect', 'collect_multi') or jsonb_typeof(p_payload) is distinct from 'object' then
    return clinic_reception.command_before_collect_once(p_workspace, p_action, p_payload, p_token);
  end if;
  -- a replayed token returns the stored answer, never a duplicate warning
  if me is not null and p_token is not null
     and exists (select 1 from clinic_reception.commands c where c.workspace_id = p_workspace and c.actor_id = me and c.token = p_token) then
    return clinic_reception.command_before_collect_once(p_workspace, p_action, p_payload, p_token);
  end if;
  begin
    v_patient := nullif(p_payload->>'patient_id', '')::uuid;
    v_amount := round(nullif(p_payload->>'amount', '')::numeric, 2);
  exception when others then v_patient := null; v_amount := null; end;
  v_method := nullif(p_payload->>'method', '');
  if v_patient is not null and v_amount is not null and v_method is not null then
    select p.id, to_jsonb(p)->>'receipt_no' receipt_no, p.created_at into prev
      from clinic_reception.payments p
     where p.workspace_id = p_workspace and p.patient_id = v_patient and p.method = v_method and round(p.amount, 2) = v_amount
       and p.created_at > now() - interval '2 minutes'
     order by p.created_at desc limit 1;
    if found then
      if coalesce((p_payload->>'confirm_duplicate')::boolean, false) is not true then
        secs := greatest(1, extract(epoch from (now() - prev.created_at))::int);
        raise exception 'اتسجل للمريض ده نفس المبلغ (% ج.م %) من % ثانية — إيصال %. لو المريض دافع مرة تانية فعلاً دوس «حصّل تاني برضه»، غير كده اقفل الشباك.',
            to_char(v_amount, 'FM999999990.##'), clinic_reception.collect_method_label(v_method), secs, coalesce(prev.receipt_no, 'بدون رقم')
          using errcode = 'P0001', hint = 'duplicate_collect',
                detail = jsonb_build_object('receipt_no', prev.receipt_no, 'seconds', secs, 'amount', v_amount, 'method', v_method)::text;
      end if;
      out := clinic_reception.command_before_collect_once(p_workspace, p_action, p_payload, p_token);
      begin pid := coalesce(nullif(out->>'id', ''), nullif(out->>'payment_id', ''))::uuid; exception when others then pid := null; end;
      if pid is not null then
        v_note := 'تحصيل تاني متأكد منه — الإيصال السابق ' || coalesce(prev.receipt_no, 'بدون رقم');
        if exists (select 1 from pg_attribute where attrelid = 'clinic_reception.payments'::regclass and attname = 'note' and not attisdropped) then
          execute 'update clinic_reception.payments set note = left(case when nullif(btrim(coalesce(note, '''')), '''') is null then $1 else note || '' — '' || $1 end, 300)
                    where id = $2 and workspace_id = $3' using v_note, pid, p_workspace;
        end if;
      end if;
      return out;
    end if;
  end if;
  return clinic_reception.command_before_collect_once(p_workspace, p_action, p_payload, p_token);
end $$;

-- the wrapper gets exactly the privileges of the function it wraps
do $$ declare r record; begin
  execute 'revoke all on function public.clinic_reception_command(uuid,text,jsonb,uuid) from public, anon, authenticated';
  for r in select a.grantee, a.privilege_type from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            where p.oid = 'clinic_reception.command_before_collect_once(uuid,text,jsonb,uuid)'::regprocedure and a.grantee <> p.proowner loop
    execute format('grant %s on function public.clinic_reception_command(uuid,text,jsonb,uuid) to %s', r.privilege_type,
                   case when r.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(r.grantee)) end);
  end loop;
  execute 'revoke all on function clinic_reception.command_before_collect_once(uuid,text,jsonb,uuid) from public, anon, authenticated';
end $$;
revoke all on function clinic_reception.collect_method_label(text) from public, anon, authenticated;

-- <<< END MIGRATION BODY <<<

do $$ declare f co_fx; k uuid := gen_random_uuid(); a jsonb; b jsonb; c jsonb; n0 int; n1 int; err text; hint text; note text;
begin select * into f from co_fx;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', f.sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', f.sub::text, true);
  -- 1) first collect
  execute 'set local role authenticated';
  begin a := public.clinic_reception_command(f.w, 'collect', jsonb_build_object('patient_id', f.pat, 'amount', 1, 'method', 'instapay', 'reference', f.tag || '-R1'), k); err := 'ok';
  exception when others then err := sqlerrm; end;
  execute 'reset role';
  insert into co_live(step, expected, actual, ok) values ('1 Mazen collect 1.00 إنستا باي', 'ok · receipt RC-…', err || ' · receipt ' || coalesce((select to_jsonb(p)->>'receipt_no' from clinic_reception.payments p where p.id = nullif(a->>'id','')::uuid) like 'RC-%', false), err = 'ok');
  -- 2) same token replay
  select count(*) into n0 from clinic_reception.payments where workspace_id = f.w and patient_id = f.pat;
  execute 'set local role authenticated';
  begin b := public.clinic_reception_command(f.w, 'collect', jsonb_build_object('patient_id', f.pat, 'amount', 1, 'method', 'instapay', 'reference', f.tag || '-R1'), k); err := 'ok';
  exception when others then err := sqlerrm; end;
  execute 'reset role';
  select count(*) into n1 from clinic_reception.payments where workspace_id = f.w and patient_id = f.pat;
  insert into co_live(step, expected, actual, ok) values ('2 same token again (double click / retry)', 'same answer · no new receipt', err || ' · same ' || (a = b) || ' · new ' || (n1 - n0), err = 'ok' and a = b and n1 = n0);
  -- 3) a new window, identical → refused
  execute 'set local role authenticated';
  begin perform public.clinic_reception_command(f.w, 'collect', jsonb_build_object('patient_id', f.pat, 'amount', 1, 'method', 'instapay', 'reference', f.tag || '-R3'), gen_random_uuid()); err := 'accepted'; hint := null;
  exception when others then get stacked diagnostics err = message_text, hint = pg_exception_hint; end;
  execute 'reset role';
  select count(*) into n1 from clinic_reception.payments where workspace_id = f.w and patient_id = f.pat;
  insert into co_live(step, expected, actual, ok) values ('3 new window, same patient/amount/method', 'refused · hint duplicate_collect · nothing recorded',
    left(err, 60) || '… · hint ' || coalesce(hint, '-') || ' · new ' || (n1 - n0), err like 'اتسجل للمريض ده نفس المبلغ%' and hint = 'duplicate_collect' and n1 = n0);
  -- 4) confirmed
  execute 'set local role authenticated';
  begin c := public.clinic_reception_command(f.w, 'collect', jsonb_build_object('patient_id', f.pat, 'amount', 1, 'method', 'instapay', 'reference', f.tag || '-R4', 'confirm_duplicate', true), gen_random_uuid()); err := 'ok';
  exception when others then err := sqlerrm; end;
  execute 'reset role';
  select to_jsonb(p)->>'note' into note from clinic_reception.payments p where p.id = nullif(c->>'id','')::uuid;
  insert into co_live(step, expected, actual, ok) values ('4 «حصّل تاني برضه» (confirm_duplicate)', 'ok · note «تحصيل تاني متأكد منه — الإيصال السابق RC-…»',
    err || ' · noted ' || coalesce(note like '%تحصيل تاني متأكد منه — الإيصال السابق %', false), err = 'ok' and note like '%تحصيل تاني متأكد منه — الإيصال السابق %');
  -- 5) different amount → no warning
  execute 'set local role authenticated';
  begin perform public.clinic_reception_command(f.w, 'collect', jsonb_build_object('patient_id', f.pat, 'amount', 2, 'method', 'instapay', 'reference', f.tag || '-R5'), gen_random_uuid()); err := 'ok';
  exception when others then err := sqlerrm; end;
  execute 'reset role';
  insert into co_live(step, expected, actual, ok) values ('5 different amount', 'ok (no warning)', err, err = 'ok');
end $$;

-- >>> ROLLBACK BODY: supabase/rollbacks/20261127110000_collect_once.rollback.sql >>>
drop function if exists public.clinic_reception_command(uuid, text, jsonb, uuid);
drop function if exists clinic_reception.collect_method_label(text);
alter function clinic_reception.command_before_collect_once(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_collect_once(uuid, text, jsonb, uuid) rename to clinic_reception_command;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
-- <<< END ROLLBACK BODY <<<
insert into co_live(step, expected, actual, ok) select '6 rollback body', 'previous command back',
  coalesce(to_regprocedure('clinic_reception.command_before_collect_once(uuid,text,jsonb,uuid)')::text, 'restored'),
  to_regprocedure('clinic_reception.command_before_collect_once(uuid,text,jsonb,uuid)') is null and to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') is not null;

select step, expected, actual, ok from co_live order by n;
rollback;
