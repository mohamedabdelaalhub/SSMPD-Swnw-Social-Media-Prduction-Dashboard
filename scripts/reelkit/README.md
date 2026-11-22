# reelkit — مولّد ريلات الشخصيات (Claude Creative)

Claude بيكتب ملف storyboard JSON بسيط، وأمر واحد بيطلّع ريل 1080×1920 فيه صوت ElevenLabs متعدد الشخصيات، كابشن، موسيقى، كارت التواصل والأوترو.

```
python3 scripts/reelkit/build.py story.json OUTDIR --kit BRANDKIT [--dry] [--no-end]
```
- `BRANDKIT`: فولدر فيه `sono_logo_web.png`, `sono_music_<calm|upbeat|serious>.mp3`, `sono_contact_video.jpg`, `sono_outro.mp4` (من البوابة `op=kit_get&name=sono/...`).
- `--dry`: من غير ElevenLabs (توقيت تقديري، مفيش تكلفة) — للتجربة.
- متطلبات: python3 + numpy، node + playwright (Chromium)، ffmpeg. الفونتات من `assets/fonts` في المستودع (`SSMPD_REPO` لو مختلف).
- صوت الراوي (narrator): Instinct (صوت بشري) عن طريق البوابة `op=vo_submit` ثم `op=vo_fetch` كل ٢٠ ثانية لحد ٣٠ دقيقة، والصوت `auto` بيتبدّل رجالي/حريمي ريل بريل؛ الطاقة من `meta.vo.energy` (calm/moderate/energetic). لو مجاش في ٣٠ دقيقة أو حصل خطأ → ElevenLabs زي الأول. التوقيت بيتظبط على وقفات الصوت (سطر لكل جملة). `RK_NARRATOR=elevenlabs` يقفل Instinct.
- لقطات Instinct المقترحة (اختيارية): `build.py story.json OUT --vo-submit` يطلب الصوت بدري، و`vo_job.py status OUT` بيعرض `clips`. لينكات Pixabay ليها `id` تتجاب بـ`op=stock {id,type,brand}` ثم `op=fetch_media`، والباقي أفكار للبحث بس. بعدها البيلد العادي بيستخدم نفس الجوب (متغيّرش النص المنطوق).
- صوت ElevenLabs: لو البيئة فيها Network secret بيتكلّم مباشرة، ولو لأ (المهام المجدولة) بيروح تلقائي على البوابة `op=tts {voice,timestamps}` بتوكن التشغيل. Network secret بهيدر `xi-api-key` (البروكسي بيحطه). الأصوات في `voices.py` (doctor_male, male_2, woman_1, woman_2, elder_man, elder_woman, narrator). أصوات الأطفال مش متاحة بعد.

## أسلوبين بصريين (بدّل بينهم للتنويع، أو اخلطهم)
1. **كارتون (ستيكمان)**: `look` من `person.py` — abu, man_tie, man_beard, mama_hair, mama_hijab, boy, girl, grandpa, grandma, doctor_m, doctor_f.
2. **كيتات Shutterstock** (`kitstyle.json`): `dr_poses` (دكتور بوضعيات)، `kit_dr_f_auburn`، `kit_woman`، `kit_girl`، `kit_boy`. الأجزاء بتتحمّل من البوابة (`op=kit_get&name=characters/<kit>/...`) في `~/.cache/swnw-char-kits` (أو `CHAR_LIB`). **الأجزاء ماتتحطش في المستودع** (ترخيص). ماتستخدمهاش كلوجو/ماسكوت.

## شكل الـ storyboard
`meta{brand,title,music,seed,file}`, `cast{id:{look,voice}}`, `scenes[{set,cam{z0,z1,x0,x1},trans(cut|fade|slide|flash),actors{id:{x(0-1),s,face,prop}},beats[...]}]`.
الـ sets: kitchen, clinic, bedroom, street, school, living, pharmacy, garden. الشخصية اللي مش مذكورة في مشهد بتختفي منه.
الـ beats: `say{who,text,hl[],gesture}`, `enter/walk/exit`, `face`, `prop`, `act{who,do,dur}` (jump, ouch, scared, happy, think, surprised, laugh, wave, point, cheer, shrug, nod, thumbs)، `fx{kind:burst|flash|shake,text}`، `card`, `set_prop`, `bubble`, `sfx`, `wait`.
أمثلة جاهزة في `stories/`. الكابشن: صندوق أزرق بحافة برتقالية، الكلمة المفتاحية في `hl`.

## قواعد محتوى (إلزامية)
- مفيش وعود علاج ولا تخويف؛ أي معلومة طبية "استشر الدكتور" وتتراجع من دكتور قبل النشر.
- مفيش بيانات/صور مرضى. اسم المركز `Swnw` بالإنجليزي في أي نص ظاهر.
- راجع رصيد ElevenLabs قبل التوليد؛ نوّع الأسلوب والمواقف والـ sets عن الريلات السابقة.


## من حوار لريل
`python3 scripts/reelkit/from_dialogue.py dialogue.json story.json` يحوّل حوار «المتكلم: الجملة» لـstoryboard كامل (تنويع + أصوات معتمدة + الأطفال بيتفاعلوا بصمت). أمثلة في `dialogues/`. التفاصيل في `docs/claude-character-videos.md` §4d.
## الغلاف
`python3 scripts/reelkit/cover.py OUT "العنوان مع *كلمة* مفتاحية" "التاج" "سطر فرعي"` بعد `build.py` ← `OUT/reel-cover.png` بقالب غلاف الريل المعتمد (يرفع بـ `?op=upload_cover`). `build.py` بيحفظ كمان `speech check` (نسخ الصوت ومقارنته بالنص) و`voice_<speaker>.json` للتشخيص.
