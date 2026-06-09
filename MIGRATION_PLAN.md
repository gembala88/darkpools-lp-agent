# Migration Plan — Meridian → GitHub Production

**Date:** 2026-06-09  
**Status:** Awaiting migration approval

---

## 1. Verification Summary

| Check | Status | Details |
|---|---|---|
| `npm run build` (tsc) | ✅ Passed | TypeScript compiled to `dist/` — zero errors |
| `npm test` (vitest) | ✅ Passed | 46/46 tests — 6 test files |
| `npm run lint` (tsc --noEmit) | ✅ Passed | Zero type errors |
| `npm install` | ✅ Passed | 227 packages, 0 missing |
| Workflow files | ✅ Valid | `lint.yml`, `test.yml`, `build.yml` — YAML syntax verified |
| `.env.example` | ✅ Complete | 25 variables documented |
| `.gitignore` | ✅ Complete | 22 patterns covering node_modules, dist/, .env, state files |
| Repository audit | ✅ Complete | `REPOSITORY_AUDIT.md` generated |
| Safe fixes | ✅ Applied | 8 fixes in `REFACTOR_REPORT.md` |
| Git repository | ✅ Initialized | Local git ready, remote pending |

---

## 2. GitHub Repository Setup

### 2.1 Remote

```bash
git remote add origin https://github.com/gembala88/darkpools-lp-agent.git
```

**Repository:** https://github.com/gembala88/darkpools-lp-agent

### 2.2 Protected Branch Rules (main)

Configure in GitHub → Settings → Branches → Add rule:

| Setting | Value |
|---|---|
| Require pull request before merging | ✅ |
| Required approvals | 1 |
| Dismiss stale reviews | ✅ |
| Require status checks | ✅ |
| Required checks | `Lint`, `Test (18, 20, 22)`, `Build` |
| Require branches up to date | ✅ |
| Include administrators | ✅ |
| Allow force pushes | ❌ |
| Allow deletions | ❌ |

### 2.3 Secrets to Configure

In GitHub → Settings → Secrets and variables → Actions:

| Secret | Purpose | Required |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | CI notification on release | No |
| `TELEGRAM_CHAT_ID` | CI notification target | No |

Note: API keys (`BIRDEYE_API_KEY`, `JUPITER_API_KEY`, etc.) are runtime secrets, not CI secrets, since workflows only run lint/test/build which do not require external APIs.

---

## 3. Branch Strategy

### 3.1 Permanent Branches

```
main          Production-ready code. Protected. All commits must arrive via PR.
develop       Integration branch for feature work. Protected. PRs merge here first.
```

### 3.2 Temporary Branches

| Prefix | Source | Merges Into | Lifetime | Purpose |
|---|---|---|---|---|
| `feature/*` | `develop` | `develop` | Until complete | New engines, tools, integrations |
| `release/*` | `develop` | `main` + `develop` | Until released | Release candidates, version bump, changelog |
| `hotfix/*` | `main` | `main` + `develop` | Until deployed | Critical production fixes |

#### Feature Branches (`feature/*`)

```bash
git checkout develop
git checkout -b feature/descriptive-name
# ... work, commit, push ...
# Open PR → develop
```

Naming: `feature/add-lp-momentum-engine`, `feature/jupiter-v6-integration`

#### Release Branches (`release/*`)

```bash
git checkout develop
git checkout -b release/v1.1.0
# Update version, CHANGELOG.md, RELEASE_NOTES.md
# Open PR → main (with merge back to develop)
```

Naming: `release/v<major>.<minor>.<patch>`

#### Hotfix Branches (`hotfix/*`)

```bash
git checkout main
git checkout -b hotfix/critical-bug-description
# Fix, commit, push
# Open PR → main (with merge back to develop)
```

Naming: `hotfix/oom-in-pool-screening`, `hotfix/wrong-fee-calculation`

### 3.3 Flow Diagram

