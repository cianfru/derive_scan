// Trader cards: the leaderboard, the day's biggest trades, how smart wallets lean, and who holds what by results.
import { posseName } from "../../lib/posses.js";
import { Avatar, Bars, Card, DOWN, GREY, NAME, TAG, UP, big, codename, dm, fin, icon, join, stamp, usd } from "../kit.jsx";

const STYLE = { income: "sells options for income", directional: "bets on direction", hedger: "hedges a bigger position", occasional: "trades now and then" };
const tsOf = (iso) => Date.parse(`${iso}T23:59:00Z`) / 1000;

// The leaderboard
export function leaderModel(t) {
  const rows = (t?.traders || []).filter((x) => fin(x.option_pnl)).slice(0, 5);
  if (rows.length < 5) return null;
  const directional = (t.traders || []).filter((x) => x.class === "directional")[0];
  return { ts: t.through ? tsOf(t.through) : t.generated_at, rows, total: t.ranked_total, directional };
}

function LeaderView({ m }) {
  const lead = m.rows[0];
  return (
    <Card glow="up" stampText={stamp("Derive trades", m.ts)} eyebrow="Derive options traders · all time"
      title={<>The best options trader on Derive is up <span className="mono g">{big(lead.option_pnl)}</span></>} size="m"
      sub={<>Ranked from every options trade on Derive since 2024, <b>{m.total.toLocaleString("en-US")}</b> wallets, market makers left out. Names are made up from each address, so they stay the same week to week.</>}>
      {m.rows.map((r, i) => (
        <div key={r.address} className="xrow glass">
          <span className="n">{i + 1}</span>
          <Avatar address={r.address} size={46} />
          <div><b>{codename(r.address)}</b><small>{STYLE[r.class] || "trades options"} · wins {Math.round((r.win_rate || 0) * 100)}% of options held to the end</small></div>
          <div className="v" style={{ color: UP }}>{big(r.option_pnl)}<small style={{ display: "block", color: "#b9b0a4" }}>{big(r.premium_traded)} traded</small></div>
        </div>
      ))}
    </Card>
  );
}

const leaderAngles = (m) => {
  const [a] = m.rows;
  const d = m.directional;
  return [
    `The best options trader on ${TAG} is up ${big(a.option_pnl)}. Their style: ${STYLE[a.class] || "options"}, winning ${Math.round(a.win_rate * 100)}% of options held to the end. Out of ${m.total.toLocaleString("en-US")} wallets ranked.`,
    d ? `The best trader on ${TAG} who simply bets on direction: ${codename(d.address)}, up ${big(d.option_pnl)} on ${big(d.premium_traded)} of options traded. Win rate: ${Math.round(d.win_rate * 100)}%. You don't need to win often, you need to win big.` : null,
    (() => {
      const dir = m.rows.filter((r) => r.class === "directional").length;
      return `Top 5 options traders on ${TAG}, all time: ${m.rows.map((r) => big(r.option_pnl)).join(", ")}. ${dir} of them bet on direction; the others sell options for income or hedge. Different games, same leaderboard.`;
    })(),
  ].filter(Boolean);
};

// The day's biggest trades, in plain words
const parse = (inst) => {
  const [und, ymd, strike, type] = inst.split("-");
  const y = Number(ymd.slice(0, 4)), mo = Number(ymd.slice(4, 6)) - 1, d = Number(ymd.slice(6, 8));
  return { und, strike: Number(strike.replace("_", ".")), call: type === "C", expiry: Date.UTC(y, mo, d, 8) / 1000 };
};
function tradeWords(t) {
  const p = parse(t.instrument);
  const at = p.strike >= 100 ? usd(p.strike) : `$${p.strike}`;
  const when = dm(p.expiry);
  if (t.direction === "buy") return p.call ? ["paid", `to bet on ${p.und} above ${at} on ${when}`] : ["paid", `for protection if ${p.und} ends below ${at} on ${when}`];
  return p.call ? ["collected", `to give up ${p.und}'s gains above ${at} on ${when}`] : ["collected", `to buy ${p.und} at ${at} if it ends below on ${when}`];
}
export function plainTrade(t) {
  const [verb, rest] = tradeWords(t);
  return `${verb} ${big(t.premium_usd)} ${rest}`;
}

