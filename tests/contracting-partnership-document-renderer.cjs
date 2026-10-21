const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const letter = fs.readFileSync(path.join(root, 'assets/js/contracting-partnership-letterhead.js'), 'utf8');
const pdf = fs.readFileSync(path.join(root, 'assets/js/contracting-partnership-pdf.js'), 'utf8');
const hub = fs.readFileSync(path.join(root, 'assets/js/contracting-partnerships.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert.match(letter, /assets\/img\/swnw-official-letterhead\.png/, 'official A4 artwork must be the renderer background');
assert.doesNotMatch(letter, /report-letterhead-header|report-letterhead-footer/, 'legacy split header/footer must not drive the renderer');
assert.match(letter, /\.swnw-page-body\{[^}]*bottom:42mm[^}]*overflow:visible/, 'content area must reserve footer space without clipping overflow');
assert.match(letter, /\.swnw-page-body h3\{[^}]*margin:28px 0 2px/, 'section headings need more space above and less below');
assert.match(letter, /\.swnw-page-body \.swnw-meta\{margin:0!important;line-height:1\.48/, 'entity/date metadata must stay compact');
assert.match(letter, /\.swnw-letter-closing\{margin-top:68px[^}]*font-weight:700/, 'closing phrase must have the larger top gap and bold weight');
assert.match(letter, /\.swnw-letter-signature\{margin-top:22px/, 'signature must keep extra space below the closing phrase');
assert.match(letter, /<strong>د\. دينا حسني<\/strong><br>مدير المركز/, 'proposal signer name must be the requested bold short name');
assert.doesNotMatch(letter, /د\. دينا حسني محمد/, 'old signer name must not remain');
assert.match(letter, /if\(el\.tagName==='H3'&&next\)\{current=appendPair/, 'heading and its first content block must paginate together');
assert.match(letter, /if\(el\.tagName==='P'&&!el\.children\.length\)return splitTextBlock/, 'oversized plain paragraphs need a non-clipping fallback');
assert.match(letter, /bottom:31mm/, 'system note must stay above the footer area');

assert.match(pdf, /function sharedPrintCss\(\)/, 'native print fallback must reuse the shared preview CSS');
assert.match(pdf, /swnw-official-letter-style/, 'PDF fallback must copy the active renderer style');
assert.doesNotMatch(pdf, /h3\{font-size:19px/, 'PDF fallback must not maintain a second independent typography stylesheet');
assert.match(pdf, /document\.fonts\?document\.fonts\.ready/, 'PDF export must wait for final font metrics');
assert.match(pdf, /if\(api\.paginate\)api\.paginate\(doc\);officialize\(doc\);return waitImages\(doc\)/, 'PDF export must repaginate after fonts before capture');
assert.match(pdf, /querySelectorAll\('\.swnw-letterhead-bg,\.swnw-page-official-artwork'\)/, 'PDF export must reuse one official artwork node instead of layering duplicates');

const letterPos = index.indexOf('assets/js/contracting-partnership-letterhead.js');
const pdfPos = index.indexOf('assets/js/contracting-partnership-pdf.js');
assert.ok(letterPos >= 0 && pdfPos > letterPos, 'shared renderer must load before PDF export hook');
assert.match(hub, /function buildDocument\(type,entity,settings,v\)/, 'draft and final contract must enter the same document builder');
assert.match(hub, /id=\\"ceh-document\\"/, 'both document types must expose the shared document root');

console.log('Partnership document renderer regression checks passed');
