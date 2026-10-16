# Claude content style guide (SSMPD) — the single source of design rules for the daily task and the design queue

Kit files (download with gateway `?op=kit_get&name=<path>`):
- dina/ref/01..19.jpg, sono/ref/01..18.jpg — the approved templates (720px). LOOK at 3–4 of them before designing every day.
- dina/logo_black.png, dina/logo_gold.png, dina/logo_white.png, dina/logo_badge.png (round white badge) · sono/logo_web.png, sono/logo.svg
- dina/contact_slide.jpg, sono/contact_slide.jpg — use as (or copy the layout of) the last carousel slide / reel end card
- dina/outro.mp4, sono/outro.mp4 — append to every reel · dina|sono/music_{calm,serious,upbeat}.mp3 — reel music (low, under the voice)
- dina/cover_template.png, sono/cover_template.png — reel cover frame (logo top-left, white rounded title box lower third)
Fonts are in the repo: assets/fonts (Tajawal-*.ttf for Dina; BigVesta-*.woff2 + Hiragino-W3/W6/W8.woff2 for Sono).

## Dr. Dina (د. دينا حسني — استشاري المخ والأعصاب)
- Font: Tajawal only (Black/Bold for titles, Medium/Regular for body). Titles often use kashida (تطويل) to stretch words.
- Palette: white (#FFFFFF) main, warm cream panel #F3E6C0, strong red #E3141B (key words, quote marks ”, badges), magenta/pink #E5007E (frames around her photo), black #111 titles. Nutrition series adds one accent per post (green #6CC24A / orange #F28C28 / amber #F5A300) as a soft blob in the top-right corner.
- Logo: calligraphic "دينا" (black or gold) small at top-left (~110 px wide on 1080).
- Layout families:
  1. Hero image top + wavy red curve divider, red circle badge "يكون في معلومك", justified body paragraph below, quote mark + "د. دينا حسني".
  2. Quote card: small circular portrait + name/title line, red ” marks, topic title, justified paragraph, side image with red curved edge.
  3. Topic + doctor: topic image in an organic blob (left), vertical rounded label chip ("بحثت لك" / "سؤال وجواب" with small icon), title in red/black, short answer, signature "د. دينا حسني | استشاري المخ والأعصاب" with red ”. (Her photos are NOT in the kit — use the blob/illustration side only; never fake her picture.)
  4. Infographic: big two-tone title (black + colored keyword in parentheses), central object illustration, 3–6 points with icon circles or numbered circles, thin divider lines.
- Footer on every design (one thin line, small pills): 📞 0236230005 · 📱 01154542191 · fb/ig icons · @dr. Dina Hosni - د. دينا حسني
- Contact slide: white, round logo badge, "د. دينا حسني / استشاري المخ والأعصاب", red numbers 02-36230005 / 01154542191, WhatsApp 01010686264, address pill "حدائق الأهرام - شارع الخزان - 45 ع".

## Swnw (عيادات سونو التخصصية)
- Fonts: BigVesta Arabic (heavy headlines, kashida stretching), Hiragino Kaku for numbers/English and small text.
- Palette: royal blue #0F369D → #1D4FD0 gradient backgrounds (often with faint medical line-art), OR clean white/light-grey with subtle wave lines; headline keyword in blue or cyan gradient (#16C2E3 → #0B8FD8); orange #F15A22 pill buttons ("احجز موعدك", "ابدأي معانا دلوقتي"); dark text #16212E.
- Logo: "عيادات سونو التخصصية" with the circular emblem, top-left (on blue designs inside a white tab/card at the top).
- Layout families:
  1. Problem/solution photo post: big BigVesta title ("وداعاً لآلام الظهر!"), one-line subtitle question, orange CTA pill, realistic photo with the pain area glowing red, white background.
  2. Blue doctor intro: cutout/circular doctor photo, "الدكتور" + big name, specialty in a cyan gradient pill.
  3. "نصيحة اليوم مع سونو": white, blue square brackets framing a photo + orange title + short tip, doctor signature chip with small round photo.
  4. Series like "علماء وأطباء", "من آراء عملائنا", cosmetics before/after split with "Before/After" vertical labels, 24h emergency 3D illustration.
- Footer on every design: three white rounded pills (📱 +201154542191 · 📞 0236230005 · WhatsApp +201010686264) + line "📍 45 ع بجوار الخزان حدائق الأهرام".
- Contact slide: blue background, big white rounded card, logo, orange numbers, address pill.

## Rules for every design
- 1080×1350 posts/carousel slides; 1080×1920 reels/covers. Generous margins (≥ 60 px), max 2 font families, max ~35 words per image (carousel slides ≤ 25).
- Hierarchy: one dominant title, one subtitle, then points. Arabic RTL, check no clipped or broken letters (render then Read the PNG).
- Use these templates as the baseline and push quality: cleaner spacing, consistent footers, stronger hook on slide 1, clear CTA. Do not copy their exact old texts.
- Photos: these templates use real photos. Until a stock-photo source is connected, use clean flat/3D-style SVG illustrations in the brand palette; never use Dr. Dina's or any doctor's photo without it being in the kit, and never put another brand's logo.
- Never write prices. Always include the footer contacts.
- PERMANENT spacing rules (Mohamed, 2026-10-11):
  - A multi-line title must never leave ONE word alone on a line. Shrink the font or rephrase (e.g. make the last line two words). The dashboard studio does this automatically by pulling a word down.
  - At least 40 px between the grey/subtitle line and the CTA button. In the approved HTML templates the title block is anchored to the bottom (`.t{bottom:…}`), so it grows upward and the gap stays 40 px.
  - At least 50 px empty above the footer (nothing — text, CTA, source label — may come closer).
  - Title line spacing on covers and posts: line-height ≈1.24, so dots of ث/ش/ق are never touched by the line above.
  - On inner slides the title, number and subtitle always sit ABOVE the photo layer (z-index 6) so no dot is hidden.
- Dr. Dina variants 3/4: the headline is red (#e50026, the same as the CTA). Whenever the headline colour is changed, the CTA button takes the same colour.

## Dr. Dina official frames WITH her photo (use these for Dina image posts — preferred over illustrations)
Kit: dina/templates/frame_*.png are 1080×1350 PNGs; the transparent areas are where your content/image goes. dina/templates/example_01..12.png show each frame filled correctly.
- frame_1_wave_quote_magenta.png / frame_2_wave_quote_cream.png — her small portrait + "د. دينا حسني" quote header top-right column, red wave divider; put a topic photo/illustration in the transparent right side, title + justified paragraph in the left column under the header.
- frame_3_blob_pinkjacket_bahatlak.png — her (pink jacket) on the right with "بحثت لك" chip; topic image inside the white blob, title + short paragraph + signature under it on the left.
- frame_4_whitecoat_sual_gawab.png — her (white coat) on the right with "سؤال وجواب" chip; question title in red + answer on the left.
- frame_5_magenta_full.png and frame_6to12_fullbleed_footer.png — full-bleed: put a full background visual (brain/DNA dark-blue style as in examples 6–12) and a big Tajawal title (white/yellow/red highlight boxes) — logo badge top-left and footer are already in the frame.
Compose: render your content layer under the frame (frame on top), check the transparent windows are fully covered, keep text inside the left column.

## Photo sources (gateway — needs the updated claude-automation function)
- Stock (Pixabay, free for commercial use): POST ?op=stock {"q":"back pain man","type":"photo"|"video","orientation":"vertical"} → hits with preview/large URLs; download with POST ?op=fetch_media&url=<large URL>. Prefer people who look Arab/Egyptian; avoid obviously foreign settings.
- Generated (OpenAI): POST ?op=image {"prompt":"...","size":"1024x1536","quality":"medium"} → PNG. Use for Egyptian/Arab-looking people and scenes when stock has no good match. Photorealistic, natural light, no text/logos in the image, modest clothing. Max 3 generated images per day.
- Never generate or alter images of Dr. Dina or any real doctor — use only the kit frames that already contain her photo.
- If these ops return an error (function not updated yet), fall back to illustrations.

## Swnw fixed frame (MANDATORY on every Swnw post/slide — approved by Mohamed 2026-10-11)
- Kit: sono/frame_light.png (colored logo + blue contact pills — for light backgrounds) and sono/frame_dark.png (white version — for blue/dark backgrounds). 1080×1350 transparent overlays containing the logo (top-left), the grey wave lines, the two contact pills (0236230005 / +201010686264) and the address line. Put the frame ABOVE photos/backgrounds and BELOW your text; never redraw or alter the logo/footer yourself.
- Keep all text and buttons above y≈1190 (the footer area belongs to the frame).
- APPROVED LOCKED LAYOUT (Mohamed approved 2026-10-11 — reuse exactly; template: sono/templates/photo_post_v1.html + sono/templates/photo_post_v1.png):
  photo top (object-fit cover, ~880 px tall) fading to white from y≈520 to ≈820; content block starts at y=725, centered, 60 px side margins;
  main title BigVesta Bold 80 px, line-height 1.1, blue #0F369D with the key words in the cyan gradient; subtitle BigVesta Regular 41 px, #4A5563, ONE line (shorten the text rather than wrap), 16 px under the title;
  info box #F3F6FC, 2 px #DCE5F5 border, radius 26, 36 px under the subtitle, orange (#F15A22) heading + white chips with orange dots;
  orange CTA pill (BigVesta Bold 34 px) 32 px under the box; everything must end above y≈1190 (frame footer).
- Gradient (background-clip:text) words cut Arabic descenders (ق ي ع): give the gradient span padding-bottom ~12px with an equal negative margin, and always zoom-check descenders in the render.


## Recent approved dashboard designs = the variety to rotate (kit: sono/dash_refs/01..16.jpg, dina templates below)
Swnw — all share: fixed frame (logo top-left, footer pills), photo filling the top ~60%, big BigVesta title with cyan→blue gradient (or white on dark), one-line subtitle, small orange CTA pill. Rotate the BOTTOM PANEL treatment so the feed doesn't look identical:
  a) white panel (photo fades to white)  b) royal-blue gradient panel (#1D3FB0→#2A2FA0) with white/cyan title
  c) deep red gradient panel (#B0101A) for pain/urgency topics with white title  d) full dark photo with white title for warning topics (smoking, addiction)
  e) blue "doctor welcome" layout: doctor cutout in circle, name big, specialty orange pill, weekly schedule cards.
  Never use the same treatment twice in a row for the same page.
