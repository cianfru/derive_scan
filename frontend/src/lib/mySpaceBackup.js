import { exportFollows, importFollows, loadDoc, prepareFollowsImport } from "./follows.js";
import { exportPositions, importPositions, JOURNAL_VERSION, loadPositions, NETWORKS, preparePositionImport } from "./positions.js";

export function savedCounts() {
  return { mainnet: loadPositions("mainnet").length, testnet: loadPositions("testnet").length, following: loadDoc().follows.length };
}

export function exportMySpace(now = Date.now() / 1000) {
  return JSON.stringify({ kind: "cowboy-my-space", version: 1, saved_ts: Math.floor(now),
    positions: JSON.parse(exportPositions()), following: JSON.parse(exportFollows()) }, null, 1);
}

export function previewMySpace(text) {
  const raw = JSON.parse(text);
  const combined = raw?.kind === "cowboy-my-space";
  if (combined && Number(raw.version) !== 1) throw new Error("Saved by a newer Cowboy");
  const followsOnly = raw?.kind === "cowboy-follows" || (!raw?.networks && Array.isArray(raw?.follows))
    || (Array.isArray(raw) && raw.length > 0 && raw.every((r) => r && typeof r.id === "string" && r.contracts == null));
  const positionsRaw = combined ? raw.positions : followsOnly ? null : raw;
  const followsRaw = combined ? raw.following : followsOnly ? raw : null;
  if (combined && (!positionsRaw || !followsRaw)) throw new Error("Not a My space file");
  const networks = positionsRaw ? preparePositionImport(positionsRaw) : null;
  const following = followsRaw ? prepareFollowsImport(followsRaw) : null;
  return {
    positions: networks ? { kind: "cowboy-journal", version: JOURNAL_VERSION, networks } : null,
    following: following ? { kind: "cowboy-follows", version: following.version, budget: following.budget, follows: following.follows } : null,
    counts: { mainnet: networks?.mainnet.length || 0, testnet: networks?.testnet.length || 0, following: following?.follows.length || 0 },
  };
}

export function restoreMySpace(preview) {
  const before = savedCounts();
  if (preview.positions) importPositions(JSON.stringify(preview.positions));
  if (preview.following) importFollows(JSON.stringify(preview.following));
  const after = savedCounts();
  return Object.fromEntries([...NETWORKS, "following"].map((k) => [k, after[k] - before[k]]));
}
