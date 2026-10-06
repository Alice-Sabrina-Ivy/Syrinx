import sys, numpy as np, pandas as pd
import train_eval as T
D=T.Data()
def curve(cfg, label):
    r,s_tr,s_au=T.cv(D,cfg)
    ok=D.au_refrow>=0; dl=np.full(len(s_au),np.nan); dl[ok]=s_au[ok]-s_au[D.au_refrow[ok]]
    dd=pd.DataFrame(dict(it=D.au['item'],d=dl)).groupby('it').d.mean()
    ai=D.ai.loc[dd.index].assign(d=dd.values/r['G'])
    p=ai[ai.kind.isin(['pitch'])].copy(); p['stb']=pd.cut(p.st,[-13,-8,-4,0,4,8,13])
    print(label, 'G',round(r['G'],4))
    print(p.groupby(['engine','sex','stb'],observed=True).d.median().unstack('stb').round(3))
    f=ai[ai.kind=='formant'].copy(); f['fsb']=pd.cut(np.log(f.fs)/np.log(1.15),[-1.7,-0.66,-0.33,0,0.33,0.66,1.7])
    print(f.groupby(['engine','sex','fsb'],observed=True).d.median().unstack('fsb').round(3))
cfg=dict(model="ridge", feat=dict(method="band",flo=500,fhi=6000), aug_abs=True, pairs=True, alpha=1.0)
curve(cfg,'band500')
