const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'assets/js/contracting-document-send.js'), 'utf8');
const boot = fs.readFileSync(path.join(root, 'assets/js/contracting-partnership-runtime-fix.js'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/contracting-document-send/index.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261021_contracting_document_delivery.sql'), 'utf8');

assert.match(boot, /contracting-document-send\.js\?v=contracting-send-pdf-20261021-3/, 'partnership runtime must load the current delivery helper');
assert.match(boot, /jspdf\/2\.5\.1\/jspdf\.umd\.min\.js/, 'mobile bootstrap must preload standalone jsPDF');
assert.match(boot, /window\.jspdf\s*&&\s*window\.jspdf\.jsPDF/, 'bootstrap must verify the jsPDF global before normal delivery startup');
assert.ok(boot.indexOf('jp.onload') < boot.indexOf('loadDeliveryHelper();\n    };'), 'delivery helper must be started from the jsPDF load completion path');
assert.doesNotThrow(() => new Function(boot), 'bootstrap must remain valid JavaScript');
assert.match(ui, /إرسال بالبريد \+ PDF/, 'email action must state that PDF is attached');
assert.match(ui, /إرسال واتساب \+ PDF/, 'WhatsApp action must state that PDF is attached');
assert.match(ui, /contracting-document-send/, 'UI must call the authenticated delivery edge function');
assert.match(ui, /SSMPDPartnershipPdf\.prepare/, 'delivery PDF must use the shared partnership renderer');
assert.match(ui, /contracting_agreement_versions/, 'delivery must be based on a saved document version');
assert.match(ui, /آخر نسخة محفوظة/, 'unsaved preview changes must not silently replace the immutable sent version');
assert.match(ui, /navigator\.share/, 'email must have a file-share fallback when no server mail provider is configured');
assert.match(ui, /html2canvas\/1\.4\.1\/html2canvas\.min\.js/, 'mobile generation must load html2canvas explicitly');
assert.match(ui, /jspdf\/2\.5\.1\/jspdf\.umd\.min\.js/, 'mobile generation must load jsPDF explicitly instead of trusting html2pdf globals');
assert.match(ui, /function pdfCtor\(\)/, 'PDF constructor must tolerate both supported global shapes');
assert.match(ui, /window\.open\('about:blank','_blank'\)/, 'mobile preview must reserve its tab synchronously before PDF generation');
assert.doesNotThrow(() => new Function(ui), 'delivery UI must remain valid JavaScript');

assert.match(edge, /type:\s*"document"/, 'WhatsApp must send a document message, not just text');
assert.match(edge, /\/media`/, 'WhatsApp PDF must be uploaded to Meta media first');
assert.match(edge, /attachments:\s*\[\{ filename, content: pdfBase64 \}\]/, 'email provider must receive the PDF as an attachment');
assert.match(edge, /contracting_agreement_versions/, 'edge function must freeze the sent version');
assert.match(edge, /immutable:\s*true/, 'sent PDF snapshot must be immutable');
assert.match(edge, /contracting_activity_log/, 'successful and failed sends must be auditable');
assert.match(edge, /contract_manager/, 'contracting staff must be authorized explicitly');

assert.match(migration, /contracting-documents/, 'private contracting document bucket must exist');
assert.match(migration, /application\/pdf/, 'bucket must only allow PDFs');
assert.match(migration, /false, 20971520/, 'bucket must stay private with a bounded file size');

console.log('Contracting PDF delivery checks passed');