// After a deploy, a page opened on the previous build asks for chunk files that no longer exist, and the view
// fails to load (owner, 7 October 2026: "the load is failing on production"). Such a failure reloads the page
// once, onto the current build; a second failure within a minute shows the error instead of looping.
const KEY = "cowboy-stale-reload";
const WINDOW_MS = 60_000;

/** A failed dynamic import or module preload (Chrome, Safari and Firefox wordings). */
export function isChunkError(err) {
  const m = String(err?.message || err || "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading (CSS )?chunk .* failed/i.test(m);
}

/** Reloads once per WINDOW_MS; returns whether it reloaded. */
let memoryLast = 0; // when storage is blocked, at most one reload per page load
export function reloadOnce(now = Date.now(), storage = globalThis.sessionStorage, reload = () => window.location.reload()) {
  let last = memoryLast;
  try { last = Math.max(last, Number(storage?.getItem(KEY)) || 0); } catch { /* storage blocked */ }
  if (last && now - last < WINDOW_MS) return false;
  memoryLast = now;
  try { storage?.setItem(KEY, String(now)); } catch { /* ignore */ }
  reload();
  return true;
}

/** Vite's own event for a failed preload of a lazy route. */
export function watchStaleBuild(target = globalThis.window) {
  target?.addEventListener?.("vite:preloadError", (e) => { if (reloadOnce()) e.preventDefault(); });
}
