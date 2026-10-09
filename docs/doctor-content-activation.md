# Doctor introduction content

Create a Sono content item and select `تعريف طبيب`, or type a title such as `تعريف د/ راضي منصور`. Enter the prefix, name, professional title/specialty, weekdays and start/end times. Qualifications and experience are optional. The normal specialty and advertising-objective fields still apply.

The generator returns the existing three suggestions for human review. Doctor facts are carried as `content_kind: doctor_intro` and `doctor_brief` inside existing `agent_raw_output` / idea-bank `raw_output` JSON. The design studio initializes the Sono doctor template from those fields when no saved design settings override them. Saving and approvals use the existing flow; no database migration is required.

Deploy the complete `supabase/functions/content-ai/index.ts` in the existing Supabase `content-ai` function, project `uuijfbpgvtdxgaosqpxo`. It preserves CORS, authentication/RLS and existing design-copy/three-idea functionality. Existing `OPENAI_API_KEY` and optional `CONTENT_AI_MODEL` settings are unchanged. It checks mandatory physician facts and schedule before calling AI. It instructs the model to use only supplied qualifications and experience and never invent credentials. Human approval remains required to check the actual generated caption.

The copied external-agent Brief also contains the supplied physician facts and welcome-post instructions. No external Custom GPT's permanent instructions were changed.

Verified with mocked AI/storage and real Chromium: title detection, required schedule blocking, optional credentials, generation payload, three-suggestion metadata, saved-idea hydration, automatic template initialization, desktop/mobile design rendering, and generic content regression checks. No paid AI request or authenticated production save was performed.
