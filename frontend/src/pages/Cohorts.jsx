import { Link } from "react-router-dom";
import { useData } from "../lib/data.js";
import { Loading, Failed, PageHead, Lead } from "../components/ui.jsx";
import { cohortsLead } from "../lib/takeaway.js";
import CohortExplorer from "../components/CohortExplorer.jsx";
import HistoryStatus, { coverageReady, GapNote } from "../components/HistoryStatus.jsx";

const PAGE_HELP = "Derive's options traders grouped by their results on expired options (Boot Hill to Legend) and by premium traded (Tenderfoot to Railroad Baron), with how each group holds its open options per coin. Market makers are left out.";

/** Posses: groups of traders by results and by size, and how each is positioned per coin. */
export default function Cohorts() {
  const { data, error } = useData("traders.json", 5 * 60_000);
  if (error && !data) return <div className="wrap page"><Failed error={error} /></div>;
  if (!data) return <div className="wrap page"><Loading /></div>;
  if (!coverageReady(data)) return (
    <div className="wrap page"><PageHead error={error} title="Posses" /><HistoryStatus data={data} /></div>);
  return (
    <div className="wrap page people-page">
      <PageHead error={error} title="Posses" info={PAGE_HELP}
        meta={<>Grouped by results and by size · history to {data.through} · <Link to="/traders">Leaderboard</Link></>} />
      <Lead lead={cohortsLead(data)} />
      <CohortExplorer cohorts={data.cohorts} through={data.through} valuedAt={data.generated_at} title="Positioning by posse" />
      <p className="status">History to {data.through} UTC · positions valued on the newest options chain<GapNote data={data} /></p>
    </div>
  );
}
