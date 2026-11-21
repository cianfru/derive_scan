// The Saloon's Rysk view (the Derive | Rysk switch, builds with VITE_RYSK): one connection to Rysk for the
// chart and the trade panel, Rysk's levels on the coin's chart, and the panel with the picture of the
// settlement and the ticket. Lazy-loaded, so other builds carry none of it.
import { useEffect, useRef, useState } from "react";
import { Info } from "../ui.jsx";
import { useSheetFocus } from "../DecisionSheet.jsx";
import { RYSK } from "../../lib/rysk/config.js";
import { ryskSocket } from "../../lib/rysk/socket.js";
import { ryskCoins, ryskMarket } from "../../lib/rysk/market.js";
import RyskChart from "./RyskChart.jsx";
import RyskTicket from "./RyskTicket.jsx";
import "../../rysk.css";

export default function RyskView({ und, candles, price, nowSec, net = RYSK, socketFactory = ryskSocket, provider, fetchImpl }) {
  const [socket, setSocket] = useState(null);
  const [listing, setListing] = useState(null);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState(null);
  const panelRef = useRef(null), opener = useRef(null);
  useEffect(() => {
    const s = socketFactory();
    setSocket(s);
    let live = true;
    const read = () => Promise.all([s.call("assets"), s.call("inventory"), s.call("caps")])
      .then(([assets, inventory, caps]) => { if (live) { setListing({ assets, inventory, caps }); setError(null); } })
      .catch((e) => { if (live) setError(e); });
    read();
    const t = setInterval(read, 60_000);
    return () => { live = false; clearInterval(t); s.close(); };
  }, [socketFactory]);
  useEffect(() => { setPicked(null); }, [und]);
  const close = () => { setPicked(null); opener.current?.focus?.(); };
  const modal = useSheetFocus(!!picked, panelRef, opener, close, "(max-width: 700px)");

  if (error && !listing) return <div className="bd-empty" role="status"><h2>Rysk is not answering right now.</h2><p>{String(error.message || error)}</p></div>;
  if (!listing) return <p className="status">Reading Rysk's listing…</p>;
  const market = ryskMarket(und, listing, net);
  const here = Number.isFinite(price) ? price : market?.price;
  if (!market) {
    const coins = ryskCoins(listing, net);
    return <div className="bd-empty" role="status"><h2>Rysk lists no {und} options on {net.chainName}.</h2><p>Rysk lists {coins.join(", ")}.</p></div>;
  }
  const minText = `${(Number(market.token.min) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${und}`;
  return (
    <div className="rysk-view">
      <div className="sl-key rk-key">
        <p className="sl-key-mobile">
          <span><i className="rk-sell" aria-hidden="true" />Sell: lock {und}</span>
          <span><i className="rk-buy" aria-hidden="true" />Buy: lock USDC</span>
          <span>About what {minText} pays now</span>
        </p>
        <p className="sl-key-desktop">
          <span><i className="rk-sell" aria-hidden="true" />Sell {und} at a level: lock {und}, get paid now</span>
          <span><i className="rk-buy" aria-hidden="true" />Buy {und} at a level: lock USDC, get paid now</span>
          <span>Each bubble: about what you get now for Rysk's smallest size, {minText}<Info label="About the bubbles">Worked out from the yearly rate Rysk lists for each level and the days left. The firm amount comes from Rysk's makers when you open a bubble. The collateral stays locked until the date, 08:00 UTC; there is no early exit. Rysk's smallest size is set by Rysk.</Info></span>
        </p>
      </div>
      <div className="sl-frame">
        {candles?.length > 1
          ? <RyskChart coin={und} market={market} candles={candles} price={here} nowSec={nowSec} selected={picked}
              onPick={(l) => { opener.current = document.activeElement; setPicked(l); }} />
          : <p className="status">The {und} chart is not available right now.</p>}
        {picked && <div className="sl-backdrop" aria-hidden="true" onClick={close} />}
        {picked && socket && <aside ref={panelRef} className="sl-panel rk-panel" role={modal ? "dialog" : undefined} aria-modal={modal ? "true" : undefined} aria-label="Your Rysk trade" tabIndex={-1}>
          <button type="button" className="text-control sl-close" onClick={close}>Close</button>
          <RyskTicket key={picked.key + picked.isPut} und={und} settleTs={picked.expiry} near={picked.strike} side={picked.isPut ? "no" : "yes"}
            fixedKey={picked.key} socket={socket} listing={listing} net={net} price={here} {...(provider !== undefined ? { provider } : {})} {...(fetchImpl ? { fetchImpl } : {})} />
        </aside>}
      </div>
      <footer className="bd-footer sl-footer"><span>Rysk's listing · HyperEVM · settles Fridays 08:00 UTC · physical settlement</span></footer>
    </div>
  );
}
