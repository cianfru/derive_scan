import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/data.js";
import { usd, ago } from "../lib/format.js";
import { Plate, Tabs, Loading, Failed, Lead } from "../components/ui.jsx";
import MarketResearchHeader from "../components/MarketResearchHeader.jsx";
import { flowLead } from "../lib/takeaway.js";
import { FlowCoverage } from "../components/AnalyticalDetails.jsx";
import FlowSummary from "../components/FlowSummary.jsx";
import WalletTag from "../components/WalletTag.jsx";
import { TYPE as CLASS } from "../lib/traders.js";
import { sentence, stories, WALLET_WORD } from "../lib/flowStories.js";
import "../flow-page.css";

const CLASS_INFO = "Wallet types from every trade on Derive since December 2023. Directional traders who are in profit on options that have expired are ranked: Top (best fifth), Smart (the best 50, or every Top wallet when Top is larger), Profitable (the rest in profit). Directional: taking a view, not in profit. Income: mostly sells out-of-the-money options. Hedger: offsets its options with perps. Occasional: too few trades to tell. Market makers are left out.";
const CAP = 12;
const tone = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");

function useSampleSize() {
  const [small, setSmall] = useState(() => typeof matchMedia === "function" && matchMedia("(max-width: 680px)").matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia("(max-width: 680px)");
    const update = () => setSmall(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return small ? 5 : CAP;
}

function Kind({ c }) {
  return c ? <span className={c === "top" || c === "smart" ? "tier-tag" : "dim"}>{CLASS[c] || c}</span> : <span className="faint">—</span>;
}

function Who({ w, ranked }) {
  const tag = <WalletTag address={w} size={18} />;
  return ranked ? <Link to={`/trader/${w.toLowerCase()}`} onClick={(e) => e.stopPropagation()}>{tag}</Link> : tag;
}

/** A perp fill as a story: its notional is the money at stake. */
function perpStory(t) {
  return { key: `${t.wallet}-${t.ts}-${t.instrument}`, wallet: t.wallet, und: t.underlying, kind: t.class, who: WALLET_WORD[t.class] || null,
    ranked: t.ranked, ts: t.ts / 1000, lastTs: t.ts / 1000, text: `${t.direction === "buy" ? "bought" : "sold"} ${t.underlying} perpetuals`,
    detail: `follows ${t.underlying}'s price, no end date`, money: Number(t.notional_usd) || 0, perp: true, times: 1 };
}

/** One trade as a sentence: who, what in plain words (the legs and the coin value they cover under it), the money
 * paid or collected, and when (the last time, for a repeated trade). */
function Story({ s }) {
  const covers = !s.perp && s.notional > 0 ? ` · covers ${usd(s.notional)} of ${s.und}` : "";
  return (
    <li className="fl-story">
      <span className="fs-who"><Who w={s.wallet} ranked={s.ranked} />{s.who && <small className={s.kind === "top" || s.kind === "smart" ? "fs-smart" : undefined}>{s.who}</small>}</span>
      <span className="fs-what">
        <span><Link to={`/coin/${s.und}#${s.perp ? "regime" : "options"}`}>{sentence(s.text)}</Link>{s.times > 1 && <b className="fs-times" title={`Traded ${s.times} times within 30 minutes`}>{"\u00a0"}×{s.times}</b>}</span>
        {s.detail && <small>{s.detail}{covers}</small>}
      </span>
      <span className="fs-money"><small>{s.perp ? "worth" : s.paid ? "paid" : "collected"}</small><b>{usd(s.money)}</b></span>
      <span className="fs-time">{ago(s.lastTs ?? s.ts)}</span>
    </li>
  );
}

export default function Flow() {
  const { data, error } = useData("flow.json", 2 * 60_000);
  const [selected, setSelected] = useState("all");
  const [kind, setKind] = useState("option");
  const [order, setOrder] = useState("money");
  const [all, setAll] = useState(false);
  const [allWallets, setAllWallets] = useState(false);
  const [view, setView] = useState("trades");
  const [focusRequest, setFocusRequest] = useState(0);
  const resultRef = useRef(null);
  const cap = useSampleSize();
  useEffect(() => {
    if (!focusRequest) return;
    resultRef.current?.focus({ preventScroll: true });
    resultRef.current?.scrollIntoView?.({ behavior: typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }, [focusRequest]);
  if (error && !data) return <div className="wrap page"><Failed error={error} /></div>;
  if (!data) return <div className="wrap page"><Loading /></div>;
  const inMarket = data.large.filter((t) => selected === "all" || t.underlying === selected);
  // Options as trades (legs sent together grouped, repeats merged), perps as single fills; largest money first.
  const matching = kind === "option" ? stories(inMarket, order)
    : inMarket.filter((t) => t.kind === "perp").map(perpStory).sort(order === "latest" ? (a, b) => b.ts - a.ts : (a, b) => b.money - a.money);
  const large = all ? matching : matching.slice(0, cap);
  const wallets = allWallets ? data.wallets : data.wallets.slice(0, cap);
  const showTrades = () => { setView("trades"); setFocusRequest((n) => n + 1); };
  return (
    <div className="wrap page people-page market-research-page flow-page research-refined">
      <MarketResearchHeader error={error} title="Flow" description="Which way options money points, and the largest trades, over 24 hours."
        info="The money by market and the active wallets cover every recorded trade of the last 24 hours. Choosing a market, options or perpetuals filters only the largest trades below."
        meta={<FlowCoverage coverage={data.coverage} as="span" />} />
      <Lead lead={flowLead(data)} />
      <Plate title="Which way options money points" className="fl-premium-panel" bodyClass="flush">
        <FlowSummary data={data} selected={selected} onSelect={(u) => { setSelected(u); setAll(false); }}
          selectionCount={matching.length} selectionKind={kind === "option" ? "option trades" : kind === "perp" ? "perpetual trades" : "trades"} onViewTrades={showTrades} />
      </Plate>
      <div className="fl-view-switch"><Tabs label="Flow detail" value={view} onChange={setView} items={[["trades", "Large trades"], ["wallets", "Active wallets"]]} /></div>
      {view === "trades" ? <Plate title={<span ref={resultRef} tabIndex={-1}>Large trades</span>} className="fl-trades-panel" bodyClass="flush"
        info={"The largest trades of the last 24 hours across all markets: options that cost or paid at least $2,000 or cover at least $100,000 of the coin (up to 80 legs, chosen by money), perpetuals of at least $25,000. Options one wallet traded together read as one trade, with every leg of the package; the same trade repeated within 30 minutes reads as one line with its count. The figure is the money paid or collected after every leg. Perpetuals follow the coin's price with no end date: a buyer gains when it rises, a seller when it falls. " + CLASS_INFO}
        right={<>
          {selected !== "all" && <button className="text-control" onClick={() => { setSelected("all"); setAll(false); }}>{selected} · Clear</button>}
          <Tabs label="Kind" value={kind} onChange={(k) => { setKind(k); setAll(false); }} items={[["option", "Options"], ["perp", "Perpetuals"]]} />
          <i className="fl-tab-sep" aria-hidden="true" />
          <Tabs label="Order" value={order} onChange={setOrder} items={[["money", "Most money"], ["latest", "Latest"]]} />
        </>}>
        <div className="fl-table-context" role="status">
          <span>{selected === "all" ? "All markets" : selected} · <b>{large.length}</b> of <b>{matching.length}</b> {kind === "option" ? "trades" : "perpetual trades"}</span>
        </div>
        <ol className="fl-stories">
          {large.map((s) => <Story key={s.key} s={s} />)}
          {!large.length && <li className="faint fl-empty">No large {kind === "option" ? "option" : "perp"} trades recorded{selected === "all" ? "" : ` on ${selected}`} in the last 24 hours.</li>}
        </ol>
        {(matching.length > cap || all) && <button className="btn lb-more" onClick={() => setAll((value) => !value)}>{all ? "Show fewer trades" : `Show all ${matching.length} trades`}</button>}
      </Plate> : <Plate title="Most active wallets" className="fl-wallets-panel" bodyClass="flush" right={<span className="fl-scope">All markets · 24h</span>}
        info={"Trading and realised profit and loss per wallet from Derive's public trades over 24 hours. Options size is the coin value the options cover; options cash in/out is what the wallet received for options sold minus what it paid for options bought. " + CLASS_INFO}>
        <div className="fl-table-context"><span>Most active in the recorded window</span><span><b>{wallets.length}</b> of <b>{data.wallets.length}</b> wallets</span></div>
        <table className="grid flow-table wallets-table">
          <thead><tr><th scope="col">Wallet</th><th scope="col">Type</th><th scope="col" className="num">Perpetuals traded</th><th scope="col" className="num">Options size</th><th scope="col" className="num" title="Received for options sold minus paid for options bought">Options cash in/out</th><th scope="col" className="num">Realised P&amp;L</th></tr></thead>
          <tbody>
            {wallets.map((w) => {
              const net = w.premium_sold_usd - w.premium_bought_usd;
              return (
                <tr key={w.wallet} className="fw-row">
                  <td className="fw-who"><Who w={w.wallet} ranked={w.ranked} /></td>
                  <td className="fw-kind" data-k="Type"><Kind c={w.class} /></td>
                  <td className="num fw-perp" data-k="Perpetuals traded">{usd(w.perp_notional_usd)}</td>
                  <td className="num fw-opt" data-k="Options size">{usd(w.option_notional_usd)}</td>
                  <td className={`num fw-net ${tone(net)}`} data-k="Options cash in/out">{w.premium_bought_usd || w.premium_sold_usd ? usd(net) : <span className="faint">—</span>}</td>
                  <td className={`num hero fw-pnl ${tone(w.realized_pnl_usd)}`} data-k="Realised P&L">{usd(w.realized_pnl_usd)}</td>
                </tr>);
            })}
            {!wallets.length && <tr><td colSpan={6} className="faint fl-empty"><span aria-label="No recorded active wallets">—</span></td></tr>}
          </tbody>
        </table>
        {(data.wallets.length > cap || allWallets) && <button className="btn lb-more" onClick={() => setAllWallets((value) => !value)}>{allWallets ? "Show fewer wallets" : `Show all ${data.wallets.length} wallets`}</button>}
      </Plate>}
    </div>
  );
}
