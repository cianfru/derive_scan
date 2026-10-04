import { Link } from "react-router-dom";
import PayZone from "./PayZone.jsx";
import { Info } from "./ui.jsx";
import { buyCents, cents, ladder, money, answerNames, live } from "../lib/questions.js";

function Answer({ level, side, headline, paused, onPick, selected }) {
  const names = answerNames(headline);
  const c = buyCents(level, side, paused);
  const can = live(level, side, paused);
  const cls = `q-btn ${side}${headline ? ` dir-${side}` : ""}${selected ? " on" : ""}`;
  const label = `${names[side]} ${can ? `${c} cents per $1` : "no price now"}`;
  if (!can) return <span className={`${cls} off`} aria-label={label}><span>{names[side]}</span><b className="mono">—</b></span>;
  return (
    <Link className={cls} to={`/q/${level.id}?side=${side}`} aria-label={label} onClick={onPick ? (e) => onPick(e, level, side) : undefined}>
      <span>{headline && <i className={`q-arrow ${side}`} aria-hidden="true" />}{names[side]}</span><b className="mono">{cents(c)}</b>
    </Link>
  );
}

function Row({ level, index, headline = false, paused, onPick, selectedId, selectedSide }) {
  const fair = level.fair;
  const sel = selectedId === level.id;
  return (
    <div className={`q-row${headline ? " headline" : ""}${sel ? " selected" : ""}${paused ? " paused" : ""}`} role="row"
      aria-label={headline ? `Up or down from ${money(level.k)}` : `Above ${money(level.k)}`}>
      {fair != null && !headline && <i className="q-bar" style={{ width: `${Math.round(fair * 100)}%` }} aria-hidden="true" />}
      <div className="q-level" role="cell">
        {headline ? <span className="q-head-text">Up or down from <b className="mono">{money(level.k)}</b></span>
          : <b className="mono q-k">{money(level.k)}</b>}
        <span className="q-zone">
          <PayZone lo={level.lo} hi={level.hi} index={index} compact />
          <small className="mono">$1 from {money(level.hi)}</small>
        </span>
      </div>
      <div className="q-answers" role="cell">
        <Answer level={level} side="yes" headline={headline} paused={paused} onPick={onPick} selected={sel && selectedSide === "yes"} />
        <Answer level={level} side="no" headline={headline} paused={paused} onPick={onPick} selected={sel && selectedSide === "no"} />
      </div>
    </div>
  );
}

/** One date's questions: the up-or-down headline, then "above" levels around the price now, highest
 * first, with the orange hairline where the price sits. Every row shows its pay zone. */
export default function QuestionLadder({ board, date, more, onMore, paused, onPick, selectedId, selectedSide }) {
  const rows = ladder(date, more);
  const head = date.levels.find((lv) => lv.id === date.headline);
  const index = board.index;
  const canMore = date.levels.some((lv) => lv.ladder === 15 && lv.state !== "retired");
  const out = [];
  let placed = false;
  rows.forEach((lv) => {
    if (!placed && lv.k < index) {
      out.push(<div key="now" className="q-now" role="presentation"><span className="mono">{money(index)} now</span></div>);
      placed = true;
    }
    out.push(<Row key={lv.id} level={lv} index={index} paused={paused} onPick={onPick} selectedId={selectedId} selectedSide={selectedSide} />);
  });
  if (!placed && rows.length) out.push(<div key="now" className="q-now" role="presentation"><span className="mono">{money(index)} now</span></div>);
  return (
    <div className="q-ladder" role="table" aria-label={`Questions for ${date.label}`}>
      {head && <Row level={head} index={index} headline paused={paused} onPick={onPick} selectedId={selectedId} selectedSide={selectedSide} />}
      <div className="q-group-head" role="presentation">
        <span className="label">Above</span>
        <span className="label q-price-head">Buy, per $1<Info label="About these prices">What $1 of payout costs now on Derive's screen, before fees. Each answer pays $1 on its side of the zone, nothing on the other side, and part of it in between. Yes and No add up to a little more than $1: the gap is the spread on Derive's screen.</Info></span>
      </div>
      {out}
      {rows.length === 0 && <p className="status">No levels with a price on Derive's screen right now.</p>}
      {canMore && <button className="text-control q-more" onClick={onMore} aria-pressed={more}>{more ? "Fewer levels" : "More levels"}</button>}
    </div>
  );
}
