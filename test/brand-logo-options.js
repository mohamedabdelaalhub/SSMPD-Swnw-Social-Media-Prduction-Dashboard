const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Exercise the actual pure renderer without requiring the rest of the dashboard DOM.
const source = fs.readFileSync(path.join(__dirname, '../assets/js/render-production.js'), 'utf8');
const scope = {};
vm.runInNewContext(source.slice(source.indexOf('  function brandLogoOptionsHtml('),
                               source.indexOf('  function coverSettingsHtml(')), scope);
const render = scope.brandLogoOptionsHtml;

test('shows only the current brand slots and disables an unuploaded slot', () => {
  const html = render({brand: 'dr_dina'}, [
    {brand: 'dr_dina', variant: 'primary'},
    {brand: 'sono', variant: 'alternate'}
  ]);
  assert.match(html, /value="alternate" disabled/);
  assert.match(html, /data-brand-logo-variant="primary"/);
  assert.doesNotMatch(html, /data-brand-logo-variant="alternate"/);
});

test('restores the saved second option for the same brand', () => {
  const html = render({brand: 'sono', cover_settings: {logo_variant: 'alternate'}}, [
    {brand: 'sono', variant: 'primary'}, {brand: 'sono', variant: 'alternate'}
  ]);
  assert.match(html, /value="alternate" checked/);
  assert.doesNotMatch(html, /value="primary" checked/);
  assert.equal((html.match(/data-brand-logo-variant=/g) || []).length, 2);
});

test('preserves the existing logo as the first option', () => {
  const html = render({brand: 'sono'}, [{brand: 'sono'}]);
  assert.match(html, /value="primary" checked>/);
  assert.match(html, /value="alternate" disabled/);
});