export function bigTradesModel(flow) {
  const rows = (flow?.large || []).filter((t) => t.kind === "option" && /^[A-Z]+-\d{8}-[\d_]+-[CP]$/.test(t.instrument)).sort((a, b) => b.notional_usd - a.notional_usd).slice(0, 5);
  if (rows.length < 3) return null;
  return { ts: flow.generated_at, rows, count: flow.large.length };
}

function BigTradesView({ m }) {
  const lead = m.rows[0], p = parse(lead.instrument);
  return (
    <Card glow={lead.direction === "buy" === p.call ? "up" : "down"} stampText={stamp("Derive trades", m.ts)} eyebrow="Biggest options trades on Derive · last 24 hours"
      title={<>Someone {tradeWords(lead)[0]} <span className="mono">{big(lead.premium_usd)}</span> {tradeWords(lead)[1]}</>} size="s"
      sub={<>Every big trade has a story. Here are the five largest of the day, translated from option names into what each trader is actually doing.</>}>
      {m.rows.map((t) => {
        const q = parse(t.instrument);
        const up = (t.direction === "buy") === q.call;
        return (
          <div key={t.ts + t.instrument} className="xrow glass">
            <Avatar address={t.wallet} size={42} />
            <div><b>{codename(t.wallet)}</b><small>{plainTrade(t)}</small></div>
            <div className="v" style={{ color: up ? UP : DOWN }}>{big(t.notional_usd)}<small style={{ display: "block", color: "#b9b0a4" }}>of {q.und}</small></div>
          </div>
        );
      })}
    </Card>
  );
}

const bigTradesAngles = (m) => {
  const [a, b] = m.rows;
  return [
    `Biggest options trade on ${TAG} in the last 24 hours: a wallet we call ${codename(a.wallet)} ${plainTrade(a)}. ${big(a.notional_usd)} of ${parse(a.instrument).und} behind it.`,
    b && a.wallet === b.wallet ? `One wallet, the two biggest options trades on ${TAG} today: ${codename(a.wallet)} ${plainTrade(a)}, then ${plainTrade(b)}. When someone does the same thing twice at this size, they mean it.` : null,
    b && a.wallet !== b.wallet ? (tradeWords(a)[0] === tradeWords(b)[0] && parse(a.instrument).call === parse(b.instrument).call && parse(a.instrument).und === parse(b.instrument).und
      ? `The two biggest options trades on ${TAG} today made the same move: one wallet ${plainTrade(a)}; another ${plainTrade(b)}. When big money repeats itself, it's worth a look.`
      : `Two of the day's biggest trades on ${TAG}: one wallet ${plainTrade(a)}; another ${plainTrade(b)}. Same market, different reads.`) : null,
    `Every options trade is a view with a price tag. Today's biggest on ${TAG}, in plain words: someone ${plainTrade(a)}. The top 5:`,
  ].filter(Boolean);
};

// How smart wallets lean, coin by coin
export function smartModel(radar) {
  const rows = Object.entries(radar?.coins || {}).map(([und, c]) => ({ und, w: c.w?.["7d"]?.at(-1) })).filter((r) => r.w && fin(r.w[0]));
  if (rows.length < 3) return null;
  rows.sort((a, b) => b.w[0] - a.w[0]);
  return { ts: radar.generated_at, rows, long: rows.filter((r) => r.w[0] > 0.15).map((r) => r.und), short: rows.filter((r) => r.w[0] < -0.15).map((r) => r.und) };
}

function SmartView({ m }) {
  return (
    <Card glow={m.long.length >= m.short.length ? "up" : "down"} stampText={stamp("Derive positions", m.ts)} eyebrow="Smart wallets · options expiring in 7 days"
      title={<>Smart wallets lean <span className="g">long</span> on {m.long.length} coins, <span className="r">short</span> on {m.short.length}</>}
      sub={<>Smart wallets are the most profitable fifth of Derive traders who bet on direction. This is how their open options add up, from fully short to fully long. Context, not a signal.</>}>
      <Bars signed rows={m.rows.map((r) => ({ label: r.und, sub: `${big(r.w[1])} in play`, icon: icon(r.und), value: r.w[0], text: r.w[0] > 0.15 ? "Long" : r.w[0] < -0.15 ? "Short" : "Balanced", color: r.w[0] > 0.15 ? UP : r.w[0] < -0.15 ? DOWN : GREY }))} />
    </Card>
  );
}

