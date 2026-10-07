import { useEffect, useState } from "react";
import { follow, followsPersistent, isFollowing, setLevel, unfollow, useFollowsDoc } from "../lib/follows.js";
import { ANSWER, money } from "../lib/questions.js";
import { Info } from "./ui.jsx";
import "../my-space.css";

function Mark({ on }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M4 1.8h8v12.4l-4-3-4 3z" />
    </svg>
  );
}

/** Follow an answer (coin, date, level, side) in this browser. */
export function FollowButton({ id, side, k, board = null, compact = false }) {
  const doc = useFollowsDoc();
  const on = isFollowing(doc, id, side);
  const [sessionNotice, setSessionNotice] = useState(false);
  const sessionOnly = on && !followsPersistent();
  const what = `${ANSWER[side]} · ${money(k)}`;
  return (
    <><button type="button" className={`text-control fl-btn${on ? " on" : ""}${compact ? " compact" : ""}`} aria-pressed={on}
      aria-label={on ? `Following ${what}${sessionOnly ? " for this visit" : ""}; stop following` : `Follow ${what}`}
      onClick={(e) => { e.stopPropagation(); if (on) { unfollow(id, side); setSessionNotice(false); } else { follow(id, side, { board }); setSessionNotice(!followsPersistent()); } }}>
      <Mark on={on} /><span className="fl-text">{on ? "Following" : "Follow"}</span>
    </button>{sessionOnly && sessionNotice && <span className="fl-session" role="status">This visit only<Info label="Why this follow is temporary">This browser could not save your follow. It stays available for this visit. Back up My space in Positions to keep a copy.</Info></span>}</>
  );
}

/** The cost per $1, in cents, at or below which a notice appears on return. Empty for none. */
export function FollowLevel({ id, side }) {
  const doc = useFollowsDoc();
  const f = doc.follows.find((x) => x.id === id && x.side === side);
  const [text, setText] = useState(f?.level ?? "");
  useEffect(() => { setText(f?.level ?? ""); }, [f?.level]);
  if (!f) return null;
  const inputId = `fl-${id}-${side}`;
  const commit = () => setLevel(id, side, String(text).trim() === "" ? null : Number(String(text).replace(/[^\d]/g, "")));
  return (
    <span className="fl-level">
      <label htmlFor={inputId}>Notice at</label>
      <input id={inputId} className="mono" inputMode="numeric" placeholder="—" value={text} maxLength={2}
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { commit(); e.currentTarget.blur(); } }} />
      <span>c per $1 or less</span>
    </span>
  );
}
