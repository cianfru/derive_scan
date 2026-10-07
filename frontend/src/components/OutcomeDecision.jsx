import { useNavigate } from "react-router-dom";
import { useFeeds } from "./Feeds.jsx";
import OutcomeComparison from "./OutcomeComparison.jsx";
import { ANSWER, findLevel, money } from "../lib/questions.js";
import { retainOutcome, saloonReturn, toggleComparison, useDecision } from "../lib/decision.js";
import "../decision-ui.css";

export function CompareControl({ selection, compact = false, onView }) {
  const [d] = useDecision();
  const on = d.compare.some((s) => s.id === selection.id && s.side === selection.side);
  return <><button type="button" className={`text-control decision-compare${compact ? " compact" : ""}`} aria-pressed={on}
    aria-label={`${on ? "Remove" : "Compare"} ${selection.und} ${ANSWER[selection.side]} ${money(selection.k ?? selection.level?.k)}${on ? " from comparison" : ""}`}
    disabled={!on && d.compare.length >= 3} onClick={(e) => { e.stopPropagation(); toggleComparison(selection); }}>
    {on ? "Compared" : "Compare"}
  </button>{on && !compact && <ViewComparison beforeFocus={onView} />}</>;
}

export function ViewComparison({ beforeFocus }) {
  const [d] = useDecision();
  if (!d.compare.length) return null;
  return <button type="button" className="text-control decision-view-comparison" onClick={() => {
    beforeFocus?.();
    requestAnimationFrame(() => {
      const target = document.getElementById("decision-comparison");
      target?.scrollIntoView?.({ block: "start", behavior: "auto" });
      target?.focus?.();
    });
  }}>View comparison ({d.compare.length})</button>;
}

/** Resolve chosen IDs against current data, so a vanished price remains an explicit unavailable choice. */
export default function DecisionComparison({ boards = {}, now, index, retryIndex }) {
  const [d, update] = useDecision();
  const navigate = useNavigate();
  const missing = [...new Set(d.compare.map((s) => s.und))].filter((u) => !boards[u]);
  const [feeds, files] = useFeeds(missing.map((u) => `questions/${u}.json`), undefined,
    { revision: index?.publication_revision, retry: retryIndex });
  const selections = d.compare.map((s) => {
    const board = boards[s.und] || files[`questions/${s.und}.json`];
    const found = board ? findLevel(board, s.id) : null;
    return { ...s, board, level: found?.level, settleTs: found?.date?.settle_ts };
  });
  if (!d.compare.length) return null;
  const dollars = Number(d.amountDraft);
  const open = (s) => {
    retainOutcome(s);
    navigate(`/q/${s.id}?side=${s.side}`, { state: { amountDraft: d.amountDraft,
      ...(Number.isFinite(dollars) && dollars > 0 ? { dollars } : {}), returnTo: saloonReturn(s.und) } });
  };
  return <div className="decision-comparison-wrap" id="decision-comparison" tabIndex={-1}>
    {feeds}
    <label className="decision-compare-amount">Amount for each outcome, fees included
      <span className="q-dollar-field"><span>$</span><input aria-label="Comparison amount, fees included" inputMode="decimal" value={d.amountDraft}
        onChange={(e) => update({ amountDraft: e.target.value.replace(/[^\d.]/g, "") })} /></span>
    </label>
    {d.compare.length === 1 && <p className="page-meta">Choose one or two more outcomes to compare.</p>}
    <OutcomeComparison selections={selections} budget={dollars} now={now} onSelect={open}
      onRemove={(key) => update({ compare: d.compare.filter((s) => `${s.id}:${s.side}` !== key) })} />
  </div>;
}
