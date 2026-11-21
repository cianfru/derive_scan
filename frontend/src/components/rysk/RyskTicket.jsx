// Receive premium on Rysk (HyperEVM), from the user's own wallet: pick selling at a level (lock the coin)
// or buying at a level (lock USDC), a Friday date, a level and an amount; Rysk's makers answer with a
// firm premium; one approval (only when needed) and one signature lock the collateral and pay the
// premium into the wallet. Every step is timed. Lazy-loaded by the Saloon in builds with VITE_RYSK set.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { getAddress } from "ethers";
import { Info, Tabs } from "../ui.jsx";
import { money } from "../../lib/questions.js";
import { DATA_URL } from "../../lib/data.js";
import { mainnetSwitch } from "../../lib/trade/live.js";
import { findProvider } from "../../lib/trade/wallet.js";
import { RYSK, ryskPilot } from "../../lib/rysk/config.js";
import { ryskSocket } from "../../lib/rysk/socket.js";
import { capsRoom, nearestDate, nearestLevel, ryskMarket } from "../../lib/rysk/market.js";
import { E18, collateralUnits, contracts, premiumUnits, quoteFits, requestParams, snapSize, strikeE8, toNumber } from "../../lib/rysk/order.js";
import { STEPS, WHYPE, lockAndReceive, wrapHype } from "../../lib/rysk/trade.js";
import { hyperBalances } from "../../lib/rysk/rpc.js";
import { saveRyskTrade } from "../../lib/rysk/records.js";
import FridayPicture from "./FridayPicture.jsx";
import "../../rysk.css";

const ZERO = "0x0000000000000000000000000000000000000000";
const SHOWN = 6;
const usd = (v) => money(v, { cents: true });
const day = (ts) => new Date(ts * 1000).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const seconds = (ms) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
const amountText = (units) => { const s = (Number(units) / 1e18).toFixed(6).replace(/\.?0+$/, ""); return s || "0"; };
const short = (a) => `${a.slice(0, 4)}…${a.slice(-2)}`;
const pctFrom = (strike, index) => (index > 0 ? `${strike >= index ? "+" : ""}${(((strike - index) / index) * 100).toFixed(1)}%` : "");

/** The published mainnet switch, read afresh; a failed read counts as off. */
async function switchOpen() {
  try {
    const r = await fetch(`${DATA_URL}questions/index.json`, { cache: "no-store" });
    return r.ok && mainnetSwitch(await r.json()) === "on";
  } catch { return false; }
}

/**
 * `socket` and `listing` may come from the Rysk chart (one connection for both); `fixedKey` holds the
 * ticket on the level tapped there, without its own date and level pickers.
 */
