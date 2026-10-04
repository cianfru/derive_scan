import { Info } from "./ui.jsx";

export function coverageReady(data) {
  // Legacy publishers used ready for file existence; require an explicit coverage status.
  return data?.ready === true && data?.status === "ready";
}

/** " · 2 days with gaps (i)" when some history readings never reconciled and are still being read
 * again; nothing when there are none. Coverage stays ready: a gap is a leg or so in thousands. */
export function GapNote({ data }) {
  const n = Number.isInteger(data?.gaps) ? data.gaps : 0;
  if (n <= 0) return null;
  const days = Array.isArray(data.gap_days) ? data.gap_days : [];
  const what = days.length > 1 ? `${days.length} days with gaps` : "1 day with a gap";
  return <> · {what} <Info label="About gaps in the wallet history">{`${n} reading${n > 1 ? "s" : ""} of Derive's trade history ${n > 1 ? "have" : "has"} not reconciled with the count Derive lists${days.length ? ` (${days.join(", ")} UTC)` : ""}: the legs read are kept, so a day can miss a few trades. Cowboy reads ${n > 1 ? "them" : "it"} again every few hours until ${n > 1 ? "they match" : "it matches"}; wallet classes, rankings and positions include ${n > 1 ? "those days" : "that day"} as read so far.`}</Info></>;
}

export default function HistoryStatus({ data }) {
  const updating = data?.status === "updating";
  return <div className="plate" role="status"><div className="plate-b">
    <strong>{updating ? "Updating wallet calculations" : "Wallet history is still accumulating"}</strong>{" "}
    <Info label="About wallet history coverage">Wallet classes and rankings follow the approved study rules. History is processed one completed UTC day at a time. Rankings and positioning are withheld until coverage is current; missing history does not mean a wallet is flat. The history collection continues automatically.</Info>
    <p className="dim">{data?.through ? `History processed through ${data.through} UTC close.` : "The first history snapshot is being prepared."}
      {data?.expected_through && ` Required through ${data.expected_through} UTC close.`}</p>
    <p className="status">{updating ? "Existing daily records are being recalculated. No history is being reset." : "Rankings and wallet positioning appear once the daily history has caught up."}</p>
  </div></div>;
}
