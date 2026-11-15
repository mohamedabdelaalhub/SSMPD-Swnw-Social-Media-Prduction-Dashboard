-- Owner (2026-11-15, via the main chat): «موافق علي ب، فقط في حالة ان الباكدج عليها عرض مشروط».
-- A package template can be marked «عرض مشروط — الخصم بشرط إكمال الباكدج». The flag is SNAPSHOTTED on each package at sale
-- (packages sold before this, or from an unflagged template, keep today's pro-rata cancellation).
-- On cancelling a conditional package the CONSUMED entitlements are re-priced at the standalone single-service price
-- captured at sale; refundable = (paid unused + consumed at package price) − consumed at standalone price, floored at 0
-- and never above the pro-rata amount. The discount the patient no longer qualifies for is recognised as service revenue.
-- A shortfall (consumed at standalone price above what was paid) is NEVER charged automatically: it is only shown.
-- The reviewer sees both numbers (quote) before approving; the method and numbers are stored on the request.

alter table clinic_reception.package_templates add column if not exists conditional_offer boolean not null default false;
alter table clinic_reception.packages add column if not exists conditional_offer boolean not null default false;
alter table clinic_reception.entitlements add column if not exists standalone_unit numeric(14,2);

-- Templates are generated from pricing_packages: copy the flag on insert, and keep active templates in step when toggled.
create or replace function clinic_reception.package_template_conditional_flag() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare pp uuid:=nullif(to_jsonb(new)->>'pricing_package_id','')::uuid;
begin
 if pp is not null then
  execute 'select coalesce((select p.conditional_offer from public.pricing_packages p where p.id=$1),false)' into new.conditional_offer using pp;
 end if;
 return new;
end $$;
drop trigger if exists trg_package_template_conditional_flag on clinic_reception.package_templates;
create trigger trg_package_template_conditional_flag before insert on clinic_reception.package_templates for each row execute function clinic_reception.package_template_conditional_flag();
revoke all on function clinic_reception.package_template_conditional_flag() from public,anon,authenticated;

create or replace function public.pricing_package_conditional_sync() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.conditional_offer is distinct from old.conditional_offer then
  update clinic_reception.package_templates set conditional_offer=new.conditional_offer where pricing_package_id=new.id and active;
 end if;
 return new;
end $$;
do $$begin
 if to_regclass('public.pricing_packages') is not null then
  alter table public.pricing_packages add column if not exists conditional_offer boolean not null default false;
  drop trigger if exists trg_pricing_package_conditional_sync on public.pricing_packages;
  create trigger trg_pricing_package_conditional_sync after update of conditional_offer on public.pricing_packages for each row execute function public.pricing_package_conditional_sync();
 end if;
end $$;
revoke all on function public.pricing_package_conditional_sync() from public,anon,authenticated;

-- Snapshot at sale: the package keeps the flag of its template at that moment, and its printed terms say so.
create or replace function clinic_reception.package_conditional_snapshot() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 new.conditional_offer:=coalesce((select t.conditional_offer from clinic_reception.package_templates t where t.id=new.template_id),false);
 if new.conditional_offer and strpos(coalesce(new.terms,''),'عرض مشروط')=0 then
  new.terms:=coalesce(new.terms,'')||E'\n\nعرض مشروط: سعر الباكدج المخفّض بشرط إكمال الباكدج. عند الإلغاء تُحسب الجلسات المستخدمة بسعر الجلسة المنفردة وقت التعاقد، ويُرد الباقي فقط إن وجد.';
 end if;
 return new;
end $$;
drop trigger if exists trg_package_conditional_snapshot on clinic_reception.packages;
create trigger trg_package_conditional_snapshot before insert on clinic_reception.packages for each row execute function clinic_reception.package_conditional_snapshot();
revoke all on function clinic_reception.package_conditional_snapshot() from public,anon,authenticated;

-- Standalone unit price captured per entitlement at sale (template lines are versioned with the template).
create or replace function clinic_reception.entitlement_standalone_snapshot() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.standalone_unit is null then
  select l.standalone_price into new.standalone_unit from clinic_reception.template_lines l join clinic_reception.packages p on p.template_id=l.template_id
   where p.id=new.package_id and l.service_id=new.service_id order by (l.visit_no=new.visit_no) desc,l.visit_no limit 1;
 end if;
 return new;
end $$;
drop trigger if exists trg_entitlement_standalone_snapshot on clinic_reception.entitlements;
create trigger trg_entitlement_standalone_snapshot before insert on clinic_reception.entitlements for each row execute function clinic_reception.entitlement_standalone_snapshot();
revoke all on function clinic_reception.entitlement_standalone_snapshot() from public,anon,authenticated;

-- The numbers both the requester and the reviewer see.
create or replace function clinic_reception.package_cancel_quote(p_workspace uuid,p_package uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare pkg clinic_reception.packages%rowtype;liability numeric;unpaid numeric;prorata numeric;used_pkg numeric;used_std numeric;cond numeric;
begin
 select * into pkg from clinic_reception.packages where id=p_package and workspace_id=p_workspace;
 if not found then raise exception 'الباكج غير متاح';end if;
 liability:=-clinic_reception.balance(p_workspace,'2151','package_id',pkg.id::text);
 select coalesce(sum(clinic_reception.due(i.id)),0) into unpaid from clinic_reception.invoices i where i.package_id=pkg.id and i.kind='installment';
 prorata:=greatest(liability-unpaid,0);
 select coalesce(sum(e.recognized),0),coalesce(sum(case when e.standalone_unit is null then e.recognized else round(e.used*e.standalone_unit,2) end),0) into used_pkg,used_std from clinic_reception.entitlements e where e.package_id=pkg.id;
 cond:=least(prorata,greatest(prorata+used_pkg-used_std,0));
 return jsonb_build_object('package_id',pkg.id,'conditional',pkg.conditional_offer,'method',case when pkg.conditional_offer then 'conditional' else 'prorata' end,
  'prorata_refund',prorata,'consumed_at_package',used_pkg,'consumed_at_standard',used_std,'conditional_refund',cond,
  'forfeited_discount',case when pkg.conditional_offer then prorata-cond else 0 end,
  'shortfall',case when pkg.conditional_offer then greatest(used_std-used_pkg-prorata,0) else 0 end,
  'refundable',case when pkg.conditional_offer then cond else prorata end);
end $$;
revoke all on function clinic_reception.package_cancel_quote(uuid,uuid) from public,anon,authenticated;

create or replace function public.clinic_reception_package_cancel_quote(p_workspace uuid,p_package uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin perform clinic_reception.access(p_workspace,'view');return clinic_reception.package_cancel_quote(p_workspace,p_package);end $$;
revoke all on function public.clinic_reception_package_cancel_quote(uuid,uuid) from public,anon;
grant execute on function public.clinic_reception_package_cancel_quote(uuid,uuid) to authenticated;

-- The request amount and method come from the quote, not from the form.
create or replace function clinic_reception.package_cancel_request_quote() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare q jsonb;
begin
 if not exists(select 1 from clinic_reception.packages where id=new.subject_id and workspace_id=new.workspace_id and status='active') then raise exception 'الباكج غير متاح للإيقاف';end if;
 q:=clinic_reception.package_cancel_quote(new.workspace_id,new.subject_id);
 new.amount:=(q->>'refundable')::numeric;new.payload:=coalesce(new.payload,'{}'::jsonb)||jsonb_build_object('quote',q,'method',q->>'method');
 return new;
end $$;
drop trigger if exists trg_package_cancel_request_quote on clinic_reception.requests;
create trigger trg_package_cancel_request_quote before insert on clinic_reception.requests for each row when (new.kind='package_cancel') execute function clinic_reception.package_cancel_request_quote();
revoke all on function clinic_reception.package_cancel_request_quote() from public,anon,authenticated;

do $$begin
 if to_regprocedure('clinic_reception.review_operation_before_conditional(uuid,jsonb,uuid)') is null then
  alter function clinic_reception.review_operation(uuid,jsonb,uuid) rename to review_operation_before_conditional;
 end if;
end $$;
revoke all on function clinic_reception.review_operation_before_conditional(uuid,jsonb,uuid) from public,anon,authenticated;

create or replace function clinic_reception.review_operation(p_workspace uuid,p_payload jsonb,p_me uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r clinic_reception.requests%rowtype;pkg clinic_reception.packages%rowtype;i clinic_reception.invoices%rowtype;q jsonb;approve boolean;unpaid numeric;dims jsonb;refund numeric;forfeit numeric;
begin
 select * into r from clinic_reception.requests where id=(p_payload->>'id')::uuid and workspace_id=p_workspace for update;
 if not found or r.kind<>'package_cancel' then return clinic_reception.review_operation_before_conditional(p_workspace,p_payload,p_me);end if;
 select * into pkg from clinic_reception.packages where id=r.subject_id and workspace_id=p_workspace for update;
 approve:=(p_payload->>'approve')::boolean;
 if approve is distinct from true or not found or not pkg.conditional_offer then
  -- Rejections and pro-rata packages: the existing path, but the numbers must still match what the requester saw.
  if approve is true and found and pkg.status='active' then
   q:=clinic_reception.package_cancel_quote(p_workspace,pkg.id);
   if (q->>'refundable')::numeric<>r.amount then raise exception 'أرقام الباكج اتغيّرت بعد الطلب؛ اطلب الإيقاف من جديد';end if;
  end if;
  return clinic_reception.review_operation_before_conditional(p_workspace,p_payload,p_me);
 end if;
 if r.created_by=p_me or r.status<>'pending' or length(trim(coalesce(p_payload->>'note','')))<3 then raise exception 'الطلب يحتاج مراجعًا آخر وسبب القرار';end if;
 if pkg.status<>'active' then raise exception 'الباكج غير متاح للإيقاف';end if;
 q:=clinic_reception.package_cancel_quote(p_workspace,pkg.id);
 if (q->>'refundable')::numeric<>r.amount then raise exception 'أرقام الباكج اتغيّرت بعد الطلب؛ اطلب الإيقاف من جديد';end if;
 dims:=jsonb_build_object('patient_id',pkg.patient_id,'package_id',pkg.id,'request_id',r.id,'method','conditional');
 -- Same first step as the existing path: cancel unconditional installments not yet settled.
 for i in select * from clinic_reception.invoices where package_id=pkg.id and kind='installment' for update loop
  unpaid:=clinic_reception.due(i.id);
  if unpaid>0 then perform clinic_reception.post(p_workspace,'cancel_installment',i.id,'إلغاء استحقاق غير منفذ عند إيقاف الباكج','2151','1122',unpaid,dims||jsonb_build_object('invoice_id',i.id));update clinic_reception.invoices set credit_amount=credit_amount+unpaid where id=i.id;end if;
 end loop;
 refund:=(q->>'conditional_refund')::numeric;forfeit:=(q->>'forfeited_discount')::numeric;
 if refund+forfeit<>-clinic_reception.balance(p_workspace,'2151','package_id',pkg.id::text) then raise exception 'راجع رصيد الباكج غير المستخدم بعد إلغاء الأقساط غير المحصلة';end if;
 if forfeit>0 then perform clinic_reception.post(p_workspace,'package_conditional_forfeit',r.id,'خصم عرض مشروط سقط بإلغاء الباكج — الجلسات المستخدمة بسعرها المنفرد','2151','4110',forfeit,dims);end if;
 if refund>0 then perform clinic_reception.post(p_workspace,'package_cancel',r.id,'تحويل المتبقي بعد إعادة تسعير الجلسات لرصيد المريض','2151','2150',refund,dims);end if;
 update clinic_reception.packages set status='frozen' where id=pkg.id;
 update clinic_reception.orders set status='cancelled' where status='ordered' and entitlement_id in(select id from clinic_reception.entitlements where package_id=pkg.id);
 update clinic_reception.appointments set status='cancelled',cancel_reason=r.reason where package_id=pkg.id and status='booked';
 update clinic_reception.requests set status='approved',reviewed_by=p_me,review_note=p_payload->>'note',payload=payload||jsonb_build_object('quote_at_approval',q) where id=r.id;
 return jsonb_build_object('id',r.id,'method','conditional','refund',refund,'forfeited_discount',forfeit,'shortfall',q->'shortfall');
end $$;
revoke all on function clinic_reception.review_operation(uuid,jsonb,uuid) from public,anon,authenticated;
