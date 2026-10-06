import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const page = (name) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: { main: page("index.html"), control: page("control.html") } } },
  test: { environment: "jsdom" },
});
