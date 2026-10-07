import { useEffect, useMemo, useRef, useState } from "react";
import { load } from "../lib/data.js";
import { ENTRIES, GROUPS, buildModel } from "./index.js";
import { TAG } from "./kit.jsx";

const LIMIT = 280;
const PICKS = 4;
const FONTS = [["Manrope", "200 800", "/fonts/manrope-latin-variable.woff2"], ["Chivo Mono", "100 900", "/fonts/chivo-mono-latin-variable.woff2"]];
let fontCSS = null;

// The PNG renderer misses fonts whose names hold a space, so both faces are handed over inline.
function embeddedFonts() {
  fontCSS ??= Promise.all(FONTS.map(async ([family, weight, url]) => {
    const blob = await (await fetch(url)).blob();
    const data = await new Promise((done, fail) => { const r = new FileReader(); r.onload = () => done(r.result); r.onerror = fail; r.readAsDataURL(blob); });
    return `@font-face { font-family: "${family}"; font-weight: ${weight}; src: url(${data}) format("woff2"); }`;
  })).then((rules) => rules.join("\n"));
  return fontCSS;
}

// Many cards read the same file at once; one request each.
const inflight = new Map();
function loadOnce(path) {
  if (!inflight.has(path)) inflight.set(path, load(path).finally(() => setTimeout(() => inflight.delete(path), 30_000)));
  return inflight.get(path);
}

const dayNumber = (now) => Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86_400_000);

/** One card a day, in turn, so the feed varies without picking by hand. */
export function todaysCard(ids, now = new Date()) {
  return ids[dayNumber(now) % ids.length];
}

/** Today's handful: one card per group where it can, turning over each day. */
export function todaysPicks(entries, now = new Date(), n = PICKS) {
  const day = dayNumber(now);
  const cards = [...new Map(entries.map((e) => [e.card.id, e.card])).values()];
  const picks = [];
  for (let i = 0; picks.length < Math.min(n, cards.length) && i < cards.length * 2; i++) {
    const card = cards[(day * 7 + i * 5) % cards.length];
    if (picks.some((p) => p.card.id === card.id)) continue;
    if (picks.length < GROUPS.length && picks.some((p) => p.card.group === card.group) && i < cards.length) continue;
    const params = card.params || [null];
    const param = params[day % params.length];
    picks.push(entries.find((e) => e.card.id === card.id && e.param === param));
  }
  return picks.filter(Boolean);
}

export const checkText = (text) => [
  text.length > LIMIT ? `${text.length - LIMIT} over` : null,
  text.includes(TAG) ? null : `Missing ${TAG}`,
  /https?:\/\/|www\.|\.trading|\.xyz\b|0x[0-9a-f]{6}/i.test(text) ? "Remove links and addresses" : null,
].filter(Boolean);

