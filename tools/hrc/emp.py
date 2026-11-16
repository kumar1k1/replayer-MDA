import re,collections,glob
R='23456789TJQKA'
def cls(c):
    a,b=c.split(); r1,s1,r2,s2=a[0],a[1],b[0],b[1]
    if R.index(r1)<R.index(r2): r1,r2,s1,s2=r2,r1,s2,s1
    return r1+r2 if r1==r2 else r1+r2+('s' if s1==s2 else 'o')
def emp(files,pos='UTG'):
    E=collections.defaultdict(collections.Counter)
    for f in files:
        for h in open(f).read().split('PokerStars Hand #')[1:]:
            m=re.search(r'Dealt to HRC\|%s \[(.. ..)\]'%pos,h); 
            pre=h.split('*** HOLE CARDS ***')[1]
            acts=[l for l in pre.split('\n') if l.startswith('HRC|') and 'Dealt' not in l and ': ' in l]
            # first action of pos only if all before folded
            for a in acts:
                p,act=a[4:].split(': ',1)
                if p==pos:
                    k='f' if act.startswith('folds') else 'j' if 'all-in' in act else 'c' if act.startswith('calls') else 'r'
                    E[cls(m.group(1))][k]+=1; break
                if not act.startswith('folds'): break
    return E
