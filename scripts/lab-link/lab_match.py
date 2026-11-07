"""Partner-lab test -> center service matcher (v2). Suggestions only: nothing here ever confirms a link.

Improvements over the first draft matcher:
  * sample type (Serum / Urine / CSF / Fluid ...) is parsed out of the lab name and compared on its own;
    a conflicting sample (e.g. lab "ADA Serum" vs center "ADA (Fluid)") caps confidence at "low";
  * fuzzy token matching with rarity weights, so a single shared common word does not score high;
  * several candidates are returned, ranked, so staff can choose another one;
  * "high" needs a clear margin over the runner-up, because high is the only level eligible for bulk confirm.
"""
import difflib
import math
import re
from collections import Counter

# sample vocabulary -> canonical group. Blood-derived samples are mutually compatible.
BLOOD = {'serum', 'plasma', 'edta', 'citrate', 'heparin', 'fluoride', 'blood'}
SAMPLE_WORDS = {
    'serum': 'serum', 'plasma': 'plasma', 'edta': 'edta', 'citrate': 'citrate', 'heparine': 'heparin', 'heparin': 'heparin',
    'fluoride': 'fluoride', 'blood': 'blood', 'urine': 'urine', 'stool': 'stool', 'csf': 'csf', 'semen': 'semen',
    'fluid': 'fluid', 'pleural': 'fluid', 'ascitic': 'fluid', 'asitic': 'fluid', 'pericardial': 'fluid', 'preicardial': 'fluid',
    'swab': 'swab', 'sputum': 'sputum', 'pus': 'pus', 'stone': 'stone', 'sample': 'sample',
}
# longest first so "serumurine" splits into serum + urine
_SAMPLE_RE = re.compile('|'.join(sorted(SAMPLE_WORDS, key=len, reverse=True)))
STOP = {'in', 'of', 'the', 'and', 'for', 'by', 'level', 'levels', 'test', 'tests', 'total', 'a', 'ab', 'abs', 'antibody', 'antibodies'}
SYN = {'progesteron': 'progesterone', 'thyroxin': 'thyroxine', 'hba1c': 'hba1c', 'sgot': 'ast', 'sgpt': 'alt', 'glycosylated': 'hba1c',
       'haemoglobin': 'hemoglobin', 'mg': 'magnesium'}


def sample_group(word):
    w = SAMPLE_WORDS.get(word)
    if w is None:
        return None
    return 'blood' if w in BLOOD else w


def split_samples(text):
    """'SerumEDTA' -> ['serum','edta']; returns [] if the word is not purely sample words."""
    w = re.sub(r'[^a-z]', '', text.lower())
    if not w:
        return []
    out, pos = [], 0
    while pos < len(w):
        m = _SAMPLE_RE.match(w, pos)
        if not m:
            return []
        out.append(m.group(0))
        pos = m.end()
    return out


def parse_lab_name(raw):
    """Return (core_name, sample_text, sample_groups). Sample = trailing run of sample words (also inside the name)."""
    words = raw.strip().split()
    tail = []
    while words:
        w = words[-1].strip('().,;:')
        parts = split_samples(w)
        if parts and not (len(w) <= 3 and w.lower() not in SAMPLE_WORDS):
            tail.insert(0, words.pop())
        else:
            break
    core = ' '.join(words).strip()
    sample_text = ' '.join(tail)
    groups = set()
    for w in tail:
        for p in split_samples(w):
            groups.add(sample_group(p))
    groups.discard(None)
    groups.discard('sample')
    # sample words written inside the name, e.g. "Magnesium (Serum)" -> still counted for conflict detection
    inner = set()
    for w in re.findall(r'[A-Za-z]+', core):
        for p in split_samples(w) if split_samples(w) else []:
            g = sample_group(p)
            if g and g != 'sample':
                inner.add(g)
    return core or raw.strip(), sample_text, groups | inner


def center_samples(name):
    out = set()
    for w in re.findall(r'[A-Za-z]+', name):
        parts = split_samples(w)
        for p in parts:
            g = sample_group(p)
            if g and g != 'sample':
                out.add(g)
    return out


def core_tokens(name):
    """Tokens used for name matching: sample words removed (compared separately)."""
    text = re.sub(r'[^a-z0-9]+', ' ', name.lower().replace('&', ' and '))
    out = []
    for t in text.split():
        if split_samples(t):
            continue
        t = SYN.get(t, t)
        if t in STOP:
            continue
        out.append(t)
    return out


