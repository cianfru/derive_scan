import { Link } from "react-router-dom";
import { useFollowsDoc } from "../lib/follows.js";
import { incompleteReceipt } from "../lib/positions.js";
import { remainingQty, realized } from "../lib/realized.js";
import { dayLabel, parseId } from "../lib/questions.js";
import { SaloonNotices } from "./SaloonNotices.jsx";
import { Info } from "./ui.jsx";
import "../my-space.css";

export function returnFacts(list, now) {
  const upcoming = list.filter((p) => !p.closed_at && p.settle_ts > now && remainingQty(p) > 0).sort((a, b) => a.settle_ts - b.settle_ts);
  const unresolved = list.filter((p) => incompleteReceipt(p) || p.exec === "hand_partial"
    || realized(p).portions.some((x) => x.net == null)
    || (p.exec === "rfq" && !Number.isFinite(p.journal?.cost?.total))
    || (!p.closed_at && p.settle_ts <= now && remainingQty(p) > 0 && !(p.exits || []).some((e) => e.kind === "settle")));
  return { next: upcoming[0] || null, unresolved };
}

export default function PositionsReturn({ list, now, onTab }) {
  const doc = useFollowsDoc();
  const { next, unresolved } = returnFacts(list, now);
  if (!next && !unresolved.length && !doc.follows.length && !doc.notices.length) return null;
  const nextQuestion = parseId(next?.id);
  return (
    <section className="my-return" aria-label="Your next steps">
      {(next || unresolved.length > 0) && <div className="my-return-facts">
        {next && <button className="text-control my-return-item" onClick={() => onTab("open")}><span>Next settlement</span><b>{next.und} · {nextQuestion ? dayLabel(nextQuestion.expiry) : new Date(next.settle_ts * 1000).toISOString().slice(0, 10)} <small>08:00 UTC</small></b></button>}
        {unresolved.length > 0 && <div className="my-return-item"><span>Needs checking<Info label="About records to check">An incomplete fill, unavailable fees or result, or a settlement still waiting for records. Check with Derive when connected, or restore a more complete backup. No trade is sent by this check.</Info></span>
          <button className="text-control" onClick={() => onTab(unresolved.some((p) => !p.closed_at && p.settle_ts > now) ? "open" : "closed")}><b className="mono">{unresolved.length}</b> {unresolved.length === 1 ? "record" : "records"}</button></div>}
      </div>}
      {(doc.follows.length > 0 || doc.notices.length > 0) && <details className="my-return-notices">
        <summary>Following updates<span className="mono">{doc.notices.length}</span></summary>
        <SaloonNotices />
        {!doc.notices.length && <p className="q-note"><Link className="text-link" to="/saloon/mine?tab=following">See followed outcomes</Link></p>}
      </details>}
    </section>
  );
}
