-- Partner-lab link review: «حذف الصف» (remove row) + closing out rows that have no counterpart in the center.
-- ADDITIVE: 3 nullable columns on clinic_labs.price_items, two wrappers over the existing RPCs (the reviewed 20261108120000 file is NOT edited).
-- A removed row is only HIDDEN from the review lists: the imported cost, the candidates and every earlier decision stay stored permanently
-- (clinic_labs.service_cost / margin reports are unaffected). Removal is reversible (restore_row) and audited. Same gate as every other action: clinic_labs.manage().
-- Rule: a CONFIRMED link must be re-opened before the row can be removed; a removed row refuses every other action until restored.
-- Requires 20261108120000_partner_lab_links.sql. Rollback: supabase/rollbacks/20261109120000_partner_lab_link_remove.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.lab_links_command(text,jsonb)') is null or to_regprocedure('public.lab_links_workspace(uuid)') is null then
    raise exception 'طبّق ملف ربط تحاليل المعمل (20261108120000) أولًا';
  end if;
  if to_regprocedure('clinic_labs.command_before_remove(text,jsonb)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table clinic_labs.price_items
  add column removed_at timestamptz,
  add column removed_by uuid references public.admins(id),
  add column removed_note text,
  add constraint price_items_removed_ck check ((removed_at is null) = (removed_by is null) and (removed_at is null or length(trim(coalesce(removed_note, ''))) >= 3));

alter function public.lab_links_command(text, jsonb) set schema clinic_labs;
alter function clinic_labs.lab_links_command(text, jsonb) rename to command_before_remove;
alter function public.lab_links_workspace(uuid) set schema clinic_labs;
alter function clinic_labs.lab_links_workspace(uuid) rename to workspace_before_remove;

create function public.lab_links_workspace(p_version uuid default null) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  v := clinic_labs.workspace_before_remove(p_version);   -- performs the permission check
  return jsonb_set(jsonb_set(v, '{items}', (
      select coalesce(jsonb_agg(x.value || jsonb_build_object('removed_at', i.removed_at, 'removed_by', i.removed_by, 'removed_note', i.removed_note) order by x.ordinality), '[]')
        from jsonb_array_elements(v->'items') with ordinality x left join clinic_labs.price_items i on i.id = (x.value->>'id')::uuid)),
    '{reviewers}', coalesce(v->'reviewers', '{}') || (
      select coalesce(jsonb_object_agg(a.id, a.name), '{}') from public.admins a where a.id in (select removed_by from clinic_labs.price_items where removed_by is not null)));
end $$;

create function public.lab_links_command(p_action text, p_payload jsonb) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  me uuid := public.my_admin_id();
  v_item uuid;
  note text := trim(coalesce(p_payload->>'note', ''));
  it clinic_labs.price_items%rowtype;
  ids jsonb; skipped jsonb := '[]'; out jsonb;
begin
  if not clinic_labs.manage() then raise exception 'لا تملك مراجعة ربط التحاليل'; end if;
  if p_action = 'bulk_confirm' then
    -- removed rows are never confirmed in bulk; they are reported as skipped
    if jsonb_typeof(p_payload->'item_ids') = 'array' then
      select coalesce(jsonb_agg(x), '[]') into ids from jsonb_array_elements_text(p_payload->'item_ids') x
        where not exists (select 1 from clinic_labs.price_items i where i.id::text = x and i.removed_at is not null);
      select coalesce(jsonb_agg(jsonb_build_object('item_id', x, 'reason', 'الصف محذوف')), '[]') into skipped from jsonb_array_elements_text(p_payload->'item_ids') x
        where exists (select 1 from clinic_labs.price_items i where i.id::text = x and i.removed_at is not null);
      if jsonb_array_length(ids) = 0 then return jsonb_build_object('confirmed', 0, 'skipped', skipped); end if;
      out := clinic_labs.command_before_remove(p_action, jsonb_set(p_payload, '{item_ids}', ids));
      return jsonb_set(out, '{skipped}', coalesce(out->'skipped', '[]') || skipped);
    end if;
    return clinic_labs.command_before_remove(p_action, p_payload);
  end if;
  if p_action in ('remove_row', 'restore_row') or nullif(p_payload->>'item_id', '') is not null then
    v_item := nullif(p_payload->>'item_id', '')::uuid;
    if v_item is null then raise exception 'اختر التحليل'; end if;
    perform pg_advisory_xact_lock(712241108);
    select * into it from clinic_labs.price_items where id = v_item for update;
    if not found then raise exception 'التحليل غير موجود'; end if;
    if p_action = 'remove_row' then
      if length(note) < 3 then raise exception 'اكتب سبب حذف الصف'; end if;
      if it.removed_at is not null then raise exception 'الصف محذوف بالفعل'; end if;
      if exists (select 1 from clinic_labs.item_links where item_id = v_item and status = 'confirmed') then raise exception 'التحليل مربوط بالفعل؛ أعد فتح الربط أولًا'; end if;
      update clinic_labs.price_items set removed_at = now(), removed_by = me, removed_note = note where id = v_item;
      insert into clinic_labs.audit(actor_id, action, item_id, details) values (me, 'remove_row', v_item, p_payload || jsonb_build_object('cost_kept', it.cost));
      return jsonb_build_object('ok', true, 'item_id', v_item);
    elsif p_action = 'restore_row' then
      if it.removed_at is null then raise exception 'الصف غير محذوف'; end if;
      update clinic_labs.price_items set removed_at = null, removed_by = null, removed_note = null where id = v_item;
      insert into clinic_labs.audit(actor_id, action, item_id, details) values (me, 'restore_row', v_item, p_payload);
      return jsonb_build_object('ok', true, 'item_id', v_item);
    elsif it.removed_at is not null then
      raise exception 'الصف محذوف؛ استرجعه أولًا';
    end if;
  end if;
  return clinic_labs.command_before_remove(p_action, p_payload);
end $$;

revoke all on all functions in schema clinic_labs from public, anon, authenticated;
revoke all on function public.lab_links_workspace(uuid), public.lab_links_command(text, jsonb) from public, anon;
grant execute on function public.lab_links_workspace(uuid), public.lab_links_command(text, jsonb) to authenticated;

commit;
