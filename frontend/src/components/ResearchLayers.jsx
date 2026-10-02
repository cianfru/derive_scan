import { useEffect, useRef, useState } from "react";

const WIDTH = 560;
const HEIGHT = 500;
const LAYERS = [
  { id: "price", name: "Daily structure", y: -110 },
  { id: "options", name: "Options by expiry", y: 0 },
  { id: "wallets", name: "Wallet exposure", y: 110 },
];
function mixColor(from, to, amount) {
  const channels = [1, 3, 5].map((offset) =>
    Math.round(
      parseInt(from.slice(offset, offset + 2), 16) * (1 - amount) +
        parseInt(to.slice(offset, offset + 2), 16) * amount,
    ),
  );
  return `rgb(${channels.join(",")})`;
}
const DOTS = Array.from({ length: 29 * 23 }, (_, i) => ({
  u: (i % 29) / 14 - 1,
  v: Math.floor(i / 29) / 11 - 1,
}));

// Illustrative geometry only. These waves never consume or impersonate market data.
function heightAt(layer, u, v, time) {
  if (layer === "price") {
    return (
      19 * Math.sin(u * 3.8 + v * 2.1 - time * 0.8) +
      8 * Math.sin(u * 7 - v * 3 + time * 0.35) +
      u * 9
    );
  }
  if (layer === "options") {
    return (
      22 * (u * u - 0.4) +
      13 * Math.sin(v * 3.8 - time * 0.6) +
      5 * Math.cos(u * 3 + v * 2 + time * 0.4)
    );
  }
  const centre = Math.sin(time * 0.4) * 0.23;
  const peak = Math.exp(-4.5 * ((u - 0.38 - centre) ** 2 + (v + 0.2) ** 2));
  const trough = Math.exp(-4 * ((u + 0.42) ** 2 + (v - 0.25 - centre) ** 2));
  return 37 * peak - 31 * trough + 4 * Math.sin(u * 4 + v * 4 - time * 0.5);
}

