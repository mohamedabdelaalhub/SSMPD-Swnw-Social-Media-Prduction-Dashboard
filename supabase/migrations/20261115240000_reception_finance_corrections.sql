-- Owner (2026-11-15): a receptionist (or anyone with collect rights) REQUESTS a correction, the financial manager APPROVES it;
-- if the financial manager made the request, the general manager or a super admin approves (existing review rule: a reviewer
-- with clinic_finance review rights who is not the creator).
--   method_fix   : the patient paid by card but the receipt says cash (or any other wrong method) — same receipt, same amount.
--   service_void : a service was entered by mistake — cancel it; anything already paid becomes patient credit
--                  (then: use it on the right service with «استخدام رصيد المريض», or refund it with the existing refund request).
-- Also: public.clinic_finance_my_shift_collections() — the cashier sees what they collected in their own open shift,
-- per payment method. Never the opening balance or the expected drawer cash (blind count stays blind).

alter table clinic_reception.requests drop constraint if exists requests_kind_check;
alter table clinic_reception.requests add constraint requests_kind_check check(kind in ('claim_correction','claim_submit','claim_contractual','claim_loss','claim_payment','credit_note','package_cancel','refund','doctor_payout','supplier_payout','expense','fund','waste','transfer_loss','method_fix','service_void'));

create or replace function clinic_reception.method_account(p_method text) returns text language sql immutable set search_path=pg_catalog as $$
 select case p_method when 'cash' then '1111' when 'pos' then '1114' when 'wallet' then '1115' when 'bank' then '1112' when 'instapay' then '1112' end
$$;

-- Validate at request time and fix the amount from the source record (the request form cannot inflate it).
create or replace function clinic_reception.correction_request_check() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare p clinic_reception.payments%rowtype;i clinic_reception.invoices%rowtype;o clinic_reception.orders%rowtype;sh clinic_reception.shifts%rowtype;v_new text;credited numeric;
begin
 if new.kind='method_fix' then
  select * into p from clinic_reception.payments where id=new.subject_id and workspace_id=new.workspace_id;
  if not found then raise exception 'اختار إيصال التحصيل اللي محتاج تصحيح';end if;
  v_new:=new.payload->>'method';
  if v_new is null or clinic_reception.method_account(v_new) is null or v_new=p.method then raise exception 'اختار طريقة الدفع الصحيحة (مختلفة عن المسجلة)';end if;
  if v_new<>'cash' and length(trim(coalesce(new.payload->>'reference','')))<2 then raise exception 'اكتب مرجع العملية الصحيحة (رقم إيصال الفيزا أو التحويل)';end if;
  if v_new in ('cash','pos') or p.method in ('cash','pos') then
   select * into sh from clinic_reception.shifts where id=p.shift_id;
   if not found or sh.status<>'open' then raise exception 'الوردية بتاعة الإيصال ده اتقفلت؛ اشرح الفرق في مراجعة الوردية بدل التصحيح';end if;
  end if;
  if exists(select 1 from clinic_reception.requests where workspace_id=new.workspace_id and kind='refund' and subject_id=p.id and status in ('pending','approved')) then raise exception 'الإيصال عليه طلب استرداد؛ مينفعش تغيّر طريقته';end if;
  if exists(select 1 from clinic_reception.requests where workspace_id=new.workspace_id and kind='method_fix' and subject_id=p.id and status='pending') then raise exception 'فيه طلب تصحيح لنفس الإيصال مستني المراجعة';end if;
  new.amount:=p.amount;new.payload:=new.payload||jsonb_build_object('method_from',p.method,'reference_from',p.reference);
 elsif new.kind='service_void' then
  select * into i from clinic_reception.invoices where id=new.subject_id and workspace_id=new.workspace_id and kind='service';
  if not found then raise exception 'اختار فاتورة الخدمة اللي اتدخلت غلط';end if;
  select * into o from clinic_reception.orders where id=i.order_id;
  if not found or o.status<>'completed' then raise exception 'الخدمة دي مش منفذة؛ لو لسه مطلوبة استخدم «إلغاء الطلب»';end if;
  if exists(select 1 from clinic_reception.claims where invoice_id=i.id) then raise exception 'الخدمة عليها مطالبة جهة؛ صحّحها من طلبات المطالبات';end if;
  if exists(select 1 from clinic_reception.requests where workspace_id=new.workspace_id and kind in ('service_void','credit_note') and subject_id=i.id and status='pending') then raise exception 'فيه طلب على نفس الخدمة مستني المراجعة';end if;
  select coalesce(sum(amount),0) into credited from clinic_reception.requests where workspace_id=new.workspace_id and kind in ('credit_note','service_void') and subject_id=i.id and status='approved';
  new.amount:=i.amount-coalesce(i.payer_amount,0)-credited;
  if new.amount<=0 then raise exception 'الخدمة دي اتلغت قيمتها بالكامل قبل كده';end if;
 end if;
 return new;
