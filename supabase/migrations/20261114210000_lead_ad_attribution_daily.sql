-- إسناد الليدز للإعلانات: اسم الإعلان والحملة كمان من مزامنة الصرف اليومية (meta_ads_daily)
-- قبل كده الاسم كان بيتجاب من meta_ads بس (استيراد CSV قديم آخره سبتمبر)، فالإعلانات الجديدة كانت
-- بتتسجل على الليد (meta_ad_id) بس اسمها مش ظاهر. نفس الأعمدة ونفس ترتيبها، وزيادة عمودين في الآخر.
create or replace view public.vw_lead_meta_attribution as
select
  l.id as lead_id, l.customer_name, l.phone_normalized, l.source, l.current_status, l.received_at,
  l.meta_ad_id, l.meta_campaign_id, l.utm_source, l.utm_medium, l.utm_campaign, l.utm_content,
  a.id as matched_meta_ad_id,
  coalesce(a.ad_name, d.ad_name) as matched_ad_name,
  a.specialty as matched_specialty,
  coalesce(c.campaign_name, d.campaign_name, dc.campaign_name) as matched_campaign_name,
  coalesce(d.brand, dc.brand) as matched_brand,
  (l.meta_ad_id is not null or l.meta_campaign_id is not null) as has_ad
from public.leads l
left join public.meta_ads a on a.platform_ad_id = l.meta_ad_id
left join public.meta_campaigns c on c.id = a.campaign_id
left join lateral (
  select x.ad_name, x.campaign_name, x.brand from public.meta_ads_daily x
   where l.meta_ad_id is not null and x.ad_id = l.meta_ad_id
   order by x.day desc limit 1
) d on true
left join lateral (
  select x.campaign_name, x.brand from public.meta_ads_daily x
   where d.ad_name is null and l.meta_campaign_id is not null and x.campaign_id = l.meta_campaign_id
   order by x.day desc limit 1
) dc on true;
