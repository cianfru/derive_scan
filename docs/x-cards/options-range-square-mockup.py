import json, datetime as dt, math
d = json.load(open('/tmp/claude-0/sd6/coins/BTC.json'))
o = d['options']; f = o['features']; lv = o['levels']
spot = f['index_price']; now = o['ts']
k = lambda v: f"${v/1000:,.1f}k"
dm = lambda t: dt.datetime.utcfromtimestamp(t).strftime('%-d %b')
day = lambda t: dt.datetime.utcfromtimestamp(t).strftime('%a %-d %b')
hist = [(c[0] + 86400, c[4]) for c in d['candles']['1d'][-30:]] + [(now, spot)]
fri = [e for e in o['implied'] if dt.datetime.utcfromtimestamp(e['expiry']).weekday() == 4 and e['days'] < 30]
cone = [(now, [spot]*5)] + [(e['expiry'], e['q']) for e in fri]
head = fri[0]
month_swing = f['atm_iv_30d'] * math.sqrt(30 / 365) * 100
skew = f['rr25_30d']
W = 1080
X0, X1, Y0, Y1 = 70, 860, 440, 790
t0, t1 = hist[0][0], cone[-1][0]
vals = [v for _, v in hist] + [q for _, qs in cone for q in (qs[0], qs[4])]
lo, hi = min(vals) * 0.99, max(vals) * 1.01
X = lambda t: X0 + (t - t0) / (t1 - t0) * (X1 - X0)
Y = lambda v: Y1 - (v - lo) / (hi - lo) * (Y1 - Y0)
path = lambda pts: "M" + " L".join(f"{X(t):.1f},{Y(v):.1f}" for t, v in pts)
def band(i, j):
    return path([(t, q[j]) for t, q in cone] + [(t, q[i]) for t, q in reversed(cone)]) + " Z"
area = path(hist) + f" L{X(now):.1f},{Y1} L{X(hist[0][0]):.1f},{Y1} Z"
grid = ""
g = math.ceil(lo / 5000) * 5000
while g < hi:
    grid += f'<line x1="{X0}" x2="{X1}" y1="{Y(g):.1f}" y2="{Y(g):.1f}" class="grid"/><text x="{X1+12}" y="{Y(g)+5:.1f}" class="ax">{k(g)}</text>'
    g += 5000
ticks = "".join(f'<line x1="{X(t):.1f}" x2="{X(t):.1f}" y1="{Y0-10}" y2="{Y1}" class="exp"/><text x="{X(t):.1f}" y="{Y1+28}" class="ax mid">{"Fri " if i == 0 else ""}{dm(t)}</text>' for i, (t, _) in enumerate(cone[1:]))
e0 = cone[1]
labels = (f'<g class="pin"><rect x="{X(e0[0])+10:.1f}" y="{Y(e0[1][3])-34:.1f}" width="86" height="28" rx="14" class="pinu"/><text x="{X(e0[0])+53:.1f}" y="{Y(e0[1][3])-15:.1f}" class="pt mid">{k(e0[1][3])}</text></g>'
          f'<g class="pin"><rect x="{X(e0[0])+10:.1f}" y="{Y(e0[1][1])+6:.1f}" width="86" height="28" rx="14" class="pind"/><text x="{X(e0[0])+53:.1f}" y="{Y(e0[1][1])+25:.1f}" class="pt mid">{k(e0[1][1])}</text></g>')
