# Sono doctor template

The template uses the owner's supplied InDesign page 1 (1080 × 1350), its exported background, and BigVesta Arabic Regular/Bold plus Hiragino Kaku Gothic StdN W8 for times. Background WebP is lossless. The Latin font includes only clock digits and punctuation. The original supplied files remain unchanged.

Select `قالب تعريف الدكتور — سونو` in the design studio. Enter the prefix, name, professional title/specialty, weekdays, start/end times, and upload the doctor's photo. No AI generation is used. Times are entered as 24-hour values and displayed as 12-hour times with Arabic AM/PM labels, including midnight. Name/title sizes are maxima and shrink to fit their template boxes without cutting words. An explicit newline controls the name's two lines.

Photo scaling starts at cover, so it always fills the circle. Horizontal/vertical position controls adjust the visible crop, with no exposed empty edges. The supplied logo, contacts, background and decorative elements stay fixed.

Existing private design-version saving stores these fields in its settings JSON and the photo in its source file. Reopening restores both through the existing permissions and review process. No SQL or Edge Function deployment is required for this template.

Focused verification: real Chromium rendering at desktop and 390/320px mobile widths, required data gating, long names, time changes, disabled AI tools for this template, photo crop, JSON settings save/reopen with mocked storage, switching back to existing templates, and the existing six-size design-editor checks. Production authentication/storage were not exercised by these tests.