```
feature/*  ──→  develop  ──→  release/*  ──→  main
                   ↑                            │
                   └────── hotfix/* ←────────────┘
```

---

## 4. Release Plan — v1.0.0

### 4.1 Checklist

- [x] TypeScript compiles (`npm run build`)
- [x] All tests pass (`npm test`)
- [x] Type checking passes (`npm run lint`)
- [x] Repository audit completed (`REPOSITORY_AUDIT.md`)
- [x] Safe fixes applied (`REFACTOR_REPORT.md`)
- [x] CI workflows configured (`.github/workflows/`)
- [x] Documentation created (CHANGELOG, RELEASE_NOTES, CONTRIBUTING, SECURITY)
- [x] CODEOWNERS configured
- [x] `.env.example` complete
- [ ] Protected branch rules enabled (GitHub Settings)
- [ ] Secrets configured (if needed)
- [ ] Git tags created (`v1.0.0`)
- [ ] Release published on GitHub

### 4.2 Release Workflow

```
Step 1: git checkout main
Step 2: git merge --no-ff develop
Step 3: git tag -a v1.0.0 -m "v1.0.0 — Initial release"
Step 4: git push origin main --tags
Step 5: Create GitHub Release from tag v1.0.0
Step 6: Attach RELEASE_NOTES.md as release description
```

### 4.3 Versioning Scheme

This project follows [Semantic Versioning](https://semver.org/):

| Increment | When | Example |
|---|---|---|
| MAJOR | Breaking API/behavior changes | `v2.0.0` |
| MINOR | New features, backward-compatible | `v1.1.0` |
| PATCH | Bug fixes, backward-compatible | `v1.0.1` |

---

## 5. First Push Sequence

### Step 1: Add remote and push main

```bash
git remote add origin https://github.com/gembala88/darkpools-lp-agent.git
git branch -M main
git add -A
git commit -m "chore: initial commit — Meridian v1.0.0
- 15 TypeScript analysis engines
- LP Alpha Score V2 with 12 components
- Deployment Decision Engine with 6-tier recommendations
- No-Deploy Filter V2 with 13 rejection criteria
- 46 unit tests
"
git push -u origin main
```

### Step 2: Push develop branch

```bash
git checkout -b develop main
git push -u origin develop
```

### Step 3: Verify CI

In GitHub → Actions, confirm all 3 workflows pass:
- `Lint` — TypeScript type check
- `Test (18, 20, 22)` — Cross-version test matrix
- `Build` — Compile + syntax check

---

## 6. Post-Migration Tasks

| Priority | Task | Owner |
|---|---|---|
| P0 | Enable branch protection rules in GitHub Settings | Maintainers |
| P0 | Wire `src/` TypeScript to production `index.js` | Engine team |
| P1 | Consolidate `lpMomentumEngine` — delegate to standalone engines | Engine team |
| P1 | Add tests for remaining 22 untested engines | Engine team |
| P1 | Add integration tests for 4 API adapters | Engine team |
| P1 | Create GitHub issue templates (bug, feature, question) | Maintainers |
| P2 | Add ESLint + Prettier config | Maintainers |
| P2 | Set up Dependabot for automated dependency updates | Maintainers |

---

## 7. Rollback Plan

If the migration causes issues:

1. **Disable workflows**: GitHub → Actions → Disable
2. **Revert branch protection**: Settings → Branches → Remove rules
3. **Delete remote**: `git push origin :main` (requires admin force push override)
4. **Preserve local**: All branches exist locally — work continues offline

No blockchain state is affected by repository migration. The agent's `state.json`, `user-config.json`, and wallet are local files not tracked in git.

---

## Approval

To proceed with migration:

1. Review this plan
2. Run the first push commands from Section 5
3. Verify CI pipelines pass
4. Create v1.0.0 release

**Current branch:** `main` (local, not yet pushed)
**Next action:** Awaiting approval.