export default function ResearchLayers({ layer, onSelect }) {
  const root = useRef(null);
  const canvas = useRef(null);
  const labels = useRef({});
  const selected = useRef(layer);
  const redraw = useRef(null);
  const scene = useRef({ time: 0, x: 0, y: 0, focus: [1, 0, 0] });
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    selected.current = layer;
    redraw.current?.();
  }, [layer]);

  useEffect(() => {
    const node = root.current;
    const surface = canvas.current;
    const ctx = surface.getContext("2d", { alpha: true });
    if (!ctx) return;
    const moving = !paused && !reduced;
    let frame = null,
      lastFrame = 0,
      visible = true,
      size = 1;
    let pointer = { x: 0, y: 0 };
    let palette;

    const readPalette = () => {
      const css = getComputedStyle(document.documentElement);
      palette = ["--orange", "--fg-2", "--up", "--seam-hi"].map((name) =>
        css.getPropertyValue(name).trim(),
      );
    };
    readPalette();

    const requestDraw = () => {
      if (frame === null && visible && !document.hidden)
        frame = requestAnimationFrame(draw);
    };
    const stop = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      lastFrame = 0;
    };
    const project = (x, y, z, yaw, pitch) => {
      const side = x * Math.cos(yaw) - z * Math.sin(yaw);
      const depth = x * Math.sin(yaw) + z * Math.cos(yaw);
      const vertical = y * Math.cos(pitch) + depth * Math.sin(pitch);
      const distance = depth * Math.cos(pitch) - y * Math.sin(pitch);
      const perspective = 1000 / (1000 + distance);
      return {
        x: WIDTH / 2 + side * perspective,
        y: HEIGHT / 2 + vertical * perspective,
        depth: distance,
        scale: perspective,
      };
    };

    function draw(now) {
      frame = null;
      // Rendering at 40 fps leaves room for the rest of the workspace.
      if (moving && lastFrame && now - lastFrame < 25) {
        requestDraw();
        return;
      }
      const elapsed = lastFrame ? Math.min((now - lastFrame) / 1000, 0.06) : 0;
      lastFrame = now;
      const state = scene.current;
      if (moving) state.time += elapsed;
      const follow = moving ? 1 - Math.exp(-elapsed * 5.5) : 1;
      if (moving) {
        state.x += (pointer.x - state.x) * follow;
        state.y += (pointer.y - state.y) * follow;
      } else if (reduced) {
        state.x = state.y = 0;
      }
      state.focus = state.focus.map(
        (value, i) =>
          value +
          ((LAYERS[i].id === selected.current ? 1 : 0) - value) * follow,
      );
      const yaw = -0.46 + state.x * 0.17;
      const pitch = 0.55 + state.y * 0.1;
      const time = state.time;
      const points = [];
      const edgePaths = [];

      LAYERS.forEach((plane, i) => {
        const focus = state.focus[i];
        // Open space around the selected field; the points themselves remain coherent.
        const base = plane.y + (i - 1) * (focus * 13 + state.focus[1] * 16);
        const sway = Math.sin(time * 0.55 + i * 0.8) * 5;
        for (const { u, v } of DOTS) {
          const height = heightAt(plane.id, u, v, time);
          const point = project(
            u * 174,
            base + sway - height,
            v * 110,
            yaw,
            pitch,
          );
          points.push({
            ...point,
            i,
            focus,
            height,
            edge: Math.abs(u) === 1 || Math.abs(v) === 1,
          });
        }
        // Four dotted boundaries keep the shape legible without drawing another chart line.
        edgePaths.push({
          focus,
          corners: [
            [-174, -110],
            [174, -110],
            [174, 110],
            [-174, 110],
          ].map(([x, z]) => project(x, base + sway, z, yaw, pitch)),
        });
        const anchor = project(105, base + 23, 130, yaw, pitch);
        const label = labels.current[plane.id];
        if (label) {
          label.style.left = `${(Math.min(WIDTH - 142, anchor.x - 28) / WIDTH) * 100}%`;
          label.style.top = `${(anchor.y / HEIGHT) * 100}%`;
        }
      });

      ctx.setTransform(size, 0, 0, size, 0, 0);
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      edgePaths.forEach(({ corners, focus }) => {
        ctx.beginPath();
        corners.forEach((p, i) =>
          i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
        );
        ctx.closePath();
        ctx.strokeStyle = palette[3];
        ctx.globalAlpha = 0.2 + focus * 0.18;
        ctx.lineWidth = 0.7;
        ctx.setLineDash([1, 7]);
        ctx.stroke();
      });
      ctx.setLineDash([]);
      // Far points paint first, preserving depth where the surfaces overlap.
      points.sort((a, b) => b.depth - a.depth);
      const colors = LAYERS.map((_, i) =>
        mixColor(palette[i === 2 ? 2 : 1], palette[0], state.focus[i]),
      );
      for (const p of points) {
        const depthFade = Math.max(0.32, Math.min(1, (370 - p.depth) / 490));
        ctx.globalAlpha = depthFade * (0.45 + p.focus * 0.45);
        ctx.fillStyle = colors[p.i];
        const radius = (p.edge ? 0.9 : 1.25 + p.focus * 0.35) * p.scale;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (moving) requestDraw();
    }

    const resize = new ResizeObserver(() => {
      const width = surface.clientWidth;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      size = (width / WIDTH) * dpr;
      surface.width = Math.round(width * dpr);
      surface.height = Math.round(((width * HEIGHT) / WIDTH) * dpr);
      requestDraw();
    });
    resize.observe(surface);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) requestDraw();
      else stop();
    });
    intersection.observe(node);
    const visibility = () => (document.hidden ? stop() : requestDraw());
    document.addEventListener("visibilitychange", visibility);
    const theme = new MutationObserver(() => {
      readPalette();
      requestDraw();
    });
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const move = (event) => {
      if (!moving || event.pointerType === "touch") return;
      const rect = surface.getBoundingClientRect();
      pointer = {
        x: Math.max(
          -1,
          Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1),
        ),
        y: Math.max(
          -1,
          Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1),
        ),
      };
    };
    const leave = () => {
      pointer = { x: 0, y: 0 };
    };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerleave", leave);
    redraw.current = requestDraw;
    requestDraw();
    return () => {
      stop();
      resize.disconnect();
      intersection.disconnect();
      theme.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerleave", leave);
      redraw.current = null;
    };
  }, [paused, reduced]);

  return (
    <div
      ref={root}
      className="research-object research-waves"
      role="group"
      aria-label="Illustrative 3D research layers"
    >
      <div className="wave-stage">
        <canvas ref={canvas} width={WIDTH} height={HEIGHT} aria-hidden="true" />
        {LAYERS.map((plane) => (
          <button
            key={plane.id}
            ref={(node) => {
              labels.current[plane.id] = node;
            }}
            className="wave-layer-label"
            aria-pressed={layer === plane.id}
            onClick={() => onSelect(plane.id)}
          >
            {plane.name}
          </button>
        ))}
      </div>
      <div className="wave-caption">
        <span>Illustrative research layers</span>
        {!reduced && (
          <button
            className="motion-control"
            onClick={() => setPaused((value) => !value)}
            aria-label={paused ? "Resume layer motion" : "Pause layer motion"}
          >
            {paused ? "Resume motion" : "Pause motion"}
          </button>
        )}
      </div>
    </div>
  );
}
