import { useEffect, useRef, useState } from "react";
import { load } from "../lib/data.js";
import { CARDS, TAG } from "./cards.jsx";

const LIMIT = 280;
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

// One card a day, in turn, so the feed varies without picking by hand.
export function todaysCard(ids, now = new Date()) {
  const day = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86_400_000);
  return ids[day % ids.length];
}

function CardBlock({ card, today }) {
  const [state, setState] = useState({ status: "loading" });
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [attempt, setAttempt] = useState(0);
  const node = useRef(null);

  useEffect(() => {
    let live = true;
    Promise.all(card.files.map((f) => load(f)))
      .then((files) => {
        const m = card.model(files);
        if (!live) return;
        if (!m) return setState({ status: "empty" });
        setState({ status: "ready", m });
        setText(card.text(m));
      })
      .catch((e) => live && setState({ status: "error", message: String(e?.message || e) }));
    return () => { live = false; };
  }, [card, attempt]);

  async function download() {
    setNote("Drawing…");
    try {
      const { toPng } = await import("html-to-image");
      const url = await toPng(node.current, { width: 1080, height: 1080, pixelRatio: 2, cacheBust: true, fontEmbedCSS: await embeddedFonts() });
      const a = document.createElement("a");
      a.href = url;
      a.download = `cowboy-${card.id}-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
      setNote("Saved");
    } catch (e) {
      setNote(`Could not draw: ${e?.message || e}`);
    }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(text); setNote("Text copied"); }
    catch { setNote("Copy blocked by the browser"); }
  }

  const { Card } = card;
  return (
    <section className={`cc-card${today ? " today" : ""}`} aria-label={card.title}>
      <header><h2>{card.title}</h2>{today ? <span className="cc-today">Today's card</span> : null}</header>
      {state.status === "ready" ? (
        <div className="cc-body">
          <div className="cc-preview"><div className="cc-scale"><div ref={node}><Card m={state.m} /></div></div></div>
          <div className="cc-post">
            <label htmlFor={`t-${card.id}`}>Post text</label>
            <textarea id={`t-${card.id}`} value={text} onChange={(e) => setText(e.target.value)} rows={7} />
            <div className="cc-meta">
              <span className={text.length > LIMIT ? "over" : ""}>{text.length} / {LIMIT}</span>
              {text.includes(TAG) ? null : <span className="over">Missing {TAG}</span>}
              {/https?:\/\/|www\.|\.trading|0x[0-9a-f]{6}/i.test(text) ? <span className="over">Remove links and addresses</span> : null}
            </div>
            <div className="cc-actions">
              <button type="button" onClick={download}>Download PNG</button>
              <button type="button" onClick={copy}>Copy text</button>
              <button type="button" className="quiet" onClick={() => setText(card.text(state.m))}>Reset text</button>
            </div>
            <p className="cc-note" role="status">{note}</p>
          </div>
        </div>
      ) : (
        <p className="cc-empty">
          {state.status === "loading" ? "Loading…" : state.status === "empty" ? "Not enough fresh data for this card today." : `Could not load: ${state.message}`}
          {state.status === "error" ? <button type="button" className="cc-retry" onClick={() => { setState({ status: "loading" }); setAttempt((n) => n + 1); }}>Try again</button> : null}
        </p>
      )}
    </section>
  );
}

export function ControlPage() {
  const today = todaysCard(CARDS.map((c) => c.id));
  const ordered = [...CARDS].sort((a, b) => (b.id === today) - (a.id === today));
  return (
    <main className="cc">
      <header className="cc-head">
        <img src="/brand/cowboy-lockup-on-dark.svg" alt="Cowboy" />
        <div><h1>X cards</h1><p>Built from the latest published data. Edit the text, download the card, post it by hand.</p></div>
      </header>
      {ordered.map((c) => <CardBlock key={c.id} card={c} today={c.id === today} />)}
    </main>
  );
}