function CardBlock({ entry, pick }) {
  const { card } = entry;
  const [param, setParam] = useState(entry.param);
  const [state, setState] = useState({ status: "loading" });
  const [angle, setAngle] = useState(0);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [attempt, setAttempt] = useState(0);
  const node = useRef(null);

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    buildModel(card, param, loadOnce)
      .then((m) => {
        if (!live) return;
        if (!m) return setState({ status: "empty" });
        const angles = card.angles(m);
        setState({ status: "ready", m, angles });
        setAngle(0);
        setText(angles[0] || "");
      })
      .catch((e) => live && setState({ status: "error", message: String(e?.message || e) }));
    return () => { live = false; };
  }, [card, param, attempt]);

  async function download() {
    if (!state.m?.provenance?.eligible?.()) return setNote("This card's data is no longer current. Refresh the card before exporting.");
    setNote("Drawing…");
    try {
      const { toPng } = await import("html-to-image");
      const url = await toPng(node.current, { width: 1080, height: 1080, pixelRatio: 2, cacheBust: true, fontEmbedCSS: await embeddedFonts() });
      const a = document.createElement("a");
      a.href = url;
      a.download = `cowboy-${card.id}${param ? "-" + param.toLowerCase() : ""}-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
      setNote("Saved");
    } catch (e) {
      setNote(`Could not draw: ${e?.message || e}`);
    }
  }

  async function copy() {
    if (!state.m?.provenance?.eligible?.()) return setNote("This card's data is no longer current. Refresh the card before exporting.");
    try { await navigator.clipboard.writeText(text); setNote("Text copied"); }
    catch { setNote("Copy blocked by the browser"); }
  }

  function nextAngle() {
    const n = (angle + 1) % state.angles.length;
    setAngle(n);
    setText(state.angles[n]);
  }

  const { View } = card;
  const issues = checkText(text);
  return (
    <section className={`cc-card${pick ? " today" : ""}`} aria-label={card.title}>
      <header>
        <h2>{card.title}</h2>
        {pick ? <span className="cc-today">Today's pick</span> : null}
        <span className="cc-group">{card.group}</span>
        {card.params ? (
          <label className="cc-param">Coin
            <select value={param} onChange={(e) => setParam(e.target.value)}>{card.params.map((p) => <option key={p}>{p}</option>)}</select>
          </label>
        ) : null}
      </header>
      {state.status === "ready" ? (
        <div className="cc-body">
          <div className="cc-preview"><div className="cc-scale"><div ref={node}><View m={state.m} /></div></div></div>
          <div className="cc-post">
            <div className="cc-angle">
              <label htmlFor={`t-${entry.key}`}>Post text</label>
              {state.angles.length > 1 ? <button type="button" className="cc-link" onClick={nextAngle}>Angle {angle + 1} of {state.angles.length} · next</button> : null}
            </div>
            <textarea id={`t-${entry.key}`} value={text} onChange={(e) => setText(e.target.value)} rows={7} />
            <div className="cc-meta">
              <span className={text.length > LIMIT ? "over" : ""}>{text.length} / {LIMIT}</span>
              {issues.filter((i) => !i.endsWith("over")).map((i) => <span key={i} className="over">{i}</span>)}
            </div>
            <div className="cc-actions">
              <button type="button" onClick={download}>Download PNG</button>
              <button type="button" onClick={copy}>Copy text</button>
              <button type="button" className="quiet" onClick={() => setAttempt((n) => n + 1)}>Refresh card</button>
              <button type="button" className="quiet" onClick={() => setText(state.angles[angle])}>Reset text</button>
            </div>
            <p className="cc-note" role="status">{note}</p>
          </div>
        </div>
      ) : (
        <p className="cc-empty">
          {state.status === "loading" ? "Loading…" : state.status === "empty" ? "Not enough fresh data for this card right now." : `Could not load: ${state.message}`}
          {state.status === "error" ? <button type="button" className="cc-retry" onClick={() => setAttempt((n) => n + 1)}>Try again</button> : null}
        </p>
      )}
    </section>
  );
}

export function ControlPage() {
  const [tab, setTab] = useState("Today");
  const picks = useMemo(() => todaysPicks(ENTRIES), []);
  const cards = useMemo(() => [...new Map(ENTRIES.map((e) => [e.card.id, e])).values()], []);
  const shown = tab === "Today" ? picks : cards.filter((e) => tab === "All" || e.card.group === tab);
  const pickIds = new Set(picks.map((p) => p.card.id));
  return (
    <main className="cc">
      <header className="cc-head">
        <img src="/brand/cowboy-lockup-on-dark.svg" alt="Cowboy" />
        <div><h1>X cards</h1><p>{cards.length} cards, {ENTRIES.length} with every coin. Built from the latest published data. Pick an angle, edit, download, post by hand.</p></div>
      </header>
      <nav className="cc-tabs" aria-label="Card groups">
        {["Today", "All", ...GROUPS].map((t) => (
          <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>{t === "Today" ? "Today's picks" : t}</button>
        ))}
      </nav>
      {shown.map((e) => <CardBlock key={e.key} entry={e} pick={tab !== "Today" && pickIds.has(e.card.id)} />)}
    </main>
  );
}
