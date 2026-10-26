# Pump.fun Momentum Scanner

A web dashboard that ranks newly launched Pump.fun Solana tokens by early buying momentum while applying holder concentration and risk filters.

## Current strategy
- Token age < 30 minutes
- Market cap >= $20,000
- Largest holder <= 5%
- Top 5 holders <= 20%
- Top 10 holders <= 30%
- Fast-growing buyers
- Low selling pressure
- Reject suspicious/sniper/bundled wallet signals when detectable
- Risk score and momentum score

## Data
The live launch/trade stream is designed around Bitquery's documented Pump.fun GraphQL/WebSocket data. Holder enrichment can use Helius.

## Run
1. Copy `.env.example` to `.env`
2. Add your Bitquery token. Add Helius if you want holder enrichment.
3. `npm install`
4. `npm start`
5. Open `http://localhost:3000`

This version is alert/scanner-only. It does not hold a private key and does not place trades.

## Production notes
For a production deployment, add persistent storage, reconnect/backoff, rate limiting, wallet-cluster analysis, exact PumpSwap/LP exclusions, and a stronger rug detector. Never put API keys or a private wallet key in browser code.
