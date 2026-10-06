import json, sys, datetime as dt
sys.path.insert(0, '/tmp/claude-0/card'); from base import page, stamp
q = json.load(open('/tmp/claude-0/sd6/questions/BTC.json'))
d = [x for x in q['dates'] if x['expiry'] == '20261009'][0]
idx = q['index']
lv = [l for l in d['levels'] if l['ladder'] == 7 and l['yes'].get('buy') and l['no'].get('buy')]
lv = sorted(sorted(lv, key=lambda l: abs(l['k'] - idx))[:5], key=lambda l: -l['k'])
c = lambda p: f"{round(p*100)}¢"
rows = ""
placed = False
for l in lv:
    if not placed and l['k'] < idx:
        rows += f'<div class="now"><span>BTC now ${idx:,.0f}</span></div>'; placed = True
    y, n = l['yes']['buy'], l['no']['buy']
    rows += f'''<div class="lvl glass"><div class="k"><b>${l['k']:,.0f}</b><small>pays in part ${l['lo']/1000:,.0f}k–${l['hi']/1000:,.0f}k</small></div>
<div class="bar"><div class="hi" style="flex:{y:.3f}"><span>Higher <b>{c(y)}</b></span></div><div class="lo" style="flex:{n:.3f}"><span><b>{c(n)}</b> Lower</span></div></div></div>'''
mid = min(lv, key=lambda l: abs(l['k'] - idx))
y = mid['yes']['buy']
body = f"""<style>
.ladder {{ position: absolute; left: 58px; right: 58px; top: 368px; display: grid; gap: 10px; }}
.lvl {{ display: grid; grid-template-columns: 210px 1fr; align-items: center; gap: 18px; padding: 10px 14px; }}
.k b {{ display: block; font: 600 26px/1.1 'Chivo Mono'; letter-spacing: -.05em; }}
.k small {{ display: block; margin-top: 4px; font: 500 13px Manrope; color: #b9b0a4; }}
.bar {{ display: flex; height: 48px; border-radius: 14px; overflow: hidden; gap: 3px; }}
.bar > div {{ display: flex; align-items: center; min-width: 120px; padding: 0 16px; font: 600 16px Manrope; }}
.bar b {{ font: 700 22px 'Chivo Mono'; letter-spacing: -.04em; }}
.hi {{ background: linear-gradient(90deg, rgba(143,240,198,.42), rgba(143,240,198,.22)); color: #eafff5; border-radius: 14px 4px 4px 14px; }}
.hi b {{ color: #8ff0c6; margin-left: 6px; }}
.lo {{ background: linear-gradient(90deg, rgba(255,157,144,.22), rgba(255,157,144,.42)); color: #fff0ed; justify-content: flex-end; border-radius: 4px 14px 14px 4px; }}
.lo b {{ color: #ff9d90; margin-right: 6px; }}
.now {{ position: relative; height: 20px; }}
.now::before {{ content: ""; position: absolute; left: 0; right: 0; top: 10px; height: 2px; background: linear-gradient(90deg, rgba(255,255,255,.0), rgba(255,255,255,.75), rgba(255,255,255,.0)); }}
.now span {{ position: absolute; left: 50%; top: 0; transform: translateX(-50%); padding: 2px 12px; border-radius: 999px; background: #f7f3ed; color: #0e0d0b; font: 700 14px 'Chivo Mono'; }}
.tiles {{ position: absolute; left: 58px; right: 58px; top: 852px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }}
.tile {{ padding: 16px 18px; }}
.tile b {{ display: block; font: 800 24px/1.1 Manrope; letter-spacing: -.03em; }} .tile b.m {{ font-family: 'Chivo Mono'; font-weight: 700; letter-spacing: -.05em; }}
.tile span {{ display: block; margin-top: 6px; font: 500 15px/1.3 Manrope; color: #ece6dd; }}
</style>
<div class="eyebrow">Bitcoin · {d['label'].replace('This Friday · ','Friday ')}</div>
<h1>BTC on Friday: <span class="g">higher</span> or <span class="r">lower</span>?</h1>
<div class="sub" style="top:252px">Pick a level and a side. Each answer pays up to <b>$1</b> at Friday's 08:00 UTC settlement. The price is what it costs today.</div>
<div class="ladder">{rows}</div>
<div class="tiles">
<div class="tile glass"><b class="m">{c(y)} → $1</b><span>Higher than ${mid['k']:,.0f} pays in full from ${mid['hi']:,.0f}</span></div>
<div class="tile glass"><b>Only what you pay</b><span>is the most you can lose</span></div>
<div class="tile glass"><b class="m">Fri 08:00 UTC</b><span>Settles by itself, paid in USDC</span></div>
</div>"""
open('/tmp/claude-0/card/ladder.html', 'w').write(page(body, stamp("Derive prices", q['prices_ts']), "Prices per $1 before fees · Not investment advice"))
