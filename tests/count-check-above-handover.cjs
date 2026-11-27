// «سلّم» in «تسليم تحصيل لزميل» did nothing (owner 2026-11-27): the «راجع اللي كتبته» count review (.cc-modal) opened BEHIND the
// handover sheet (.shift-reminder-backdrop z 9000), the click waited on it forever. The count-check dialogs must sit above every sheet that calls gate().
const fs = require('fs'), path = require('path'), assert = require('assert');
const css = f => fs.readFileSync(path.join(__dirname, '..', 'assets/css', f), 'utf8');
const z = (src, sel) => { const m = src.match(new RegExp('(^|[}\\s])' + sel.replace(/\./g, '\\.') + '\\{[^}]*z-index:(\\d+)', 'm')); assert.ok(m, sel + ' z-index not found'); return +m[2]; };
const cc = z(css('finance-cash.css'), '.cc-modal');
for (const [f, sel] of [['styles.css', '.shift-reminder-backdrop'], ['reception-drawer.css', '.rd-sheet'], ['styles.css', '.dp-backdrop']]) {
  const o = z(css(f), sel); assert.ok(cc > o, `.cc-modal (${cc}) must be above ${sel} (${o})`);
}
const idx = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.ok(/finance-cash\.css\?v=cc-zfix-20261127-1|finance-cash\.css\?v=(?!close-blind-20261127-2)/.test(idx), 'finance-cash.css cache stamp must be bumped');
console.log('count-check-above-handover: OK (cc-modal z ' + cc + ')');