end $$;
drop trigger if exists trg_correction_request_check on clinic_reception.requests;
create trigger trg_correction_request_check before insert on clinic_reception.requests for each row when (new.kind in ('method_fix','service_void')) execute function clinic_reception.correction_request_check();

do $$begin
 if to_regprocedure('clinic_reception.review_operation_before_corrections(uuid,jsonb,uuid)') is null then
  alter function clinic_reception.review_operation(uuid,jsonb,uuid) rename to review_operation_before_corrections;
 end if;
end $$;
revoke all on function clinic_reception.review_operation_before_corrections(uuid,jsonb,uuid) from public,anon,authenticated;

create or replace function clinic_reception.review_operation(p_workspace uuid,p_payload jsonb,p_me uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r clinic_reception.requests%rowtype;p clinic_reception.payments%rowtype;i clinic_reception.invoices%rowtype;o clinic_reception.orders%rowtype;sh clinic_reception.shifts%rowtype;
 approve boolean;v_new text;due numeric;value numeric;fee numeric;dims jsonb;
begin
 select * into r from clinic_reception.requests where id=(p_payload->>'id')::uuid and workspace_id=p_workspace for update;
 if not found or r.kind not in ('method_fix','service_void') then return clinic_reception.review_operation_before_corrections(p_workspace,p_payload,p_me);end if;
 approve:=(p_payload->>'approve')::boolean;
 if r.created_by=p_me or r.status<>'pending' or approve is null or length(trim(coalesce(p_payload->>'note','')))<3 then raise exception 'الطلب يحتاج مراجعًا آخر غير اللي قدّمه، وسبب القرار';end if;
 if not approve then update clinic_reception.requests set status='rejected',reviewed_by=p_me,review_note=p_payload->>'note' where id=r.id;return jsonb_build_object('id',r.id);end if;
 if r.kind='method_fix' then
  select * into p from clinic_reception.payments where id=r.subject_id and workspace_id=p_workspace for update;
  v_new:=r.payload->>'method';
  if not found or p.method<>r.payload->>'method_from' or p.amount<>r.amount then raise exception 'الإيصال اتغيّر بعد الطلب؛ اطلب تصحيح جديد';end if;
  if exists(select 1 from clinic_reception.requests where workspace_id=p_workspace and kind='refund' and subject_id=p.id and status in ('pending','approved')) then raise exception 'الإيصال عليه طلب استرداد؛ مينفعش تغيّر طريقته';end if;
  if v_new in ('cash','pos') or p.method in ('cash','pos') then
   select * into sh from clinic_reception.shifts where id=p.shift_id;
   if not found or sh.status<>'open' then raise exception 'الوردية بتاعة الإيصال ده اتقفلت؛ اشرح الفرق في مراجعة الوردية بدل التصحيح';end if;
  end if;
  dims:=jsonb_build_object('patient_id',p.patient_id,'payment_id',p.id,'request_id',r.id,'shift_id',p.shift_id,'method_from',p.method,'method_to',v_new);
  -- Same money, different drawer/account: debit the right one, credit the wrong one. Cash moved out lowers the shift's expected cash.
  perform clinic_reception.post(p_workspace,'method_fix',r.id,'تصحيح طريقة السداد لإيصال تحصيل',clinic_reception.method_account(v_new),clinic_reception.method_account(p.method),p.amount,dims);
  update clinic_reception.payments set method=v_new,reference=coalesce(nullif(trim(r.payload->>'reference'),''),reference) where id=p.id;
 else
  select * into i from clinic_reception.invoices where id=r.subject_id and workspace_id=p_workspace and kind='service' for update;
  select * into o from clinic_reception.orders where id=i.order_id for update;
  if i.id is null or o.status<>'completed' or exists(select 1 from clinic_reception.claims where invoice_id=i.id) then raise exception 'الخدمة اتغيّرت بعد الطلب؛ راجعها';end if;
  if r.amount<>i.amount-coalesce(i.payer_amount,0)-(select coalesce(sum(amount),0) from clinic_reception.requests where workspace_id=p_workspace and kind in ('credit_note','service_void') and subject_id=i.id and status='approved') then raise exception 'قيمة الخدمة اتغيّرت بعد الطلب؛ اطلب من جديد';end if;
  dims:=jsonb_build_object('patient_id',i.patient_id,'invoice_id',i.id,'order_id',o.id,'request_id',r.id);
  due:=clinic_reception.due(i.id);value:=least(due,r.amount);
  -- Unpaid part: cancel the receivable. Paid part: becomes the patient's credit balance (2150), refundable or usable on the right service.
  if value>0 then perform clinic_reception.post(p_workspace,'service_void_ar',r.id,'إلغاء خدمة مدخلة بالخطأ — غير محصل','4192','1122',value,dims);update clinic_reception.invoices set credit_amount=credit_amount+value where id=i.id;end if;
  if r.amount>value then perform clinic_reception.post(p_workspace,'service_void_credit',r.id,'إلغاء خدمة مدخلة بالخطأ — المدفوع رصيد للمريض','4192','2150',r.amount-value,dims);end if;
  fee:=case when i.amount>0 then round(coalesce(o.doctor_fee,0)*r.amount/i.amount,2) else 0 end;
  if fee>0 then perform clinic_reception.post(p_workspace,'service_void_doctor',r.id,'عكس أتعاب خدمة ملغاة','2120','5111',fee,dims||jsonb_build_object('provider_id',o.provider_id));end if;
  update clinic_reception.orders set status='cancelled' where id=o.id;
  -- Materials already consumed stay consumed: a real stock return is a separate inventory step.
 end if;
 update clinic_reception.requests set status='approved',reviewed_by=p_me,review_note=p_payload->>'note' where id=r.id;
 return jsonb_build_object('id',r.id);
end $$;
revoke all on function clinic_reception.review_operation(uuid,jsonb,uuid) from public,anon,authenticated;
revoke all on function clinic_reception.correction_request_check() from public,anon,authenticated;

-- The cashier's own open shift(s): collections per method. No opening balance, no expected cash.
create or replace function public.clinic_finance_my_shift_collections() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();
begin
 if me is null or not exists(select 1 from public.admins where id=me and active) then raise exception 'سجل الدخول' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('shift_id',fs.id,'register_name',reg.name,'opened_at',fs.opened_at,
   'methods',coalesce((select jsonb_agg(jsonb_build_object('method',m.method,'receipts',m.n,'amount',m.total) order by m.method) from (
      select x.method,count(*) n,sum(x.amount) total from (
        select rp.method,rp.amount from clinic_reception.payments rp join clinic_reception.shifts rs on rs.id=rp.shift_id where rs.finance_shift_id=fs.id
        union all
        select fp.method,fp.amount from clinic_finance.payments fp where fp.shift_id=fs.id and not exists(select 1 from clinic_reception.payments rp2 where rp2.finance_payment_id=fp.id)
      ) x group by x.method) m),'[]'::jsonb)) order by fs.opened_at)
  from clinic_finance.shifts fs join clinic_finance.registers reg on reg.id=fs.register_id
  where fs.cashier_id=me and fs.status='open'),'[]'::jsonb);
end $$;
revoke all on function public.clinic_finance_my_shift_collections() from public,anon;
grant execute on function public.clinic_finance_my_shift_collections() to authenticated;
