import datetime as dt
W = 1080
def page(body, stamp, foot_right, glow_a="rgba(80,200,150,.30)", glow_b="rgba(240,110,95,.26)"):
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: Manrope; src: url(manrope-latin-variable.woff2) format('woff2'); font-weight: 200 800; }}
@font-face {{ font-family: Chivo Mono; src: url(chivo-mono-latin-variable.woff2) format('woff2'); font-weight: 100 900; }}
* {{ margin: 0; box-sizing: border-box; }}
body {{ width: {W}px; height: {W}px; overflow: hidden; position: relative; color: #f7f3ed; font-family: Manrope;
  background: radial-gradient(760px 560px at 105% 30%, {glow_a}, transparent 62%),
              radial-gradient(720px 560px at -10% 95%, {glow_b}, transparent 62%),
              radial-gradient(640px 420px at 12% -8%, rgba(255,128,40,.22), transparent 65%),
              linear-gradient(160deg, #1c1714 0%, #0f0d0b 55%, #0c0b0a 100%); }}
.grain {{ position: absolute; inset: 0; opacity: .5; background-image: radial-gradient(rgba(255,255,255,.035) 1px, transparent 1px); background-size: 4px 4px; }}
.frame {{ position: absolute; inset: 22px; border-radius: 28px; border: 1px solid rgba(255,255,255,.10);
  background: linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.01)); box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 30px 80px rgba(0,0,0,.45); }}
.top {{ position: absolute; left: 58px; right: 58px; top: 52px; display: flex; justify-content: space-between; align-items: center; }}
.top img {{ height: 40px; }}
.chip {{ font: 500 15px/1 'Chivo Mono'; color: #e4ded5; padding: 10px 16px; border-radius: 999px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.05); }}
.eyebrow {{ position: absolute; left: 58px; top: 138px; font: 700 18px/1 Manrope; letter-spacing: .16em; text-transform: uppercase; color: #ffb27a; }}
h1 {{ position: absolute; left: 58px; right: 58px; top: 172px; font: 800 58px/1.04 Manrope; letter-spacing: -.04em; }}
.g {{ color: #8ff0c6; }} .r {{ color: #ff9d90; }} .n {{ font-family: 'Chivo Mono'; font-weight: 600; letter-spacing: -.06em; }}
.sub {{ position: absolute; left: 58px; right: 70px; font: 500 22px/1.38 Manrope; color: #ece6dd; }}
.sub b {{ color: #fff; }}
.glass {{ border-radius: 20px; border: 1px solid rgba(255,255,255,.12); background: linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.025)); box-shadow: inset 0 1px 0 rgba(255,255,255,.08); }}
.foot {{ position: absolute; left: 58px; right: 58px; bottom: 46px; display: flex; justify-content: space-between; font: 500 14px/1 Manrope; color: #b9b0a4; }}
.foot b {{ font: 600 15px 'Chivo Mono'; color: #f7f3ed; }}
</style></head><body><div class="grain"></div><div class="frame"></div>
<div class="top"><img src="cowboy-lockup-on-dark.svg"><span class="chip">{stamp}</span></div>
{body}
<div class="foot"><span><b>cowboy.trading</b></span><span>{foot_right}</span></div>
</body></html>"""
def stamp(src, ts): return f"{src} · {dt.datetime.utcfromtimestamp(ts).strftime('%-d %b, %H:%M')} UTC"
