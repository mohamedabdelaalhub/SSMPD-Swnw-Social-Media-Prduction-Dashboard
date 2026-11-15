-- Owner (2026-11-15): «عايز كل الحركات اللي تمت في الخزنة تبقي مفصلة وواضحة … كاش ولا تأمين وطريقة التحصيل والمبلغ»
-- + «المدير المالي والسوبر ادمن والمدير العام» see all shifts, with Excel/PDF export (done in the browser).
-- One read-only function:
--   * a cashier: only their OWN shifts (default: their open shift). Never the opening balance or expected cash.
--   * financial reviewers / general manager / super admin: any shift, by period (≤ 31 days), employee or register.
-- Rows: collections (reception receipts linked to the shift, or made by the cashier during it without a drawer, e.g. instapay),
-- finance-desk receipts, money going out of the shift (refunds, expenses, payouts, handover), and approved method corrections.
create or replace function public.clinic_finance_shift_movements(p_shift uuid default null,p_from date default null,p_to date default null,p_cashier uuid default null,p_register uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();manager boolean;ids uuid[];v_rows jsonb;v_shifts jsonb;
begin
 if me is null or not exists(select 1 from public.admins where id=me and active) then raise exception 'سجل الدخول' using errcode='42501';end if;
 manager:=public.has_role('super_admin') or public.has_role('general_manager') or clinic_finance.allowed('review');
 if p_shift is null and (p_from is not null or p_to is not null) then
  if p_from is null or p_to is null or p_to<p_from then raise exception 'اختار فترة صحيحة';end if;
  if p_to-p_from>30 then raise exception 'أقصى فترة ٣١ يوم';end if;
 end if;
 select array_agg(fs.id) into ids from clinic_finance.shifts fs
  where (manager or fs.cashier_id=me)
    and (p_shift is null or fs.id=p_shift)
    and (p_cashier is null or fs.cashier_id=p_cashier)
    and (p_register is null or fs.register_id=p_register)
    and (p_shift is not null
         or (p_from is not null and (fs.opened_at at time zone 'Africa/Cairo')::date between p_from and p_to)
         or (p_from is null and fs.cashier_id=me and fs.status='open'));
 if p_shift is not null and ids is null then raise exception 'الوردية مش متاحة لك' using errcode='42501';end if;
 ids:=coalesce(ids,'{}');

 select coalesce(jsonb_agg(jsonb_build_object('id',fs.id,'register_name',reg.name,'cashier_name',coalesce(nullif(trim(to_jsonb(ad)->>'name'),''),'موظف'),'opened_at',fs.opened_at,'status',fs.status) order by fs.opened_at),'[]')
   into v_shifts from clinic_finance.shifts fs join clinic_finance.registers reg on reg.id=fs.register_id left join public.admins ad on ad.id=fs.cashier_id where fs.id=any(ids);

 with fsh as (
   select fs.id,fs.cashier_id,fs.opened_at,coalesce(fs.closed_at,now()) until_at,reg.name register_name,coalesce(nullif(trim(to_jsonb(ad)->>'name'),''),'موظف') cashier_name
   from clinic_finance.shifts fs join clinic_finance.registers reg on reg.id=fs.register_id left join public.admins ad on ad.id=fs.cashier_id where fs.id=any(ids)),
 rsh as (select rs.id rid,f.* from clinic_reception.shifts rs join fsh f on f.id=rs.finance_shift_id),
 -- reception receipts: in the drawer (cash/card) or recorded by the cashier during the shift (instapay/bank/wallet)
 rpay as (
   select rp.*,f.id fid,f.register_name,f.cashier_name from clinic_reception.payments rp join rsh f on f.rid=rp.shift_id
   union all
   select rp.*,f.id,f.register_name,f.cashier_name from clinic_reception.payments rp join fsh f on rp.shift_id is null and rp.created_by=f.cashier_id and rp.created_at between f.opened_at and f.until_at),
 r_in as (
   select p.created_at at_time,p.fid shift_id,p.cashier_name,p.register_name,'in' direction,
     case when ins.payer is not null then 'insurance' else 'self' end kind,
     pt.name title,
     concat_ws(' · ',nullif(coalesce(inv.descr,case when p.package_id is not null then 'دفعة باكج' else 'رصيد مقدم للمريض' end),''),case when pt.file_no is not null then 'ملف '||pt.file_no end) detail,
     p.method,p.reference,p.amount::numeric amount,
     case when ins.payer is not null then jsonb_build_object('payer',ins.payer,'claim',ins.claim,'total',ins.total,'cover',case when ins.total>0 then round(ins.claim*100/ins.total) end) end insurance,
     p.id source_id
   from rpay p join clinic_reception.patients pt on pt.id=p.patient_id
   left join lateral (select string_agg(distinct i.description,' + ') descr from clinic_reception.allocations a join clinic_reception.invoices i on i.id=a.invoice_id where a.payment_id=p.id) inv on true
   left join lateral (select e.name payer,c.amount claim,i.amount total from clinic_reception.allocations a join clinic_reception.invoices i on i.id=a.invoice_id join clinic_reception.claims c on c.invoice_id=i.id join clinic_reception.entities e on e.id=c.entity_id where a.payment_id=p.id order by c.amount desc limit 1) ins on true),
 -- finance-desk receipts not already mirrored from reception
 f_in as (
   select fp.created_at,f.id,f.cashier_name,f.register_name,'in','self',coalesce(nullif(fi.patient_ref,''),'تحصيل الخزينة'),fi.description,fp.method,fp.reference,fp.amount::numeric,null::jsonb,fp.id
   from clinic_finance.payments fp join fsh f on f.id=fp.shift_id join clinic_finance.invoices fi on fi.id=fp.invoice_id
   where not exists(select 1 from clinic_reception.payments rp where rp.finance_payment_id=fp.id)),
 -- money out of a reception drawer (refunds, expenses, payouts): credit on a money account, tagged with the shift
 r_out as (
   select j.created_at,f.id,f.cashier_name,f.register_name,'out','out',
     coalesce(pt.name,case j.source when 'refund' then 'استرداد' when 'expense' then 'مصروف' when 'doctor_payout' then 'صرف أتعاب طبيب' when 'supplier_payout' then 'سداد مورد' else 'صرف' end),
     j.description,case l.account when '1111' then 'cash' when '1114' then 'pos' when '1115' then 'wallet' else 'bank' end,coalesce(j.dimensions->>'reference',''),-l.credit,null::jsonb,j.id
   from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id and l.credit>0 and l.account in ('1111','1114','1115','1112')
   join rsh f on f.rid=nullif(j.dimensions->>'shift_id','')::uuid
   left join clinic_reception.patients pt on pt.id=nullif(j.dimensions->>'patient_id','')::uuid
   where j.source not in ('method_fix')),
 -- money out recorded on the finance side (petty cash, refunds, handover to the main treasury …)
 f_out as (
   select e.created_at,f.id,f.cashier_name,f.register_name,'out','out',e.description,e.source,'cash','',-l.credit,null::jsonb,e.id
   from clinic_finance.entries e join fsh f on f.id=e.shift_id join clinic_finance.lines l on l.entry_id=e.id and l.account='1111' and l.credit>0
   where e.source not like 'reception\_%'),
 -- approved payment-method corrections on receipts of these shifts
 fixes as (
   select j.created_at,f.id,f.cashier_name,f.register_name,'fix','fix',coalesce(pt.name,'تصحيح طريقة الدفع'),
     'تصحيح طريقة الدفع لإيصال '||coalesce(rp.reference,''),coalesce(j.dimensions->>'method_from','')||'>'||coalesce(j.dimensions->>'method_to',''),'',l.debit,null::jsonb,j.id
   from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id and l.debit>0
   join rsh f on f.rid=nullif(j.dimensions->>'shift_id','')::uuid
   left join clinic_reception.payments rp on rp.id=nullif(j.dimensions->>'payment_id','')::uuid
   left join clinic_reception.patients pt on pt.id=rp.patient_id
   where j.source='method_fix'),
 allrows as (select * from r_in union all select * from f_in union all select * from r_out union all select * from f_out union all select * from fixes)
 select coalesce(jsonb_agg(jsonb_build_object('at',a.at_time,'shift_id',a.shift_id,'cashier_name',a.cashier_name,'register_name',a.register_name,'direction',a.direction,'kind',a.kind,'title',a.title,'detail',a.detail,'method',a.method,'reference',a.reference,'amount',a.amount,'insurance',a.insurance) order by a.at_time),'[]')
   into v_rows from (select * from allrows order by at_time limit 3000) a;

 return jsonb_build_object('shifts',v_shifts,'movements',v_rows,'manager',manager,'capped',jsonb_array_length(v_rows)>=3000);
end $$;
revoke all on function public.clinic_finance_shift_movements(uuid,date,date,uuid,uuid) from public,anon;
grant execute on function public.clinic_finance_shift_movements(uuid,date,date,uuid,uuid) to authenticated;
