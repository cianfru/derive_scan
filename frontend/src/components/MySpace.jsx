// The counts for "My space" (Saloon builds only, loaded lazily by the Shell): open positions in this
// browser and followed answers. Re-read on every navigation, after every save and on storage events.
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { loadPositions, onPositionsChange } from "../lib/positions.js";
import { useFollowsDoc } from "../lib/follows.js";
import { TESTNET_FILLS } from "../lib/flags.js";
import { positionDone } from "../lib/positionView.js";

const NET = TESTNET_FILLS ? "testnet" : "mainnet";

/** Positions still open, by Positions' own rule (positionDone), so the menu, the page and the home card agree. */
export function openCount(list, now = Date.now() / 1000) {
  return list.filter((p) => !positionDone(p, now)).length;
}

/** Renders nothing: hands the Shell the counts for "My space", which stays one menu throughout. */
export default function MySpaceCounts({ onCounts }) {
  const { pathname } = useLocation();
  const doc = useFollowsDoc();
  const [list, setList] = useState(() => loadPositions(NET));
  useEffect(() => { setList(loadPositions(NET)); }, [pathname]);
  useEffect(() => {
    const reread = () => setList(loadPositions(NET));
    const off = onPositionsChange(reread);
    window.addEventListener("storage", reread);
    return () => { off(); window.removeEventListener("storage", reread); };
  }, []);
  const positions = openCount(list);
  const following = doc.follows.length;
  useEffect(() => { onCounts({ positions, following }); }, [positions, following]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
