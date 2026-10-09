# Doctor schedule templates

The numbered PNG pairs supplied by the owner are authoritative. Clean backgrounds are resized to 1080 × 1350 and stored as lossless WebP. Schedule text coordinates and white day pills come from odd IDML pages 1–19. The paired even pages are clean backgrounds. Original uploads remain unchanged.

| Schedule | Variant |
| --- | --- |
| Shared hours, 1–2 days | 1 |
| Shared hours, 3 days | 2 |
| Shared hours, 4 days | 3 |
| Every day except selected days; shared hours over 4 days | 4 |
| Different hours, 7 days | 5 |
| Different hours, 6 days | 6 |
| Different hours, 5 days | 7 |
| Different hours, 4 days | 8 |
| Different hours, 3 days | 9 |
| Different hours, 2 days | 10 |
| Different hours, 1 day | 1 |

`doctor_brief.schedule_mode` and `excluded_days` are stored with the existing `agent_raw_output`; actual working days and hours are included in `schedule`. Studio settings retain `doctorScheduleMode`, `doctorDays`, shared/first-row hours and `doctorScheduleExtra`. Previous metadata without the new mode is inferred from its hours. Duplicate days and incomplete entries are rejected; no days are silently dropped. The doctor name uses the provided BigVesta Arabic Bold font.

Redeploy the full `supabase/functions/content-ai/index.ts` to the existing content-ai function in project uuijfbpgvtdxgaosqpxo to preserve schedule case and exceptions in saved AI ideas. No SQL migration, new key, or paid generation is required by this change.

Verification: doctor-schedule.cjs, doctor-content.cjs, design-copy.cjs, design-editor-responsive.cjs and doctor-template-variants.cjs. Browser storage and API responses are mocked; no live account save or paid AI generation was performed.
