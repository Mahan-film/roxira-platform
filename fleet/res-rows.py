#!/usr/bin/env python3
# Resolve table-row conflicts in status docs: per row key keep the longer row (status rows only ever gain evidence).
# Refuses (exit 1) if a conflict side has a non-table line, so prose conflicts still go to a person.
import re,sys
for p in sys.argv[1:]:
    s=open(p).read()
    def f(m):
        a,b=m.group(1).splitlines(True),m.group(2).splitlines(True)
        for l in a+b:
            if not l.startswith('|'): sys.exit(1)
        key=lambda l:l.split('|')[1].strip()
        kb={key(l):l for l in b}; seen=set(); out=[]
        for l in a:
            k=key(l); seen.add(k); o=kb.get(k,l); out.append(o if len(o)>=len(l) else l)
        return ''.join(out+[l for l in b if key(l) not in seen])
    s=re.sub(r'<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n',f,s,flags=re.S); open(p,'w').write(s)
