// Torq reads only the published app data (site-data branch): one file per screen, cached in memory.
import { useEffect, useState } from "react";

export const DATA_URL = import.meta.env.VITE_DATA_URL || "https://raw.githubusercontent.com/cianfru/derive_scan/site-data/";
const TTL = 60_000;
const cache = new Map();

export async function load(path) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const r = await fetch(DATA_URL + path, { cache: "no-cache" });
  if (!r.ok) throw new Error(`Data unavailable (${r.status}). It refreshes every 15 minutes.`);
  const data = await r.json();
  cache.set(path, { at: Date.now(), data });
  return data;
}

export function useData(path, refreshMs = 5 * 60_000) {
  const [state, setState] = useState({ data: cache.get(path)?.data ?? null, error: null });
  useEffect(() => {
    let live = true;
    const get = () => load(path).then(
      (data) => live && setState({ data, error: null }),
      (error) => live && setState((s) => ({ data: s.data, error })));
    get();
    const t = setInterval(get, refreshMs);
    return () => { live = false; clearInterval(t); };
  }, [path, refreshMs]);
  return state;
}
