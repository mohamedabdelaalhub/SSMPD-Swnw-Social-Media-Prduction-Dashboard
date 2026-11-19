---
name: swnw-official-cover-letter
description: كفر لتر سونو الرسمي — turn any text (offer, proposal, report, letter, contract summary) into an A4 PDF + editable Word file on the official Swnw (عيادات سونو التخصصية) letterhead, with an elegant cover page, the official logo/footer on every page, BigVesta Arabic font and brand colors. Use when the owner asks for a Swnw-branded offer/letter/report document, "كفر لتر سونو", "ورق سونو الرسمي", a branded PDF + Word, or an offer for partners/owners. Not for invoices or prescriptions (those have their own templates).
---

# كفر لتر سونو الرسمي (Swnw official cover + letterhead document)

Builds a ready-to-send **A4 PDF** and an editable **Word (.docx)** from a JSON file of text blocks:
a designed cover page, then the body on the **official letterhead** (logo header + footer with the company name,
phones, address, tax number, QR) on **every page**, in the Swnw identity.

## Rules (read first)
1. **Wording and numbers are the owner's.** Typeset the text verbatim. Never rephrase, shorten, add claims, or "improve" figures. Layout and design only. The cover shows only the title / subtitle / date / addressee that the owner gave (no invented labels like «سري»).
2. **Identity comes from the repo, nothing else:** `assets/img/swnw-official-letterhead.png` (A4 letterhead, logo + footer baked in), `assets/fonts/BigVesta-*.woff2`, colors `#0F369D` (primary), `#F15A22` (accent), `#16212E` (ink), light fills `#F4F6FC` / `#FFF4EE`. If the files are missing, stop and tell the owner; do not improvise a logo.
3. **The footer is part of the letterhead image.** Do not re-type it. If the owner's requested footer text differs from the letterhead (e.g. a different tax number), **do not silently pick one**: build with the letterhead as is and tell the owner exactly what differs. (Known: the letterhead shows Tax No **758-688-423**; an owner message once quoted 423-688-758 — ask which is correct.)
4. **Business documents are private.** Write outputs to the scratchpad or another non-repo folder and deliver with SendUserFile. Never commit an offer/contract/proposal to the repository (the repo is published).
5. Reply to the owner in Egyptian Arabic; keep the report short. Say plainly what was and was not checked (e.g. "Word opened only in LibreOffice").
6. "Same template as the invoices": this skill uses the official letterhead. If the owner says invoices use another template, ask for a sample instead of guessing.

## Steps
1. Put the owner's text into a JSON file (schema in `references/content-schema.md`; example in `examples/sample.json`). Keep their text character for character; split it into blocks only.
2. Run: `python3 .claude/skills/swnw-official-cover-letter/scripts/swnw_doc.py content.json OUTDIR "Base-File-Name"`
   → `OUTDIR/Base-File-Name.pdf` + `.docx`.
   Needs: node + Playwright with Chromium (the script falls back to `/opt/pw-browsers/chromium`), Python `pypdf`, `reportlab`, `python-docx`, `pillow`.
3. **Look at every page** before sending: `pdftoppm -r 60 -png file.pdf pg` then view each PNG. Check: cover centered and titles on one line where possible, nothing under the header wave or footer, no table/card split across pages, no orphan heading at the bottom of a page, text fully readable over the (faded) background figure.
4. Optional Word check: `soffice --headless --convert-to pdf --outdir check file.docx` (uses a fallback font there; in Word the font **BigVesta Arabic must be installed**, files are in `assets/fonts/`; the PDF embeds the font and is unaffected).
5. Send both files and list: what was built, any discrepancy found (rule 3), what was not verified.

## Design knobs (top of `scripts/swnw_doc.py`)
- `FADE` (default 0.55): how much the big grey background figure is washed out. `BAND`: the vertical band that is faded (keeps the header wave and footer untouched). Raise FADE to make it fainter, lower to bring it back.
- `MARGIN`: text area (top 50 mm / bottom 44 mm / sides 20 mm) keeps text clear of the header wave and footer block.
- `"cover": false` in the JSON skips the cover page.

## How it works (so you can fix it)
HTML → PDF with Chromium for the text layer (Chromium cannot repeat a full-bleed background reliably across pages), then every page is stamped over the (lightened) letterhead with pypdf. DOCX: the same lightened letterhead is an anchored "behind text" picture in the header; the cover is its own section, vertically centered.