export default function RyskTicket({ und, settleTs, near, side, net = RYSK, socketFactory = ryskSocket, socket: shared = null, listing: sharedListing = null, fixedKey = null, price: shownPrice = null, provider: injected, fetchImpl, now = () => Date.now() }) {
  const id = useId();
  const sock = useRef(null);
  const [ownListing, setListing] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [mode, setMode] = useState(side === "no" ? "put" : "call");
  const [expiry, setExpiry] = useState(null);
  const [levelKey, setLevelKey] = useState(null);
  const [all, setAll] = useState(false);
  const [draft, setDraft] = useState("");
  const [wallet, setWallet] = useState(null);
  const [walletError, setWalletError] = useState(null);
  const [balances, setBalances] = useState(null);
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const [clock, setClock] = useState(() => Math.floor(now() / 1000));
  const [run, setRun] = useState({ phase: "idle", steps: {} });
  const [positions, setPositions] = useState(null);
  const quoteRef = useRef(null), reqRef = useRef(null), sentAt = useRef(0), firstAsk = useRef(0);
  const [wrap, setWrap] = useState({ phase: "idle" });
  const provider = injected === undefined ? findProvider() : injected;

  // One socket while the ticket is on screen (or the chart's): the listing on open and every minute after.
  useEffect(() => {
    const s = shared || socketFactory();
    sock.current = s;
    let live = true, timer = null;
    const read = () => Promise.all([s.call("assets"), s.call("inventory"), s.call("caps")])
      .then(([assets, inventory, caps]) => { if (live) { setListing({ assets, inventory, caps }); setLoadError(null); } })
      .catch((e) => { if (live) setLoadError(e); });
    if (!sharedListing) { read(); timer = setInterval(read, 60_000); }
    const off = s.on("request", (f) => {
      const req = reqRef.current;
      if (f.error) { setQuoteError(f.error.message || "Rysk has no premium for this now."); return; }
      if (req && quoteFits(f.result, req, Math.floor(Date.now() / 1000))) { quoteRef.current = f.result; setQuote(f.result); setQuoteError(null); }
    });
    return () => { live = false; clearInterval(timer); off(); if (!shared) s.close(); sock.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socketFactory, shared]);
  const listing = sharedListing || ownListing;

  useEffect(() => { const t = setInterval(() => setClock(Math.floor(now() / 1000)), 1000); return () => clearInterval(t); }, [now]);

  const market = useMemo(() => (listing ? ryskMarket(und, listing, net) : null), [listing, und, net]);
  const date = useMemo(() => market && (market.dates.find((d) => d.expiry === expiry) || nearestDate(market, settleTs)), [market, expiry, settleTs]);
  const levels = date ? date[mode] : [];
  const fixed = fixedKey && market ? market.dates.flatMap((d) => [...d.call, ...d.put]).find((l) => l.key === fixedKey && l.isPut === (side === "no")) : null;
  const level = fixed || levels.find((l) => l.key === levelKey) || nearestLevel(levels, Number.isFinite(near) ? near : market?.price);
  const token = market?.token;
  const size = token && snapSize(contracts(draft || amountText(token.min)), token.min, token.max);
  const typed = contracts(draft);
  const req = useMemo(() => (level && size ? requestParams(level, size, wallet || ZERO, net, level.isPut ? token.symbol : level.collateralToken.symbol) : null), [level, size, wallet, net, token]);
  const reqKey = req ? JSON.stringify({ ...req, taker: null }) : "";
  const lock = level && size ? collateralUnits(size, level) : null;
  const room = level && listing ? capsRoom(listing.caps, level, und) : null;
  const notional = level && size ? (size * strikeE8(level) * 10n ** 10n) / E18 : null;
  const overCap = room && size && ((room.contracts != null && size > room.contracts) || (room.notional != null && notional > room.notional));

  // A firm premium while the inputs hold still; asked again before it lapses, as Rysk's page does.
  useEffect(() => {
    reqRef.current = req;
    quoteRef.current = null;
    setQuote(null);
    setQuoteError(null);
    if (!req || overCap || !sock.current) return undefined;
    firstAsk.current = 0;
    const ask = () => { sentAt.current = Date.now(); if (!firstAsk.current) firstAsk.current = sentAt.current; sock.current?.send("request", req).catch((e) => setQuoteError(e.message)); };
    const first = setTimeout(ask, 500);
    const again = setInterval(() => {
      const q = quoteRef.current, t = Math.floor(Date.now() / 1000);
      if (!q ? Date.now() - sentAt.current >= 15_000 : Number(q.validUntil) - 20 <= t) ask();
    }, 3000);
    return () => { clearTimeout(first); clearInterval(again); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey, overCap]);

  const refreshWallet = async (address) => {
    if (!address || !level) return;
    const tokens = [...new Set([token.address, net.usdc].map((a) => a.toLowerCase()))];
    hyperBalances(net.rpc, address, tokens, fetchImpl).then(setBalances).catch(() => setBalances(null));
    sock.current?.call("positions", { address }).then((p) => setPositions(Array.isArray(p) ? p : [])).catch(() => {});
  };
  useEffect(() => { if (wallet) refreshWallet(wallet); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [wallet, token?.address]);
  useEffect(() => {
    if (!provider?.on) return undefined;
    const changed = (accounts) => { const a = accounts?.[0]; setWallet(a ? getAddress(a) : null); setBalances(null); setPositions(null); };
    provider.on("accountsChanged", changed);
    return () => provider.removeListener?.("accountsChanged", changed);
  }, [provider]);

  async function connect() {
    setWalletError(null);
    if (!provider) { setWalletError("No wallet found in this browser."); return; }
    try {
      const [a] = await provider.request({ method: "eth_requestAccounts" });
      setWallet(a ? getAddress(a) : null);
    } catch (e) { setWalletError(e?.code === 4001 ? "Your wallet declined." : "Your wallet stopped the request."); }
  }

  const pilotOk = !net.real || ryskPilot(wallet);
  async function allow() {
    if (!net.real) return true;
    if (!ryskPilot(wallet)) return "Trading on Rysk is open to pilot wallets first.";
    return (await switchOpen()) || "Trading is paused right now.";
  }
  const waitQuote = () => new Promise((resolve, reject) => {
    const until = Date.now() + 20_000;
    const tick = () => {
      const q = quoteRef.current, t = Math.floor(Date.now() / 1000);
      if (q && quoteFits(q, reqRef.current, t, 5)) return resolve(q);
      if (Date.now() > until) return reject(Object.assign(new Error("No premium from Rysk right now."), { code: "rysk_no_quote" }));
      setTimeout(tick, 250);
    };
    tick();
  });

  async function trade() {
    if (!wallet || !quote || run.phase === "running") return;
    const shown = premiumUnits(quote);
    setRun({ phase: "running", steps: {} });
    const mark = (k, s) => setRun((r) => ({ ...r, steps: { ...r.steps, [k]: s } }));
    const base = { wallet, und, isPut: level.isPut, strike: level.strike, expiry: level.expiry, quantity: size.toString(), collateral: level.collateral, network: net.name, placedAt: Date.now() };
    try {
      const res = await lockAndReceive({ provider, wallet, net, socket: sock.current, level, quote: waitQuote, allow, shownPremium: shown, onStep: mark, ...(fetchImpl ? { fetchImpl } : {}) });
      saveRyskTrade(net.name, { ...base, hash: res.hash, premium: res.premium.toString(), gasFee: res.gasFee.toString(), received: res.received.toString(), apr: res.quote.apy ?? null, timings: res.timings, totalMs: res.totalMs, outcome: "filled" });
      setRun((r) => ({ ...r, phase: "done", result: res }));
      refreshWallet(wallet);
    } catch (e) {
      if (e.unknown) saveRyskTrade(net.name, { ...base, hash: e.hash || null, timings: e.timings, totalMs: e.totalMs, outcome: "unknown" });
      setRun((r) => ({ ...r, phase: "failed", error: e }));
    }
  }

  if (loadError && !listing) return <section className="rysk-ticket"><p className="q-note warn">Rysk is not answering right now.<Info label="Details">{String(loadError.message || loadError)}</Info></p></section>;
  if (!listing) return <section className="rysk-ticket"><p className="status">Reading Rysk's listing…</p></section>;
  if (!market) return <section className="rysk-ticket"><p className="q-note">Rysk lists no {und} options on {net.chainName} now.</p></section>;

  const coin = und;
  const premium = quote ? toNumber(premiumUnits(quote), 6) : null;
  const left = quote ? Number(quote.validUntil) - clock : null;
  const lockText = lock == null ? "" : level.isPut ? `${usd(toNumber(lock, 6))} ${level.collateralToken.symbol}` : `${amountText(size)} ${token.symbol}`;
  const sizeText = size ? `${amountText(size)} ${coin}` : "";
  const ordered = mode === "call" ? levels : [...levels].reverse();
  const shownLevels = all ? ordered : ordered.slice(0, SHOWN);
  const needCollateral = balances && lock != null ? balances.tokens[(level.isPut ? level.collateral : token.address).toLowerCase()] : null;
  const short_ = needCollateral != null && lock != null && needCollateral < lock;
  // Selling HYPE locks WHYPE: offer to wrap what is missing when the wallet holds enough HYPE (with gas to spare).
  const wrapNeed = short_ && !level.isPut && token.address.toLowerCase() === WHYPE ? lock - needCollateral : null;
  const canWrap = wrapNeed != null && balances?.hype != null && balances.hype > wrapNeed + 10n ** 16n;
  const silent = !quote && !quoteError && firstAsk.current && Date.now() - firstAsk.current > 20_000;
  async function doWrap() {
    setWrap({ phase: "running" });
    try { await wrapHype({ provider, wallet, net, units: wrapNeed }); setWrap({ phase: "idle" }); refreshWallet(wallet); }
    catch (e) { setWrap({ phase: "failed", message: e?.source === "wallet" || e?.code === 4001 ? "Your wallet declined." : e.message }); }
  }
  const running = run.phase === "running";
  const canTrade = wallet && quote && left > 5 && !overCap && pilotOk && !running && run.phase !== "done" && !short_;

  return (
    <section className="rysk-ticket" aria-labelledby={`${id}-t`}>
      <header className="rk-head">
        <h3 id={`${id}-t`}>{fixed ? `${fixed.isPut ? "Buy" : "Sell"} ${coin} at ${money(fixed.strike)}` : `Receive premium on ${coin}`}</h3>
        <span>{fixed ? `${day(fixed.expiry)}, 08:00 UTC · ` : ""}Rysk · {net.chainName}{net.real ? " · Real money" : " · Testnet"}</span>
      </header>
      {!fixed && <><Tabs label="What you lock" value={mode} onChange={(m) => { setMode(m); setLevelKey(null); }} items={[["call", `Sell ${coin} at a level`], ["put", `Buy ${coin} at a level`]]} />
      <div className="rk-dates" role="group" aria-label="Settlement date">
        {market.dates.map((d) => <button key={d.expiry} type="button" className="text-control" aria-pressed={d.expiry === date.expiry} onClick={() => { setExpiry(d.expiry); setLevelKey(null); }}>{day(d.expiry)}</button>)}
      </div>
      <div className="rk-levels" role="radiogroup" aria-label="Level">
        <div className="rk-levels-head"><span>Level</span><span>From now</span><span>APR<Info label="About APR">The yearly rate Rysk lists for this level: the premium as a share of what you lock, scaled to a year. The firm premium below is what you receive.</Info></span></div>
        {shownLevels.map((l) => (
          <button key={l.key} type="button" role="radio" aria-checked={l.key === level?.key} className="rk-level" onClick={() => setLevelKey(l.key)}>
            <span className="mono">{money(l.strike)}</span><span className="mono">{pctFrom(l.strike, market.price)}</span><span className="mono">{l.apr != null ? `${l.apr.toFixed(1)}%` : "—"}</span>
          </button>
        ))}
        {ordered.length > SHOWN && <button type="button" className="text-control rk-all" onClick={() => setAll(!all)}>{all ? "Fewer levels" : `All ${ordered.length} levels`}</button>}
        {!levels.length && <p className="q-note">Rysk lists no {mode === "call" ? "sale" : "purchase"} levels for this date.</p>}
      </div></>}
      {level && <>
        <div className="rk-amount">
          <label htmlFor={`${id}-a`} className="label">Amount, {coin}<Info label="About the amount">Rysk trades in steps of {amountText(token.min)} {coin}, from {amountText(token.min)} up to {amountText(token.max)}.</Info></label>
          <input id={`${id}-a`} inputMode="decimal" className="mono" value={draft || amountText(token.min)} onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ""))} />
          <span className="q-quick">{[1n, 2n, 5n].map((m) => token.min * m <= token.max && <button key={String(m)} type="button" className="text-control" aria-pressed={size === token.min * m} onClick={() => setDraft(amountText(token.min * m))}>{amountText(token.min * m)}</button>)}</span>
          {typed != null && size != null && typed !== size && <p className="rk-snap">Rysk takes {amountText(size)} {coin}.</p>}
        </div>
        <section className="rk-obligation" aria-label="What you commit">
          <p className="rk-label">You lock until {day(level.expiry)}, 08:00 UTC</p>
          <strong className="mono">{lockText}</strong>
          <FridayPicture coin={coin} level={level} size={Number(size) / 1e18} sizeText={sizeText} lockUsd={level.isPut ? toNumber(lock, 6) : null}
            premium={premium} price={Number.isFinite(shownPrice) ? shownPrice : market.price} when={`${day(level.expiry)}, 08:00 UTC`} />
          <p className="rk-terms">Physical settlement · No early exit<Info label="About the obligation">The collateral stays locked until settlement, about two hours after 08:00 UTC on the date; there is no early exit. The premium is yours either way, and it can be smaller than a move in {coin}'s price.</Info></p>
          {overCap && <p className="q-note warn">Larger than Rysk takes on {coin} right now.</p>}
        </section>
        <div className="rk-premium" aria-live="polite">
          <div><span>Premium now</span><strong className="mono">{premium != null ? usd(premium) : "—"}</strong></div>
          <small>{quote ? <>{quote.apy != null && <>{Number(quote.apy).toFixed(1)}% APR · </>}valid {Math.max(0, left)} s</> : quoteError ? <>{quoteError}</> : silent ? "No premium from Rysk's makers right now." : "Asking Rysk's makers…"}<Info label="About the premium">A firm price from Rysk's makers for exactly this trade, paid in USDC into your wallet when the trade goes through. Rysk takes a small gas fee from it, shown before you sign. No fee goes to Cowboy.</Info></small>
        </div>
      </>}

      <div className="rk-wallet">
        {wallet
          ? <p>Wallet <span className="mono">{short(wallet)}</span>{balances && <> · <span className="mono">{balances.tokens[token.address.toLowerCase()] != null ? amountText(balances.tokens[token.address.toLowerCase()] * 10n ** BigInt(18 - token.decimals)) : "—"}</span> {token.symbol} · <span className="mono">{balances.tokens[net.usdc.toLowerCase()] != null ? usd(toNumber(balances.tokens[net.usdc.toLowerCase()], 6)) : "—"}</span> USDC · <span className="mono">{balances.hype != null ? (Number(balances.hype) / 1e18).toFixed(3) : "—"}</span> HYPE</>}</p>
          : <button type="button" className="btn" onClick={connect}>Connect wallet</button>}
        {walletError && <p className="q-note warn">{walletError}</p>}
        {short_ && <p className="q-note warn">Your wallet holds less {level.isPut ? level.collateralToken.symbol : token.symbol} on {net.chainName} than this locks.</p>}
        {canWrap && <button type="button" className="btn rk-wrap" disabled={wrap.phase === "running"} onClick={doWrap}>{wrap.phase === "running" ? "Wrapping…" : `Wrap ${amountText(wrapNeed)} HYPE to WHYPE`}</button>}
        {wrap.phase === "failed" && <p className="q-note warn">{wrap.message}</p>}
        {wallet && !pilotOk && <p className="q-note">Trading on Rysk is open to pilot wallets first.</p>}
      </div>

      {wallet && <button type="button" className="btn primary rk-go" disabled={!canTrade} onClick={trade}>{premium != null ? `Lock ${lockText} and receive ${usd(premium)}` : "Waiting for a premium"}</button>}

      {run.phase !== "idle" && <ol className="rk-steps" aria-label="Progress">
        {STEPS.map(([k, label]) => { const s = run.steps[k]; return (
          <li key={k} className={s?.status || "todo"}><span>{label}</span><span className="mono">{s?.status === "skipped" ? "not needed" : s?.ms != null ? seconds(s.ms) : s?.status === "active" ? "…" : ""}</span></li>
        ); })}
      </ol>}
      {run.phase === "done" && <p className="rk-done">Done in <b className="mono">{seconds(run.result.totalMs)}</b>. <b className="mono">{usd(toNumber(run.result.received, 6))}</b> received after Rysk's gas fee of <span className="mono">{usd(toNumber(run.result.gasFee, 6))}</span>. <a href={`${net.explorer}/tx/${run.result.hash}`} target="_blank" rel="noreferrer">View the trade</a></p>}
      {run.phase === "failed" && <p className="q-note warn">{run.error?.message || "The trade did not go through."}{run.error?.timings && <> ({seconds(run.error.totalMs || 0)})</>}{!run.error?.unknown && <> <button type="button" className="text-control" onClick={() => setRun({ phase: "idle", steps: {} })}>Try again</button></>}</p>}

      {positions?.length > 0 && <section className="rk-positions" aria-label="Your Rysk positions">
        <h4>Your Rysk positions</h4>
        <ul>{positions.slice(0, 8).map((p, i) => (
          <li key={`${p.address || ""}${p.expiry}${p.strike}${i}`}><span>{p.symbol} {p.isPut ? "buy" : "sell"} at <span className="mono">{money(Number(BigInt(p.strike || 0)) / 1e18)}</span></span><span>{p.expiry ? day(Number(p.expiry)) : ""}</span><span className="mono">{p.premium ? usd(Number(BigInt(p.premium)) / 1e18) : ""}</span></li>
        ))}</ul>
      </section>}
      <p className="rk-foot">Rysk's makers quote and Rysk sends the trade; your wallet signs. No fee goes to Cowboy.</p>
    </section>
  );
}
