// The header's disclosure menus (Saloon builds): Markets, Traders and My space.
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";

const KEYS = ["ArrowDown", "ArrowUp", "Home", "End"];

/**
 * A disclosure menu: a real button with aria-expanded and aria-controls. Opening moves focus to the
 * first link; the arrow keys, Home and End move between links; Escape or a pick closes it and returns
 * focus to the button; tabbing out or a tap elsewhere closes it. Items: { to, text, count, current }.
 * `current` (a function of the location) overrides the plain path match, for links that differ only
 * by their query.
 */
export default function NavMenu({ id, label, items, active, className = "", align = "start", ...rest }) {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const menu = useRef(null);
  const wrap = useRef(null);
  const loc = useLocation();
  useEffect(() => { setOpen(false); }, [loc.pathname, loc.search]);
  useEffect(() => {
    if (!open) return undefined;
    menu.current?.querySelector("a")?.focus();
    const key = (e) => {
      if (e.key === "Escape") { e.preventDefault(); setOpen(false); btn.current?.focus(); return; }
      if (!KEYS.includes(e.key) || !wrap.current?.contains(document.activeElement)) return;
      const links = [...(menu.current?.querySelectorAll("a") || [])];
      if (!links.length) return;
      e.preventDefault();
      const at = links.indexOf(document.activeElement);
      const next = e.key === "Home" ? 0 : e.key === "End" ? links.length - 1
        : e.key === "ArrowDown" ? (at + 1) % links.length : (at <= 0 ? links.length - 1 : at - 1);
      links[next].focus();
    };
    const away = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", away);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("pointerdown", away); };
  }, [open]);
  const blur = (e) => { if (e.relatedTarget && !wrap.current?.contains(e.relatedTarget)) setOpen(false); };
  const pick = () => { setOpen(false); btn.current?.focus(); };
  const menuId = `${id}-menu`;
  return (
    <div className={`nav-more${className ? ` ${className}` : ""}`} ref={wrap} onBlur={blur} {...rest}>
      <button ref={btn} type="button" className={`nav-more-btn${active ? " active" : ""}`} aria-expanded={open} aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}>
        {label}<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" /></svg>
      </button>
      {open && (
        <div id={menuId} ref={menu} className={`nav-menu nav-menu-${align}`} role="group" aria-label={`${label} pages`}>
          {items.map(({ to, text, count, current }) => {
            const on = current ? current(loc) : loc.pathname === to;
            return (
              <Link key={to} to={to} onClick={pick} className={on ? "active" : undefined} aria-current={on ? "page" : undefined}>
                {text}{count > 0 && <span className="nav-count mono">{count}</span>}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

const tabOf = (loc) => new URLSearchParams(loc.search).get("tab");
export const onPositions = (loc) => loc.pathname === "/saloon/mine" && tabOf(loc) !== "following";
export const onFollowing = (loc) => loc.pathname === "/saloon/following" || (loc.pathname === "/saloon/mine" && tabOf(loc) === "following");

/** "My space": Positions and Following, for every visitor of a Saloon build. Counts come from MySpace.jsx. */
export function MySpace({ positions = 0, following = 0, counted = false }) {
  const loc = useLocation();
  return (
    <NavMenu id="my-space" label="My space" className="nav-myspace" align="end" active={onPositions(loc) || onFollowing(loc)} data-counted={counted ? "1" : undefined}
      items={[
        { to: "/saloon/mine", text: "Positions", count: positions, current: onPositions },
        { to: "/saloon/mine?tab=following", text: "Following", count: following, current: onFollowing },
      ]} />
  );
}
