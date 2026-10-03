import { useEffect, useRef, useState } from "react";

// Width and height of a box whose size CSS sets, so an SVG is drawn at its real pixel size.
export function useElementSize(initialWidth, initialHeight) {
  const ref = useRef(null);
  const [size, setSize] = useState([initialWidth, initialHeight]);
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width), h = Math.round(entry.contentRect.height);
      if (w > 0 && h > 0) setSize((s) => (s[0] === w && s[1] === h ? s : [w, h]));
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, size[0], size[1]];
}
