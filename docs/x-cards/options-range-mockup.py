import json, datetime as dt, math
d = json.load(open('/tmp/claude-0/sd6/coins/BTC.json'))
o = d['options']; f = o['features']; lv = o['levels']
spot = f['index_price']; now = o['ts']
fmt = lambda v: f"${v:,.0f}"
k = lambda v: f"${v/1000:,.1f}k"
dm = lambda t: dt.datetime.utcfromtimestamp(t).strftime('%-d %b')
day = lambda t: dt.datetime.utcfromtimestamp(t).strftime('%a %-d %b')
# history: last 35 daily closes
hist = [(c[0] + 86400, c[4]) for c in d['candles']['1d'][-35:]] + [(now, spot)]
fri = [e for e in o['implied'] if dt.datetime.utcfromtimestamp(e['expiry']).weekday() == 4 and e['days'] < 30]
cone = [(now, [spot]*5)] + [(e['expiry'], e['q']) for e in fri]
head = fri[0]
# chart geometry
X0, X1, Y0, Y1 = 44, 660, 268, 520
t0, t1 = hist[0][0], cone[-1][0]
vals = [v for _, v in hist] + [q for _, qs in cone for q in (qs[0], qs[4])]
lo, hi = min(vals) * 0.985, max(vals) * 1.012
X = lambda t: X0 + (t - t0) / (t1 - t0) * (X1 - X0)
Y = lambda v: Y1 - (v - lo) / (hi - lo) * (Y1 - Y0)
def path(pts): return "M" + " L".join(f"{X(t):.1f},{Y(v):.1f}" for t, v in pts)
def band(i, j):
    up = [(t, q[j]) for t, q in cone]; dn = [(t, q[i]) for t, q in reversed(cone)]
    return path(up + dn) + " Z"
line = path(hist)
outer_up, outer_dn, inner_up, inner_dn = band(2, 4), band(0, 2), band(2, 3), band(1, 2)
upper = path([(t, q[3]) for t, q in cone]); lower = path([(t, q[1]) for t, q in cone])
mid = path([(t, q[2]) for t, q in cone])
# grid
step = 5000
grid = ""
g = math.ceil(lo / step) * step
while g < hi:
    grid += f'<line x1="{X0}" x2="{X1}" y1="{Y(g):.1f}" y2="{Y(g):.1f}" class="grid"/><text x="{X1+10}" y="{Y(g)+4:.1f}" class="ax">{k(g)}</text>'
    g += step
ticks = "".join(f'<line x1="{X(t):.1f}" x2="{X(t):.1f}" y1="{Y0}" y2="{Y1}" class="exp"/><text x="{X(t):.1f}" y="{Y1+22}" class="ax mid">{dm(t)}</text>' for t, _ in cone[1:])
labels = ""
for t, q in cone[2:]:
    labels += f'<text x="{X(t)-6:.1f}" y="{Y(q[3])-8:.1f}" class="lab up end">{k(q[3])}</text><text x="{X(t)-6:.1f}" y="{Y(q[1])+18:.1f}" class="lab dn end">{k(q[1])}</text>'
