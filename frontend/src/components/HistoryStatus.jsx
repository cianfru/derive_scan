import { Info } from "./ui.jsx";

export function coverageReady(data) {
  // Legacy publishers used ready for file existence; require an explicit coverage status.
  return data?.ready === true && data?.status === "ready";
}

export default function HistoryStatus({ data }) {
  if (data?.status === "not_ranked") return <p className="status">This wallet is outside the currently published leaderboard. Open Traders to see the current ranking.</p>;
  const updating = data?.status === "updating";
  return <div className="plate" role="status"><div className="plate-b">
    <strong>{updating ? "Updating wallet calculations" : "Wallet history is still accumulating"}</strong>{" "}
    <Info label="About wallet history coverage">Wallet classes and rankings follow the approved study rules. History is processed one completed UTC day at a time. Rankings and positioning are withheld until coverage is current; missing history does not mean a wallet is flat. The history collection continues automatically.</Info>
    <p className="dim">{data?.through ? `History processed through ${data.through} UTC close.` : "The first history snapshot is being prepared."}
      {data?.expected_through && ` Required through ${data.expected_through} UTC close.`}</p>
    <p className="status">{updating ? "Existing daily records are being recalculated. No history is being reset." : "Rankings and wallet positioning appear once the daily history has caught up."}</p>
  </div></div>;
}
