import { useCallback, useEffect, useRef, useState } from "react";
import { useData } from "../lib/data.js";
import { publicationState } from "../lib/publication.js";

function Feed({ path, refresh, onData }) {
  const r = useData(path, refresh);
  useEffect(() => { onData(path, r); }, [path, r.data, r.error, r.refreshing, r.loading, r.retry]);
  return null;
}

/**
 * Several published files at once (one hook per file, as data.js serves them, cached and shared).
 * Returns the elements to render (they draw nothing), the files by path, `ready` once every
 * file has loaded or failed, and the per-file loading results.
 */
export function useFeeds(paths, refresh = 5 * 60_000, anchor = {}) {
  const [got, setGot] = useState({});
  const onData = useCallback((path, r) => setGot((g) => (g[path]?.data === r.data && g[path]?.error === r.error
    && g[path]?.refreshing === r.refreshing && g[path]?.retry === r.retry ? g : { ...g, [path]: r })), []);
  const els = paths.map((p) => <Feed key={p} path={p} refresh={refresh} onData={onData} />);
  const ready = paths.every((p) => got[p] && (got[p].data != null || got[p].error != null));
  const data = Object.fromEntries(paths.map((p) => [p, got[p]?.data ?? null]));
  const publication = publicationState(Object.values(data), anchor.revision);
  const retried = useRef(null);
  const refreshing = paths.some((p) => got[p]?.refreshing);
  const signature = paths.join(",");
  const retry = () => { anchor.retry?.(); for (const p of paths) got[p]?.retry?.(); };
  useEffect(() => {
    if (!ready || refreshing) return;
    if (!publication.mismatch) { retried.current = null; return; }
    if (retried.current === signature) return;
    retried.current = signature;
    retry();
  }, [ready, refreshing, publication.mismatch, signature]);
  if (ready && publication.mismatch) els.push(<p key="publication-notice" className="page-meta" role="status">
    {refreshing ? "Refreshing snapshot files…" : "Some snapshot files are from different publications."}
    {!refreshing && <>{" "}<button type="button" className="text-control" onClick={retry}>Retry snapshot</button></>}
  </p>);
  return [els, data, ready, got, { ...publication, refreshing, retry }];
}