pct_up = (head['q'][3] / spot - 1) * 100; pct_dn = (1 - head['q'][1] / spot) * 100
skew = f['rr25_30d'] * 100
html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: Manrope; src: url(manrope-latin-variable.woff2) format('woff2'); font-weight: 200 800; }}
@font-face {{ font-family: Chivo Mono; src: url(chivo-mono-latin-variable.woff2) format('woff2'); font-weight: 100 900; }}
* {{ margin: 0; box-sizing: border-box; }}
body {{ width: 1200px; height: 675px; background: #0e0d0b; color: #f7f3ed; font-family: Manrope; overflow: hidden; position: relative; }}
.glow {{ position: absolute; inset: 0; background: radial-gradient(900px 420px at 18% -10%, rgba(255,116,15,.10), transparent 60%), radial-gradient(700px 500px at 95% 110%, rgba(148,223,191,.06), transparent 60%); }}
.card {{ position: absolute; inset: 28px; border: 1px solid #3b352f; border-radius: 20px; background: linear-gradient(180deg, #171513, #121110); overflow: hidden; }}
.top {{ position: absolute; left: 44px; top: 34px; right: 44px; display: flex; justify-content: space-between; align-items: center; }}
.eyebrow {{ font: 600 15px/1 Manrope; letter-spacing: .14em; text-transform: uppercase; color: #c6beb2; }}
.eyebrow b {{ color: #f7f3ed; }}
.stamp {{ font: 400 14px/1 'Chivo Mono'; color: #c6beb2; }}
h1 {{ position: absolute; left: 44px; top: 74px; font: 700 44px/1.08 Manrope; letter-spacing: -.035em; max-width: 1060px; }}
h1 .rng {{ font-family: 'Chivo Mono'; font-weight: 500; letter-spacing: -.05em; }}
h1 .up {{ color: #9fe6c7; }} h1 .dn {{ color: #f4968b; }}
.sub {{ position: absolute; left: 44px; top: 180px; font: 400 18px/1.4 Manrope; color: #e4ded5; max-width: 1060px; }}
svg.chart {{ position: absolute; left: 0; top: 0; }}
.grid {{ stroke: #2a2622; stroke-width: 1; }} .exp {{ stroke: #3b352f; stroke-dasharray: 2 5; }}
.ax {{ font: 400 13px 'Chivo Mono'; fill: #9d958a; }} .mid {{ text-anchor: middle; }} .end {{ text-anchor: end; }}
.lab {{ font: 500 14px 'Chivo Mono'; }} .lab.up {{ fill: #9fe6c7; }} .lab.dn {{ fill: #f4968b; }}
.side {{ position: absolute; left: 790px; right: 40px; top: 262px; display: grid; gap: 14px; }}
.stat {{ border-top: 1px solid #3b352f; padding-top: 12px; }}
.stat span {{ display: block; font: 500 13px/1.3 Manrope; color: #c6beb2; letter-spacing: .02em; }}
.stat b {{ display: block; font: 500 30px/1.1 'Chivo Mono'; letter-spacing: -.04em; margin-top: 5px; }}
.stat small {{ display: block; font: 400 13px/1.35 Manrope; color: #c6beb2; margin-top: 3px; }}
.foot {{ position: absolute; left: 44px; right: 44px; bottom: 22px; display: flex; justify-content: space-between; align-items: center; font: 400 13px/1 Manrope; color: #9d958a; }}
.foot img {{ height: 26px; vertical-align: middle; }} .foot .site {{ font: 500 14px 'Chivo Mono'; color: #e4ded5; margin-left: 14px; vertical-align: middle; }}
.legend {{ position: absolute; left: 60px; top: 232px; display: flex; gap: 18px; font: 500 13px Manrope; color: #c6beb2; }}
.legend i {{ display: inline-block; width: 18px; height: 10px; border-radius: 3px; margin-right: 7px; vertical-align: -1px; }}
</style></head><body><div class="glow"></div><div class="card">
<div class="top"><div class="eyebrow"><b>BTC</b> · What options price</div><div class="stamp">Derive options · {dt.datetime.utcfromtimestamp(now).strftime('%-d %b %Y, %H:%M')} UTC</div></div>
<h1>Options price the middle half of BTC<br>on {day(head['expiry'])} at <span class="rng"><span class="dn">{k(head['q'][1])}</span>–<span class="up">{k(head['q'][3])}</span></span></h1>
<div class="sub">BTC is at {fmt(spot)} now. That range sits {pct_dn:.1f}% below and {pct_up:.1f}% above it, and it widens with each Friday.</div>
<svg class="chart" width="1144" height="619" viewBox="0 0 1144 619">
<defs><linearGradient id="gu" x1="0" x2="1"><stop offset="0" stop-color="#9fe6c7" stop-opacity=".06"/><stop offset="1" stop-color="#9fe6c7" stop-opacity=".26"/></linearGradient>
<linearGradient id="gd" x1="0" x2="1"><stop offset="0" stop-color="#f4968b" stop-opacity=".06"/><stop offset="1" stop-color="#f4968b" stop-opacity=".26"/></linearGradient></defs>
{grid}{ticks}
<path d="{outer_up}" fill="url(#gu)" opacity=".45"/><path d="{outer_dn}" fill="url(#gd)" opacity=".45"/><path d="{inner_up}" fill="url(#gu)"/><path d="{inner_dn}" fill="url(#gd)"/>
<path d="{upper}" fill="none" stroke="#9fe6c7" stroke-width="2.5"/><path d="{lower}" fill="none" stroke="#f4968b" stroke-width="2.5"/>
<path d="{mid}" fill="none" stroke="#c6beb2" stroke-width="1.2" stroke-dasharray="3 5"/>
<path d="{line}" fill="none" stroke="#f7f3ed" stroke-width="2.6" stroke-linejoin="round"/>
<circle cx="{X(now):.1f}" cy="{Y(spot):.1f}" r="6" fill="#0e0d0b" stroke="#f7f3ed" stroke-width="2.5"/>
<text x="{X(now)-12:.1f}" y="{Y(spot)-14:.1f}" class="lab end" style="fill:#f7f3ed">Now {k(spot)}</text>
<text x="{X0}" y="{Y1+22}" class="ax">{day(hist[0][0])}</text>
{labels}
</svg>
<div class="side">
<div class="stat"><span>30-day implied volatility</span><b>{f['atm_iv_30d']*100:.1f}%</b><small>What options charge for movement.</small></div>
<div class="stat"><span>Price of protection, 30 days</span><b>{abs(skew):.1f} pts</b><small>{"Downside puts cost more than upside calls." if skew < 0 else "Upside calls cost more than downside puts."}</small></div>
<div class="stat"><span>Max pain, {day(lv['max_pain_expiry'])}</span><b>{fmt(lv['max_pain'])}</b><small>Where option buyers collect least.</small></div>
</div>
<div class="foot"><div><img src="cowboy-lockup-on-dark.svg"><span class="site">cowboy.trading</span></div><span>Shaded: middle half and middle 80% of outcomes option prices imply · Market pricing, not a forecast · Not investment advice</span></div>
</div></body></html>"""
open('/tmp/claude-0/card/card.html', 'w').write(html)
print(day(head['expiry']), k(head['q'][1]), k(head['q'][3]), round(pct_dn,1), round(pct_up,1), round(skew,2))
