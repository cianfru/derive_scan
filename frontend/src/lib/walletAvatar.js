import { draw, walletSeed } from "./walletName.js";

// Identity colours are fixed by address; names, rank and trading results do not affect them.
const INKS = [
  ["ember", "#ffa464", "#9c4514"],
  ["amber", "#ecc572", "#856016"],
  ["sand", "#d6c3a3", "#77603e"],
  ["ivory", "#e8e5dc", "#4c4842"],
  ["steel", "#a6bbcd", "#3d627d"],
  ["denim", "#92b3e4", "#345b91"],
  ["indigo", "#acaee6", "#565991"],
  ["violet", "#c7a4de", "#795193"],
  ["orchid", "#d5a8d1", "#89547f"],
  ["rose", "#d7a6b9", "#914f6d"],
  ["aqua", "#92bdce", "#386e80"],
  ["clay", "#ceb2a7", "#845a48"],
];

export function walletAvatar(address) {
  const seed = walletSeed(address);
  const [ink, dark, light] = INKS[draw(seed, 0x6a09e667) % INKS.length];
  const hue = draw(seed, 0xbb67ae85) % 360;
  const saturation = 32 + draw(seed, 0x3c6ef372) % 14;
  const tone = draw(seed, 0xa54ff53a) % 7;
  return {
    key: `${ink}-${hue}-${saturation}-${tone}`,
    dark, light,
    background: `hsl(${hue} ${saturation}% ${18 + tone}%)`,
    backgroundLight: `hsl(${hue} ${saturation}% ${85 + tone}%)`,
  };
}
