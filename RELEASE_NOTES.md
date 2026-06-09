# Meridian v1.0.0 — Release Notes

**Release date:** 2026-06-09

---

## Overview

Meridian is an autonomous DLMM (Dynamic Liquidity Market Maker) liquidity provider agent for Meteora pools on the Solana blockchain. It discovers, evaluates, deploys, and manages LP positions autonomously using LLM-driven decision-making.

---

## What's New

### Agent System
- ReAct loop agent powered by OpenRouter/OpenAI-compatible LLMs
- Three specialist roles: SCREENER (find & deploy), MANAGER (monitor & close), GENERAL (manual commands)
- Configurable per-role LLM models with automatic fallback on rate limits

### Pool Discovery & Screening
- Multi-criteria screening with configurable thresholds (TVL, volume, fee/TVL ratio, organic score, holders, market cap, bin step)
- Bundler detection via common funder analysis and funding window correlation
- Launchpad blacklisting and duplicate token/pool prevention

### Position Management
- Full lifecycle: deploy → monitor → OOR detect → close → learn
- Dynamic position sizing based on wallet balance (compounding formula)
- Configurable bin range calculation from pool volatility
- Performance recording and automated threshold evolution

### TypeScript Analysis Engine (src/)
- **15 engines** composing the LP Alpha Score V2:
  - TX Momentum, Buy/Sell Pressure, Trader Growth, Liquidity Stability
  - Fee Velocity, Smart Money Conviction, Capital Inflow, Holder Growth
  - Narrative V2, Fee APR Prediction, Liquidity Utilization, Range Efficiency
  - Volatility, LP Momentum, Capital Rotation
- **Risk Engine V2** with Deployment Decision Engine (REJECT → AGGRESSIVE)
- **No-Deploy Filter V2** with 13 automatic rejection criteria
- **Position Sizing** and **Auto Rebalance** engines

### Integrations
- Meteora DLMM SDK (positions, PnL, claims)
- Jupiter API (swaps, routing)
- Birdeye, DexScreener (market data)
- Helius RPC (wallet balances, transactions)

### Communication
- Telegram bot with `/positions`, `/close`, `/set` commands
- Daily HTML briefings
- Hive Mind collective intelligence sharing (optional)

---

## Installation

```bash
git clone <repo-url>
cd meridian
npm install
cp .env.example .env
# Edit .env with your keys
npm start
```

## Requirements

- Node.js >= 18.0.0
- Solana wallet with SOL for gas and LP deployment
- RPC endpoint (Helius recommended)
- OpenRouter API key (or local LLM via LM Studio)

---

## Known Issues

- `lessons.js evolveThresholds()` references `maxVolatility` and `minFeeTvlRatio` which don't match config.js keys — evolution of these thresholds is a no-op
- `get_wallet_positions` tool defined but not assigned to MANAGER or SCREENER roles — only available in GENERAL role
- TypeScript `src/` is a parallel implementation not yet wired to production `index.js`

---

## Contributors

- Meridian development team
