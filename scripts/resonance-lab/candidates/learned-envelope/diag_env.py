import numpy as np, pandas as pd, train_eval as T, lefeat as L
D=T.Data()
E=D.au['E_band']; rr=D.au_refrow; ok=rr>=0
it=D.au['item']; ai=D.ai
eng=ai.engine.values[it]; sex=ai.sex.values[it]; kind=D.au_kind; st=D.au_st; lfs=D.au_lnfs
dE=np.zeros_like(E); dE[ok]=E[ok]-E[rr[ok]]
def m(sel): return dE[sel&ok].mean(0)
g=L.GRID
idx=[np.argmin(abs(g-f)) for f in (300,500,800,1200,1800,2500,3500,4500,5500)]
rows={}
for e in ('praat','world'):
    for sx in 'mf':
        rows[f'{e} {sx} pitch+8..12']=m((eng==e)&(sex==sx)&(kind=='pitch')&(st>8))
        rows[f'{e} {sx} pitch-8..-12']=m((eng==e)&(sex==sx)&(kind=='pitch')&(st<-8))
        rows[f'{e} {sx} pitch+2..4']=m((eng==e)&(sex==sx)&(kind=='pitch')&(st>0)&(st<4))
        rows[f'{e} {sx} fs>1.12']=m((eng==e)&(sex==sx)&(kind=='formant')&(lfs>np.log(1.12)))
Et=D.tr['E_band']
rows['women-men (orig train)']=Et[D.tr_fem==1].mean(0)-Et[D.tr_fem==0].mean(0)
df=pd.DataFrame({k:v[idx] for k,v in rows.items()}, index=[f'{int(g[i])}' for i in idx]).T
print((df*10/np.log(10)).round(2).to_string())
# cosine similarity of directions (500-6000)
sel=g>=500
ref=rows['women-men (orig train)'][sel]
for k,v in rows.items():
    v=v[sel]; print(f'{k:28s} cos(sexdir) {v@ref/np.linalg.norm(v)/np.linalg.norm(ref):+.2f}  norm {np.linalg.norm(v):.3f}')
