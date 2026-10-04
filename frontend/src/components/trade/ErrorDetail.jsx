// Testnet builds only: the raw facts behind a plain error message, in an (i) beside it, so a failed
// step can be told apart (wallet or Derive, which call, which code). Every other build renders nothing:
// TESTNET_FILLS is a build-time constant, so this drops out of them.
import { Info } from "../ui.jsx";
import { TESTNET_FILLS } from "../../lib/flags.js";

export default function ErrorDetail({ detail }) {
  if (!TESTNET_FILLS || !detail) return null;
  const rows = [["Step", detail.step], ["Source", detail.source], ["Code", detail.code], ["Message", detail.message], ["Data", detail.data]];
  return (
    <Info label="Details for testing">
      <span className="tr-detail">
        <b>Details for testing</b>
        {rows.map(([k, v]) => <span key={k} className="tr-detail-row"><span>{k}</span> <span className="mono">{v === "" || v == null ? "none" : String(v)}</span></span>)}
      </span>
    </Info>
  );
}
