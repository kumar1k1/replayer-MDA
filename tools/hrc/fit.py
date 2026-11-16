import struct,numpy as np,pickle,itertools
E=pickle.load(open('emp15.pkl','rb'))
idx=open('idx.dat','rb').read(); nd=open('nodedata.dat','rb').read()
Ent=[struct.unpack_from('<QI',idx,i) for i in range(0,len(idx),12)]
def orders():
    for RR in ['AKQJT98765432','23456789TJQKA']:
        for supper in [True,False]:
            o=[]
            for i,a in enumerate(RR):
                for j,b in enumerate(RR):
                    if i==j: o.append(a+b)
                    elif (i<j)==supper:
                        hi,lo=(a,b) if 'AKQJT98765432'.index(a)<'AKQJT98765432'.index(b) else (b,a); o.append(hi+lo+'s')
                    else:
                        hi,lo=(a,b) if 'AKQJT98765432'.index(a)<'AKQJT98765432'.index(b) else (b,a); o.append(hi+lo+'o')
            yield (RR[0],supper,'rowmajor'),o
            # column major
            o2=[o[j*13+i] for i in range(13) for j in range(13)]
            yield (RR[0],supper,'colmajor'),o2
empv={k:np.array([c['f'],c['r'],c['j']],float)/max(1,sum(c.values())) for k,c in E.items()}
o,l=Ent[1]; b=nd[o:o+l]
best=[]
for start in range(28,40,4):
  raw=np.frombuffer(b[start:start+169*28],dtype='<f4').astype(np.float64).reshape(169,7)
  for j in range(5):
    s=np.abs(raw[:,j:j+3]); p=s/np.maximum(s.sum(1,keepdims=True),1e-300)
    for name,ordr in orders():
      for perm in itertools.permutations(range(3)):
        q=p[:,perm]
        err=np.mean([np.abs(q[i]-empv[h]).sum() for i,h in enumerate(ordr)])
        best.append((err,start,j,name,perm))
best.sort(); print(best[:8])
