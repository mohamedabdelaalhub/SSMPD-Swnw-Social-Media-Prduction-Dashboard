-- READ ONLY. «White Friday» laser offer (Candela GentlePro): every live laser/pulse service, its base price, booking
-- setup, reception copy and center-list price, plus any laser package templates — so the 15 areas + pulse lines can be matched.
begin read only;
select 'services', jsonb_agg(jsonb_build_object('id',p.id,'code',p.booking_code,'name',p.name,'category',p.category,'dept',p.booking_department,
  'base',p.base_price,'booking',p.booking_enabled,'minutes',p.booking_minutes,
  'center_price',(select i.fixed_price from clinic_prices.items i join clinic_prices.lists l on l.id=i.list_id where l.list_kind='center' and l.status='active' and l.deleted_at is null and i.service_id=p.id limit 1),
  'reception',(select jsonb_agg(jsonb_build_object('code',r.code,'price',r.price,'active',r.active)) from clinic_reception.services r where r.pricing_service_id=p.id and r.active))
  order by p.name)
from public.pricing_services p
where p.active and (p.name ~* 'ليزر|كانديلا|candela|gentle|نبض|pulse|شعر' or p.booking_department ~ 'ليزر');
select 'package_templates', jsonb_agg(jsonb_build_object('code',t.code,'name',t.name,'price',t.price,'visits',t.visits,'validity_days',t.validity_days,'active',t.active,
  'lines',(select jsonb_agg(jsonb_build_array(l.visit_no,s.code,s.name,l.quantity,l.standalone_price)) from clinic_reception.template_lines l join clinic_reception.services s on s.id=l.service_id where l.template_id=t.id)))
from clinic_reception.package_templates t where t.name ~* 'ليزر|كانديلا|candela|نبض|pulse' or exists(select 1 from clinic_reception.template_lines l join clinic_reception.services s on s.id=l.service_id where l.template_id=t.id and s.name ~* 'ليزر|كانديلا|نبض');
select 'center_list', (select jsonb_build_object('id',id,'name',name,'status',status,'valid_from',valid_from,'valid_to',valid_to,'version',version) from clinic_prices.lists where list_kind='center' and status='active' and deleted_at is null);
rollback;
