import { useEffect, useLayoutEffect, useRef, useState } from "react";

// Keep SVG labels at readable sizes rather than shrinking a desktop viewBox on phones.
export function useElementWidth(initial) {
  const ref = useRef(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/**
 * The layout size {w, h} of an element (not its transformed box), for charts drawn in real pixels.
 * Returns a callback ref, so it follows an element that mounts after the first render (a card that
 * was loading). Read once before paint, then on every resize; `initial` where ResizeObserver is
 * missing (tests), null until measured otherwise.
 */
export function useElementSize(initial) {
  const [el, setEl] = useState(null);
  const [size, setSize] = useState(() => (typeof ResizeObserver === "undefined" ? initial : null));
  useLayoutEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const read = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w > 0 && h > 0) setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, size];
}
