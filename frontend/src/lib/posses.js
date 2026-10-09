// Western names for the trader groups (owner, 9 October 2026: "cohorts" reads as machine-written, and the
// Shrimp-to-Leviathan names come from HyperTracker). The data keeps its codes (traders.PNL_COHORTS,
// SIZE_COHORTS in the backend); people see these names. Same bounds, same order.
export const POSSE = {
  // By results on expired options, best first.
  "Money Printer": "Legend",
  "Smart Money": "Sharpshooter",
  Grinder: "Wrangler",
  "Humble Earner": "Ranch Hand",
  "Exit Liquidity": "Stray Shot",
  "Semi-Rekt": "Saddle Sore",
  "Full Rekt": "Busted",
  "Giga-Rekt": "Boot Hill",
  // By premium traded, largest first.
  Leviathan: "Railroad Baron",
  Whale: "Cattle Baron",
  Dolphin: "Rancher",
  Fish: "Cowpoke",
  Shrimp: "Tenderfoot",
};

/** The name people see for a group code; unknown codes pass through. */
export const posseName = (code) => (code == null ? code : POSSE[code] || code);
