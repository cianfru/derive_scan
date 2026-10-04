import { Link } from "react-router-dom";
import PayZone from "./PayZone.jsx";
import { Info } from "./ui.jsx";
import { ANSWER, buyCents, cents, fullPay, ladder, money, live, noPriceReason } from "../lib/questions.js";

function Answer({ level, side, paused, onPick, selected }) {
  const name = ANSWER[side];
  const c = buyCents(level, side, paused);
  const can = live(level, side, paused);
  const cls = `q-btn ${side}${selected ? " on" : ""}`;
  if (!can) {
    return (
      <span className={`${cls} off`} role="group" aria-label={`${name}, ${fullPay(level, side)}, no price now`}>
        <span>{name}</span>
        <small>No price now<Info label={`Why ${name} has no price at ${money(level.k)}`}>{noPriceReason(level, side, paused)}</Info></small>
      </span>
    );
  }
  return (
    <Link className={cls} to={`/q/${level.id}?side=${side}`} aria-label={`${name}, ${fullPay(level, side)}, ${c} cents per $1`}
      aria-current={selected ? "true" : undefined} onClick={onPick ? (e) => onPick(e, level, side) : undefined}>
      <span><i className={`q-arrow ${side}`} aria-hidden="true" />{name}</span><b className="mono">{cents(c)}</b>
    </Link>
  );
}

function Row({ level, index, headline = false, paused, onPick, selectedId, selectedSide }) {
  const fair = level.fair;
  const sel = selectedId === level.id;
  const off = level.k - index;
  return (
    <div className={`q-row${headline ? " headline" : ""}${sel ? " selected" : ""}${paused ? " paused" : ""}`} role="row"
      aria-label={`Higher or lower than ${money(level.k)}`} aria-selected={sel ? "true" : undefined}>
      {fair != null && !headline && <i className="q-bar" style={{ width: `${Math.round(fair * 100)}%` }} aria-hidden="true" />}
      <div className="q-level" role="cell">
        {headline ? <span className="q-head-text"><b className="mono">{money(level.k)}</b> <small>{money(Math.abs(off))} {off >= 0 ? "above" : "below"} today</small></span>
          : <b className="mono q-k">{money(level.k)}</b>}
        <span className="q-zone">
          <PayZone lo={level.lo} hi={level.hi} index={index} compact />
          <small className="mono" aria-label={`pays in part from ${money(level.lo)} to ${money(level.hi)}`}>{money(level.lo)}–{money(level.hi)}</small>
        </span>
      </div>
      <div className="q-answers" role="cell">
        <Answer level={level} side="yes" paused={paused} onPick={onPick} selected={sel && selectedSide === "yes"} />
        <Answer level={level} side="no" paused={paused} onPick={onPick} selected={sel && selectedSide === "no"} />
      </div>
    </div>
  );
}

/** One date's questions: the level nearest today first, then the other levels around the price now, highest
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
        <span className="label">Level · zone</span>
        <span className="label q-price-head">Cost per $1<Info label="About these prices">What $1 of payout costs now on Derive's screen, before fees. Higher pays $1 above the zone, Lower $1 below it; each pays nothing on the other side and part of it inside the zone. Higher and Lower add up to a little more than $1: the gap is the spread on Derive's screen.</Info></span>
      </div>
      {out}
      {rows.length === 0 && <p className="status">No levels with a price on Derive's screen right now.</p>}
      {canMore && <button className="text-control q-more" onClick={onMore} aria-pressed={more}>{more ? "Fewer levels" : "More levels"}</button>}
    </div>
  );
}
