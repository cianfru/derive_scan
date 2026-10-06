# Matches Polymarket "BTC/ETH above K on date D" questions to Derive option ramps (K-w, K+w)
# on recorded hourly chains and writes rows.json. Run from a folder holding chains/ (Derive
# hourly chain files named COIN-YYYY-MM-DD-HH.json.gz), pmh/ and pm_markets.json (Polymarket
# history and markets). Optional argument: Polymarket half-spread. See docs/polymarket-comparison.md.
import json,gzip,glob,math,os,statistics as st,datetime as dt,collections,sys
HALF = float(sys.argv[1]) if len(sys.argv)>1 else None   # override PM half-spread
def ts(s): return dt.datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()
def N(x): return 0.5*(1+math.erf(x/math.sqrt(2)))
def f(x):
    try: v=float(x); return v if math.isfinite(v) else None
    except: return None
def half(p):
    if HALF is not None: return HALF
    return 0.0125 if p<0.15 else (0.015 if p<0.85 else 0.008)
pm=json.load(open('pm_markets.json'))
hist={}
for m in pm:
    h=json.load(open(f"pmh/{m['coin']}-{m['day']}-{int(m['K'])}.json")) or {}
    hist[(m['coin'],m['day'],m['K'])]=sorted((p['t'],p['p']) for p in h.get('history',[]))
def pm_at(key,t):
    best=None
    for tt,p in hist[key]:
        if abs(tt-t)<=1800 and (best is None or abs(tt-t)<abs(best[0]-t)): best=(tt,p)
    return best[1] if best else None
rows=[]
for fn in sorted(glob.glob('chains/*.json.gz')):
    base=os.path.basename(fn)[:-8]; coin,y,mo,d,hh=base.split('-')
    t=dt.datetime(int(y),int(mo),int(d),int(hh),tzinfo=dt.timezone.utc).timestamp()
    try: ch=json.load(gzip.open(fn))['options']
    except Exception: continue
    by=collections.defaultdict(dict)
    for n,q in ch.items():
        u,e,k,cp=n.split('-'); by[(e,cp)][float(k.replace('_','.'))]=q
    for m in pm:
        if m['coin']!=coin: continue
        D=dt.date(2026,10,m['day']); e=D.strftime('%Y%m%d')
        Tder=(dt.datetime(2026,10,m['day'],8,tzinfo=dt.timezone.utc).timestamp()-t)/(365*86400)
        Tpm=(ts(m['end'])-t)/(365*86400)
        if Tder<=1/(365*24) or Tder>4/365: continue
        p=pm_at((coin,m['day'],m['K']),t)
        if p is None: continue
        K=m['K']; calls=by.get((e,'C')); puts=by.get((e,'P'))
        if not calls or not puts: continue
        ws=[1000,2000] if coin=='BTC' else [50,100]
        for w in ws:
            lo,hi=K-w,K+w
            if lo not in calls or hi not in calls or K not in calls or lo not in puts or hi not in puts: continue
            cl,chh,ck=calls[lo],calls[hi],calls[K]
            I=f(ck.get('I')); op=ck.get('option_pricing') or {}
            iv=f(op.get('i')); F=f(op.get('f'))
            if not I or not iv or not F: continue
            # fair binary at PM time and Derive time from Derive's IV at K
            def dig(T): return N((math.log(F/K)-0.5*iv*iv*T)/(iv*math.sqrt(T)))
            fairD_mark=None
            Ml,Mh=f(cl.get('M')),f(chh.get('M'))
            if Ml is not None and Mh is not None: fairD_mark=(Ml-Mh)/(2*w)
            fair_pm=dig(Tpm); fair_d=dig(Tder)
            for side in ('yes','no'):
                if side=='yes': buy,sell=calls[lo],calls[hi]; fairpay=fairD_mark; fp=None if fairD_mark is None else fairD_mark+(fair_pm-fair_d)
                else: buy,sell=puts[hi],puts[lo]; fairpay=None if fairD_mark is None else 1-fairD_mark; fp=None if fairD_mark is None else 1-(fairD_mark+(fair_pm-fair_d))
                if fp is None: continue
                a,A,b,B=f(buy.get('a')),f(buy.get('A')),f(sell.get('b')),f(sell.get('B'))
                if not a or not b or not A or not B: continue
                net=a-b
                if net<=0: continue
                fee_c=min(0.0003*I,0.125*a)+min(0.0003*I,0.125*b)
                n=(100-1.0)/(net+fee_c)
                cost_d=100/(n*2*w)           # all-in $ per $1 of max payout
                # PM
                pp=p if side=='yes' else 1-p
                ask=min(0.999,pp+half(pp))
                cost_pm=ask*(1+0.07*(1-ask))
                rows.append(dict(coin=coin,t=t,day=m['day'],K=K,w=w,side=side,hrs=Tder*365*24,
                    fair_pm=fp,fair_d=(fairpay if fairpay is not None else (fair_d if side=='yes' else 1-fair_d)),
                    cost_pm=cost_pm,cost_d=cost_d,pm_mid=pp,
                    size_d=min(A,B)*2*w, spread_d=((a-b)-((f(buy.get('M')) or 0)-(f(sell.get('M')) or 0)))/(2*w), fee_d=(fee_c+1.0/n)/(2*w), net_d=net/(2*w)))
json.dump(rows,open('rows.json','w'))
print('rows',len(rows))
