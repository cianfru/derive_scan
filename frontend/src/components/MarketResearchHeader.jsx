import { Link } from "react-router-dom";
import { Arrow, Info, RefreshNotice } from "./ui.jsx";
import "../market-research.css";

/** Shared heading for the three market research views. */
export function MarketResearchHeader({ title, description, info, meta, error }) {
  return (
    <>
      <header className="mr-head">
        <div className="mr-heading">
          <Link className="mr-back" to="/markets"><Arrow />Markets</Link>
          <h1>{title}{info && <Info label={`About ${title}`}>{info}</Info>}</h1>
          {description && <p className="mr-description">{description}</p>}
        </div>
        {meta && <div className="mr-observed"><span>Published snapshot</span><div className="page-meta">{meta}</div></div>}
      </header>
      <RefreshNotice error={error} />
    </>
  );
}

export default MarketResearchHeader;