html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: Manrope; src: url(manrope-latin-variable.woff2) format('woff2'); font-weight: 200 800; }}
@font-face {{ font-family: Chivo Mono; src: url(chivo-mono-latin-variable.woff2) format('woff2'); font-weight: 100 900; }}
* {{ margin: 0; box-sizing: border-box; }}
body {{ width: {W}px; height: {W}px; overflow: hidden; position: relative; color: #f7f3ed; font-family: Manrope;
  background: radial-gradient(760px 560px at 105% 30%, rgba(80, 200, 150, .30), transparent 62%),
              radial-gradient(720px 560px at -10% 95%, rgba(240, 110, 95, .26), transparent 62%),
              radial-gradient(640px 420px at 12% -8%, rgba(255, 128, 40, .22), transparent 65%),
              linear-gradient(160deg, #1c1714 0%, #0f0d0b 55%, #0c0b0a 100%); }}
.grain {{ position: absolute; inset: 0; opacity: .5; background-image: radial-gradient(rgba(255,255,255,.035) 1px, transparent 1px); background-size: 4px 4px; }}
.frame {{ position: absolute; inset: 22px; border-radius: 28px; border: 1px solid rgba(255,255,255,.10);
  background: linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.01)); box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 30px 80px rgba(0,0,0,.45); }}
.top {{ position: absolute; left: 58px; right: 58px; top: 52px; display: flex; justify-content: space-between; align-items: center; }}
.top img {{ height: 40px; }}
.chip {{ font: 500 15px/1 'Chivo Mono'; color: #e4ded5; padding: 10px 16px; border-radius: 999px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.05); }}
.eyebrow {{ position: absolute; left: 58px; top: 138px; font: 700 18px/1 Manrope; letter-spacing: .16em; text-transform: uppercase; color: #ffb27a; }}
h1 {{ position: absolute; left: 58px; right: 58px; top: 172px; font: 800 58px/1.04 Manrope; letter-spacing: -.04em; }}
h1 .dn {{ color: #ff9d90; }} h1 .up {{ color: #8ff0c6; }} h1 .n {{ font-family: 'Chivo Mono'; font-weight: 600; letter-spacing: -.06em; }}
.sub {{ position: absolute; left: 58px; right: 70px; top: 318px; font: 500 22px/1.38 Manrope; color: #ece6dd; }}
.sub b {{ color: #fff; }}
svg {{ position: absolute; left: 0; top: 0; }}
.grid {{ stroke: rgba(255,255,255,.07); }} .exp {{ stroke: rgba(255,255,255,.14); stroke-dasharray: 2 6; }}
.ax {{ font: 400 15px 'Chivo Mono'; fill: #b9b0a4; }} .mid {{ text-anchor: middle; }}
.pt {{ font: 600 15px 'Chivo Mono'; fill: #0e0d0b; }} .pinu {{ fill: #8ff0c6; }} .pind {{ fill: #ff9d90; }}
.tiles {{ position: absolute; left: 58px; right: 58px; top: 850px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }}
.tile {{ border-radius: 20px; padding: 18px 20px; border: 1px solid rgba(255,255,255,.12); background: linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.025)); box-shadow: inset 0 1px 0 rgba(255,255,255,.08); }}
.tile b {{ display: block; font: 700 30px/1.05 'Chivo Mono'; letter-spacing: -.05em; }}
.tile span {{ display: block; margin-top: 8px; font: 500 16px/1.3 Manrope; color: #ece6dd; }}
.tile.g b {{ color: #8ff0c6; }} .tile.r b {{ color: #ff9d90; }}
.foot {{ position: absolute; left: 58px; right: 58px; bottom: 46px; display: flex; justify-content: space-between; font: 500 14px/1 Manrope; color: #b9b0a4; }}
.foot b {{ font: 600 15px 'Chivo Mono'; color: #f7f3ed; }}
</style></head><body><div class="grain"></div><div class="frame"></div>
<div class="top"><img src="cowboy-lockup-on-dark.svg"><span class="chip">Derive options · {dt.datetime.utcfromtimestamp(now).strftime('%-d %b, %H:%M')} UTC</span></div>
<div class="eyebrow">Bitcoin · this Friday</div>
<h1>Options traders price BTC between <span class="n dn">{k(head['q'][1])}</span> and <span class="n up">{k(head['q'][3])}</span> on Friday</h1>
<div class="sub">That's the middle half of the outcomes they're paying for. BTC is at <b>{k(spot)}</b> now, and the range gets wider the further out you look.</div>
<svg width="{W}" height="{W}" viewBox="0 0 {W} {W}">
<defs>
<linearGradient id="gu" x1="0" x2="1"><stop offset="0" stop-color="#8ff0c6" stop-opacity=".08"/><stop offset="1" stop-color="#8ff0c6" stop-opacity=".42"/></linearGradient>
<linearGradient id="gd" x1="0" x2="1"><stop offset="0" stop-color="#ff9d90" stop-opacity=".08"/><stop offset="1" stop-color="#ff9d90" stop-opacity=".42"/></linearGradient>
<linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".16"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
<filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter>
</defs>
{grid}{ticks}
<path d="{area}" fill="url(#ga)"/>
<path d="{band(2,4)}" fill="url(#gu)" opacity=".5"/><path d="{band(0,2)}" fill="url(#gd)" opacity=".5"/>
<path d="{band(2,3)}" fill="url(#gu)"/><path d="{band(1,2)}" fill="url(#gd)"/>
<path d="{path([(t, q[3]) for t, q in cone])}" fill="none" stroke="#8ff0c6" stroke-width="7" opacity=".35" filter="url(#glow)"/>
<path d="{path([(t, q[1]) for t, q in cone])}" fill="none" stroke="#ff9d90" stroke-width="7" opacity=".35" filter="url(#glow)"/>
<path d="{path([(t, q[3]) for t, q in cone])}" fill="none" stroke="#8ff0c6" stroke-width="3"/>
<path d="{path([(t, q[1]) for t, q in cone])}" fill="none" stroke="#ff9d90" stroke-width="3"/>
<path d="{path(hist)}" fill="none" stroke="#ffffff" stroke-width="3.2" stroke-linejoin="round"/>
<circle cx="{X(now):.1f}" cy="{Y(spot):.1f}" r="14" fill="#ffffff" opacity=".15"/><circle cx="{X(now):.1f}" cy="{Y(spot):.1f}" r="7" fill="#ffffff"/>
<text x="{X(now)-16:.1f}" y="{Y(spot)-20:.1f}" class="ax" style="text-anchor:end;fill:#fff;font-weight:600">Now</text>
<text x="{X0}" y="{Y1+28}" class="ax">{dm(hist[0][0])}</text>
{labels}
</svg>
<div class="tiles">
<div class="tile"><b>±{month_swing:.0f}%</b><span>A normal month's swing for BTC, as options price it</span></div>
<div class="tile {'r' if skew < 0 else 'g'}"><b>{"Drops" if skew < 0 else "Rises"}</b><span>cost more to protect against than {"rises" if skew < 0 else "drops"}</span></div>
<div class="tile"><b>${lv['call_wall']:,.0f}</b><span>Where the most open bets on BTC sit</span></div>
</div>
<div class="foot"><span><b>cowboy.trading</b></span><span>What option prices imply, not a forecast · Not investment advice</span></div>
</body></html>"""
open('/tmp/claude-0/card/card2.html', 'w').write(html)
print(round(month_swing,1), skew)
