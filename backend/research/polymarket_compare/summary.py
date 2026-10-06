# Summarises rows.json from compare.py. See docs/polymarket-comparison.md.
import json,statistics as st,collections
R=json.load(open('rows.json'))
def q(xs,p): xs=sorted(xs); return xs[int(p*(len(xs)-1))] if xs else None
def summ(rs,label):
    if not rs: return
    tp=[(r['cost_pm']-r['fair_pm'])/r['cost_pm'] for r in rs]; td=[(r['cost_d']-r['fair_d'])/r['cost_d'] for r in rs]
    cheaper=sum(1 for r in rs if (r['cost_d']-r['fair_d'])/r['cost_d'] < (r['cost_pm']-r['fair_pm'])/r['cost_pm'])/len(rs)
    raw=sum(1 for r in rs if r['cost_d']<r['cost_pm'])/len(rs)
    bias=[r['pm_mid']-r['fair_pm'] for r in rs]
    print(f"{label:34s} n={len(rs):5d}  toll PM {st.median(tp)*100:5.1f}%  Derive {st.median(td)*100:5.1f}%  Derive cheaper vs fair {cheaper*100:4.0f}%  raw cheaper {raw*100:4.0f}%  PM mid-fair {st.median(bias)*100:+.1f}c")
mid=[r for r in R if 0.05<=r['fair_pm']<=0.95 and 0.05<=r['fair_d']<=0.95]
# one point per (coin,t,day,K,side): keep narrowest width w
best={}
for r in mid:
    k=(r['coin'],r['t'],r['day'],r['K'],r['side'])
    if k not in best or r['w']<best[k]['w']: best[k]=r
B=list(best.values())
summ(B,'ALL (5-95c, narrowest)')
for c in ('BTC','ETH'): summ([r for r in B if r['coin']==c],c)
for lo,hi,l in ((0.05,0.25,'longshots 5-25c'),(0.25,0.75,'middle 25-75c'),(0.75,0.95,'favourites 75-95c')):
    summ([r for r in B if lo<=r['fair_pm']<hi],l)
for lo,hi in ((1,12),(12,24),(24,48),(48,96)):
    summ([r for r in B if lo<=r['hrs']<hi],f'{lo}-{hi}h to Derive expiry')
for w in (1000,2000,50,100): summ([r for r in mid if r['w']==w],f'width +/-{w}')
summ([r for r in B if r['side']=='yes'],'YES (above)'); summ([r for r in B if r['side']=='no'],'NO (below)')
# sanity: Derive mark ramp vs BS digital at Derive time is implicit; print fair gap pm vs d
gap=[r['fair_pm']-r['fair_d'] for r in B]; print('fair_pm - fair_d median',round(st.median(gap)*100,2),'c  p10/p90',round(q(gap,.1)*100,1),round(q(gap,.9)*100,1))
# dollar view for $100
sav=[100*( r['fair_d']/r['cost_d'] - r['fair_pm']/r['cost_pm']) for r in B]
print('expected payout per $100: Derive minus PM, median $',round(st.median(sav),2),' p25',round(q(sav,.25),2),' p75',round(q(sav,.75),2))
print('Derive size at top of book ($ max payout) median',round(st.median(r['size_d'] for r in B)))
print('hours covered',len({r['t'] for r in B}),'questions',len({(r['coin'],r['day'],r['K']) for r in B}))
