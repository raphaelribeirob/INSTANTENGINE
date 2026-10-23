# INSTANTENGINE v3.1.0 — source QA test report

**Date:** 2026-10-22/23. **Base:** user-owned RIVERENGINE v3.0 QA archive. **Environment:** Node.js 22.16.0; Python 3.13.5; no live Neon/PostHog/OneSignal services or production credentials.

| Check run | Observed result | Limitations |
|---|---|---|
| `npm test` — modern Node | **333/333 PASS** | Pure / simulated backend and contract tests |
| `npm test` — study app integration | **4/4 PASS** | Stubbed integration path |
| `npm test` — legacy R3ENGINE | **137/137 PASS** | Local compatibility suite |
| `npm run test:stats` | **9/9 PASS** | Offline synthetic / statistical tests |
| `npm run db:verify-install` | **16/16 files, PASS** | SQL static contract and order; no DB migrations applied |
| `npm run smoke` | **21/21 PASS** | HTTP mock tests; no DB or push delivery |
| `npm run check`, `check:observer`, `check:integrations`, `check:churn` | **PASS** | Static syntax/contract gates |
| `npm run load:smoke` | **PASS** (5,000 synthetic memory inserts, 20 duplicates rejected) | Not a live performance benchmark |
| `npm run worker:churn` | **disabled** (0 processed) | Safe default |
| `npm run worker:purge` | **disabled** (0 deleted) | Safe default |
| `npm run test:identity` | **9/9 PASS** | Includes branding, calendar-gap and purge guard tests |
| `npm run check:manifest` | **PASS** | SHA-256 of all release source files |
| `node -e "import('instantengine')"` | **PASS** | New package self-resolution works locally |

**474 distinct Node test results in the principal `npm test` script** (333 + 4 + 137), plus 9 Python tests. Targeted `test:identity`, `test:churn`, `test:integrations` are subsets of the modern suite and not added again.

## Fixed audit defects

- Inactivity no longer counts only elapsed 24h intervals from 00:00 UTC; it now compares UTC calendar days correctly. Added late-yesterday and offset timezone regression tests.
- Added independent, manually enabled purge worker, production double-opt-in, allowlisted scope and isolation tests. This fixes the absence of a way to run maintenance when churn scoring remains OFF; a real scheduler still needs installation and monitoring.
- Recreated versioned SHA-256 manifest from all package source files; CI gate will detect source drift and unintended additions/deletions.
- Product branding updated to INSTANTENGINE and public JS aliases exposed; historic wire and DB protocols remain unchanged.

## Still blocked

- No live Neon staging checks for opt-out race conditions, retention cutoff dates, failure/retry semantics and isolated DELETE policies.
- No CI run on GitHub for this locally produced archive; YAML workflow has been authored but not observed green on a remote runner.
- No PostHog/OneSignal device delivery or randomized retention lift measurement.
- Anti-churn remains an uncalibrated heuristic by default, not an experimentally validated probability or a full Duolingo RDS implementation.
- Old package import specifier requires explicit consumer migration; this archive is not published to npm or deployed on Vercel.

**Release decision: QA artifact only, NOT production-ready.**
