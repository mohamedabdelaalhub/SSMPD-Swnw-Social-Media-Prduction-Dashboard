# Tips coach — actions that still need a training video (2026-11-22)

Owner request (via main chat 4): role-based tips with animated slides and a «كمّل اتعلّم» button that opens the matching training video.
The existing videos are listed in `assets/js/training-videos.js`. **No finance videos exist yet.**

## Reception — already covered by a video
| Tip | Video |
|---|---|
| سجّل وصول المريض / حجز جديد | `01-booking-arrival.mp4` |
| نادِ على المريض + «بدأ الكشف» | `02-call-start.mp4` |
| طلب خدمة وإنهاء الزيارة | `03-service-finish.mp4` |
| لم يحضر / تغيير الميعاد | `04-noshow-reschedule-search.mp4` |
| ليد جديد | `09-leads.mp4` |

## Reception — needs a video (9)
1. اربط الدكتور بالعيادة. This is «الغرف والطابور» ← العيادات ← اختار الدكتور ← «ربط». The room number then shows on the queue screen and in «دوري».
2. سجّل وصول الدكتور (حالة الطبيب: في الطريق / وصل / بدأ / تأخير / انتهى)
3. حصّل قبل ما المريض يمشي (التحصيل، plus several visits in one payment)
4. الدكتور هيتأخر: «تأخير» + الدقايق + السبب
5. مصروفات الوردية
6. سلّم تحصيلك لزميل («استلمت» / «رفض»)
7. اقفل ورديتك وسلّم الكاش (جرد الفعلي)
8. طلب دعم / تحديد الأولوية
9. الغرف والطابور: «نادِ التالي»، طوابير الأقسام (رقم جديد / نادِ تاني / خلص / مجاش)

## Finance — needs a video (all 14)
1. استلم الكاش من الخزن (استلم النقدية / رفض)
2. اعتمادات مستنياك (طلبات الصرف)
3. سند قبض
4. سند صرف
5. جرد الخزينة الرئيسية (the treasury stays open)
6. مراجعة الوردية
7. فروق الخزينة (راجع الفروق ← استكمال المسار)
8. كشف الخزينة
9. مقدمات الحجز (تسجيل مقدم ← استخدام على فاتورة ← استرداد)
10. مستحقات دكتور (حساب الدكتور ← طلب صرف مستحقات)
11. سداد مورد
12. رفع كشف البنك ومطابقته
13. تحصيل أكتر من زيارة مرة واحدة
14. صرف راتب

## Technical notes
- `SSMPDTrainingVideos.open()` has no "open by id" yet. The coach needs `open(file)` to deep-link a video.
- There is no per-user help/training progress table yet. Seen / learned / never-again tracking needs migration `20261122230000`.
- "Doctor arrived but has no room" can be detected by combining `doctor_sessions[].status` of `arrived` or `started` with the queue state's `doctors[].room_label` being null. `today-operations-queue.js` already shows «اربط الدكتور بعيادة الأول».
