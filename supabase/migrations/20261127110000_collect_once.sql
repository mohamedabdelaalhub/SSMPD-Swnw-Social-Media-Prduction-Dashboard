-- «التحصيل بضغطة واحدة» (owner 2026-11-27 «محتاجين ان الزرار بتاع التحصيل ما بيسجلش غير ضغطة واحدة … تكرار التسجيل»;
-- «طبّق منع التحصيل المكرر»). Real case 2026-11-26: RC-2026-000021 then, 23 s later in a NEW «تسجيل تحصيل» window, RC-2026-000022 —
-- same patient, same 50, same method; the second one had no open invoice left and became «رصيد مقدم».
-- A double click in ONE window was already safe (the modal locks its buttons and sends one token per window; a replayed token returns
-- the first answer). This adds the server guard for a second window:
--   actions 'collect' and 'collect_multi' (public.clinic_reception_command): if the SAME patient already has a receipt in the same
--   workspace with the SAME amount and the SAME method created in the last 2 minutes, the command is refused with hint
--   'duplicate_collect' (detail = json: receipt_no, seconds, amount, method) unless payload.confirm_duplicate = true.
--   A confirmed second receipt gets the note «تحصيل تاني متأكد منه — الإيصال السابق RC-…» (kept with any typed note, ≤ 300).
--   A replay of the same token (already in clinic_reception.commands) is never refused: it returns the first answer as before.
-- One outer wrapper; the previous function is kept as clinic_reception.command_before_collect_once. Nothing removed.
-- Rollback: supabase/rollbacks/20261127110000_collect_once.rollback.sql
begin;

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

commit;
