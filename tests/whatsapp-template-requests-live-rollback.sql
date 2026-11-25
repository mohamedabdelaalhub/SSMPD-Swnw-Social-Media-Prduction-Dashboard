-- Live dry-run for migration 20261124230000 (run AFTER the migration inside the same transaction; everything rolls back).
-- Proves on the live roles: the owner (super_admin) can queue a template, reception is refused, the agent API leases/acks/syncs.
begin;
do $$
declare v_owner uuid; v_recep uuid; r jsonb; v_id uuid; v_name text;
begin
  select id into v_owner from public.admins where role = 'super_admin' and active order by created_at limit 1;
  select id into v_recep from public.admins where role = 'reception' and active order by created_at limit 1;
  if v_owner is null or v_recep is null then raise exception 'need an active super_admin and an active reception admin'; end if;

  r := public.whatsapp_template_submit(v_recep, 'UTILITY', 'أهلاً بحضرتك من مركز عيادات سونو التخصصية. حاولنا نتواصل معاك بخصوص طلب الحجز.');
  if (r->>'ok')::boolean then raise exception 'reception must be refused: %', r; end if;

  r := public.whatsapp_template_submit(v_owner, 'UTILITY', 'أهلاً بحضرتك من مركز عيادات سونو التخصصية. حاولنا نتواصل معاك بخصوص طلب الحجز.');
  if not (r->>'ok')::boolean then raise exception 'owner submit failed: %', r; end if;
  v_id := (r->>'id')::uuid; v_name := r->>'name';

  r := public.whatsapp_template_submit(v_owner, 'UTILITY', 'كلمنا على 01012345678 دلوقتي لو محتاج حجز');
  if (r->>'ok')::boolean then raise exception 'phone number must be refused'; end if;

  r := public.whatsapp_template_api('lease', '{"limit":10}');
  if jsonb_array_length(r->'requests') < 1 then raise exception 'lease returned nothing: %', r; end if;
  r := public.whatsapp_template_api('ack', jsonb_build_object('id', v_id, 'status', 'PENDING', 'meta_id', 'dryrun'));
  if not (r->>'ok')::boolean then raise exception 'ack failed: %', r; end if;
  r := public.whatsapp_template_api('sync', jsonb_build_object('statuses', jsonb_build_array(jsonb_build_object('name', v_name, 'language', 'ar', 'status', 'APPROVED'))));
  if not exists (select 1 from ops_private.whatsapp_templates where name = v_name) then raise exception 'approved template missing from the picker table'; end if;
  if (select count(*) from ops_private.whatsapp_template_audit where request_id = v_id) < 3 then raise exception 'audit rows missing'; end if;
  raise notice 'whatsapp_template_requests dry-run OK (%)', v_name;
end $$;
rollback;
