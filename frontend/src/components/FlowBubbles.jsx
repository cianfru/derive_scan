// The options flow map (lib/flowBubbles.js): one bubble per coin, its size the option money of the last 24 hours,
// left to right from "Gains if it falls" to "Gains if it rises". The home card draws it still (its own link opens
// the page), the pop-out links each coin to its view on /flow, and the Flow page picks a coin with it.
import { Link } from "react-router-dom";
import { usd } from "../lib/format.js";
import { BUBBLES, bubbleLayout, leanParts, leanWords } from "../lib/flowBubbles.js";
import { useElementSize } from "../lib/useElementWidth.js";
import { CoinIcon } from "./MarketVisuals.jsx";
import "../flow-bubbles.css";

// "ETH $300K": the coin in words, the money in figures.
const labelParts = (t) => { const i = t.indexOf(" "); return i < 0 ? t : <><b>{t.slice(0, i)}</b>{t.slice(i)}</>; };

/** "63% on a rise" with the figure in the numbers' font (`Num` wraps it: the home card's own, else a mono span). */
export function LeanText({ c, Num = ({ children }) => <span className="fb-n">{children}</span> }) {
  const p = leanParts(c);
  return p ? <><Num>{p.pct}%</Num> on a {p.word}</> : <>about even</>;
}

export const coinWords = (c) => `${c.und}: ${usd(c.total)} in options over 24 hours, ${leanWords(c)}`;

export default function FlowBubbles({ coins, className = "", rMin = 10, rMax = 30, labels = 4, label, onPick, linkTo, selected,
  axisWords = ["Gains if it falls", "Even", "Gains if it rises"] }) {
  const [box, size] = useElementSize({ w: 640, h: 120 });
  // A short band drops the axis words' row and keeps the field (the tint already says which side is which).
  const axis = size && size.h >= 64 ? BUBBLES.axis : 0;
  const L = size ? bubbleLayout(coins, { w: size.w, h: size.h, rMin, rMax, labels, label, axis }) : null;
  const picked = selected && selected !== "all" ? selected : null;
  // Largest first, so the smaller bubbles sit on top and stay visible.
  const bubble = (m) => {
    const cls = `fb-b ${m.lean}${picked ? (picked === m.und ? " on" : " off") : ""}`;
    const style = { left: `${(m.x - m.r).toFixed(1)}px`, top: `${(m.y - m.r).toFixed(1)}px`, width: 2 * m.r, height: 2 * m.r };
    const words = coinWords(m);
    if (onPick) return <button key={m.und} type="button" className={cls} style={style} aria-label={words} title={words} data-und={m.und}
      aria-pressed={picked === m.und} onClick={() => onPick(picked === m.und ? "all" : m.und)}><CoinIcon und={m.und} /></button>;
    if (linkTo) return <Link key={m.und} to={linkTo(m.und)} className={cls} style={style} aria-label={words} title={words} data-und={m.und}><CoinIcon und={m.und} /></Link>;
    return <span key={m.und} className={cls} style={style} title={words} data-und={m.und}><CoinIcon und={m.und} /></span>;
  };
  return (
    <div className={`fb ${className}`} ref={box}>
      {L && <>
        <div className="fb-field" style={{ height: L.ph }}>
          <i className="fb-mid" style={{ top: L.mid }} />
          <i className="fb-even" style={{ left: L.evenX }} />
        </div>
        {L.marks.map(bubble)}
        {L.marks.filter((m) => m.label).map((m) => (
          <span key={`l-${m.und}`} className={`fb-l${picked && picked !== m.und ? " off" : ""}`} aria-hidden="true"
            style={{ left: `${m.label.x.toFixed(1)}px`, top: `${m.label.y.toFixed(1)}px` }}>{labelParts(m.label.text)}</span>
        ))}
        {axis > 0 && <div className="fb-xw" aria-hidden="true" style={{ top: L.ph }}>
          <span className="down">{axisWords[0]}</span><span className="up">{axisWords[2]}</span>
          {size.w >= 300 && <span className="fb-xw-even" style={{ left: L.evenX }}>{axisWords[1]}</span>}
        </div>}
      </>}
    </div>
  );
}
