const fs = require('fs'), ts = require('typescript');
let out = [], currentNode = null;
function choices(n) { if (!n)
    return []; if (ts.isStringLiteralLike(n))
    return [n.text]; if (ts.isConditionalExpression(n))
    return choices(n.whenTrue).concat(choices(n.whenFalse)); if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken)
    return choices(n.left); return []; }
function context(n) { for (let p = n; p; p = p.parent) {
    if (ts.isCallExpression(p)) {
        let name = p.expression.getText();
        if (/(?:^|\.)modal$/.test(name))
            return choices(p.arguments[0]);
        if (/(?:^|\.)listEditor$/.test(name))
            return choices(p.arguments[1]);
    }
} return []; }
function clean(s) { try {
    if (/^%[0-9a-f]{2}/i.test(s))
        s = decodeURIComponent(s);
}
catch (e) { } return s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/<(select|textarea|button)\b[^>]*>[\s\S]*?<\/\1>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); }
// Owner Business Intelligence and partnership document rendering are self-contained workspaces.
// Lead detail editing is an enhancement of render-leads.js and reuses the lead workspace's
// reviewed guidance rather than creating a second, duplicate field-help surface.
// Their controls include local explanatory copy or document-output options, so they stay out of
// the global operational field-help inventory.
for (const file of fs.readdirSync('assets/js').filter(x => x.endsWith('.js') && !/dashboard-help|dictionary|doctor-template-map|contracting-partnership|business-intelligence|leads-edit-details/.test(x))) {
    const code = fs.readFileSync('assets/js/' + file, 'utf8'), sf = ts.createSourceFile(file, code, 99, true);
    function add(label, name = '', kind = 'html') { label = clean(label); if (label && label.length < 180 && !/[{}]|^\+|^<|^\s*$/.test(label))
        out.push({ file, label, name, kind, forms: context(currentNode) }); }
    function walk(n) { currentNode = n; if (ts.isObjectLiteralExpression(n)) {
        const props = {};
        for (const p of n.properties)
            if (ts.isPropertyAssignment(p))
                props[p.name.getText(sf).replace(/["']/g, '')] = p.initializer;
        if (props.label && ts.isStringLiteralLike(props.label) && (props.type || props.options || props.extra || props.hint || props.required)) {
            const key = props.key || props.name;
            add(props.label.text, key && ts.isStringLiteralLike(key) ? key.text : '', 'config');
        }
    } if (ts.isStringLiteralLike(n) && /<(?:input|select|textarea)\b/.test(n.text)) {
        for (const m of n.text.matchAll(/<(?:input|select|textarea)\b[^>]*aria-label=["']([^"']+)["']/g))
            add(m[1], '', 'aria');
        for (const m of n.text.matchAll(/<(?:input|textarea)\b[^>]*placeholder=["']([^"']+)["']/g))
            add(m[1], '', 'placeholder');
        for (const m of n.text.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g))
            add(m[1], '', 'label');
    } if (ts.isStringLiteralLike(n) && n.text.includes('<label'))
        for (const m of n.text.matchAll(/<label\b[^>]*>([\s\S]*?)(?:<\/(?:label)>|<(?:input|select|textarea)\b)/g))
            add(m[1]); if (ts.isCallExpression(n) && /(?:^|\.)(?:f|s|field|select|textField|inputField|formField)$/.test(n.expression.getText(sf)) && n.arguments.length >= 2 && ts.isStringLiteralLike(n.arguments[0]) && ts.isStringLiteralLike(n.arguments[1]))
        add(n.arguments[1].text, n.arguments[0].text, 'helper'); ts.forEachChild(n, walk); }
    walk(sf);
}
out = out.filter((v, i, a) => a.findIndex(x => x.file === v.file && x.label === v.label && x.name === v.name && JSON.stringify(x.forms) === JSON.stringify(v.forms)) === i);
if (require.main !== module) {
    module.exports = out;
    return;
}
if (process.argv.includes('--json')) {
    console.log(JSON.stringify(out, null, 2));
    return;
}
for (const f of [...new Set(out.map(x => x.file))])
    console.log(f + ' (' + out.filter(x => x.file === f).length + ') ' + out.filter(x => x.file === f).map(x => x.label + (x.name ? ' [' + x.name + ']' : '')).join(' | '));
console.log('TOTAL', out.length);
