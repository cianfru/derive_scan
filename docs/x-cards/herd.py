import json, sys
sys.path.insert(0, '/tmp/claude-0/card'); from base import page, stamp
m = json.load(open('/tmp/claude-0/sd6/markets.json'))
coins = [c for c in m['coins'] if c['has_options']]
NAME = {"ADA":"Cardano","BTC":"Bitcoin","CC":"Canton","ETH":"Ethereum","HYPE":"Hyperliquid","LIT":"Lighter","PUMP":"Pump","SOL":"Solana","VVV":"Venice","XAUT":"Tether Gold","XRP":"XRP","ZEC":"Zcash"}
REG = {"MARKUP":"Trending up","REACC":"Cooling off","ACCUM":"Building a base","MARKDOWN":"Trending down","BLOWOFF":"Overheated","CAP":"Washed out"}
ICON = {"CC":"CC.png","HYPE":"HYPE.jpg","LIT":"LIT.png","PUMP":"PUMP.jpg","VVV":"VVV.png"}
H = "30d"
def st(c, k): return c['align']['readings'][H][k]['state']
def agree(c): return all(st(c, k) == 'up' for k in ('engine','wallets','options'))
coins.sort(key=lambda c: (not agree(c), c['regime_1d'] != 'MARKUP', -(c['chg_7d'] or 0)))
up = sum(c['regime_1d'] == 'MARKUP' for c in coins)
both = [c['und'] for c in coins if agree(c)]
def dot(s, label):
    cls = {'up':'u','defensive':'d','neutral':'z'}.get(s, 'x')
    return f'<span class="dot {cls}"><i></i>{label}</span>'
tiles = ""
for c in coins:
    ch = c['chg_7d'] or 0
    tiles += f'''<div class="tile glass{' all' if agree(c) else ''}">
<div class="row1"><img src="{ICON.get(c['und'], c['und']+'.svg')}"><div><b>{c['und']}</b><small>{NAME.get(c['und'], c['und'])}</small></div><span class="chg {'g' if ch>=0 else 'r'}">{'+' if ch>=0 else ''}{ch:.1f}%<small class="wk">7d</small></span></div>
<div class="reg">{REG.get(c['regime_1d'], 'No reading yet')}</div>
<div class="dots">{dot(st(c,'engine'),'Signal')}{dot(st(c,'wallets'),'Wallets')}{dot(st(c,'options'),'Options')}</div>
{'<div class="badge">All three point up</div>' if agree(c) else ''}</div>'''
names = " and ".join(both) if len(both) <= 2 else ", ".join(both[:-1]) + " and " + both[-1]
body = f"""<style>
.grid {{ position: absolute; left: 58px; right: 58px; top: 396px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }}
.tile {{ padding: 14px 14px 12px; position: relative; min-height: 158px; }}
.tile.all {{ border-color: rgba(143,240,198,.55); box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 0 28px rgba(143,240,198,.22); background: linear-gradient(180deg, rgba(143,240,198,.14), rgba(143,240,198,.03)); }}
.row1 {{ display: flex; align-items: center; gap: 10px; }} .row1 img {{ width: 30px; height: 30px; border-radius: 50%; }}
.row1 b {{ display: block; font: 700 18px/1.1 Manrope; }} .row1 small {{ display: block; font: 500 12px/1.2 Manrope; color: #b9b0a4; }}
.wk {{ display: block; text-align: right; font: 500 11px Manrope; color: #9d958a; letter-spacing: 0; }}
.chg {{ margin-left: auto; font: 600 15px 'Chivo Mono'; letter-spacing: -.03em; }}
.reg {{ margin-top: 16px; font: 700 16px/1.2 Manrope; color: #f7f3ed; }}
.dots {{ margin-top: 14px; display: flex; gap: 10px; flex-wrap: wrap; }}
.dot {{ display: inline-flex; align-items: center; gap: 5px; font: 500 12px Manrope; color: #c6beb2; }}
.dot i {{ width: 10px; height: 10px; border-radius: 50%; display: inline-block; }}
.dot.u i {{ background: #8ff0c6; box-shadow: 0 0 8px rgba(143,240,198,.7); }} .dot.d i {{ background: #ff9d90; box-shadow: 0 0 8px rgba(255,157,144,.6); }}
.dot.z i {{ background: #8a847b; }} .dot.x i {{ border: 1.5px dashed #6d675f; }}
.badge {{ position: absolute; right: 12px; bottom: 12px; font: 700 11px Manrope; letter-spacing: .06em; text-transform: uppercase; color: #8ff0c6; }}
.key {{ position: absolute; left: 58px; right: 58px; top: 930px; display: flex; gap: 22px; font: 500 15px Manrope; color: #c6beb2; flex-wrap: wrap; }}
.key b {{ color: #f7f3ed; }} .key b.g {{ color: #8ff0c6; }} .key b.r {{ color: #ff9d90; }}
</style>
<div class="eyebrow">Derive options markets · next 30 days</div>
<h1>{up} of {len(coins)} coins are <span class="g">trending up</span></h1>
<div class="sub" style="top:252px">Three things we watch for every coin: the engine's price signal, how smart wallets are positioned, and what options traders pay for. On <b>{names}</b> all three point up.</div>
<div class="grid">{tiles}</div>
<div class="key"><span><b class="g">●</b> Points up</span><span><b class="r">●</b> Points down</span><span><b style="color:#8a847b">●</b> Balanced</span><span>Dashed: not enough data yet</span></div>"""
open('/tmp/claude-0/card/herd.html', 'w').write(page(body, stamp("Derive data", m['generated_at']), "What the data shows today · Not investment advice"))
print(up, both)
