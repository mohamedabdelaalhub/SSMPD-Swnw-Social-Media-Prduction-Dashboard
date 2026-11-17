// Layout QA for UI mockups and screens: catches the "naive" mistakes before anyone sees a screenshot.
// usage: node layout-check.cjs <file-or-url> [cardSelector] [width ...]
//   cardSelector defaults to visible boxes with a radius >= 12px and a border or background (cards/tiles).
// Checks (per viewport width):
//   1. near-miss edges: two card edges 1-24px apart (should be identical) -> misaligned columns
//   2. gutters: every horizontal and vertical gap between neighbouring cards must use one value
//   3. column bottoms: side-by-side columns (grid children) must end on the same line
//   4. clipped text: an element whose text overflows its box (ellipsis, cut, overlap)
//   5. horizontal page overflow
// Exit code 1 when anything fails, with a list of offending elements.
const { chromium } = require('playwright');
const target = process.argv[2], sel = process.argv[3] && !/^\d+$/.test(process.argv[3]) ? process.argv[3] : null;
const widths = process.argv.slice(sel ? 4 : 3).map(Number).filter(Boolean);
(async () => {
  const b = await chromium.launch(); let bad = 0;
  for (const w of widths.length ? widths : [1440, 390]) {
    const p = await b.newPage({ viewport: { width: w, height: 900 } });
    await p.goto(/^https?:|^file:/.test(target) ? target : 'file://' + require('path').resolve(target));
    await p.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
    await p.waitForTimeout(400);
    const r = await p.evaluate((sel) => {
      const out = { edges: [], gaps: {}, bottoms: [], clip: [], overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      const name = e => (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : e.tagName.toLowerCase()) + ' «' + (e.innerText || '').trim().split('\n')[0].slice(0, 28) + '»';
      const vis = e => { const s = getComputedStyle(e), r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 40 && r.height > 30; };
      let cards = sel ? [...document.querySelectorAll(sel)] : [...document.querySelectorAll('body *')].filter(e => { const s = getComputedStyle(e); return parseFloat(s.borderTopLeftRadius) >= 12 && (s.borderTopWidth !== '0px' || (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') || s.backgroundImage !== 'none'); });
      cards = cards.filter(vis);
      // keep only outermost cards (a card inside a card is content)
      cards = cards.filter(c => !cards.some(o => o !== c && o.contains(c)));
      const R = cards.map(c => { const x = c.getBoundingClientRect(); return { c, l: x.left, r: x.right, t: x.top + scrollY, b: x.bottom + scrollY }; });
      const near = (a, b) => { const d = Math.abs(a - b); return d > 0.75 && d < 24; };
      for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
        const A = R[i], B = R[j];
        // vertical edges that almost line up across rows
        const stacked = A.b <= B.t + 1 || B.b <= A.t + 1;
        if (stacked) for (const [ea, eb, k] of [[A.l, B.l, 'left'], [A.r, B.r, 'right']]) if (near(ea, eb)) out.edges.push(k + ' ' + Math.round(Math.abs(ea - eb)) + 'px: ' + name(A.c) + ' / ' + name(B.c));
        // gutters between neighbours
        const vOverlap = Math.min(A.b, B.b) - Math.max(A.t, B.t), hOverlap = Math.min(A.r, B.r) - Math.max(A.l, B.l);
        if (vOverlap > 20) { const g = Math.round(A.r <= B.l ? B.l - A.r : A.l - B.r); if (g >= 0 && g < 80 && !R.some(C => C !== A && C !== B && Math.min(C.b, A.b, B.b) - Math.max(C.t, A.t, B.t) > 20 && C.l >= Math.min(A.r, B.r) - 1 && C.r <= Math.max(A.l, B.l) + 1)) (out.gaps['x' + g] = out.gaps['x' + g] || []).push(name(A.c) + ' | ' + name(B.c)); }
        if (hOverlap > 20) { const g = Math.round(A.b <= B.t ? B.t - A.b : A.t - B.b); if (g >= 0 && g < 80 && !R.some(C => C !== A && C !== B && Math.min(C.r, A.r, B.r) - Math.max(C.l, A.l, B.l) > 20 && C.t >= Math.min(A.b, B.b) - 1 && C.b <= Math.max(A.t, B.t) + 1)) (out.gaps['y' + g] = out.gaps['y' + g] || []).push(name(A.c) + ' / ' + name(B.c)); }
      }
      // column bottoms: children of a multi-column grid placed side by side in the same last row
      document.querySelectorAll('body *').forEach(g => {
        const s = getComputedStyle(g); if (s.display !== 'grid' || !vis(g)) return;
        const kids = [...g.children].filter(vis).map(k => ({ k, x: k.getBoundingClientRect() }));
        const rows = {}; kids.forEach(o => { const key = Math.round(o.x.top); (rows[key] = rows[key] || []).push(o); });
        Object.values(rows).forEach(row => { if (row.length < 2) return; const bs = row.map(o => o.x.bottom), d = Math.max(...bs) - Math.min(...bs); if (d > 1.5) out.bottoms.push(Math.round(d) + 'px: ' + row.map(o => name(o.k)).join(' | ')); });
      });
      // inner content of a column card should reach the column bottom (no empty band inside a stretched column)
      // clipped text
      document.querySelectorAll('body *').forEach(e => {
        if (!vis(e) || !e.childNodes.length || ![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;
        const s = getComputedStyle(e);
        if ((e.scrollWidth > e.clientWidth + 1 && s.overflowX !== 'visible') || s.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth) out.clip.push(name(e));
      });
      return out;
    }, sel);
    const gapKeys = Object.keys(r.gaps), xs = gapKeys.filter(k => k[0] === 'x'), ys = gapKeys.filter(k => k[0] === 'y');
    const fails = [];
    if (r.overflow > 0) fails.push('page overflows horizontally by ' + r.overflow + 'px');
    r.edges.forEach(e => fails.push('near-miss edge ' + e));
    if (xs.length > 1) fails.push('uneven column gutters: ' + xs.map(k => k.slice(1) + 'px ×' + r.gaps[k].length + ' (e.g. ' + r.gaps[k][0] + ')').join(' ; '));
    if (ys.length > 1) fails.push('uneven row gutters: ' + ys.map(k => k.slice(1) + 'px ×' + r.gaps[k].length + ' (e.g. ' + r.gaps[k][0] + ')').join(' ; '));
    r.bottoms.forEach(e => fails.push('columns end at different heights ' + e));
    r.clip.forEach(e => fails.push('clipped text ' + e));
    console.log((fails.length ? 'FAIL' : 'PASS') + ' @' + w + 'px' + (fails.length ? '\n  - ' + fails.join('\n  - ') : '  gutters ' + [...new Set(gapKeys.map(k => k.slice(1)))].join('/') + 'px'));
    bad += fails.length; await p.close();
  }
  await b.close(); process.exit(bad ? 1 : 0);
})();
