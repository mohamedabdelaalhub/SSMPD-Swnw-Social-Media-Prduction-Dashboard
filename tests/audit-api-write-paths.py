# Review #129: repo-evidence audit of which tables the browser code reads/writes directly (PostgREST as the signed-in user), which RPCs and Edge Functions it calls, and which Edge Functions hint at service-key vs caller-JWT clients. HEURISTIC (regex): each .from('t') is paired with the first .insert/.update/.delete/.upsert/.select within 500 chars. Usage: run from the repo root; writes /tmp/aud/audit.json and prints a summary.
import os
os.makedirs('/tmp/aud',exist_ok=True)
import re,os,json,glob,collections
root='.'
files=[]
for dp,dn,fn in os.walk(root):
    if any(x in dp for x in ('node_modules','/tests','/.git','/test','security_backups','/deploy','/deployment','/docs')): continue
    for f in fn:
        if f.endswith(('.js','.html','.ts','.py','.gs')): files.append(os.path.join(dp,f))
OPS=r'\.(insert|update|delete|upsert|select)\s*\('
def scan(text):
    res=collections.defaultdict(set); rpcs=set(); funcs=set()
    for m in re.finditer(r'\.from\(\s*["\']([a-z_0-9]+)["\']\s*\)',text):
        tail=text[m.end():m.end()+500]
        o=re.search(OPS,tail)
        res[m.group(1)].add(o.group(1) if o else '?')
    for m in re.finditer(r'\.rpc\(\s*["\']([a-z_0-9]+)["\']',text): rpcs.add(m.group(1))
    for m in re.finditer(r'functions\.invoke\(\s*["\']([a-z0-9_-]+)["\']',text): funcs.add(m.group(1))
    for m in re.finditer(r'/functions/v1/([a-z0-9_-]+)',text): funcs.add(m.group(1))
    return res,rpcs,funcs
browser=collections.defaultdict(lambda: collections.defaultdict(set)); brpc=collections.defaultdict(set); bfun=collections.defaultdict(set)
edge={}
for f in files:
    t=open(f,errors='ignore').read()
    res,rpcs,funcs=scan(t)
    if '/supabase/functions/' in f:
        name=f.split('/supabase/functions/')[1].split('/')[0]
        e=edge.setdefault(name,{'tables':collections.defaultdict(set),'rpcs':set(),'auth':set()})
        for k,v in res.items(): e['tables'][k]|=v
        e['rpcs']|=rpcs
        if re.search(r'SERVICE_ROLE|SUPABASE_SECRET_KEYS|SERVICE\b',t): e['auth'].add('service-key')
        if re.search(r'Authorization["\']?\s*:\s*(auth|req\.headers|authHeader|`Bearer \$\{)',t) or 'global:{headers' in t.replace(' ','') : e['auth'].add('caller-jwt-forwarded?')
    elif '/video-worker/' in f or '/apps-script/' in f or '/scripts/' in f: pass
    else:
        for k,v in res.items(): browser[f][k]|=v
        brpc[f]|=rpcs; bfun[f]|=funcs
out={'browser':{f:{k:sorted(v) for k,v in d.items()} for f,d in browser.items() if d},
     'browser_rpc':{f:sorted(v) for f,v in brpc.items() if v},'browser_funcs':{f:sorted(v) for f,v in bfun.items() if v},
     'edge':{n:{'tables':{k:sorted(v) for k,v in e['tables'].items()},'rpcs':sorted(e['rpcs']),'auth':sorted(e['auth'])} for n,e in edge.items()}}
json.dump(out,open('/tmp/aud/audit.json','w'),indent=1)
# summary
agg=collections.defaultdict(set)
for f,d in out['browser'].items():
    for t,o in d.items(): agg[t]|=set(o)
print('BROWSER FILES with from():',list(out['browser'].keys()))
w=[(t,sorted(o)) for t,o in agg.items() if set(o)&{'insert','update','delete','upsert'}]
print('BROWSER direct WRITE tables (%d):'%len(w)); [print(' ',t,o) for t,o in sorted(w)]
print('BROWSER read-only tables (%d):'%(len(agg)-len(w)),sorted(t for t in agg if t not in dict(w)))
print('BROWSER rpc count:',sum(len(v) for v in out['browser_rpc'].values()),'distinct',len({r for v in out['browser_rpc'].values() for r in v}))
print('EDGE functions with table access:',sum(1 for e in out['edge'].values() if e['tables']),'of',len(out['edge']))
print('EDGE auth modes:',collections.Counter(tuple(e['auth']) for e in out['edge'].values()))
