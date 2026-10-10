import React, { lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import "./styles.css";
import "./research.css";
import "./journey.css";
import "./boards.css";
import "./people.css";
import "./mobile.css";
import "./mobile-research.css";
import Shell from "./components/Shell.jsx";
import Landing from "./pages/Landing.jsx";
import { QUESTIONS_ON } from "./lib/flags.js";
import { watchStaleBuild } from "./lib/staleBuild.js";
watchStaleBuild();
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
const Saloon = QUESTIONS_ON ? lazy(() => import("./pages/Saloon.jsx")) : null;
const Home = QUESTIONS_ON ? lazy(() => import("./pages/Home.jsx")) : null;
// The guided flow and the per-coin Saloon retired into the chart (owner, 7 October 2026); old links land on it.
function ToChart() {
  const { und } = useParams();
  return <Navigate to={und ? `/saloon?coin=${encodeURIComponent(und.toUpperCase())}` : "/saloon"} replace />;
}

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
          <Route path="traders/posses" element={<Cohorts />} />
          <Route path="traders/cohorts" element={<Navigate to="/traders/posses" replace />} />
          <Route path="trader/:address" element={<Trader />} />
          <Route path="flow" element={<Flow />} />
          {QUESTIONS_ON && <Route path="home" element={<Home />} />}
          {QUESTIONS_ON && <Route path="saloon" element={<Saloon />} />}
          {QUESTIONS_ON && <Route path="saloon/guided" element={<ToChart />} />}
          {QUESTIONS_ON && <Route path="saloon/following" element={<Navigate to="/saloon/mine?tab=following" replace />} />}
          {QUESTIONS_ON && <Route path="saloon/mine" element={<MyQuestions />} />}
          {QUESTIONS_ON && <Route path="saloon/browse" element={<Navigate to="/saloon?view=list" replace />} />}
          {QUESTIONS_ON && <Route path="saloon/:und" element={<ToChart />} />}
          {QUESTIONS_ON && <Route path="q/:id" element={<Questions />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
    {/* Page views. Fixed product event codes are separately opt-in via VITE_PRODUCT_EVENTS. */}
    <Analytics />
  </React.StrictMode>,
);