Dr. Dina — render with the dashboard's OWN renderer so it matches the studio exactly: serve the repo root over http (python3 -m http.server), load assets/js/design-panel-color.js, design-composer.js, dina-content.js, design-dina-template.js, then
  await SSMPDDinaTemplate.render(canvas, sceneImage, {dinaVariant:"<1-12>", headline, subtitle, designBody, cta, headlineSize?, subtitleSize?, designBodySize?, ctaSize?, x?, imageOffsetY?, zoom?})
  and export canvas.toDataURL. Variant names (Mohamed's): 1 تصريح خلفية فاتحة · 2 تصريح خلفية غامقة · 3 معلومة من د. دينا · 4 بحثت لك · 5 سؤال وجواب · 6 محتوى عام · 7 عنوان فوق · 8 عنوان علي بوكس · 9 عنوان يمين · 10 عنوان تحت - خلفية سوداء · 11 عنوان تحت - خلفية بيج · 12 عنوان تحت - خلفية نبيتي.
  Content kind → variants: quote (على لسان الدكتورة) 1,2 · education (معلومة طبية) 3,6,7,8 · research (بحثت لك) 4 · qa (سؤال وجواب) 5 · question (سؤال يشد الانتباه) 9 · tip (نصيحة وخطوة عملية) 10,11,12. Headline ≤ 5 words, subtitle ≤ 8 words. Rotate variants.

## Dr. Dina variants 3 & 4 text layout (Mohamed's notes, 2026-10-11 — built into the renderer)
- Headline: Tajawal Black (900), 80 px default, wraps to TWO lines (write 3–5 words so it breaks naturally).
- Subtitle sits 15 px closer to the headline than before; body starts right after it.
- Headline is justified with kashida (tatweel) so both lines have the same width — write the two lines with similar length (e.g. "النوم الكويس / بيحمي مخك") so the stretch looks natural; pass headlineJustify:false to turn it off.
- Headline line spacing +14 px (so the dots of ش don't touch the line above); subtitle Tajawal Bold 42 px on ONE line (auto-shrinks); CTA text Bold.
- Body paragraph line spacing is +3 px. Do not pass headlineSize/designBodySize unless the text doesn't fit.

## Revision requests from the design queue (stage needs_revision)
- Before redesigning an item in needs_revision, read ALL its comments (table comments, content_id = the item) that start with "طلب تعديل:" and that are newer than the last design; apply every requested change exactly and keep everything else from the previous design.
- Videos/reels: "keep everything else" never keeps an old ending. Every revised video is re-exported with the CURRENT "Reel ending — fixed order" (kit contact card, then the current kit outro last) and the current pronunciation fixes, even if the comments don't mention them.
- If a comment says "أعد التصميم من الأول" (or similar), make a completely new design (different variant/photo) instead of editing.
- After uploading, mark those comments done (status = 'done') and send the item back to final_approval as usual. Never approve it yourself.

## Template discovery — do this at the START of every run (Mohamed adds new templates from time to time)
- List the dashboard's templates in this repository: every folder under `assets/design-templates/` and every `assets/js/design-*-template.js` / `*-content.js` file (plus `assets/design-templates/dr-dina/frames.json`). Also list the kit folders `sono/dash_refs/`, `sono/templates/`, `dina/templates/` with op=kit_get listing if available.
- Compare with the templates named in this file. For anything NEW: open its renderer JS to learn its `render(...)` signature and fields, look at its preview images, and add it to the rotation (use it at least once in the next few days where the topic fits).
- In the run summary, write one line: "قوالب جديدة اتلاقت: …" (or "مفيش قوالب جديدة").
- Never edit or delete the template files themselves.

## Carousel items (content_format = carousel)
- Swipe hint on covers is always «اسحب وشوف ←» — the arrow points LEFT (the swipe direction on the platforms), at the left end of the text.
- The slide copy is in `agent_raw_output.carousel_copy` (array of {role: hook|point|cta, headline, body, scene}) and the brief in `carousel_brief` ({slides_count, style, notes}). If carousel_copy is missing, write it yourself from the title/body/caption with the same rules (slide 1 hook, middle slides one idea each, last slide contact/booking, ≤6-word headlines, ≤22-word bodies, no prices).
- Design ALL slides as one consistent set, 1080×1350: same page frame/template on every slide, slide 1 big hook title + photo, middle slides numbered (١، ٢، ٣…) with the point title + body + small icon/photo, last slide = the page contact slide (kit dina/contact_slide.jpg or sono/contact_slide.jpg style). Swnw: fixed frame on every slide. Dina: use the dashboard renderer variants that fit (e.g. 7/8 for points) or her frames.
- Upload each slide PNG to the content-designs bucket under `<content_id>/<uuid>/output.png`, then call `POST /rest/v1/rpc/save_private_carousel` with {p_content_id, p_output_urls:[…in order…], p_settings:{template:"claude-carousel"}}. Then move the item to final_approval as usual.

## Reel on-screen look (Mohamed, 2026-10-11)
- Logo: the approved look is the kit frame `sono/cover_template.png` (Swnw) / `dina/cover_template.png` (Dr. Dina) — the logo sits DIRECTLY on the video, top-left, small (≈200 px wide on 1080), NO box, card or coloured tab behind it. Overlay the cover_template frame on every reel frame (or place `sono/logo_web.png` / the Dina logo at the same position and size). If the footage behind it is very light, add a soft dark gradient at the top of the video instead of a box.
- Caption box: the white rounded box in the lower third (as in cover_template). The box HUGS the text (its width = the caption line + ~28 px padding each side, never a fixed full-width bar), and captions are cut into SHORT chunks of 2–5 words, one line each, switching with the voice (Mohamed, 2026-10-11: «بوكس على قد الكلام وبيتقطع جمل أصغر»).
- Motion (Mohamed, 2026-10-11): key words must MOVE, not sit as plain text. Symptom / list words (e.g. صداع، تنميل، دوخة) pop in one after another (scale 0.6→1.08→1 with a short slide-up, ~0.25 s each, highlight colour), numbers count/pop, the hook line slides in. Keep it smooth and readable — no shaking, no fast flashing.
- Highlighted words in on-screen text: Swnw = ORANGE #F15A22 (never blue); Dr. Dina = her red #E3141B. The rest of the text stays dark (#16212E) on the white box.

## Reel text styles — two options (Mohamed, 2026-10-11)
Read `content_items.cover_settings.caption_style` (staff pick it on the video item):
- `box` → white rounded caption box that hugs the words, short 2–5 word chunks (see "Reel on-screen look").
- `headline` → big headline ON the video, no box (Mohamed liked this look): `docs/templates/sono-reel-text/overlay.html` or `docs/templates/dina-reel-text/overlay.html` — transparent 1080×1920 PNG (render with omitBackground, params tag/title/hl/sub, title lines split with \n, max 2 lines), overlaid on the footage with ffmpeg; dark brand gradient at the bottom, tag pill (Swnw orange, Dina red), white headline centred with the key word coloured (Swnw light blue #6EC6F5 in this style, Dina red), one subtitle line. Change the overlay per scene (a new headline every 3–6 s, fade/slide in), keep the same key-word motion.
- empty → you choose; alternate between the two so the page doesn't look the same every day.

## Reel cover (Mohamed, 2026-10-11)
- Every reel gets a cover in the carousel-cover style: `docs/templates/sono-reel-cover/cover.html` (Swnw, blue, orange highlight) or `docs/templates/dina-reel-cover/cover.html` (Dr. Dina, burgundy, red highlight). 1080×1920: photo on top (a strong frame from the reel or a matching stock photo; never a generated image of Dr. Dina or any doctor), tag pill, big hook title (≤3 lines, no single orphan word), one subtitle line, «▶ شوف الفيديو».
- Cover photo = a WIDE shot (Mohamed 2026-10-12): the photo stays full-bleed (full width, as in the template), but pick a photo where the person is SMALL in the frame with plenty of background around them (head + shoulders or more, not a close-up), so their face sits in the clear upper part (about y 150–800) and is never under the blue/burgundy layer or the logo. Prefer a wide stock photo (op=stock, vertical) over a tight frame from the reel. Don't shrink the photo into a card or box. Check the rendered PNG: if the face is cut or covered, pick another photo.
- Render it to PNG and upload it with the gateway `POST ?op=upload_cover&content_id=<id>` (body = PNG). That one call saves it as the reel cover AND links it in `cover_settings.cover_image_url` (response `linked:true`). Do NOT use op=upload_image for covers (it is refused for video items). Never send the cover to Mohamed instead of uploading; if upload_cover fails, report the exact error. The dashboard shows it in the preview («غلاف الريل») and the publisher sends it as the Instagram reel cover. Staff can also make/edit it from «🎬 تصميم غلاف الريل» on video items.

## Reel ending — fixed order (Mohamed, 2026-10-11)
Every reel ends: content → contact card → outro. The outro is ALWAYS the very last thing.
- Contact card (≈3 s, gentle zoom, voice-over may say the booking line): Swnw `sono/contact_video.jpg`, Dr. Dina `dina/contact_video.jpg` (kit, 1080×1920). Never build your own contact card for reels.
- Outro (≈4 s, keep its own sound): Swnw `sono/outro.mp4` (blue, circular Swnw logo); Swnw cosmetics/aesthetics videos (تجميل، بشرة، ليزر، فيلر، بوتوكس…) use `sono/outro_cosmetics.mp4` instead; Dr. Dina `dina/outro.mp4`. The old burgundy outro (`sono/outro_old_burgundy.mp4`) is retired.
- Keep the voice exactly as it is (one op=tts call per script, current model). Mohamed tried other models and sentence-by-sentence voice and rejected them (2026-10-11).

## Reel voice-over pronunciation (Mohamed, 2026-10-11)
- Before writing a reel's voice, call the gateway `POST ?op=tts_quota` (→ left, limit, resets_at). (If tts_quota itself answers an error, the API key can't read the balance: just go ahead with op=tts.) If `left` is less than the script length, don't call op=tts: make the posts/carousels, leave the reel, and tell Mohamed how many characters are left and the reset date.
- New words to fix: write them with tashkeel in the script, and list them in your report for Mohamed (Claude in the main chat adds them to the permanent list). Don't try kit_put for tts/pronunciations.json from scheduled runs.
- The gateway op=tts rewrites words the voice said wrong before speaking (built-in list in supabase/functions/claude-automation/index.ts + kit file tts/pronunciations.json). Add any new word Mohamed flags to the kit file as {"written": "spoken with tashkeel"}.
- Write scripts so they read right: ordinals أولاً / ثانياً / ثالثاً (never تانياً / تالتاً), «بالراحة» not «براحة», add tashkeel on words that can be misread (الحِمْل، اثْبَتْ، قِسْم).

## Video items with NO uploaded footage
- Follow the request style (claude_design_requests.style, chosen by staff for videos too): `photo` = licensed real stock footage/photos; `illustration` = brand-palette illustrations/motion graphics, no real people footage.
- If the item has no uploaded clips in video-inputs, build the reel yourself: Pixabay stock videos (op=stock type=video, vertical, people who look Egyptian/Arab, no other brands) and/or photos with slow zoom, plus ElevenLabs voice-over of the item's script (op=tts), page music low under the voice, burned-in Arabic captions, and the page outro (kit outro.mp4) at the end. 1080×1920, 20–45 s.
- Never show a fake doctor or fake patient testimonial; stock people are illustrative only.


## Carousel contract — user references, 2026-10-11

This section overrides the single-image locked layout and any general 25-word total cap for content_format=carousel. Use the per-field ranges below instead. Do not render all carousel text onto one photo post. Read the pending claude_design_requests.note: JSON with task=carousel is a rendering brief, not a status message. Preserve the brand, slides_count, style and ordered carousel_copy. Older materials with no copy require a complete carousel copy first; never silently reduce them to image_post.

Read assets/design-templates/carousel-reference/manifest.json and open its reference slides before rendering. Both uploaded examples are Sono. The back series demonstrates a hook cover, five numbered habit/correction cards, then contacts. The flu series demonstrates a question cover, comparisons with two labeled columns, a practical advice slide, then contacts. Use their structure, spacing and hierarchy as references, not their medical text as a new source of truth. For Dina use her existing red/beige/black identity and approved frames, not Sono blue and not a fabricated physician portrait.

Required copy ranges per slide, counted by whitespace:
- hook headline 3–6 words, body 6–12.
- point headline 2–6 words, body 10–22.
- cta headline 2–6 words, body 6–16.
- Every slide needs role, headline, body and a scene description. Role order is hook / points / cta. Cover headline is the design_headline. The caption complements the slides.
- A point teaches one useful thing. No filler to reach the minimum. Compare means two labeled columns; myths mean myth and correction; FAQ means question and answer. Use numbers and icons, not repetitions of the cover photo post.
- Page footers come from the approved frames and stay exactly as printed (Dina frames show 0236230005 / 01154542191 — keep them). In text you write, the final body includes an approved number, and WhatsApp uses https://wa.me/201010686264. Never write other numbers in your own text, prices, invented medical facts or guaranteed outcomes. Emergency guidance takes priority over booking.

Preflight before upload: count all slides and words, verify distinct ideas, brand/frame/footer, numbering, clipping and legibility. If copy fails, report the slide and field to the writing agent and allow one correction; fail the request after a second invalid result. Do not upload a partial set. Upload all slides and call save_private_carousel with ordered URLs and settings containing the same carousel_copy/brief and template=claude-carousel. Verify content_items.carousel_slides length equals slides_count, design_file_url is the first slide, then move only to final_approval. Do not auto-approve.

The in-dashboard generator is the content-ai Edge Function. Custom GPT instructions do not automatically replace that function's instructions. The external Claude scheduler must consume this repository guidance and the queue note; changing that scheduler's own configuration was not performed here.

## Dr. Dina template catalog — with / without her photo (Mohamed, 2026-10-11)
- Source of truth: `assets/design-templates/dr-dina/catalog.json`. Each template has `doctor_photo` (true/false) and `use`.
- Templates 1–5 (تصريح خلفية فاتحة/غامقة، معلومة من د. دينا، بحثت لك، سؤال وجواب) contain her photo → **single posts only**. Never put them in a carousel and never repeat her photo across slides.
- Templates 6–12 (محتوى عام، عنوان فوق، عنوان علي بوكس، عنوان يمين، عنوان تحت سوداء/بيج/نبيتي) have NO photo (logo badge + footer only) → the base for every Dina carousel.
- Dina carousel = same structure as the approved Sono carousel references, in Dina's identity (Tajawal; burgundy #6e225b→#2c0b26, beige #f6edd6, red #E3141B, black). APPROVED LOOK (Mohamed 2026-10-11) — reuse the HTML in `docs/templates/dina-carousel/` (01-cover-dark, 02-point, 99-contact-dark) and the reference images `assets/design-templates/carousel-reference/dina_sample_01..03.webp`:
  - Cover = DARK: burgundy radial gradient, red tag pill, big Black title with key words in light red, one-line subtitle, ONE large topic illustration (~600×500) bottom-left, white "← اسحب وشوف" pill. Frame 12.
  - Point slides = beige #f6edd6: red numbered circle + Black title on one line (key words red), ONE large illustration (~760×470) in the middle showing the idea (people/objects, never her), white card with burgundy right border + label pill (الصح / الخرافة / الحقيقة / السؤال) and the body. Frame 11. No small icon tiles.
  - Last slide = DARK burgundy like the cover: title, one-line reason, "د. دينا حسني / استشاري المخ والأعصاب", red booking pill, white number pills 01010686264 / 0236230005, address pill, one large illustration at the bottom (above y≈1240). Frame 12.
  - Slide counter "١ / ٦" top-right. Illustrations are flat SVG you draw, big and friendly; never fake her or any doctor.
- Keep the frames' printed footer exactly as it is (Mohamed, 2026-10-11) — do NOT cover or redraw the footer number in Claude's designs. He will send a new footer if it changes.
- New templates: when you discover a Dina template that is not in catalog.json, look at it; if it shows her photo treat it as single-post only, and tell Mohamed in the run summary to add it to the catalog.

## Carousel styles — APPROVED by Mohamed 2026-10-11 (pick by claude_design_requests.style)
- style = 'illustration' → illustrated sets: Dina `docs/templates/dina-carousel/01-cover-dark.html, 02-point.html, 99-contact-dark.html` (refs dina_sample_01..03); Sono = the approved Sono carousel references (back/flu sets).
- style = 'photo' (and the default for the daily run when a good photo exists) → photo sets:
  - Sono `docs/templates/sono-carousel-photo/01-cover.html, 02-point.html, 99-contact.html` (refs sono_photo_01..03). Cover = full-bleed photo fading into royal blue, white BigVesta title with orange key words, orange tag, white "اسحب وشوف" pill. Point = photo on the top ~720 px fading to white (white fade behind the logo too), orange number + blue title with cyan gradient word + grey one-line subtitle + #F3F6FC card with "الصح". Contact = blue gradient, round photo, orange booking pill. Mandatory frames: frame_dark.png on dark slides, frame_light.png on light slides (kit). Keep text above y≈1190.
  - Dina `docs/templates/dina-carousel/photo-01-cover.html, photo-02-point.html` + `99-contact-dark.html` (refs dina_photo_01..03). Cover = full-bleed photo fading into burgundy, Black title with light-red key words. Point = beige, big photo (rounded 44 px, white 8 px + red 3 px outline) under the badge, red number + title, white card with burgundy border. Contact = the dark illustrated contact slide (no photo of any woman near "د. دينا حسني").
  - Replace `PHOTO.jpg` in the HTML with the downloaded/generated photo.
- PHOTO FRAMING RULE (mandatory): faces must be fully visible and clear, never under a title, a gradient or the logo. On covers the face centre must sit between y≈200 and y≈500 of the 1080×1350 canvas — move the photo up/down (e.g. `top:-230px; height:1580px; background-position:center top`) until it does; check the render. Same on point slides: the face sits in the upper/middle of the photo box, never cut by its edge.
- Photos: prefer Pixabay (op=stock) only when the people look Egyptian/Arab and fit; otherwise generate (op=image, photorealistic Egyptian people, modest clothing, no text/logos; max 3 per run). Never generate or show doctors or Dr. Dina.

## Numbers in designs (Mohamed, 2026-10-11)
- Always use English/Western digits 0123456789 in every design and video caption — slide counters ("1 / 6", render the counter with direction:ltr), numbered circles, titles ("5 حاجات"), times, percentages and phone numbers. Never Arabic-Indic digits (٠١٢٣…). If the item's text has Arabic-Indic digits, convert them in the design.

## Single post in the carousel-cover style — APPROVED option (Mohamed 2026-10-11)
- Single posts (both brands): the CTA button sits on the RIGHT, directly under the title block (Mohamed 2026-10-11). Dina's source line sits under it, also right-aligned.
- Staff can make the same Swnw post in the dashboard studio: قالب التصميم ← «بوست بستايل غلاف الكاروسيل — سونو» (`layoutTemplate: sono_cover`, assets/js/design-cover-template.js, frame assets/design-templates/sono-cover/frame_dark.webp).
- For content_format = image_post with a real photo (request style 'photo', and the daily run whenever a good photo exists), the DEFAULT layout is the carousel-cover style: `docs/templates/sono-post-photo/post.html` (Swnw) and `docs/templates/dina-post-photo/post.html` (Dr. Dina); references `assets/design-templates/carousel-reference/sono_post_cover_style.webp` / `dina_post_cover_style.webp`.
- Same as the approved cover: full-bleed photo (face clearly visible in the upper half, framing rule applies) fading into royal blue (Swnw) / burgundy (Dina), tag pill, big title with key words in orange (Swnw) / light red (Dina), one-line subtitle — but NO slide counter and NO "اسحب وشوف": instead a CTA pill (Swnw orange #F15A22 e.g. "احجز موعدك"; Dina red #E3141B e.g. "شاركنا تجربتك في الكومنت") at the same place. Frames/footers exactly as the carousel covers.
- The older locked Swnw photo layout (white fade, info box) and the bottom-panel treatments stay available as alternatives — rotate so the feed is not identical every day.

## Medical sources — `sources` + `cover_source_text` (Mohamed, 2026-10-11)
One structure for every origin of a content item: ChatGPT plugin manual import, the in-dashboard `content-ai` function, and this daily Claude run. It lives at the TOP LEVEL of `content_items.agent_raw_output` (JSON text, no new columns):

```json
"sources": [{"name":"NHS","title":"Headaches","url":"https://www.nhs.uk/symptoms/headaches/","type":"medical_authority","is_primary":true}],
"cover_source_text": "المصدر الطبي للمحتوى: NHS"
```
- Non-medical content (doctor welcome, offers, service/center ads): `"sources": []` and `"cover_source_text": ""`. Old items without these keys are valid and behave as the empty case.
- Medical content: only real official pages you are sure exist (NHS, WHO, CDC, Mayo Clinic, NICE …) with https URLs. NEVER invent a source, URL or study title; if no specific page is known, leave `sources` empty. Exactly one `is_primary: true`. `cover_source_text` = «المصدر الطبي للمحتوى: » + primary `name`.
- When you CREATE an item (POST content_items) write `agent_raw_output` as a JSON string that includes both keys. When you PATCH `agent_raw_output`, read the current JSON first and keep `sources` / `cover_source_text` (and the other keys such as carousel_copy, carousel_brief) — never overwrite the whole object. Staff may edit the source in the dashboard ("المصدر الطبي" section), so always read the latest value before designing.
- The dashboard function `content-ai` already returns the same schema, drops any URL outside a short allow-list of medical authorities, and opens every link once — a page that does not answer is removed. Do the same yourself: before saving a source, fetch its URL; if it is not reachable, do not use it.

### Where it appears on the design
- `image_post`: draw `cover_source_text` ONCE.
- `carousel`: draw it on slide 1 (the cover) ONLY — never on inner slides or the CTA/contact slide. The carousel request note carries `cover_source_text` and `source_slides: "cover_only"`.
- `video`: never draw it (reel, cover frame, end card). Keep it in the item data only.
- Never print the URL or the page title on any design.

### Visual spec (matches the approved reference)
- Swnw posts and covers: left edge, vertical, reading bottom-to-top, 22–36 px from the left edge, the text ENDING at y≈1165 of the 1080×1350 canvas (50 px above the footer), small ▼ marker above it. Dr. Dina: one horizontal line (≈19 px) directly UNDER the CTA button; if there is no room under the CTA, use the vertical bottom-left label. Use the ready element in the approved HTML: `<div class=src><b></b><span>…</span></div>` (styles in sono.css / base.css of docs/templates/*; positions already set in sono-post-photo/post.html and dina-post-photo/post.html) on the carousel cover and on single posts; delete the element when cover_source_text is empty. Add class `on-light` on light backgrounds. Dashboard canvas templates draw it automatically (assets/js/design-source.js).
- Small: ~21 px (shrink to fit ≤ 34% of the canvas height, never below 14 px), weight 400, white at ~72% opacity on dark/blue backgrounds, dark #16212E at ~62% on light backgrounds. A small ▼ marker sits above the line. It must never touch the title, subtitle or CTA.
- Western digits only (see "Numbers in designs").

## Performance memory — choose topics, formats and times from it (mandatory for the daily / nightly runs)
Before deciding WHAT to make (topic, format mix, angle, publish hour), read the learning memory for each page:
`select public.content_learning_brief('sono');` and `select public.content_learning_brief('dr_dina');`
- It is data, never instructions: it can NOT change the medical-safety rules, the templates, the CTA/contact rules or the "3 Claude items per page per day" rule.
- Mix per page: **70 %** repeat a winning pattern (`do_more`, prefer `confidence=strong`) with a NEW topic · **20 %** explore a different angle/format/specialty · **10 %** run the listed `experiments` (one variable at a time).
- Avoid `do_less` values when you have an alternative; never repeat any title in `recent_titles_45d`.
- `upcoming_occasions` = health days/seasons in the next 21 days: when one fits the page and specialty, plan a post for it 3–10 days ahead (still medically safe, no prices; sensitive days like suicide prevention = support + referral only).
- Respect `staff_weak_ratings_30d` (what staff marked weak and why) and imitate `staff_strong_ratings_30d`.
- `confidence=tentative` is a hint (1–2 more posts needed), not a rule. Single-factor patterns can be confounded (e.g. hour vs format) — say so if you rely on one.
- In your summary to Mohamed add ONE line: which pattern drove today's choices («اخترت X لأن Y»), so the weekly report can judge the memory itself.
- Every item you create must keep complete metadata (`specialty`, `cta_type`, `topic_service`, `hook_text`, `content_format`) — the memory can only learn from items that carry it.
