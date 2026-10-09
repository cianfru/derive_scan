import { Info } from "./ui.jsx";
import { POSSE_INFO, posseName } from "../lib/posses.js";

const KIND = (code) => (/premium/.test(POSSE_INFO[code] || "") ? "by size" : "by results");

/** A posse's Western name with an (i) saying what it means and its bounds. */
export default function PosseName({ code, as: Tag = "span", className = "" }) {
  if (!code) return null;
  const name = posseName(code), info = POSSE_INFO[code];
  const about = info && <Info label={`About ${name}`}>{name}, a posse {KIND(code)}: {info} Gross results count expired options before fees; market makers are left out.</Info>;
  // A heading keeps its own name; the (i) sits beside it, not inside.
  if (Tag !== "span") return <span className={`posse-name ${className}`.trim()}><Tag>{name}</Tag>{about}</span>;
  return <span className={`posse-name ${className}`.trim()}>{name}{about}</span>;
}
