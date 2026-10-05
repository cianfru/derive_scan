// Cowboy reads only the published app data (site-data branch): one file per screen, cached in memory.
import { useEffect, useState } from "react";

export const DATA_URL = import.meta.env.VITE_DATA_URL || "https://raw.githubusercontent.com/cianfru/cowboy-feed/site-data/";
const TTL = 60_000;
const cache = new Map();

export async function load(path) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const r = await fetch(DATA_URL + path, { cache: "no-cache" });
  if (!r.ok) throw Object.assign(new Error(`Data unavailable (${r.status}). It refreshes every 15 minutes.`), { status: r.status });
  const data = await r.json();
  cache.set(path, { at: Date.now(), data });
  return data;
}

/** A published file, refreshed every refreshMs. A null path reads nothing (no request).
 *  missing is true when the file does not exist (HTTP 404), e.g. a wallet with no profile. */
export function useData(path, refreshMs = 5 * 60_000) {
  const [state, setState] = useState({ path, data: cache.get(path)?.data ?? null, error: null, missing: false });
  useEffect(() => {
    if (!path) return;
    let live = true;
    setState({ path, data: cache.get(path)?.data ?? null, error: null, missing: false });
    const get = () => load(path).then(
      (data) => live && setState({ path, data, error: null, missing: false }),
      (error) => live && setState((s) => (error?.status === 404
        ? { path, data: null, error, missing: true }
        : { path, data: s.data, error, missing: false })));
    get();
    const t = setInterval(get, refreshMs);
    return () => { live = false; clearInterval(t); };
  }, [path, refreshMs]);
  if (!path) return { data: null, error: null, missing: false };
  return state.path === path ? state : { data: cache.get(path)?.data ?? null, error: null, missing: false };
}
