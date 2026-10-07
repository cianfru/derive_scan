import { readFileSync } from "node:fs";

const read = (name) => JSON.parse(readFileSync(new URL(`../src/fixtures/questions/${name}.json`, import.meta.url), "utf8"));
export const NOW = 1791036600;
const BASE = 1791036000;

function coin(und, value) {
  const candles = (seconds) => Array.from({ length: 80 }, (_, i) => {
    const price = value * (0.96 + i / 2000);
    return [Math.floor(BASE / seconds) * seconds - (80 - i) * seconds, price, price * 1.005, price * 0.995, price, 100];
  });
  return { und, candles: { "4h": candles(14400), "1d": candles(86400) }, latest: {}, signals: {}, ribbon: {},
    questions: true, options: null, generated_at: BASE, backfilled: {} };
}

export function documents() {
  const btc = read("BTC"), hype = read("HYPE");
  const assets = [{ und: "BTC", price: btc.index }, { und: "HYPE", price: hype.index }];
  return {
    "questions/index.json": { ...read("index"), coins: read("index").coins.filter((c) => ["BTC", "HYPE"].includes(c.und)) },
    "questions/BTC.json": btc, "questions/HYPE.json": hype,
    "coins/BTC.json": coin("BTC", btc.index), "coins/HYPE.json": coin("HYPE", hype.index),
    "markets.json": { generated_at: BASE, bars: { "1d": Math.floor(BASE / 86400) * 86400 },
      context: {}, consensus: {}, coins: assets.map((c) => ({ ...c, has_options: true, questions: true,
        chg_24h: 1, chg_1d: 1, signal_1d: "WAIT", regime_1d: "MARKUP",
        engine_comparison: { "1d": { status: "ready", timeframe: "1d", observed_at: BASE } } })) },
  };
}

export async function mockPublicData(page, { fail = [], live = false } = {}) {
  const docs = documents();
  const sockets = [];
  await page.clock.install({ time: new Date(NOW * 1000) });
  await page.route("**/site-data/**", async (route) => {
    const path = new URL(route.request().url()).pathname.split("/site-data/")[1];
    if (fail.includes(path)) return route.fulfill({ status: 503, body: "unavailable" });
    if (!(path in docs)) return route.fulfill({ status: 404, body: "missing" });
    return route.fulfill({ json: docs[path] });
  });
  await page.routeWebSocket(/\/v3\/ws$/, (ws) => {
    sockets.push(ws);
    ws.onMessage((text) => {
      const msg = JSON.parse(String(text));
      ws.send(JSON.stringify({ id: msg.id, result: [] }));
      if (live && msg.method === "subscribe") for (const channel of msg.params.channels) {
        const und = channel.split(".")[1];
        ws.send(JSON.stringify({ method: "subscription", params: { channel,
          data: { timestamp: NOW * 1000, feeds: { [und]: { price: und === "BTC" ? "85000" : "89", price_prev_daily: "84000" } } } } }));
      }
    });
  });
  return { docs, disconnect: () => { for (const socket of sockets) socket.close(); },
    pushPrice: (und, price, ts = NOW) => { for (const socket of sockets) socket.send(JSON.stringify({
      method: "subscription", params: { channel: `spot_feed.${und}`,
        data: { timestamp: ts * 1000, feeds: { [und]: { price: String(price), price_prev_daily: String(price) } } } },
    })); } };
}
