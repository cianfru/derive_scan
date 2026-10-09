import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

const positions = new Map();
const names = { "/": "Cowboy", "/markets": "Markets", "/radar": "Radar", "/options": "Options",
  "/flow": "Flow", "/traders": "Traders", "/traders/posses": "Posses", "/saloon/mine": "Positions",
  "/saloon/following": "Following", "/saloon": "Saloon" };

export function pageTitle(pathname, search = "") {
  const params = new URLSearchParams(search);
  if (pathname === "/saloon/mine" && params.get("tab") === "following") return "Following · Cowboy";
  if (pathname.startsWith("/coin/")) return `${pathname.split("/")[2].toUpperCase()} · Markets · Cowboy`;
  if (pathname.startsWith("/q/")) return "Outcome details · Cowboy";
  if (pathname.startsWith("/trader/")) return "Trader profile · Cowboy";
  const coin = params.get("coin");
  if (pathname === "/saloon" && /^[A-Z0-9]{1,12}$/i.test(coin || "")) return `${coin.toUpperCase()} · Saloon · Cowboy`;
  return names[pathname] ? `${names[pathname]}${pathname === "/" ? "" : " · Cowboy"}` : "Cowboy";
}

/** Back returns to the same reading, including after an asynchronously loaded view grows. */
export function usePageNavigation() {
  const location = useLocation();
  const navigation = useNavigationType();
  const previousPath = useRef(null);
  useEffect(() => { document.title = pageTitle(location.pathname, location.search); }, [location.pathname, location.search]);
  useEffect(() => {
    const old = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => { window.history.scrollRestoration = old; };
  }, []);
  useLayoutEffect(() => {
    const { key, pathname, hash } = location;
    const changed = previousPath.current !== pathname;
    previousPath.current = pathname;
    let restoring = false, observer, timer, frame;
    const remember = () => {
      if (restoring) return;
      positions.set(key, window.scrollY);
      if (positions.size > 100) positions.delete(positions.keys().next().value);
    };
    const stop = () => { restoring = false; observer?.disconnect(); clearTimeout(timer); cancelAnimationFrame(frame); };
    const saved = positions.get(key);
    if (navigation === "POP" && saved != null && !hash) {
      restoring = true;
      const restore = () => {
        if (!restoring) return;
        window.scrollTo(0, saved);
        if (Math.abs(window.scrollY - saved) < 2) stop();
      };
      if (typeof ResizeObserver !== "undefined") { observer = new ResizeObserver(restore); observer.observe(document.body); }
      timer = setTimeout(stop, 5000);
      frame = requestAnimationFrame(restore);
    } else if (changed && !hash) window.scrollTo(0, 0);
    const userMoved = () => { stop(); remember(); };
    window.addEventListener("scroll", remember, { passive: true });
    window.addEventListener("wheel", userMoved, { passive: true });
    window.addEventListener("touchstart", userMoved, { passive: true });
    window.addEventListener("keydown", userMoved);
    return () => {
      stop();
      window.removeEventListener("scroll", remember);
      window.removeEventListener("wheel", userMoved);
      window.removeEventListener("touchstart", userMoved);
      window.removeEventListener("keydown", userMoved);
    };
  }, [location.key, location.pathname, location.hash, navigation]);
}
