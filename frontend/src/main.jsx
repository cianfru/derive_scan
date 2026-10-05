import React, { lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import "./styles.css";
import "./research.css";
import "./journey.css";
import "./boards.css";
import "./people.css";
import Shell from "./components/Shell.jsx";
import Landing from "./pages/Landing.jsx";
import { QUESTIONS_ON } from "./lib/flags.js";
const Radar = lazy(() => import("./pages/Radar.jsx"));
const Markets = lazy(() => import("./pages/Markets.jsx"));
const Coin = lazy(() => import("./pages/Coin.jsx"));
const Options = lazy(() => import("./pages/Options.jsx"));
const Flow = lazy(() => import("./pages/Flow.jsx"));
const Traders = lazy(() => import("./pages/Traders.jsx"));
const Trader = lazy(() => import("./pages/Trader.jsx"));
const Cohorts = lazy(() => import("./pages/Cohorts.jsx"));
// Questions stay out of the build's routes until VITE_QUESTIONS=1 (the owner's off switch).
const Questions = QUESTIONS_ON ? lazy(() => import("./pages/Questions.jsx")) : null;
const MyQuestions = QUESTIONS_ON ? lazy(() => import("./pages/MyQuestions.jsx")) : null;
const Board = QUESTIONS_ON ? lazy(() => import("./pages/Board.jsx")) : null;

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
          <Route path="traders/cohorts" element={<Cohorts />} />
          <Route path="trader/:address" element={<Trader />} />
          <Route path="flow" element={<Flow />} />
          {QUESTIONS_ON && <Route path="saloon" element={<Board />} />}
          {QUESTIONS_ON && <Route path="saloon/guided" element={<Questions />} />}
          {QUESTIONS_ON && <Route path="saloon/following" element={<Navigate to="/saloon/mine?tab=following" replace />} />}
          {QUESTIONS_ON && <Route path="saloon/mine" element={<MyQuestions />} />}
          {QUESTIONS_ON && <Route path="saloon/browse" element={<Board />} />}
          {QUESTIONS_ON && <Route path="saloon/:und" element={<Questions />} />}
          {QUESTIONS_ON && <Route path="q/:id" element={<Questions />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
    {/* Vercel Web Analytics: page views only, no custom events, no cookies, no personal data. */}
    <Analytics />
  </React.StrictMode>,
);
