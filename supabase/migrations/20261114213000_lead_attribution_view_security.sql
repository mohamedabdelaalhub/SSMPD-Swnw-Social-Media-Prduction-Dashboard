-- أمان: vw_lead_meta_attribution (فيها اسم ورقم كل ليد) كانت view عادية (بتتخطى RLS بتاع leads)
-- ومتاحة لـ anon. اتطبق على القاعدة الحية 2026-11-14 20:38 UTC. دلوقتي بتحترم صلاحيات اللي بيقرا،
-- ومتاحة للمستخدمين المسجلين بس، وللقراءة بس.
alter view public.vw_lead_meta_attribution set (security_invoker = true);
revoke all on public.vw_lead_meta_attribution from anon;
revoke insert, update, delete, truncate, references, trigger on public.vw_lead_meta_attribution from authenticated;
