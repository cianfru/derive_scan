import { useEffect, useRef, useState } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
const visible = (x) => !x.closest('.sr-only, [hidden], [aria-hidden="true"]')
  && !(x.tagName !== "SUMMARY" && x.closest("details:not([open])"))
  && getComputedStyle(x).display !== "none" && getComputedStyle(x).visibility !== "hidden";

/** Mobile drawers isolate the background; desktop tickets stay in the page's normal column. */
export function useSheetFocus(open, sheetRef, openerRef, close, mediaQuery = "(max-width: 1279px)") {
  const [modal, setModal] = useState(() => typeof matchMedia !== "function" || matchMedia(mediaQuery).matches);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia(mediaQuery), update = () => setModal(media.matches);
    update(); media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [mediaQuery]);
  useEffect(() => {
    const el = sheetRef.current;
    if (!open || !el) return undefined;
    const items = (scope = el) => [...scope.querySelectorAll(FOCUSABLE)].filter(visible)
      .filter((x) => modal || !x.classList.contains("q-sheet-close"));
    const background = [];
    const bodyOverflow = document.body.style.overflow, rootOverflow = document.documentElement.style.overflow;
    if (modal) {
      for (let node = el; node && node !== document.body; node = node.parentElement) {
        for (const sibling of node.parentElement?.children || []) {
          if (sibling === node || sibling.classList.contains("pop") || sibling.matches(".sl-backdrop, .q-sheet-backdrop, .bd-look-backdrop")) continue;
          background.push([sibling, sibling.getAttribute("inert")]); sibling.setAttribute("inert", "");
        }
      }
      document.body.style.overflow = "hidden"; document.documentElement.style.overflow = "hidden";
    }
    (items()[0] || el).focus?.();
    const key = (e) => {
      const pop = document.querySelector('.pop[role="dialog"]');
      if (e.key === "Escape" && !e.defaultPrevented && !pop) { e.preventDefault(); closeRef.current(); return; }
      if (!modal || e.key !== "Tab" || e.defaultPrevented) return;
      const scope = pop || el, list = items(scope);
      if (!list.length) { e.preventDefault(); scope.focus?.(); return; }
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || !scope.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !scope.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    const back = openerRef.current || document.activeElement;
    return () => {
      document.removeEventListener("keydown", key);
      for (const [node, inert] of background) { if (inert == null) node.removeAttribute("inert"); else node.setAttribute("inert", inert); }
      if (modal) { document.body.style.overflow = bodyOverflow; document.documentElement.style.overflow = rootOverflow; }
      if (back?.isConnected) back.focus?.();
      else if (back?.dataset?.key) [...document.querySelectorAll(".sch-bubble")].find((n) => n.dataset.key === back.dataset.key)?.focus?.();
    };
  }, [open, modal]);
  return modal;
}
