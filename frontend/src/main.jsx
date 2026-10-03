import React, { lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./styles.css";
import "./research.css";
import "./journey.css";
import Shell from "./components/Shell.jsx";
import Landing from "./pages/Landing.jsx";
const Radar = lazy(() => import("./pages/Radar.jsx"));
const Markets = lazy(() => import("./pages/Markets.jsx"));
const Coin = lazy(() => import("./pages/Coin.jsx"));
const Options = lazy(() => import("./pages/Options.jsx"));
const Flow = lazy(() => import("./pages/Flow.jsx"));
const Traders = lazy(() => import("./pages/Traders.jsx"));
const Trader = lazy(() => import("./pages/Trader.jsx"));

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Landing />} />
          <Route path="markets" element={<Markets />} />
          <Route path="radar" element={<Radar />} />
          <Route path="coin/:und" element={<Coin />} />
          <Route path="options" element={<Options />} />
          <Route path="traders" element={<Traders />} />
          <Route path="trader/:address" element={<Trader />} />
          <Route path="flow" element={<Flow />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
