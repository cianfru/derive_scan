import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useFeeds } from "./Feeds.jsx";
import { Info } from "./ui.jsx";
import { computeNotices, dismiss, dismissAll, loadDoc, saveDoc, useFollowsDoc } from "../lib/follows.js";
import "../board.css";

/**
 * Notices on return: compares the latest published files with what this browser last saw for each
 * followed answer and lists what changed, quietly, at the top of the Saloon. Nothing runs in the
 * background; a notice stays until dismissed.
 */
export function SaloonNotices() {
  const doc = useFollowsDoc();
  const now = Date.now() / 1000;
  const paths = useMemo(() => {
    if (!doc.follows.length) return [];
    const unds = [...new Set(doc.follows.map((f) => f.und))].sort();
    const hist = doc.follows.filter((f) => now >= f.settle_ts && !f.seen.settled).map((f) => `questions/history/${f.und}-${f.expiry}.json`);
    return ["markets.json", ...unds.map((u) => `questions/${u}.json`), ...[...new Set(hist)]];
  }, [doc.follows.map((f) => `${f.id}:${f.side}:${f.seen.settled}`).join(",")]);
  const [feeds, files, ready] = useFeeds(paths, 15 * 60_000);
  const stamp = paths.map((p) => `${p}:${files[p]?.prices_ts ?? files[p]?.generated_at ?? (files[p] ? 1 : 0)}`).join("|");
  useEffect(() => {
    if (!paths.length || !ready) return;
    const boards = {}, hist = {};
    for (const p of paths) {
      const d = files[p];
      if (!d) continue;
      let m = /^questions\/([A-Z0-9]+)\.json$/.exec(p);
      if (m) boards[m[1]] = d;
      m = /^questions\/history\/([A-Z0-9]+-\d{8})\.json$/.exec(p);
      if (m) hist[m[1]] = d;
    }
    const before = loadDoc();
    const { doc: next } = computeNotices(before, { boards, hist, markets: files["markets.json"], now: Date.now() / 1000 });
    if (JSON.stringify(next) !== JSON.stringify(before)) saveDoc(next);
  }, [ready, stamp]);
  const list = [...doc.notices].reverse();
  return (
    <>
      {feeds}
      {list.length > 0 && (
        <section className="sn" aria-label="Notices">
          <div className="sn-head">
            <h2 className="label">Since you last looked
              <Info label="About notices">For the answers you follow, Cowboy compares the latest prices with what this browser saw last time. Nothing is sent to you; notices appear here when you come back.</Info>
            </h2>
            {list.length > 1 && <button className="text-control" onClick={dismissAll}>Dismiss all</button>}
          </div>
          <ul className="sn-list">
            {list.map((n) => (
              <li key={n.key} className={`sn-item ${n.kind}`}>
                <i className="sn-mark" aria-hidden="true" />
                {n.kind === "research"
                  ? <Link to={`/coin/${n.und}#regime`} className="sn-text">{n.text}</Link>
                  : <Link to={`/q/${n.id}?side=${n.side}`} state={{ step: "preview" }} className="sn-text">{n.text}</Link>}
                <button className="text-control sn-x" aria-label={`Dismiss: ${n.text}`} onClick={() => dismiss(n.key)}>Dismiss</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** Browsing is the default. Guided setup remains available without duplicating the main nav. */
export default function SaloonHead({ view }) {
  const following = view === "following";
  const guided = view === "guided";
  return (
    <header className="q-head sn-head-wrap">
      <div className="q-head-top">
        <div className="saloon-heading">
          <h1>{following ? "Following" : "Saloon"}</h1>
          <p>{following ? "Your saved outcomes, kept in this browser." : guided ? "Choose a coin, a date and an outcome." : "Higher or lower. Find your outcome."}</p>
        </div>
        <Link className="saloon-view-link" to={guided ? "/saloon" : "/saloon/guided"}>{guided ? "Browse outcomes" : "Guided setup"}<span aria-hidden="true">↗</span></Link>
      </div>
      <SaloonNotices />
    </header>
  );
}
