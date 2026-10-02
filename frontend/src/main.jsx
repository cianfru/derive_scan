import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./styles.css";
import Shell from "./components/Shell.jsx";
import Landing from "./pages/Landing.jsx";
import Markets from "./pages/Markets.jsx";
import Coin from "./pages/Coin.jsx";
import Options from "./pages/Options.jsx";
import Flow from "./pages/Flow.jsx";
import Traders from "./pages/Traders.jsx";
import Trader from "./pages/Trader.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Landing />} />
          <Route path="markets" element={<Markets />} />
          <Route path="coin/:und" element={<Coin />} />
          <Route path="options" element={<Options />} />
          <Route path="traders" element={<Traders />} />
          <Route path="trader/:address" element={<Trader />} />
          <Route path="flow" element={<Flow />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
