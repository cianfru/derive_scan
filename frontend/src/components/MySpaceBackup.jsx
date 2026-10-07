import { useRef, useState } from "react";
import { followsPersistent, useFollowsDoc } from "../lib/follows.js";
import { persistent } from "../lib/positions.js";
import { exportMySpace, previewMySpace, restoreMySpace, savedCounts } from "../lib/mySpaceBackup.js";
import { Info } from "./ui.jsx";
import "../my-space.css";

const total = (counts) => counts.mainnet + counts.testnet + counts.following;

export default function MySpaceBackup({ onRestored }) {
  useFollowsDoc();
  const counts = savedCounts();
  const file = useRef(null);
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const download = () => {
    const a = document.createElement("a");
    a.href = `data:application/json;charset=utf-8,${encodeURIComponent(exportMySpace())}`;
    a.download = "cowboy-my-space.json";
    a.click();
  };
  const upload = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setPreview(null); setMessage(""); setError("");
    try { setPreview(previewMySpace(await f.text())); } catch (err) {
      setError(err.message === "Saved by a newer Cowboy" ? "Saved by a newer Cowboy. Nothing was restored." : "That is not a My space, Positions or Following file. Nothing was restored.");
    }
  };
  const restore = () => {
    try {
      const added = restoreMySpace(preview);
      setPreview(null);
      setMessage(`${total(added)} added. Existing records kept.${!persistent() || !followsPersistent() ? " Restored for this visit only; download a backup to keep them." : ""}`);
      onRestored?.();
    } catch { setError("The file could not be restored. Download a copy of the records currently available."); }
  };
  return (
    <details className="my-backup q-saved" id="my-space-backup">
      <summary>Back up My space<Info label="About My space backups">A local copy of your positions on both networks and your followed outcomes. Wallet access is not included. Clearing browser data removes local records. Restore merges a copy into this browser; duplicates are not added twice. Older Positions and Following files also work.</Info></summary>
      <dl className="my-backup-counts" aria-label="Saved locally">
        <div><dt>Mainnet records</dt><dd className="mono">{counts.mainnet}</dd></div>
        <div><dt>Testnet records</dt><dd className="mono">{counts.testnet}</dd></div>
        <div><dt>Following</dt><dd className="mono">{counts.following}</dd></div>
      </dl>
      <div className="q-card-actions">
        <button className="text-control" onClick={download} disabled={!total(counts)}>Download backup</button>
        <button className="text-control" onClick={() => file.current?.click()}>Restore a backup</button>
        <input ref={file} type="file" accept="application/json" hidden onChange={upload} aria-label="Restore a My space file" />
      </div>
      {preview && <section className="my-restore" aria-label="Restore preview">
        <h3>Ready to restore</h3>
        <p><span className="mono">{preview.counts.mainnet}</span> mainnet records · <span className="mono">{preview.counts.testnet}</span> testnet records · <span className="mono">{preview.counts.following}</span> follows</p>
        <p className="q-note">Merge into this browser. Existing records stay; matching receipts can update.</p>
        <div className="q-card-actions"><button className="btn" onClick={restore}>Restore records</button><button className="text-control" onClick={() => setPreview(null)}>Cancel</button></div>
      </section>}
      {message && <p className="q-note" role="status">{message}</p>}
      {error && <p className="q-note warn" role="alert">{error}</p>}
    </details>
  );
}
