import { useState } from "react";
import { useData } from "../../lib/data.js";
import { canTrade, useSeat } from "../../lib/trade/seat.js";
import { ConnectStep, FundStep, TermsStep } from "./SeatSetup.jsx";
import ApproveCowboy, { SeatLine } from "./ApproveCowboy.jsx";
import TradeTicket from "./TradeTicket.jsx";
import "../../trade.css";

/**
 * Saloon stage 2 beside stage 1: connect, agree to Derive's terms, fund the Saloon account, approve
 * Cowboy, then the one-tap ticket. "Place by hand" always shows stage 1's ticket. Loaded only in
 * builds with VITE_SALOON_TRADE on.
 */
export default function TradePanel({ und, question, answer, level, sideKey, board, t, closing = false, fallback }) {
  const seat = useSeat();
  const [byHand, setByHand] = useState(false);
  const { data: index } = useData("questions/index.json");
  if (closing || !canTrade(und)) return fallback;
  const ethUsd = index?.coins?.find((c) => c.und === "ETH")?.index;
  const step = {
    no_wallet: <ConnectStep />, disconnected: <ConnectStep />, terms: <TermsStep />,
    fund: <FundStep ethUsd={ethUsd} />, approve: <ApproveCowboy />,
    ready: <TradeTicket und={und} level={level} sideKey={sideKey} board={board} contracts={t?.contracts} onByHand={() => setByHand(true)} />,
  }[seat.stage] || <ConnectStep />;
  return (
    <section className="q-ticket tr" aria-label={`${answer} through Derive`}>
      <header className="tr-head">
        <h3>{question} <span className="q-ticket-side">{answer}</span></h3>
        <span className="tr-tag mono">Testnet · dry run</span>
      </header>
      {!byHand && seat.stage === "ready" && <SeatLine />}
      {byHand ? <div className="tr-hand">{fallback}</div> : step}
      <div className="tr-switch">
        <button className="text-control" onClick={() => setByHand((b) => !b)} aria-pressed={byHand}>{byHand ? "Back to one tap" : "Place by hand"}</button>
      </div>
    </section>
  );
}
