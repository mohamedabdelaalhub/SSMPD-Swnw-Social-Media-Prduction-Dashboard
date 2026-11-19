import re,sys
stamp=sys.argv[1]; ver=sys.argv[2]
def res(f,fn):
    s=open(f).read()
    def pick(m):
        a,b=m.group(1),m.group(2); r=fn(a,b)
        if r is None: print('UNRESOLVED',f,a[:120],'||',b[:120]); return m.group(0)
        return r
    s=re.sub(r'<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n',pick,s,flags=re.S); open(f,'w').write(s)
def helpjs(a,b):
    if 'DATA_FILES' in a: return "var DATA_FILES=['assets/js/dashboard-help-data.js?v=%s','assets/js/dashboard-help-fields.js?v=%s'],dataPromise=null;\n"%(stamp,stamp)
def index(a,b):
    if 'dashboard-help.js' in a and a.count('\n')==1: return '<script src="assets/js/dashboard-help.js?v=%s"></script>\n'%stamp
def data(a,b):
    if a.strip().startswith('"version"') and a.count('\n')==1: return '  "version": "%s",\n'%ver
res('assets/js/dashboard-help.js',helpjs); res('index.html',index); res('assets/js/dashboard-help-data.js',data)
