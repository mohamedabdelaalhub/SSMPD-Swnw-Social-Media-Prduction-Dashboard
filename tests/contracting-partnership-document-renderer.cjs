const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const letter = fs.readFileSync(path.join(root, 'assets/js/contracting-partnership-letterhead.js'), 'utf8');
const pdf = fs.readFileSync(path.join(root, 'assets/js/contracting-partnership-pdf.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/css/contracting-partnerships.css'), 'utf8');
const hub = fs.readFileSync(path.join(root, 'assets/js/contracting-partnerships.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert.match(letter, /assets\/img\/swnw-official-letterhead\.png/, 'official A4 artwork must be the renderer background');
assert.doesNotMatch(letter, /report-letterhead-header|report-letterhead-footer/, 'legacy split header/footer must not drive the renderer');
assert.match(letter, /\.swnw-letterhead-bg\{[^}]*left:-8mm[^}]*right:-8mm[^}]*width:226mm[^}]*height:297mm/, 'official artwork must bleed horizontally to remove white side gutters');
assert.match(letter, /\.swnw-page-body\{[^}]*bottom:50mm[^}]*right:15mm[^}]*left:15mm[^}]*overflow:visible/, 'content area must reserve a dedicated lower note zone without changing text side margins');
assert.match(letter, /\.swnw-page-body h3\{[^}]*margin:28px 0 2px/, 'shared renderer keeps a safe default heading gap');
assert.match(letter, /\.swnw-page-body \.swnw-meta\{margin:0!important;line-height:1\.48/, 'shared renderer keeps compact metadata defaults');
assert.match(letter, /\.swnw-letter-closing\{margin-top:68px[^}]*font-weight:700/, 'shared renderer keeps the closing phrase bold');
assert.match(letter, /\.swnw-letter-signature\{[^}]*justify-content:flex-end/, 'proposal signer block must align visually to the left in the RTL document');
assert.match(letter, /<strong>د\. دينا حسني<\/strong><br>مدير المركز/, 'proposal signer name must be the requested bold short name');
assert.doesNotMatch(letter, /د\. دينا حسني محمد/, 'old signer name must not remain');
assert.match(letter, /if\(el\.tagName==='H3'&&next\)\{current=appendPair/, 'heading and its first content block must paginate together');
assert.match(letter, /if\(el\.tagName==='P'&&!el\.children\.length\)return splitTextBlock/, 'oversized plain paragraphs need a non-clipping fallback');
assert.match(letter, /\.swnw-system-note\{[^}]*bottom:44mm[^}]*white-space:normal/, 'system note must sit in its own clear zone above the footer and be allowed to wrap');

assert.match(css, /\.ce-hub-doc \.swnw-page-body \.swnw-meta\{margin-bottom:0!important;line-height:1\.38!important\}/, 'entity/date rows must use the compact final spacing');
assert.match(css, /\.ce-hub-doc \.swnw-page-body \.swnw-meta\+\.swnw-meta\{margin-top:-2px!important\}/, 'entity and date rows must stay close together');
assert.match(css, /\.ce-hub-doc \.swnw-page-body h3\{margin-top:30px!important;margin-bottom:1px!important\}/, 'section titles need more space above and less below');
assert.match(css, /\.ce-hub-doc \.swnw-letter-closing\{margin-top:116px!important;margin-bottom:23px!important;font-weight:700!important\}/, 'closing phrase needs the requested large gap and bold weight');
assert.match(css, /\.ce-hub-doc \.swnw-letter-signature\{margin-top:0!important\}/, 'closing-to-signature gap must come from the closing block only');
assert.match(css, /\.ce-hub-doc \.swnw-letter-signature-text strong\{font-weight:700!important\}/, 'signer name must stay bold');

assert.match(pdf, /function sharedPrintCss\(\)/, 'native print fallback must reuse the shared preview CSS');
assert.match(pdf, /swnw-official-letter-style/, 'PDF fallback must copy the active renderer style');
assert.match(pdf, /PARTNERSHIP_SPACING_CSS/, 'PDF fallback must carry the same partnership spacing overrides');
assert.match(pdf, /left:-8mm!important;right:-8mm!important;width:226mm!important;height:297mm!important/, 'PDF artwork hook must preserve the same horizontal bleed as preview');
assert.match(pdf, /<body><div class="ce-hub-doc">/, 'native PDF fallback must preserve the document scope used by spacing selectors');
assert.doesNotMatch(pdf, /h3\{font-size:19px/, 'PDF fallback must not maintain a second independent typography stylesheet');
assert.match(pdf, /document\.fonts\?document\.fonts\.ready/, 'PDF export must wait for final font metrics');
assert.match(pdf, /if\(api\.paginate\)api\.paginate\(doc\);officialize\(doc\);return waitImages\(doc\)/, 'PDF export must repaginate after fonts before capture');
assert.match(pdf, /querySelectorAll\('\.swnw-letterhead-bg,\.swnw-page-official-artwork'\)/, 'PDF export must reuse one official artwork node instead of layering duplicates');

const letterPos = index.indexOf('assets/js/contracting-partnership-letterhead.js');
const pdfPos = index.indexOf('assets/js/contracting-partnership-pdf.js');
assert.ok(letterPos >= 0 && pdfPos > letterPos, 'shared renderer must load before PDF export hook');
assert.match(hub, /function buildDocument\(type,entity,settings,v\)/, 'draft and final contract must enter the same document builder');
assert.match(hub, /id="ceh-document"/, 'both document types must expose the shared document root');

console.log('Partnership document renderer regression checks passed');
