# Design copy activation

Frontend loads three distinct fields from existing agent_raw_output metadata. It preserves restored design versions and drafts. Applying a suggestion changes only headline/subtitle/cta and saves them with the existing design settings. No SQL migration is required.

Publish the updated supabase/functions/content-ai/index.ts as content-ai in the existing Supabase project. Keep OPENAI_API_KEY server-side. Existing generation modes remain supported. New design_copy mode reads content through the caller RLS and returns one suggestion without writing to content_items or changing approval state.

The external Custom GPT receives the updated style through the copied Dashboard Brief. To make this its permanent default, add the following to its Instructions:

أنتج دائمًا design_headline بعنوان رئيسي لا يتجاوز ٥ كلمات وdesign_subtitle بسطر توضيحي لا يتجاوز ٨ كلمات وdesign_cta بنص زر من كلمتين إلى ٤ كلمات. راجع الإملاء. استخدم صياغة مصرية طبيعية بلا فواصل أو تنصيص أو زخارف. اجعل السطر التوضيحي يضيف معنى ولا يكرر العنوان. أعد الصياغة ولا تقص الكلمات. اختر التفاعل حسب هدف المنشور والمحتوى. في الطوارئ قدّم التوجه للطوارئ على الحجز. أبقِ hook وcaption وcta_text حقولًا مستقلة وأضف الحقول الثلاثة إلى SSMPD_STRUCTURED_JSON لكل فكرة.

Verification: tests/design-copy.cjs covers limits, punctuation, import matching, authentication/RLS, single suggestion and old three-idea schema using mocked responses. tests/design-editor-responsive.cjs covers review-before-apply and save/restore in actual Chromium at six viewport sizes. No live paid AI request or Supabase deployment was performed by these tests.
