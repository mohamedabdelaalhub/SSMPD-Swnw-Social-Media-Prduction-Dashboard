#!/usr/bin/env python3
"""Build the Sono knowledge pack, tied to one code commit.

Usage: python3 scripts/build-sono-knowledge.py --out DIR [--sha SHA] [--repo .]

Output (DIR): manifest.json, employee.json, owner-admin.json.
 * employee.json     = reviewed help articles (assets/js/dashboard-help-data.js); each item carries an
                       `access` rule derived from assets/js/roles.js (fail closed when unsure).
 * owner-admin.json  = allow-listed docs/*.md sections; owner only, never sent to anyone else.
Nothing is read from the network, the database, Secrets/ or .env. Any section that looks like it holds a
secret, personal data, an id, or instruction-like text is EXCLUDED and listed in the manifest.
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
import time
from pathlib import Path

SCHEMA = 1
MAX_SECTION = 2600
CODE_CHUNK = 2400
ROOT_DOCS = ['BUSINESS-INTELLIGENCE.md', 'OPERATIONS-INTEGRATION.md', 'TASK-WORKFLOW.md', 'WEBSITE-INTEGRATION.md']
DOC_SKIP_DIRS = ('docs/chatgpt-plugin/',)

# UI source -> the tab it implements. First match wins; no match => owner only (fail closed).
# Files that are pure noise or already covered by the reviewed help articles are skipped entirely.
SKIP_SOURCE = re.compile(r'^(i18n-dictionary|dashboard-help-data|dashboard-help-fields|turnstile-gate|latin-digits|employee-assistant|sono-ai-assist|navigation-ui|ui-titles|toast|scroll-top)\.js$')
SOURCE_RULES = [
    (r'^(render-accounting|finance-.*|accountant-workspace|ledger-editor|insurance-.*|service-invoice-print)\.js$', 'accounting'),
    (r'^(reception-services|reception-service-orders|service-.*)\.js$', 'reception_services'),
    (r'^(reception-.*|today-operations.*)\.js$', 'reception_services'),
    (r'^render-bookings\.js$', 'booking_cash'),
    (r'^(render-inventory|inventory-.*)\.js$', 'inventory'),
    (r'^(hr-.*|staff-profile|workforce-prices)\.js$', 'human_resources'),
    (r'^(price-.*|contract-price-workspace)\.js$', 'price_lists'),
    (r'^(render-leads|leads-.*)\.js$', 'leads'),
    (r'^(render-patients|patient-.*|patient360|nutrition-view|child-assessment-forms|psychology-workspace|render-patient-verification)\.js$', 'patients'),
    (r'^(render-contracting-entities|contracting-.*|contract-.*|entity-claims.*|center-master-review)\.js$', 'contracting_entities'),
    (r'^(render-tasks|task-.*|weekly-plan|workflow)\.js$', 'tasks'),
    (r'^render-summary\.js$', 'summary'),
    (r'^(render-production|content-.*|carousel-content|before-after-content|dina-content|doctor-content|doctor-.*|publication-.*)\.js$', 'production'),
    (r'^render-review\.js$', 'review'),
    (r'^(render-design|design-.*|video-.*|reel-cover|studio-storyboard|ai-clips)\.js$', 'design'),
    (r'^(render-publish|website-publish)\.js$', 'publish'),
    (r'^(render-comments|comments.*)\.js$', 'comments'),
    (r'^render-clinic-info\.js$', 'clinic_info'),
    (r'^render-performance\.js$', 'performance'),
    (r'^(render-metaads)\.js$', 'metaads'),
    (r'^render-mediabuyer\.js$', 'mediabuyer'),
    (r'^render-archive\.js$', 'archive'),
    (r'^render-mykpi\.js$', 'my_kpi'),
    (r'^(render-staffkpi|employee-performance)\.js$', 'staff_kpi'),
    (r'^indicator-reports\.js$', 'indicator_reports'),
    (r'^(personal-home|home-welcome-redesign|update-notice)\.js$', 'home'),
]

# Owner/admin knowledge: explicit allow-list (new docs are NOT picked up automatically).
OWNER_DOCS = [
    'docs/admin-workspace.md', 'docs/financial-roles-permissions.md', 'docs/HR-STAFF-ACCOUNTS.md',
    'docs/HR-PRICE-LISTS.md', 'docs/CLINIC-CASH-CONTROL.md', 'docs/head-nursing-role.md',
    'docs/PSYCHOLOGY-PERMISSIONS.md', 'docs/RECEPTION-CUTOVER.md', 'docs/RECEPTION-SERVICES.md',
    'docs/accountant-chart-treasury.md', 'docs/finance-reconciliation.md', 'docs/PRICING-DOCTOR-CONTRACTS.md',
]

# Tabs whose real visibility rule in roles.js has extra branches (flags, module permissions): fail closed.
STRICT_TABS = {'accounting', 'price_lists', 'patients', 'human_resources', 'booking_cash',
               'contracting_entities', 'tasks', 'inventory'}
MANAGERS = ['general_manager', 'super_admin']
OPEN_TABS = {'home'}

SECRET_PATTERNS = [
    ('jwt', re.compile(r'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}')),
    ('api-key', re.compile(r'\b(sk-[A-Za-z0-9]{16,}|sb_secret_[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{12,})')),
    ('secret-assignment', re.compile(r'(?i)\b(password|passwd|secret|token|api[_-]?key|service_role)\b\s*[:=]\s*\S{6,}')),
    ('private-key', re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----')),
    ('uuid', re.compile(r'\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b', re.I)),
    ('email', re.compile(r'\b[\w.+-]+@[\w-]+\.[\w.-]+\b')),
    ('phone', re.compile(r'(?<!\d)(\+?20|0)?1[0125]\d{8}(?!\d)')),
    ('national-id', re.compile(r'(?<!\d)[23]\d{13}(?!\d)')),
    ('ip-address', re.compile(r'\b\d{1,3}(\.\d{1,3}){3}\b')),
]
INJECTION_PATTERNS = [
    re.compile(r'(?i)ignore (all |any |the )?(previous|above|prior) (instructions|rules)'),
    re.compile(r'(?i)disregard (all |the )?(previous|above|prior)'),
    re.compile(r'(?i)(you are now|act as|pretend to be)\b'),
    re.compile(r'(?i)(reveal|print|show) (your )?(system )?prompt'),
    re.compile(r'(?i)\b(developer|system) (message|instructions?)\b.*\b(override|replace|new)\b'),
    re.compile(r'تجاهل (كل |جميع )?(التعليمات|الأوامر|القواعد)'),
    re.compile(r'(انس|انسَ) (كل |جميع )?(التعليمات|القواعد)'),
    re.compile(r'(اعرض|اطبع|اكشف) (تعليمات|رسالة) النظام'),
]
CONTROL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f‪-‮⁦-⁩]')


def problems(text):
    found = [n for n, p in SECRET_PATTERNS if p.search(text)]
    found += ['instruction-like' for p in INJECTION_PATTERNS if p.search(text)]
    return sorted(set(found))


def clean(text):
    return re.sub(r'[ \t]+\n', '\n', CONTROL.sub('', text)).strip()


def parse_tab_roles(roles_js):
    m = re.search(r'var TAB_ACCESS = \{(.*?)\n  \};', roles_js, re.S)
    if not m:
        raise SystemExit('cannot find TAB_ACCESS in roles.js')
    out = {}
    for tab, body in re.findall(r'(\w+):\s*(Object\.keys\(ROLES\)|\[[^\]]*\])', m.group(1)):
        out[tab] = ['*'] if body.startswith('Object') else re.findall(r'"([a-z_]+)"', body)
    return out


def access_for(tab, tab_roles):
    if tab in OPEN_TABS:
        return {'mode': 'signed_in'}
    roles = tab_roles.get(tab)
    if not roles:
        return {'mode': 'owner'}  # unknown tab: fail closed
    if tab in STRICT_TABS or roles == ['*']:
        return {'mode': 'roles', 'roles': MANAGERS}
    return {'mode': 'roles', 'roles': sorted(roles)}


def load_help(repo):
    s = (repo / 'assets/js/dashboard-help-data.js').read_text(encoding='utf8')
    return json.loads(s[s.index('{'):s.rstrip().rstrip(';').rfind('}') + 1])


def employee_items(repo, tab_roles, excluded):
    data = load_help(repo)
    fields = {}
    for f in data.get('fields', []):
        fields.setdefault(f.get('article'), []).append(f)
    items = []
    for a in data['articles']:
        steps = [str(x) for x in a.get('steps', [])]
        field_lines = ['حقل «%s»: %s' % (f.get('title') or f.get('match', ''), f.get('text', '')) for f in fields.get(a['id'], [])[:12]]
        text = clean('\n'.join(filter(None, [
            a.get('meaning', ''),
            'الخطوات:\n' + '\n'.join('%d. %s' % (i + 1, s) for i, s in enumerate(steps)) if steps else '',
            ('السبب: ' + a['reason']) if a.get('reason') else '',
            ('المسؤول عند الحاجة: ' + a['owner']) if a.get('owner') else '',
            '\n'.join(field_lines)])))[:MAX_SECTION * 2]
        bad = problems(a.get('title', '') + '\n' + text)
        if bad:
            excluded.append({'source': 'help:' + a['id'], 'reason': bad})
            continue
        items.append({'id': 'help:' + a['id'], 'title': a.get('title', ''), 'tab': a.get('tab', ''),
                      'terms': a.get('terms', ''), 'text': text, 'access': access_for(a.get('tab', ''), tab_roles),
                      'source': 'assets/js/dashboard-help-data.js'})
    return data.get('version', ''), items


def doc_list(repo):
    extra = sorted(str(p.relative_to(repo)) for p in (repo / 'docs').rglob('*.md')
                   if not any(str(p.relative_to(repo)).startswith(d) for d in DOC_SKIP_DIRS))
    out = list(OWNER_DOCS)
    out += [r for r in extra if r not in out]
    out += [r for r in ROOT_DOCS if (repo / r).is_file()]
    return out


def owner_items(repo, excluded):
    items = []
    for rel in doc_list(repo):
        p = repo / rel
        if not p.is_file():
            excluded.append({'source': rel, 'reason': ['missing']})
            continue
        title, parts = rel, [[rel, []]]
        for line in p.read_text(encoding='utf8').splitlines():
            if line.startswith('#'):
                parts.append([line.lstrip('#').strip() or rel, []])
            else:
                parts[-1][1].append(line)
        for n, (head, lines) in enumerate(parts):
            text = clean('\n'.join(lines))
            if len(text) < 40:
                continue
            bad = problems(head + '\n' + text)
            sid = 'doc:%s#%d' % (rel, n)
            if bad:
                excluded.append({'source': sid, 'reason': bad})
                continue
            items.append({'id': sid, 'title': head, 'tab': '', 'terms': rel, 'text': text[:MAX_SECTION],
                          'access': {'mode': 'owner'}, 'source': rel})
    return items


_AR = re.compile(r'[\u0600-\u06FF]')
_STR = re.compile(r"""(['"`])((?:(?!\1)[^\n\\]){3,90})\1""")
_FN = re.compile(r'(?:function\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?function)')


def split_code(text, limit=CODE_CHUNK):
    out, i = [], 0
    while i < len(text):
        j = min(len(text), i + limit)
        if j < len(text):
            cut = max(text.rfind('\n', i, j), text.rfind('}', i, j), text.rfind(';', i, j))
            j = cut + 1 if cut > i + limit // 2 else j
        piece = text[i:j].strip()
        if len(piece) >= 120:
            out.append(piece)
        i = j
    return out


def source_items(repo, tab_roles, excluded):
    items, skipped_reasons = [], {}
    for p in sorted((repo / 'assets/js').glob('*.js')):
        name = p.name
        if SKIP_SOURCE.match(name):
            continue
        tab = next((t for rx, t in SOURCE_RULES if re.match(rx, name)), None)
        access = access_for(tab, tab_roles) if tab else {'mode': 'owner'}
        try:
            text = clean(p.read_text(encoding='utf8'))
        except UnicodeDecodeError:
            continue
        for n, piece in enumerate(split_code(text)):
            bad = problems(piece)
            sid = 'src:%s#%d' % (name, n)
            if bad:
                for b in bad:
                    skipped_reasons[b] = skipped_reasons.get(b, 0) + 1
                continue
            fns = []
            for m in _FN.finditer(piece):
                f = m.group(1) or m.group(2)
                if f not in fns:
                    fns.append(f)
            strs = []
            for m in _STR.finditer(piece):
                v = m.group(2).strip()
                if _AR.search(v) and v not in strs:
                    strs.append(v)
            items.append({'id': sid, 'title': '%s · %s' % (name, ' '.join(fns[:3])) if fns else name,
                          'tab': tab or '', 'terms': ' '.join(strs[:80] + fns[:20]),
                          'text': 'كود واجهة (للفهم فقط) — ملف assets/js/%s\n%s' % (name, piece),
                          'access': access, 'source': 'assets/js/' + name, 'kind': 'code'})
    if skipped_reasons:
        excluded.append({'source': 'assets/js/*', 'reason': ['%s x%d' % kv for kv in sorted(skipped_reasons.items())]})
    return items


def dump(path, obj):
    raw = json.dumps(obj, ensure_ascii=False, sort_keys=True, indent=1).encode('utf8')
    path.write_bytes(raw)
    return hashlib.sha256(raw).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', default='.')
    ap.add_argument('--out', required=True)
    ap.add_argument('--sha')
    a = ap.parse_args()
    repo, out = Path(a.repo).resolve(), Path(a.out)
    sha = a.sha or subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=repo, capture_output=True, text=True, check=True).stdout.strip()
    if not re.fullmatch(r'[0-9a-f]{7,40}', sha):
        raise SystemExit('bad sha')
    out.mkdir(parents=True, exist_ok=True)
    excluded = []
    tab_roles = parse_tab_roles((repo / 'assets/js/roles.js').read_text(encoding='utf8'))
    version, emp = employee_items(repo, tab_roles, excluded)
    own = owner_items(repo, excluded)
    src = source_items(repo, tab_roles, excluded)
    files = {'employee': ('employee.json', emp), 'owner_admin': ('owner-admin.json', own), 'source': ('source.json', src)}
    manifest = {'schema': SCHEMA, 'commit_sha': sha, 'help_version': version, 'built_at': int(time.time()),
                'tab_roles': tab_roles, 'excluded': excluded, 'tiers': {}}
    for tier, (name, items) in files.items():
        digest = dump(out / name, {'tier': tier, 'items': items})
        manifest['tiers'][tier] = {'file': name, 'sha256': digest, 'count': len(items)}
    manifest['pack_sha256'] = hashlib.sha256(json.dumps(manifest['tiers'], sort_keys=True).encode() + sha.encode()).hexdigest()
    (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding='utf8')
    print('pack %s sha=%s employee=%d owner_admin=%d source=%d excluded=%d' % (out, sha[:12], len(emp), len(own), len(src), len(excluded)))


if __name__ == '__main__':
    sys.exit(main())
