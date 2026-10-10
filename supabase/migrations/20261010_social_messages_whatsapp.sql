-- تنبيهات وكيل واتساب (whatsapp-alert) كانت بتفشل لأن عمود platform كان بيقبل فيسبوك وإنستجرام بس.
alter table public.social_messages drop constraint if exists social_messages_platform_check;
alter table public.social_messages add constraint social_messages_platform_check
  check (platform in ('facebook','instagram','whatsapp'));
