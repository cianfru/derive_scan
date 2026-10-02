import { Link } from "react-router-dom";
import { useData } from "../lib/data.js";
import { price, chg, utc } from "../lib/format.js";
import { Asset, MarketPreview, MarketTrace, Reading } from "../components/MarketVisuals.jsx";
import { Failed, Info } from "../components/ui.jsx";

export default function Landing() {
  const { data, error } = useData("markets.json");
  const coins = (data?.coins || []).filter(c => c.has_options);
  const featured = ["BTC", "ETH", "SOL", "HYPE"].map(u => coins.find(c => c.und === u)).filter(Boolean);
  return <div className="landing">
    <section className="wrap hero">
      <div className="hero-copy">
        <h1>A clearer view<br />of Derive.</h1>
        <p>Read the price action. Understand the options. See how wallets are positioned.</p>
        <p className="hero-note">Three distinct perspectives.<br />The evidence behind each, one click away.</p>
        <div className="hero-cta"><Link className="btn primary" to="/markets">Explore markets</Link><Link className="text-link" to="/radar">Open radar</Link></div>
        <div className="hero-source"><span>Built around Derive’s public market data<br /><small>Snapshots published every 15 minutes</small></span></div>
      </div>
      {error && !data ? <Failed error={error} /> : <MarketPreview coins={coins} />}
    </section>
    <section className="wrap home-markets">
      <div className="section-heading"><div><h2>Start with a market.</h2><p className="sub">Price, engine and positioning in one place.</p></div><Link className="text-link" to="/markets">View all markets</Link></div>
      <div className="table-wrap"><table className="grid home-grid"><thead><tr><th>Market</th><th className="num">Index price / 24h</th><th>Recent 4H closes</th><th>1D engine</th><th>30d options <Info>30-day option tenor with seven-day taker premium flow. A full flow window is required.</Info></th><th>Smart wallets <Info>Existing Smart cohort, options expiring within 30 days. History and delta valuation must be ready.</Info></th></tr></thead>
        <tbody>{featured.map(c => <tr key={c.und}><td><Link className="asset-link" to={`/coin/${c.und}`}><Asset und={c.und} /></Link></td><td className="num">${price(c.price)}<small className={c.chg_24h >= 0 ? "up" : "down"}>{chg(c.chg_24h)}</small></td><td><MarketTrace values={c.spark} label={`${c.und} recent closes`} /></td><td><Reading alignment={c.align} kind="engine" /></td><td><Reading alignment={c.align} kind="options" /></td><td><Reading alignment={c.align} kind="wallets" /></td></tr>)}</tbody></table></div>
      {data && <p className="status">Published {utc(data.generated_at)}. Price changes use closed 4H bars.</p>}
    </section>
    <section className="wrap perspective-section">
      <div className="perspective-intro"><h2>Different questions.<br />Separate answers.</h2><p className="sub">Agreement can be useful. So can disagreement. Torq keeps each reading visible, with its source, window and limitations.</p><Link className="text-link" to="/radar">Compare them on the radar</Link></div>
      <div className="perspective-list">
        <article><h3>What is price doing?</h3><p>The engine reads trend, structure and exhaustion after each 4-hour and daily close. Open a market to inspect the conditions behind its signal.</p><Link to="/markets">Explore the engine</Link></article>
        <article><h3>What are options pricing?</h3><p>See volatility, skew and activity across expiries. Model ranges describe option prices; they are not forecasts.</p><Link to="/options">Explore options</Link></article>
        <article><h3>How are wallets positioned?</h3><p>Explore the defined trader cohorts and their reconstructed options exposure. Incomplete history stays clearly marked while collection continues.</p><Link to="/traders">Explore traders</Link></article>
      </div>
    </section>
  </div>;
}
