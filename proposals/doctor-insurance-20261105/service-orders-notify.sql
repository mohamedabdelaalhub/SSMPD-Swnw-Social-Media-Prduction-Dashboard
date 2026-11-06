-- ADDITIVE ONLY. Patient notification (email) bookkeeping. Sender = Edge Function running under the STAFF user's JWT
-- (no service-role key, no cron secrets). Review file.
begin;

create table if not exists clinic_reception.report_notifications(
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references clinic_reception.orders(id) on delete cascade,
  report_id uuid not null references clinic_reception.order_reports(id) on delete cascade,
  channel text not null default 'email' check (channel in ('email')),
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','skipped')),
  attempts int not null default 0,
  last_error text,
  skipped_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique(report_id,channel));
alter table clinic_reception.report_notifications enable row level security;

-- Returns what the sender needs (target email only for an eligible, verified portal account). Never returns medical details.
create or replace function public.clinic_reception_so_notify_prepare(p_workspace uuid,p_order uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_reception.access(p_workspace,'execute');
 rep clinic_reception.order_reports%rowtype; n clinic_reception.report_notifications%rowtype; target text;
begin
 select r.* into rep from clinic_reception.order_reports r join clinic_reception.orders o on o.id=r.order_id
   where r.order_id=p_order and o.workspace_id=p_workspace and r.patient_visible order by r.uploaded_at desc limit 1;
 if not found then raise exception 'لا يوجد تقرير لهذا الطلب';end if;
 insert into clinic_reception.report_notifications(order_id,report_id) values(p_order,rep.id) on conflict(report_id,channel) do nothing;
 select * into n from clinic_reception.report_notifications where report_id=rep.id and channel='email' for update;
 if n.status='sent' then return jsonb_build_object('status','already_sent','id',n.id);end if;
 if n.status='sending' and n.updated_at>now()-interval '5 minutes' then return jsonb_build_object('status','in_progress','id',n.id);end if;
 if n.attempts>=3 then return jsonb_build_object('status','failed_final','id',n.id);end if;
 select pa.login_email into target
   from clinic_reception.orders o join clinic_reception.visits v on v.id=o.visit_id
   join clinic_reception.patients p on p.id=v.patient_id
   join public.patient_account_access a on a.patient_id=p.patient_id
   join public.patient_accounts pa on pa.id=a.account_id
  where o.id=p_order and pa.status='active' and pa.email_verified and pa.login_email is not null
    and a.verification_status='approved' and a.revoked_at is null and (a.expires_at is null or a.expires_at>now())
  order by a.is_primary desc nulls last, a.created_at limit 1;
 if target is null then
   update clinic_reception.report_notifications set status='skipped',skipped_reason='no_verified_portal_email',updated_at=now() where id=n.id;
   return jsonb_build_object('status','skipped','reason','no_verified_portal_email','id',n.id);
 end if;
 update clinic_reception.report_notifications set status='sending',attempts=attempts+1,updated_at=now() where id=n.id;
 return jsonb_build_object('status','ready','id',n.id,'to',target);
end $$;

create or replace function public.clinic_reception_so_notify_result(p_id uuid,p_ok boolean,p_error text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare ws uuid; me uuid; n clinic_reception.report_notifications%rowtype;
begin
 select * into n from clinic_reception.report_notifications where id=p_id;
 if not found then raise exception 'الإشعار غير موجود';end if;
 select o.workspace_id into ws from clinic_reception.orders o where o.id=n.order_id;
 me:=clinic_reception.access(ws,'execute');
 if n.status<>'sending' then raise exception 'حالة الإشعار لا تسمح بالتحديث';end if;
 if p_ok then
   update clinic_reception.report_notifications set status='sent',sent_at=now(),updated_at=now(),last_error=null where id=p_id;
   update clinic_reception.order_ext set status='patient_notified' where order_id=n.order_id and status='report_uploaded';
 else
   update clinic_reception.report_notifications set status='failed',last_error=left(coalesce(p_error,'خطأ غير معروف'),300),updated_at=now() where id=p_id;
 end if;
 insert into clinic_reception.audit(workspace_id,actor_id,action,entity_id,detail)
   values(ws,me,case when p_ok then 'so_notify_sent' else 'so_notify_failed' end,n.order_id,jsonb_build_object('notification',p_id,'channel','email'));
 return jsonb_build_object('id',p_id,'status',case when p_ok then 'sent' else 'failed' end);
end $$;

revoke all on function public.clinic_reception_so_notify_prepare(uuid,uuid),public.clinic_reception_so_notify_result(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.clinic_reception_so_notify_prepare(uuid,uuid),public.clinic_reception_so_notify_result(uuid,boolean,text) to authenticated;
commit;
