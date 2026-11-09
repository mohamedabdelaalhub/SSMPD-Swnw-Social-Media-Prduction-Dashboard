-- NOT EXECUTED. Prepared 2026-11-09 for the owner's go. Creates the 10 booking-channel rules (PENDING: a DIFFERENT admin must approve each one in the channels screen).
-- Source of truth for the rows: PROJECT-STATE/findings-nursing-referral-channels-20261108.md section 4, with the owner's decision "channels start now": valid_from = the day it is applied (parameter).
-- Needs migration 20261108130000_channels_discounts_p1.sql applied (clinic_finance.channel_rules / clinic_finance_channel_command).
-- Usage (psql, by the owner or an approved session):
--   psql -v maker_user=<auth.users id of the MAKER admin: must have accounting 'create'> -v valid_from=2026-11-09 -v valid_to=2027-12-31 -f channel_rules.sql
-- Rules created through clinic_finance_channel_command('create') so maker-checker / audit / versioning are kept (never raw INSERT). Re-running is safe: the same token is derived from the code + dates, and an identical request returns the same rule.
\if :{?valid_to} \else \set valid_to 2027-12-31 \endif
\if :{?valid_from} \else \echo 'pass -v valid_from=YYYY-MM-DD (the day the owner applies)' \quit \endif
\if :{?maker_user} \else \echo 'pass -v maker_user=<auth user id of the maker admin>' \quit \endif
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'maker_user', 'role', 'authenticated')::text, true); -- AUTH
set local role authenticated; -- AUTH
with r(code, name, kind, applies_to, discount, share, payable_kind, payable_when, source_codes) as (values
  ('vezeeta',            'فيزيتا',                           'external',    'consultation', 0, 25, 'commission', 'آخر الشهر',         array['vezeeta']),
  ('akshef',             'أكشف',                            'external',    'consultation', 0, 25, 'commission', 'آخر الشهر',         array['akshef']),
  ('clinidu',            'كلينيدو',                         'external',    'consultation', 0, 25, 'commission', 'آخر الشهر',         array['clinidu']),
  ('social',             'سوشيال ميديا',                    'external',    'consultation', 0, 25, 'commission', 'آخر الشهر',         array['facebook','instagram']),
  ('club_ahly',          'النادي الأهلي',                   'contracting', 'consultation', 30, 0, 'none',       '',                  array['club_ahly']),
  ('club_wadi_degla',    'نادي وادي دجلة',                  'contracting', 'consultation', 30, 0, 'none',       '',                  array['club_wadi_degla']),
  ('club_hadayek_ahram', 'نادي حدائق الأهرام',              'contracting', 'consultation', 30, 0, 'none',       '',                  array['club_hadayek_ahram']),
  ('syndicate',          'نقابات',                          'contracting', 'consultation', 30, 0, 'none',       '',                  array['syndicate']),
  ('kafaret',            'كفارة وسلامتك',                   'contracting', 'consultation', 20, 10, 'cashback',  'شهريًا (كاش باك)',  array['kafaret']),
  ('internal_booking',   'حجز داخلي (تليفون/موقع/واتساب)',  'internal',    'all',          0, 25, 'none',       'تبقى داخل المركز',  array['phone','website','whatsapp']))
select r.code, public.clinic_finance_channel_command('create', jsonb_build_object(
         'code', r.code, 'name', r.name, 'kind', r.kind, 'applies_to', r.applies_to, 'patient_discount_percent', r.discount, 'platform_share_percent', r.share,
         'payable_kind', r.payable_kind, 'payable_when', r.payable_when, 'source_codes', to_jsonb(r.source_codes), 'valid_from', :'valid_from', 'valid_to', :'valid_to', 'notes', 'قرار المالك 2026-11-09: تبدأ من تاريخ التطبيق'),
         md5('channel-rule|' || r.code || '|' || :'valid_from' || '|' || :'valid_to')::uuid) as rule_id
from r order by r.code;
commit;
-- AFTER: a second admin opens the channels screen and approves each of the 10 pending rules (or: select clinic_finance_channel_command('review', jsonb_build_object('id','<rule id>','approve',true,'note','اعتماد'), gen_random_uuid()) as that admin).
-- UNDO (pending only): update clinic_finance.channel_rules set status = 'rejected' where status = 'pending' and notes like 'قرار المالك 2026-11-09%';   (an approved rule is retired with clinic_finance_channel_command('retire', ...))
