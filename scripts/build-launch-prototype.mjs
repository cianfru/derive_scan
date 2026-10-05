import { build } from "../frontend/node_modules/esbuild/lib/main.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] || path.join(root, "artifacts/cowboy-launch-prototype.html"));
const result = await build({
  entryPoints: [path.join(root, "frontend/src/prototype/main.jsx")], bundle: true, write: false,
  outdir: path.join(root, "artifacts"), minify: true, format: "iife", jsx: "automatic", target: "es2020",
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, legalComments: "eof",
  loader: { ".svg": "dataurl", ".jpg": "dataurl", ".png": "dataurl", ".woff2": "dataurl" },
});
const js = result.outputFiles.find((f) => f.path.endsWith(".js")).text.replace(/<\/script/gi, "<\\/script");
const css = result.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
const html = `<!doctype html><html lang="en" data-theme="light"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cowboy · Product prototype</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`;
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, html);
console.log(`Standalone prototype: ${out} (${Buffer.byteLength(html).toLocaleString()} bytes)`);
