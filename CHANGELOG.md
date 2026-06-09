# Changelog

All notable changes to Meridian will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-06-09

### Added
- Initial release of Meridian — autonomous DLMM LP agent for Meteora pools on Solana
- Agent loop with ReAct reasoning (OpenRouter/OpenAI-compatible LLM)
- Three agent roles: SCREENER, MANAGER, GENERAL
- Pool discovery and screening from Meteora API
- Deploy, close, claim, and manage LP positions via Meteora DLMM SDK
- Position lifecycle tracking with OOR detection and pool-memory snapshots
- Learning engine with performance recording and threshold evolution
- Token screening with bundler detection, holder analysis, and launchpad blocking
- Smart wallet tracking for KOL/alpha wallet signals
- Telegram bot with position status, close, and note commands
- Daily briefing generation
- Hive Mind collective intelligence sync
- Config system with runtime mutation and persistence
- Encryption support for environment variables
- Dry-run mode for safe testing

### TypeScript Engine Subsystem (src/)
- Data layer with 5 repositories (token, holder, liquidity, market, transaction)
- 4 external data integrations (Birdeye, DexScreener, Jupiter, Meteora)
- 15 analysis engines (TX momentum, buy/sell pressure, trader growth, liquidity stability, fee velocity, smart money conviction, capital inflow, holder growth, narrative, fee APR prediction, liquidity utilization, capital rotation, range efficiency, volatility, LP momentum)
- LP Alpha Score V2 — 12-component weighted scoring system
- Risk Engine V2 with no-deploy filter (13 rejection criteria)
- Deployment Decision Engine with 6-tier recommendations
- Position Sizing Engine and Auto Rebalance Engine
- Hot Pool Detector and Smart LP Engine
- marketDataService and LPIntelligenceService
- 46 unit tests across 6 test files
