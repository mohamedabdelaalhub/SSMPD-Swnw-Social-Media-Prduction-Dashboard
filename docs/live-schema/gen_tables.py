import re,sys
CMD={'r':'SELECT','a':'INSERT','w':'UPDATE','d':'DELETE','*':'ALL'}
out={}
for line in open(sys.argv[1],encoding='utf-8'):
    line=line.rstrip('\n')
    if not line: continue
    f=line.split('@@')
    assert len(f)==7,(len(f),line[:60])
    s,r,cols,cons,idx,rls,pols=f
    t=f"{s}.{r}"
    L=[f"CREATE TABLE {t} ("]
    items=[c.strip() for c in cols.split(' ;; ') if c.strip()]
    items+=["CONSTRAINT "+c.strip() for c in cons.split(' ;; ') if c.strip()]
    L.append(",\n".join("  "+i for i in items))
    L.append(");")
    for i in idx.split(' ;; '):
        if i.strip(): L.append(i.strip()+";")
    if rls=='true': L.append(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY;")
    for p in pols.split(' ;; '):
        p=p.strip()
        if not p: continue
        m=re.match(r'^(.*?) ([rawd*])(?= |$) ?(.*)$',p)
        name,cmd,rest=m.groups()
        use,chk=rest,None
        if rest.startswith(' check ') or rest.startswith('check '):
            use,chk='',rest.split('check ',1)[1]
        elif ' check ' in rest:
            use,chk=rest.split(' check ',1)
        q=f'CREATE POLICY "{name}" ON {t} FOR {CMD[cmd]}'
        if use.strip(): q+=f" USING ({use.strip()})"
        if chk: q+=f" WITH CHECK ({chk.strip()})"
        L.append(q+";")
    out.setdefault(s,[]).append("\n".join(L))
hdr="""-- LIVE CAPTURE (2026-11-07): table structure read from production catalogs (read-only).
-- Reference snapshot only. NOT a migration: do not apply blindly.
-- Generated from docs/live-schema/tables-raw-20261107.txt. Unqualified names resolve via search_path (public).
-- Not captured: grants, policy roles (TO ...), permissive/restrictive flag, triggers, sequences ownership, seed rows.
"""
for s,blocks in out.items():
    open(f"{sys.argv[2]}/20261107_tables_{s}.sql" if s!='clinic_reception' else f"{sys.argv[2]}/20261107_tables_clinic_reception_b.sql",'w',encoding='utf-8').write(hdr+"\n"+"\n\n".join(blocks)+"\n")
    print(s,len(blocks))
