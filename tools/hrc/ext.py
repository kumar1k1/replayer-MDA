import sys,lzma,os
sys.path.insert(0,'/tmp/s7'); from r7z import *
fh,main,(names,empty,mt)=open7z(sys.argv[1]); pi,fs,ss=main
f=fs[0]; p=f['coders'][0][3][0]; ds=(2|(p&1))<<(p//2+11)
dec=lzma.LZMADecompressor(lzma.FORMAT_RAW,filters=[dict(id=lzma.FILTER_LZMA2,dict_size=ds)])
fh.seek(32+pi[0]); left=pi[1][0]
files=[n for n,e in zip(names,empty) if not e]; sizes=ss[1]
out='/tmp/s7/x'; os.makedirs(out,exist_ok=True)
i=0; cur=open(os.path.join(out,os.path.basename(files[0])),'wb'); need=sizes[0]
buf=b''
while left>0 or buf:
    if not buf:
        c=fh.read(min(4<<20,left)); left-=len(c); buf=dec.decompress(c)
        if not buf: continue
    take=buf[:need]; cur.write(take); need-=len(take); buf=buf[len(take):]
    if need==0:
        cur.close(); print('ok',files[i],flush=True); i+=1
        if i==len(files): break
        cur=open(os.path.join(out,os.path.basename(files[i])),'wb'); need=sizes[i]
