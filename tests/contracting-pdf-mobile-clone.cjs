const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const runtime = fs.readFileSync(path.join(root, 'assets/js/contracting-partnership-runtime-fix.js'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/contracting-document-send/index.ts'), 'utf8');

assert.match(runtime, /installContractingHtml2CanvasGuard/, 'contracting runtime must guard html2canvas page rendering');
assert.match(runtime, /element\.cloneNode\(true\)/, 'each A4 page must be rendered from a fresh attached clone');
assert.match(runtime, /data-contracting-render-stage/, 'temporary render stage must be isolated');
assert.match(runtime, /html2canvas\/1\.4\.1\/html2canvas\.min\.js/, 'html2canvas must be preloaded before delivery helper');
assert.match(runtime, /contracting-send-pdf-20261022-7/, 'delivery helper cache buster must be advanced');
assert.doesNotThrow(() => new Function(runtime), 'runtime shim must remain valid JavaScript');

assert.match(edge, /whatsapp_phone_number_id/, 'contract delivery must read the saved Meta Phone Number ID');
assert.match(edge, /cachedPhoneNumberId/, 'saved sender ID must be passed to WhatsApp delivery');
assert.match(edge, /\^\\d\+\$/.test\(cached\)/, 'cached sender ID must be validated before use');
assert.match(edge, /assigned_whatsapp_business_accounts/, 'system-user WABA discovery remains available as fallback');
assert.match(edge, /WHATSAPP_WINDOW_EXPIRED/, 'closed service windows must not be reported as successful delivery');

console.log('Contracting mobile PDF and WhatsApp sender checks passed');
