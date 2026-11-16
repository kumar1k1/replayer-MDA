import struct, lzma, sys, io
class R:
    def __init__(s,b): s.b=b; s.p=0
    def byte(s): v=s.b[s.p]; s.p+=1; return v
    def num(s):
        f=s.byte(); m=0x80; v=0
        for i in range(8):
            if f & m == 0:
                hi = f & (m-1)
                return v | (hi << (8*i))
            v |= s.byte() << (8*i); m >>= 1
        return v
    def bytes(s,n): v=s.b[s.p:s.p+n]; s.p+=n; return v
    def bits(s,n):
        out=[]; m=0; v=0
        for i in range(n):
            if m==0: v=s.byte(); m=0x80
            out.append(bool(v&m)); m>>=1
        return out
    def defbits(s,n):
        a=s.byte()
        return [True]*n if a else s.bits(n)
def packinfo(r):
    pos=r.num(); n=r.num(); sizes=[]
    while True:
        t=r.byte()
        if t==0: break
        if t==9: sizes=[r.num() for _ in range(n)]
        elif t==10: d=r.defbits(n); [r.bytes(4) for x in d if x]
    return pos,sizes
def folder(r):
    nc=r.num(); coders=[]; tin=0; tout=0
    for _ in range(nc):
        f=r.byte(); idl=f&0xf; cid=r.bytes(idl)
        ni=no=1
        if f&0x10: ni=r.num(); no=r.num()
        props=r.bytes(r.num()) if f&0x20 else b''
        coders.append((cid,ni,no,props)); tin+=ni; tout+=no
    bonds=[(r.num(),r.num()) for _ in range(tout-1)]
    npacked=tin-(tout-1)
    packed=[r.num() for _ in range(npacked)] if npacked>1 else [0]
    return dict(coders=coders,bonds=bonds,packed=packed,tout=tout)
def unpackinfo(r):
    assert r.byte()==11; nf=r.num(); assert r.byte()==0
    fs=[folder(r) for _ in range(nf)]
    assert r.byte()==12
    for f in fs: f['us']=[r.num() for _ in range(f['tout'])]
    t=r.byte()
    if t==10: d=r.defbits(nf); [r.bytes(4) for x in d if x]; t=r.byte()
    assert t==0
    return fs
def substreams(r,fs):
    nums=[1]*len(fs); sizes=[]; t=r.byte()
    if t==13: nums=[r.num() for _ in fs]; t=r.byte()
    for f,n in zip(fs,nums):
        if n==0: continue
        tot=f['us'][-1] if len(f['us'])==1 else unpacksize(f); s=0
        if t==9:
            for _ in range(n-1): x=r.num(); sizes.append(x); s+=x
        sizes.append(tot-s)
    if t==9: t=r.byte()
    while t!=0:
        if t==10:
            k=sum(n for f,n in zip(fs,nums) if not(n==1 and 'crc' in f))
            d=r.defbits(k); [r.bytes(4) for x in d if x]
        t=r.byte()
    return nums,sizes
def unpacksize(f):
    bound={b[1] for b in f['bonds']}
    for i,s in enumerate(f['us']):
        if i not in bound: return s
def streamsinfo(r):
    pi=None; fs=[]; ss=None; t=r.byte()
    while t!=0:
        if t==6: pi=packinfo(r)
        elif t==7: fs=unpackinfo(r)
        elif t==8: ss=substreams(r,fs)
        t=r.byte()
    return pi,fs,ss
def decode(fh,base,pi,fs,fi,limit=None):
    f=fs[fi]; pos=base+pi[0]+sum(pi[1][:sum(len(x['packed']) for x in fs[:fi])])
    cid,ni,no,props=f['coders'][0]
    if len(f['coders'])!=1: raise Exception('coders '+str([c[0].hex() for c in f['coders']]))
    fh.seek(pos)
    if cid==b'\x03\x01\x01':
        d=props[0]; lc=d%9; d//=9; lp=d%5; pb=d//5; ds=struct.unpack('<I',props[1:5])[0]
        dec=lzma.LZMADecompressor(lzma.FORMAT_RAW,filters=[dict(id=lzma.FILTER_LZMA1,lc=lc,lp=lp,pb=pb,dict_size=ds)])
    elif cid==b'\x21':
        p=props[0]; ds=(2|(p&1))<<(p//2+11) if p<40 else 0xffffffff
        dec=lzma.LZMADecompressor(lzma.FORMAT_RAW,filters=[dict(id=lzma.FILTER_LZMA2,dict_size=ds)])
    elif cid==b'\x00': dec=None
    else: raise Exception('codec '+cid.hex())
    want=unpacksize(f) if limit is None else limit
    out=bytearray(); left=pi[1][sum(len(x['packed']) for x in fs[:fi])]
    while len(out)<want and left>0:
        chunk=fh.read(min(1<<20,left)); left-=len(chunk)
        out+= chunk if dec is None else dec.decompress(chunk, max_length=want-len(out)) if False else (chunk if dec is None else dec.decompress(chunk))
    return bytes(out[:want])
def filesinfo(r):
    n=r.num(); names=[]; empty=[False]*n; attrs=None; mt=None
    while True:
        t=r.byte()
        if t==0: break
        sz=r.num(); body=R(r.bytes(sz))
        if t==14: empty=body.bits(n)
        elif t==17: body.byte(); names=body.b[1:].decode('utf-16le').split('\x00')[:n]
        elif t==20:
            d=body.defbits(n); ext=body.byte(); mt=[struct.unpack('<Q',body.bytes(8))[0] if x else None for x in d]
    return names,empty,mt
def open7z(path):
    fh=open(path,'rb'); h=fh.read(32); assert h[:6]==b"7z\xbc\xaf\x27\x1c"
    off,size=struct.unpack('<QQ',h[12:28]); fh.seek(32+off); hd=fh.read(size); r=R(hd)
    t=r.byte()
    if t==0x17:
        pi,fs,ss=streamsinfo(r); hd=decode(fh,32,pi,fs,0); r=R(hd); t=r.byte()
    assert t==1
    t=r.byte(); main=None; files=None
    while t!=0:
        if t==4: main=streamsinfo(r)
        elif t==5: files=filesinfo(r)
        elif t==2:
            while r.byte()!=0: pass
        t=r.byte()
    return fh,main,files
if __name__=='__main__':
    fh,main,(names,empty,mt)=open7z(sys.argv[1])
    pi,fs,ss=main
    nums,sizes=ss if ss else ([1]*len(fs),[unpacksize(f) for f in fs])
    print('folders',len(fs),'files',len(names),'codecs',{c[0].hex() for f in fs for c in f['coders']})
    i=0
    for n,e in zip(names,empty):
        print(('DIR ' if e else '%12d '%sizes[i])+n)
        if not e: i+=1
