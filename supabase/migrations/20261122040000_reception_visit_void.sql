-- «الزيارة اتسجلت غلط — المريض ما جاش» (owner 2026-11-21, after the Bandary case was fixed by hand): one button for reception.
-- NO new money path. The request is the EXISTING «إلغاء خدمة اتدخلت بالغلط» (service_void, 20261115240000) for every executed service invoice
-- of the visit, filed together and flagged payload.visit_void = true. The financial reviewer approves each one exactly as today
-- (maker ≠ checker, counter-entries 4192/1122 or 4192/2150, doctor fee reversed 2120/5111, order cancelled — nothing deleted).
-- When the LAST service of the visit is cancelled by such an approval, a trigger marks the appointment «لم يحضر» (no_show) and writes the
-- reason on the visit (close_note), plus a reception audit row. The archive visit (public.patient_visits) is not touched.
--   public.clinic_reception_visit_void_request(workspace, appointment, reason, token) — collect right (same as filing a «طلب مالي»).
-- Rollback: supabase/rollbacks/20261122040000_reception_visit_void.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_reception.correction_request_check()') is null then raise exception 'طبّق ملف تصحيحات الاستقبال (20261115240000) أولًا'; end if;
  if to_regprocedure('public.clinic_reception_visit_void_request(uuid,uuid,text,uuid)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create function public.clinic_reception_visit_void_request(p_workspace uuid, p_appointment uuid, p_reason text, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; a clinic_reception.appointments%rowtype; v clinic_reception.visits%rowtype; i record; ids uuid[] := array[]::uuid[]; r uuid; why text := btrim(coalesce(p_reason, ''));
begin
  me := clinic_reception.access(p_workspace, 'collect');
  if p_token is null then raise exception 'مفتاح العملية مطلوب'; end if;
  if length(why) < 5 then raise exception 'اكتب السبب (مثلاً: المريض ما جاش والزيارة اتسجلت بالغلط)'; end if;
  select * into a from clinic_reception.appointments where id = p_appointment and workspace_id = p_workspace for update;
  if not found then raise exception 'الحجز غير موجود'; end if;
  select * into v from clinic_reception.visits where appointment_id = a.id for update;
  if not found then raise exception 'الحجز ده ما اتفتحلوش زيارة — استخدم «لم يحضر» العادي'; end if;
  -- replay with the same token / a request already filed: return what is pending instead of filing twice
  if exists(select 1 from clinic_reception.requests q where q.workspace_id = p_workspace and q.kind = 'service_void' and q.status = 'pending' and q.payload->>'visit_id' = v.id::text) then
    return jsonb_build_object('visit_id', v.id, 'pending', (select jsonb_agg(q.id) from clinic_reception.requests q where q.workspace_id = p_workspace and q.kind = 'service_void' and q.status = 'pending' and q.payload->>'visit_id' = v.id::text), 'replayed', true);
  end if;
  if exists(select 1 from clinic_reception.orders o where o.visit_id = v.id and o.status = 'ordered') then
    raise exception 'فيه خدمة في الزيارة لسه ما اتنفذتش — الغيها الأول من «إلغاء الطلب»، وبعدين اطلب إلغاء الزيارة';
  end if;
  for i in select inv.id from clinic_reception.invoices inv join clinic_reception.orders o on o.id = inv.order_id
            where o.visit_id = v.id and o.status = 'completed' and inv.kind = 'service' order by inv.created_at, inv.id loop
    -- the existing check trigger validates (executed, no claim, nothing pending) and fixes the amount from the invoice
    insert into clinic_reception.requests(workspace_id, kind, subject_id, amount, payload, reason, evidence, created_by)
    values (p_workspace, 'service_void', i.id, 0,
            jsonb_build_object('kind', 'service_void', 'subject_id', i.id, 'visit_void', true, 'visit_id', v.id, 'appointment_id', a.id, 'token', p_token),
            why, 'الزيارة اتسجلت غلط — طلب من الاستقبال', me) returning id into r;
    ids := ids || r;
  end loop;
  if coalesce(array_length(ids, 1), 0) = 0 then raise exception 'مفيش خدمة منفذة عليها فاتورة في الزيارة دي — كلّم الحسابات'; end if;
  insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
  values (p_workspace, me, 'visit_void_requested', v.id, jsonb_build_object('appointment_id', a.id, 'requests', to_jsonb(ids), 'reason', why));
  return jsonb_build_object('visit_id', v.id, 'pending', to_jsonb(ids), 'replayed', false);
end $$;

-- after the reviewer approves the last service_void of a visit-void request, the visit is closed as «لم يحضر»
create function clinic_reception.visit_void_after_review() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v clinic_reception.visits%rowtype;
begin
  if new.kind <> 'service_void' or new.status <> 'approved' or old.status = 'approved' or coalesce(new.payload->>'visit_void', '') <> 'true' then return new; end if;
  select * into v from clinic_reception.visits where id = (new.payload->>'visit_id')::uuid for update;
  if not found then return new; end if;
  if exists(select 1 from clinic_reception.orders o where o.visit_id = v.id and o.status <> 'cancelled') then return new; end if;   -- other services still pending review
  update clinic_reception.appointments set status = 'no_show' where id = v.appointment_id and status in ('arrived', 'completed');
  update clinic_reception.visits set close_note = left('زيارة مسجلة بالخطأ — المريض لم يحضر — ' || new.reason || coalesce(' — ملاحظة سابقة: ' || nullif(close_note, ''), ''), 1000) where id = v.id;
  insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
  values (new.workspace_id, coalesce(new.reviewed_by, new.created_by), 'visit_void_completed', v.id, jsonb_build_object('appointment_id', v.appointment_id, 'last_request', new.id));
  return new;
end $$;
create trigger trg_visit_void_after_review after update of status on clinic_reception.requests for each row execute function clinic_reception.visit_void_after_review();

revoke all on function public.clinic_reception_visit_void_request(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.clinic_reception_visit_void_request(uuid, uuid, text, uuid) to authenticated;
revoke all on function clinic_reception.visit_void_after_review() from public, anon, authenticated;

commit;
