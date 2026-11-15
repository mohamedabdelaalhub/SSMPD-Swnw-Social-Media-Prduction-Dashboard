-- ذاكرة التعلّم تقيس «ريل شخصيات كارتونية» لوحدها (2026-11-14، قرار محمد).
-- بتتقارن بالريل العادي في نفس الصفحة (مش بمتوسط كل المنشورات، لأن الريلز كلها أعلى من البوست).
-- ملحوظة: اللي اتغيّر في refresh_content_learnings هو إضافة insert تاني لبُعد reel_style؛ باقي الدالة زي ما هو بالظبط.
create or replace function public.refresh_content_learnings()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int; n2 int;
begin
  update public.content_learnings set active = false where source = 'system' and active;
  with m as (select * from public.content_performance(60) where brand in ('sono','dr_dina')),
  base as (select brand, avg(engagement)::numeric b from m group by brand having count(*) >= 6 and avg(engagement) > 0),
  dims as (
    select brand, 'format' dim, content_format v, engagement e from m
    union all select brand, 'daypart', daypart, engagement from m
    union all select brand, 'weekday', weekday, engagement from m
    union all select brand, 'cta_type', cta_type, engagement from m
    union all select brand, 'specialty', specialty, engagement from m
  ),
  agg as (select brand, dim, v, count(*) cnt, avg(e)::numeric a from dims where v is not null and v <> '' group by 1,2,3 having count(*) >= 3),
  ins as (
    insert into public.content_learnings(brand, dimension, value, verdict, confidence, evidence, note, source, expires_at)
    select a.brand, a.dim, a.v,
           case when a.a / b.b >= 1.25 then 'do_more' when a.a / b.b <= 0.4 and a.cnt >= 5 then 'avoid' else 'do_less' end,
           case when a.cnt >= 5 and (a.a / b.b >= 1.4 or a.a / b.b <= 0.6) then 'strong' else 'tentative' end,
           jsonb_build_object('posts', a.cnt, 'avg_engagement', round(a.a, 1), 'brand_avg', round(b.b, 1), 'ratio', round(a.a / b.b, 2)),
           a.dim || ' = ' || a.v || ': متوسط التفاعل ' || round(a.a / b.b, 2) || '× متوسط الصفحة (' || a.cnt || ' منشورات)',
           'system', now() + interval '10 days'
      from agg a join base b using (brand)
     where a.a / b.b >= 1.25 or a.a / b.b <= 0.75
    returning 1)
  select count(*) into n from ins;

  -- ريل الشخصيات الكارتونية مقابل الريل العادي (نفس الصفحة، آخر 60 يوم): لازم 3 ريلات من كل نوع على الأقل
  with r as (
    select p.brand, p.engagement::numeric e, (coalesce(c.content_angle, '') = 'character_reel') as is_char
      from public.content_performance(60) p join public.content_items c on c.id = p.content_id
     where p.brand in ('sono','dr_dina') and p.content_format = 'video'),
  s as (
    select brand,
           count(*) filter (where is_char) cc, avg(e) filter (where is_char) ca,
           count(*) filter (where not is_char) nc, avg(e) filter (where not is_char) na
      from r group by brand),
  ins2 as (
    insert into public.content_learnings(brand, dimension, value, verdict, confidence, evidence, note, source, expires_at)
    select brand, 'reel_style', 'character_reel',
           case when ca / na >= 1.25 then 'do_more' when ca / na <= 0.4 and cc >= 5 then 'avoid' else 'do_less' end,
           case when cc >= 5 and (ca / na >= 1.4 or ca / na <= 0.6) then 'strong' else 'tentative' end,
           jsonb_build_object('character_reels', cc, 'normal_reels', nc, 'avg_engagement', round(ca, 1), 'normal_reel_avg', round(na, 1), 'ratio', round(ca / na, 2)),
           'reel_style = ريل شخصيات كارتونية: متوسط التفاعل ' || round(ca / na, 2) || '× الريل العادي (' || cc || ' ريلات شخصيات مقابل ' || nc || ' عادية)',
           'system', now() + interval '10 days'
      from s
     where cc >= 3 and nc >= 3 and na > 0 and (ca / na >= 1.25 or ca / na <= 0.75)
    returning 1)
  select count(*) into n2 from ins2;
  return n + n2;
end $function$;
