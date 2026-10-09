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

/** What each name means, then the group's bounds (owner, 9 October 2026: an (i) beside each name). */
export const POSSE_INFO = {
  "Money Printer": "A name the whole West knows. At least $1M gross profit on expired options.",
  "Smart Money": "Hits what they aim at. $100K to $1M gross profit on expired options.",
  Grinder: "Rounds up steady wins. $10K to $100K gross profit on expired options.",
  "Humble Earner": "Does the daily work for modest pay. Up to $10K gross profit on expired options.",
  "Exit Liquidity": "A few shots gone wide. Up to $10K gross loss on expired options.",
  "Semi-Rekt": "Took a beating on the trail. $10K to $100K gross loss on expired options.",
  "Full Rekt": "Lost the stake. $100K to $1M gross loss on expired options.",
  "Giga-Rekt": "Named after the gunfighters' graveyard. More than $1M gross loss on expired options.",
  Leviathan: "The railroads held the biggest money in the West. At least $10M of option premium traded.",
  Whale: "Owns the big herds. $1M to $10M of option premium traded.",
  Dolphin: "Runs a ranch of their own. $100K to $1M of option premium traded.",
  Fish: "A working cowhand. $10K to $100K of option premium traded.",
  Shrimp: "New to the trail. Less than $10K of option premium traded.",
};
