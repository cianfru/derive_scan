import { useCallback, useEffect, useState } from "react";
import { useData } from "../lib/data.js";

function Feed({ path, refresh, onData }) {
  const r = useData(path, refresh);
  useEffect(() => { onData(path, r); }, [path, r.data, r.error]);
  return null;
}

/**
 * Several published files at once (one hook per file, as data.js serves them, cached and shared).
 * Returns the elements to render (they draw nothing), the files by path, and `ready` once every
 * file has loaded or failed.
 */
export function useFeeds(paths, refresh = 5 * 60_000) {
  const [got, setGot] = useState({});
  const onData = useCallback((path, r) => setGot((g) => (g[path]?.data === r.data && g[path]?.error === r.error ? g : { ...g, [path]: r })), []);
  const els = paths.map((p) => <Feed key={p} path={p} refresh={refresh} onData={onData} />);
  const ready = paths.every((p) => got[p] && (got[p].data != null || got[p].error != null));
  const data = Object.fromEntries(paths.map((p) => [p, got[p]?.data ?? null]));
  return [els, data, ready];
}