const smartAngles = (m) => [
  `Where the smart money sits on ${TAG} this week: long ${join(m.long) || "nothing"}${m.short.length ? `; short ${join(m.short)}` : ""}. "Smart" = the most profitable fifth of traders who bet on direction. Context, not a signal.`,
  `We track the most profitable options traders on ${TAG} and add up what they hold. Right now they lean long on ${m.long.length} coins and short on ${m.short.length}. Following them blindly is not the point; knowing where they stand is.`,
];

// How each results group holds one coin
export function cohortModel(w, und) {
  const rows = (w?.cohorts?.pnl || []).map((c) => ({ code: c.name, name: posseName(c.name), wallets: c.wallets, r: c["7d"] })).filter((c) => c.r && fin(c.r.net_delta_usd) && c.r.positions > 0);
  if (rows.length < 3) return null;
  const winners = rows.filter((c) => ["Money Printer", "Smart Money", "Grinder", "Humble Earner"].includes(c.code));
  const losers = rows.filter((c) => ["Semi-Rekt", "Full Rekt", "Giga-Rekt"].includes(c.code));
  const sum = (xs) => xs.reduce((t, c) => t + c.r.net_delta_usd, 0);
  return { und, ts: w.generated_at, rows, win: sum(winners), lose: sum(losers), biggest: [...rows].sort((a, b) => Math.abs(b.r.net_delta_usd) - Math.abs(a.r.net_delta_usd))[0] };
}

const side = (v) => (v >= 0 ? "long" : "short");

function CohortView({ m }) {
  const split = Math.sign(m.win) !== Math.sign(m.lose);
  return (
    <Card glow={split ? "mixed" : m.win >= 0 ? "up" : "down"} stampText={stamp("Derive positions", m.ts)} eyebrow={`${NAME[m.und] || m.und} · options expiring in 7 days, by trader results`}
      title={split
        ? <>Derive's winners are <span className={m.win >= 0 ? "g" : "r"}>{side(m.win)}</span> {m.und}. Its biggest losers are <span className={m.lose >= 0 ? "g" : "r"}>{side(m.lose)}</span></>
        : <>Winners and losers on Derive are both {side(m.win)} {m.und}</>} size="m"
      sub={<>Every wallet is grouped by its all-time options results, from Legend to Boot Hill. The biggest bet comes from <b>{m.biggest.name}</b>: {big(Math.abs(m.biggest.r.net_delta_usd))} {side(m.biggest.r.net_delta_usd)} across {m.biggest.r.positions} positions.</>}>
      <Bars signed rows={m.rows.map((c) => ({ label: c.name, sub: `${c.wallets.toLocaleString("en-US")} wallets`, value: Math.sign(c.r.net_delta_usd) * Math.log10(1 + Math.abs(c.r.net_delta_usd)), text: big(c.r.net_delta_usd) }))} />
    </Card>
  );
}

const cohortAngles = (m) => {
  const split = Math.sign(m.win) !== Math.sign(m.lose);
  return [
    split ? `On ${TAG}, the most profitable options traders are ${side(m.win)} ${m.und} (${big(Math.abs(m.win))}). The ones who've lost the most are ${side(m.lose)} (${big(Math.abs(m.lose))}). We know which group we'd rather sit next to.` : `Winners and losers on ${TAG} agree for once: both ${side(m.win)} ${m.und}. Winners ${big(Math.abs(m.win))}, losers ${big(Math.abs(m.lose))}.`,
    `Biggest ${m.und} bet on ${TAG} this week, by trader group: ${m.biggest.name}, ${big(Math.abs(m.biggest.r.net_delta_usd))} ${side(m.biggest.r.net_delta_usd)}. Every wallet is named for its results, from Legend to Boot Hill.`,
  ];
};

export const TRADERS = [
  { id: "leaders", group: "Traders", title: "Leaderboard", files: () => ["traders.json"], model: ([t]) => leaderModel(t), View: LeaderView, angles: leaderAngles },
  { id: "bigtrades", group: "Traders", title: "Biggest trades, 24h", files: () => ["flow.json"], model: ([f]) => bigTradesModel(f), View: BigTradesView, angles: bigTradesAngles },
  { id: "smart", group: "Traders", title: "Smart wallets' lean", files: () => ["radar.json"], model: ([r]) => smartModel(r), View: SmartView, angles: smartAngles },
  { id: "cohorts", group: "Traders", title: "Winners vs losers", params: ["BTC", "ETH", "HYPE"], files: (u) => [`wallets/${u}.json`], model: ([w], u) => cohortModel(w, u), View: CohortView, angles: cohortAngles },
];
