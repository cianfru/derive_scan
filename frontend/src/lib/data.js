// Cowboy reads only the published app data (site-data branch): one file per screen, cached in memory.
import { useCallback, useEffect, useRef, useState } from "react";
import { recordProductEvent } from "./diagnostics.js";
export { publicationState } from "./publication.js";

export const DATA_URL = import.meta.env.VITE_DATA_URL || "https://raw.githubusercontent.com/cianfru/cowboy-feed/site-data/";
const TTL = 60_000;
// The live service (Railway) re-prices the Saloon's files from Derive every few seconds; they are
// read from there when VITE_LIVE_URL is set, and from the published data if it does not answer.
export const LIVE_URL = import.meta.env.VITE_LIVE_URL || "";
const LIVE_PATH = /^questions\/(index|[A-Z0-9]+)\.json$/;
export const isLivePath = (path) => !!LIVE_URL && LIVE_PATH.test(path || "");
const LIVE_TTL = 3000;
export const LIVE_REFRESH_MS = 5000;
const cache = new Map();
const inflight = new Map();
export const DATA_TIMEOUT_MS = 8000;

async function read(path) {
  if (isLivePath(path)) {
    try { return await readFrom(LIVE_URL, path); } catch { /* the published copy below */ }
  }
  return readFrom(DATA_URL, path);
}

async function readFrom(base, path) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const r = await fetch(base + path, { cache: "no-cache", signal: controller.signal });
        if (!r.ok) throw Object.assign(new Error(`Data unavailable (${r.status}). It refreshes every 15 minutes.`), { status: r.status, code: "http" });
        let data;
        try { data = await r.json(); } catch { throw Object.assign(new Error("Published data could not be read. Try again shortly."), { code: "invalid_data" }); }
        if (!data || typeof data !== "object") throw Object.assign(new Error("Published data has an unsupported format."), { code: "invalid_data" });
        return data;
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => {
        reject(Object.assign(new Error("Data request timed out. Try again shortly."), { code: "timeout" }));
        controller.abort();
      }, DATA_TIMEOUT_MS); }),
    ]);
  } catch (error) {
    if (!error.code) error.code = "network";
    throw error;
  } finally { clearTimeout(timer); }
}

export async function load(path, { force = false } = {}) {
  if (inflight.has(path)) return inflight.get(path);
  const hit = cache.get(path);
  if (!force && hit && Date.now() - hit.at < (isLivePath(path) ? LIVE_TTL : TTL)) return hit.data;
  const request = (async () => {
    let data;
    try { data = await read(path); } catch (error) {
      // One bounded retry for a transient response; other failures offer an explicit retry in the UI.
      if (!(error?.status === 429 || error?.status >= 500)) {
        if (error?.status === 404) cache.delete(path);
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      data = await read(path);
    }
    cache.set(path, { at: Date.now(), data });
    return data;
  })().catch((error) => { if (error?.status === 404) cache.delete(path); throw error; });
  inflight.set(path, request);
  try { return await request; } finally { if (inflight.get(path) === request) inflight.delete(path); }
}

/** A published file, refreshed every refreshMs. A null path reads nothing (no request).
 *  missing is true when the file does not exist (HTTP 404), e.g. a wallet with no profile. */
export function useData(path, refreshMs = 5 * 60_000) {
  if (isLivePath(path)) refreshMs = Math.min(refreshMs, LIVE_REFRESH_MS);
  const [state, setState] = useState({ path, data: cache.get(path)?.data ?? null, error: null, missing: false });
  const refresh = useRef(null);
  const retry = useCallback(() => refresh.current?.(true), [path]);
  useEffect(() => {
    if (!path) return;
    let live = true;
    let hadError = false;
    setState({ path, data: cache.get(path)?.data ?? null, error: null, missing: false });
    const get = (force = false) => {
      setState((s) => ({ ...s, refreshing: true }));
      return load(path, { force }).then(
        (data) => {
          if (!live) return;
          if (hadError) recordProductEvent("data_recovered");
          hadError = false;
          setState({ path, data, error: null, missing: false, refreshing: false });
        },
        (error) => {
          if (!live) return;
          hadError = error?.status !== 404;
          if (hadError) recordProductEvent("data_unavailable");
          setState((s) => (error?.status === 404
            ? { path, data: null, error, missing: true, refreshing: false }
            : { path, data: s.data, error, missing: false, refreshing: false }));
        });
    };
    refresh.current = get;
    get();
    // A hidden tab stops refreshing; it catches up as soon as it is shown again.
    const t = setInterval(() => { if (typeof document === "undefined" || !document.hidden) get(); }, refreshMs);
    return () => { live = false; refresh.current = null; clearInterval(t); };
  }, [path, refreshMs]);
  if (!path) return { data: null, error: null, missing: false, loading: false, refreshing: false, retry };
  const current = state.path === path ? state : { data: cache.get(path)?.data ?? null, error: null, missing: false };
  return { ...current, loading: !current.data && !current.error, refreshing: !!current.refreshing, retry };
}
