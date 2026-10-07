import { useId, useState } from "react";
import { Info, Tabs } from "./ui.jsx";
import { money, signed } from "../lib/questions.js";
import "../rysk-mock.css";

// Illustrative collateral and premiums only; these are not supported-coin or quote data.
const FIGURES = {
  BTC: { price: 85000, quantity: .01, call: 90000, put: 80000, callPremium: 24, putPremium: 22 },
  ETH: { price: 3500, quantity: 1, call: 4000, put: 3000, callPremium: 80, putPremium: 70 },
  HYPE: { price: 40, quantity: 10, call: 45, put: 35, callPremium: 15, putPremium: 12 },
};
const GENERIC = { price: 100, quantity: 1, call: 120, put: 80, callPremium: 3, putPremium: 2.5 };
const usd = (value) => money(value, { cents: true });

/** A discussion mock only. The parent lazy-loads it behind VITE_RYSK_MOCK=1. */
export default function RyskMock({ und = "HYPE" }) {
  const [mode, setMode] = useState("call");
  const id = useId();
  const coin = /^[A-Z0-9]{1,12}$/.test(und) ? und : "HYPE";
  const f = FIGURES[coin] || GENERIC;
  const call = mode === "call", strike = call ? f.call : f.put;
  const premium = call ? f.callPremium : f.putPremium;
  const cash = strike * f.quantity;
  const start = call ? f.price * f.quantity : cash;
  const quantity = `${f.quantity} ${coin}`;
  const prices = call ? [f.price * .8, f.price, strike * 1.2] : [strike * .6, strike * .95, f.price * 1.2];
  return (
    <section className="rysk-mock" aria-labelledby={`${id}-title`}>
      <header className="rm-head"><h3 id={`${id}-title`}>Receive premium</h3><span>Rysk illustration</span></header>
      <Tabs label="Example obligation" value={mode} onChange={setMode} items={[["call", "Sell at a level"], ["put", "Buy at a level"]]} />
      <section className="rm-obligation" aria-label="What you commit">
        <p className="rm-label">You lock until settlement</p>
        <strong>{call ? quantity : usd(cash)}</strong>
        <p className="rm-term">Example term: 7 days from locking the collateral.</p>
        <p>{call
          ? <>Above {money(strike)} at settlement, you sell {quantity} for {usd(cash)}.</>
          : <>Below {money(strike)} at settlement, you buy {quantity} for {usd(cash)}.</>}</p>
        <p className="rm-terms">Physical settlement · No early exit<Info label="About the Rysk obligation">A covered call locks your coin; a cash-secured put locks the cash for a possible coin purchase. Settlement returns coin or cash, rather than the Higher/Lower cash payout. The mock assumes conversion above the call level or below the put level. Exact settlement rules, collateral assets, dates and available coins need confirmation with Rysk. This is an illustration, not a quote.</Info></p>
        <p className="rm-risk">{call ? "Coin value can fall, and gains above the sale level are given up." : "The coin received can be worth less than the cash exchanged."} The premium can be smaller than the loss.</p>
      </section>
      <div className="rm-premium"><div><span>Example premium</span><strong>{usd(premium)}</strong></div><small>Fees not modelled<Info label="About the example premium">Premium is money received for the obligation. It is not the overall profit: the collateral can lose value. These made-up premiums exclude fees. No Rysk price, wallet balance, order or settlement record is read.</Info></small></div>
      <section className="rm-examples" aria-labelledby={`${id}-examples`}>
        <h4 id={`${id}-examples`}>At example settlement</h4>
        <p className="rm-example-reference">Value change from {usd(start)} locked{call ? ` at an illustrative ${coin} price of ${money(f.price)}` : ""}. Premium included; fees excluded.</p>
        <ol>
          {prices.map((price) => {
            const converted = call ? price > strike : price < strike;
            const returnsCoin = call ? !converted : converted;
            const holdings = returnsCoin ? f.quantity * price : cash;
            const change = holdings + premium - start;
            return <li key={price}>
              <div className="rm-scenario-head"><span>{coin} at <b>{money(price)}</b></span><strong className={change >= 0 ? "up" : "down"}>{signed(change)}</strong></div>
              <p>{converted ? (call ? "Coin sold: " : "Coin bought: ") : "Collateral returned: "}<b>{returnsCoin ? quantity : usd(cash)}</b></p>
              <p>Holdings worth {usd(holdings)} + {usd(premium)} premium.</p>
            </li>;
          })}
        </ol>
      </section>
      <p className="rm-disabled" role="note">Made-up figures, not a quote or coin listing. No trade is placed. Rysk funding and execution are not connected.</p>
    </section>
  );
}
