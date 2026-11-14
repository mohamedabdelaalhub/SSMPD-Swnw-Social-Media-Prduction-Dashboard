# reelkit — مولّد ريلات الشخصيات (Claude Creative)

Claude بيكتب ملف storyboard JSON بسيط، وأمر واحد بيطلّع ريل 1080×1920 فيه صوت ElevenLabs متعدد الشخصيات، كابشن، موسيقى، كارت التواصل والأوترو.

```
python3 scripts/reelkit/build.py story.json OUTDIR --kit BRANDKIT [--dry] [--no-end]
```
- `BRANDKIT`: فولدر فيه `sono_logo_web.png`, `sono_music_<calm|upbeat|serious>.mp3`, `sono_contact_video.jpg`, `sono_outro.mp4` (من البوابة `op=kit_get&name=sono/...`).
- `--dry`: من غير ElevenLabs (توقيت تقديري، مفيش تكلفة) — للتجربة.
- متطلبات: python3 + numpy، node + playwright (Chromium)، ffmpeg. الفونتات من `assets/fonts` في المستودع (`SSMPD_REPO` لو مختلف).
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
