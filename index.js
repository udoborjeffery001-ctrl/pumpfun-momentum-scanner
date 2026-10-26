import express from "express";
import dotenv from "dotenv";
import { WebSocket } from "ws";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, "../public")));

const cfg = {
  minMc: Number(process.env.MIN_MC_USD || 20000),
  maxAge: Number(process.env.MAX_AGE_MINUTES || 30),
  minBuyers: Number(process.env.MIN_BUYERS || 8),
  maxTop1: Number(process.env.MAX_TOP1_PCT || 5),
  maxTop5: Number(process.env.MAX_TOP5_PCT || 20),
  maxTop10: Number(process.env.MAX_TOP10_PCT || 30),
  maxSellRatio: Number(process.env.MAX_SELL_RATIO || 0.35)
};

const coins = new Map();

function cleanCoin(c) {
  return {
    ...c,
    ageMinutes: Math.max(0, (Date.now() - c.launchMs) / 60000),
    buySellRatio: c.sells ? c.buys / c.sells : c.buys,
    sellRatio: c.buys + c.sells ? c.sells / (c.buys + c.sells) : 1
  };
}

function score(c) {
  const age = cleanCoin(c);
  const buyerScore = Math.min(age.uniqueBuyers / 100, 1) * 30;
  const flowScore = Math.min((age.buys / Math.max(age.sells, 1)) / 8, 1) * 30;
  const acceleration = Math.min(age.buyVelocity / 20, 1) * 20;
  const liquidity = Math.min((age.liquidityUsd || 0) / 30000, 1) * 10;
  const riskPenalty = (age.rugFlags || 0) * 15;
  return Math.max(0, Math.round(buyerScore + flowScore + acceleration + liquidity - riskPenalty));
}

function passes(c) {
  const x = cleanCoin(c);
  return x.ageMinutes < cfg.maxAge &&
    x.marketCapUsd >= cfg.minMc &&
    x.uniqueBuyers >= cfg.minBuyers &&
    x.top1Pct <= cfg.maxTop1 &&
    x.top5Pct <= cfg.maxTop5 &&
    x.top10Pct <= cfg.maxTop10 &&
    x.sellRatio <= cfg.maxSellRatio &&
    (x.sniperCount || 0) === 0 &&
    (x.rugFlags || 0) === 0;
}

function snapshot() {
  return [...coins.values()]
    .map(c => ({...cleanCoin(c), momentumScore: score(c), passed: passes(c)}))
    .filter(c => c.ageMinutes < cfg.maxAge)
    .sort((a,b) => b.momentumScore - a.momentumScore)
    .slice(0, 100);
}

app.get("/api/coins", (_, res) => res.json({
  updatedAt: new Date().toISOString(),
  config: cfg,
  coins: snapshot()
}));

app.get("/api/health", (_, res) => res.json({ok:true, bitquery:!!process.env.BITQUERY_TOKEN}));

// Bitquery Pump.fun websocket.
// The query asks for new token creation events and live trades.
// The exact returned fields can evolve; normalize() keeps the dashboard stable.
const launchQuery = `subscription {
  Solana {
    TokenSupplyUpdates(
      where: {
        Instruction: {
          Program: {
            Address: {is: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"}
            Method: {in: ["create","create_v2"]}
          }
        }
      }
    ) {
      Block { Time }
      Transaction { Signer Signature }
      TokenSupplyUpdate {
        Amount
        PostBalance
        Currency {
          Symbol Name MintAddress Uri
        }
      }
    }
  }
}`;

function normalizeLaunch(x) {
  const u = x?.data?.Solana?.TokenSupplyUpdates?.[0] || x?.Solana?.TokenSupplyUpdates?.[0] || x;
  const t = u?.TokenSupplyUpdate || {};
  const cur = t.Currency || {};
  const launchMs = Date.parse(u?.Block?.Time || new Date().toISOString());
  const mint = cur.MintAddress || cur.Address;
  if (!mint) return null;
  return {
    mint,
    name: cur.Name || "Unknown",
    symbol: cur.Symbol || "???",
    launchMs,
    creator: u?.Transaction?.Signer || "",
    signature: u?.Transaction?.Signature || "",
    marketCapUsd: 0,
    liquidityUsd: 0,
    buys: 0,
    sells: 0,
    uniqueBuyers: 0,
    buyVelocity: 0,
    top1Pct: 100,
    top5Pct: 100,
    top10Pct: 100,
    sniperCount: 0,
    rugFlags: 0,
    xUrl: "",
    websiteUrl: ""
  };
}

function addLaunch(c) {
  if (!c || coins.has(c.mint)) return;
  coins.set(c.mint, c);
}

async function startBitquery() {
  if (!process.env.BITQUERY_TOKEN) {
    console.warn("BITQUERY_TOKEN missing: running in demo/empty mode.");
    return;
  }
  const ws = new WebSocket("wss://streaming.bitquery.io/graphql", {
    headers: { Authorization: `Bearer ${process.env.BITQUERY_TOKEN}` }
  });
  ws.on("open", () => {
    ws.send(JSON.stringify({ type:"connection_init", payload:{} }));
    ws.send(JSON.stringify({
      id:"launches",
      type:"start",
      payload:{ query: launchQuery, variables:{} }
    }));
  });
  ws.on("message", raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "data") addLaunch(normalizeLaunch(msg.payload));
    } catch {}
  });
  ws.on("close", () => setTimeout(startBitquery, 5000));
  ws.on("error", () => ws.close());
}
startBitquery();

// Age out stale tokens.
setInterval(() => {
  const cutoff = Date.now() - cfg.maxAge * 60_000;
  for (const [mint,c] of coins) if (c.launchMs < cutoff) coins.delete(mint);
}, 30_000);

app.listen(PORT, () => console.log(`Scanner running at http://localhost:${PORT}`));
