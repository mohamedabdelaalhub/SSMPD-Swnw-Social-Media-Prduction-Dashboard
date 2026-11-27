// Real Chromium: the search box keeps what was typed, the list shrinks to an open short list, the chosen value is sent — at 1280 and 390.
const fs = require('fs'), assert = require('node:assert/strict'), { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    for (const width of [1280, 390]) {
      const p = await b.newPage({ viewport: { width, height: 700 } }), errors = []; p.on('pageerror', e => errors.push(e.message));
      const names = ['سعاد', 'إيمان', 'أسماء', 'منال', 'هبة', 'رباب', 'سلمى', 'نهى', 'دعاء', 'شيماء'];
      await p.setContent('<!doctype html><html lang="ar" dir="rtl"><body><form><label class="fc-field">الفاتورة<select name="invoice_id"><option value="">اختر</option>' + names.map((x, i) => '<option value="i' + i + '">' + x + ' محمد — باقي ' + (100 + i) + '</option>').join('') + '</select></label></form></body></html>');
      for (const f of ['styles', 'service-select-search', 'select-search']) await p.addStyleTag({ content: fs.readFileSync('assets/css/' + f + '.css', 'utf8') });
      await p.addScriptTag({ content: fs.readFileSync('assets/js/select-search.js', 'utf8') }); await p.waitForSelector('[data-ss-q]');
      await p.fill('[data-ss-q]', 'ا'); await p.waitForTimeout(300);
      assert.equal(await p.inputValue('[data-ss-q]'), 'ا', 'what was typed stays in the box (' + width + ')');
      await p.fill('[data-ss-q]', 'من'); await p.waitForTimeout(300); assert.equal(await p.inputValue('[data-ss-q]'), 'من');
      assert(await p.evaluate(() => document.querySelector('select').options.length) < 11, 'list shrank'); assert(+await p.evaluate(() => document.querySelector('select').size) >= 2, 'shown as an open list');
      await p.fill('[data-ss-q]', 'ايمان'); await p.waitForTimeout(300);
      assert.equal(await p.inputValue('[data-ss-q]'), 'ايمان'); assert.equal(await p.inputValue('select'), 'i1', 'single match chosen');
      assert.equal(await p.evaluate(() => new FormData(document.forms[0]).get('invoice_id')), 'i1', 'form sends it');
      assert((await p.locator('[data-ss-n]').textContent()).includes('اخترت'), 'visible confirmation of the pick');
      await p.keyboard.press('Escape'); assert.equal(await p.evaluate(() => document.querySelector('select').options.length), 11, 'Esc restores the whole list'); assert.equal(await p.inputValue('select'), 'i1', 'choice kept');
      const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); assert(over <= 0, 'no sideways scroll at ' + width);
      assert.deepEqual(errors, []); await p.close();
    }
    console.log('select-search-ui OK');
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exit(1); });
