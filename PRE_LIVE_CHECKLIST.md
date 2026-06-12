# Pre-Live Safety Checklist

Before switching `DRY_RUN=false` and `ENABLE_REAL_DEPLOYMENT=true`, verify each item.

## Safety Gates

- [ ] Disable auto-promote entirely (it bypasses safety gates — never run live)
- [ ] Restore `minFeeActiveTvlRatio` to 0.05% (remove the DRY RUN bypass)
- [ ] Restore alpha threshold to 70 (remove the DRY RUN 25 override)
- [ ] Restore concentration threshold to 80% (remove the DRY RUN 95 override)
- [ ] Verify only `ai_chosen` deploys execute (no forced promotes)

## Wallet & Risk

- [ ] Confirm wallet has the intended SOL amount
- [ ] Start with a SMALL `deployAmountSol` (e.g., 0.1 SOL)
- [ ] Verify `maxPositions` is set to a safe limit (e.g., 1–2)
- [ ] Ensure `gasReserve` covers at least 2 close + 2 claim transactions

## Screening Filters

- [ ] Verify all safety gates are active:
  - [ ] top10 holder percentage check
  - [ ] bot holder percentage check
  - [ ] minimum TVL check
  - [ ] minimum token age check
  - [ ] minimum fee/TVL ratio check
  - [ ] bundler detection check
- [ ] Confirm `blockedLaunchpads` list is up to date
- [ ] Verify `maxBundlersPct` and `maxTop10Pct` thresholds

## Monitoring

- [ ] Telegram notifications working for deploys, closes, and errors
- [ ] PM2 log monitoring in place
- [ ] At least 3 ai_chosen deployments observed in DRY RUN with outcome tracking data

## Learning Data

- [ ] `deployment-memory.json` has complete records (lane, regime, psychology, deploySource)
- [ ] Outcome tracking has processed at least some 1h/4h checks
- [ ] Win rate from ai_chosen deploys is understood (simulated, not real)

## Rollback Plan

- [ ] `DRY_RUN=true` can be toggled at any time without data loss
- [ ] `user-config.json` is backed up
- [ ] Wallet private key is accessible for emergency withdrawal