def token_variants(name):
    """Full token list plus (head outside parentheses) and (text inside parentheses) so that
    'TSH (Thyroid Stimulating H)' can be matched by 'TSH' or by 'Thyroid Stimulating Hormone'."""
    full = core_tokens(name)
    outside = core_tokens(re.sub(r'\([^)]*\)', ' ', name))
    inside = [core_tokens(x) for x in re.findall(r'\(([^)]*)\)', name)]
    out = [(full, 1.0)]
    if outside and outside != full:
        out.append((outside, 0.95))
    for part in re.split(r'\s-\s', name) if re.search(r'\s-\s', name) else []:
        t = core_tokens(re.sub(r'\([^)]*\)', ' ', part))
        if t and t != full and t not in [v[0] for v in out]:
            out.append((t, 0.93))
    for t in inside:
        if len(t) >= 1 and t != full and not (len(t) == 1 and len(t[0]) <= 2):
            out.append((t, 0.93))
    return out


def _tok_sim(a, b):
    if a == b:
        return 1.0
    if min(len(a), len(b)) <= 3 or a.isdigit() or b.isdigit():
        return 0.0  # short tokens and numbers must match exactly (igg vs igm, b12 vs b6)
    if a[:3] != b[:3] and not (a in b or b in a):
        return 0.0
    r = difflib.SequenceMatcher(None, a, b).ratio()
    return r if r >= 0.9 else 0.0


class Matcher:
    def __init__(self, services):
        self.services = []
        df = Counter()
        for s in services:
            toks = core_tokens(s['name'])
            self.services.append((s, token_variants(s['name']), center_samples(s['name'])))
            for t in set(toks):
                df[t] += 1
        n = max(len(self.services), 1)
        self.idf = {t: math.log(1 + n / c) for t, c in df.items()}

    def weight(self, t):
        return self.idf.get(t, math.log(1 + len(self.services)))

    def _score(self, lt, ct):
        """-> (score, exact). exact = every token pair identical and nothing left over on either side."""
        if not lt or not ct:
            return 0.0, False
        used, mw_l, mw_c, exact = set(), 0.0, 0.0, True
        for a in lt:
            best, bj = 0.0, None
            for j, b in enumerate(ct):
                if j in used:
                    continue
                s = _tok_sim(a, b)
                if s > best:
                    best, bj = s, j
            if bj is not None:
                used.add(bj)
                mw_l += best * self.weight(a)
                mw_c += best * self.weight(ct[bj])
                if best < 1.0:
                    exact = False
            else:
                exact = False
        tl = sum(self.weight(a) for a in lt)
        tc = sum(self.weight(b) for b in ct)
        p, r = mw_l / tl, mw_c / tc
        if len(used) != len(ct):
            exact = False
        return (0.0 if p + r == 0 else 2 * p * r / (p + r)), exact

    def candidates(self, raw_name, limit=5):
        core, sample_text, groups = parse_lab_name(raw_name)
        lvars = token_variants(core)
        rows = []
        for s, cvars, cs in self.services:
            sc, exact = 0.0, False
            for lt, lw in lvars:
                for ct, cw in cvars:
                    v, ex = self._score(lt, ct)
                    v *= lw * cw
                    if v > sc:
                        sc, exact = v, ex and lw == 1.0 and cw == 1.0
            if sc < 0.35:
                continue
            conflict = bool(groups and cs and not (groups & cs))
            sample_hit = bool(groups and cs and (groups & cs))
            # lab names a non-blood sample (urine, CSF...) but the center name names none: probably the blood test.
            unspecified = bool(groups and not cs and not groups <= {'blood'})
            adj = sc
            if conflict:
                adj *= 0.6
            elif sample_hit:
                adj = min(1.0, adj + 0.04)
            rows.append({'service_id': s['id'], 'name': s['name'], 'score': round(adj, 4), 'raw_score': round(sc, 4), 'exact': exact,
                         'sample_conflict': conflict, 'sample_match': sample_hit, 'sample_unspecified': unspecified})
        rows.sort(key=lambda r: (-r['score'], r['name']))
        return rows[:limit], sample_text, sorted(groups)


def confidence(cands):
    """high | medium | low | none. High is the only level that may be bulk confirmed (still by a person)."""
    if not cands:
        return 'none'
    top = cands[0]
    second = cands[1]['score'] if len(cands) > 1 else 0.0
    if top['sample_conflict']:
        return 'low' if top['score'] >= 0.35 else 'none'
    if top['exact'] and top['score'] >= 0.95 and top['score'] - second >= 0.06 and not top['sample_unspecified']:
        return 'high'
    if top['score'] >= 0.75:
        return 'medium'
    if top['score'] >= 0.5:
        return 'low'
    return 'none'
