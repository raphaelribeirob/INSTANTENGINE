# TMNT Engine v2.2 — installation and operational evidence

## Environment contract

- Node.js >=22 on a **trusted backend**. Do not import the administrative SDK or `DATABASE_URL` in Flutter, web, or browser bundles.
- Isolated Neon/PostgreSQL database/branch, whose connection credentials stay on the backend.
- Disable pushes during installation: `R3_PUSH_ENABLED=false`.
- `@neondatabase/serverless` is a **peer dependency**; install it in the backend with the registry accessible (`npm install @neondatabase/serverless`). It was NOT installed in the audit container.
- App owners must configure verified event vocabulary, authenticated user identity, channel-specific opt-ins and encrypted secrets.

## Deterministic clean installation

1. In the project folder, run `npm run db:verify-install` to verify that bootstrap and all 12 additive migrations are present, ordered, complete, and have no `DROP TABLE/SCHEMA/DATABASE`.
2. On an **empty dedicated QA database only**, using `psql` with an authorized connection string configured externally, execute **in order**:
   ```bash
   # NEVER run against a production DB without release approval and backup.
   set -eu
   for sql in migrations/000{0,1,2,3,4,5,6,7,8,9}_*.sql migrations/001{0,1,2}_*.sql; do
     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f "$sql"
   done
   ```
   Each file is one transaction. All schema changes are additive; PostgreSQL permissions and capacity are still the deployment operator's responsibility. Failure halts before the next file.
3. Run `npm run db:verify-live` from the **trusted backend** to verify network, actual driver, read-only table/function presence. This command does not mutate data.
4. Configure a backend adapter (`createNeonRepository(DATABASE_URL)`), HMAC request signer, per-app scope and frontend proxy. Do not expose this SDK or secrets to client applications.
5. In a scoped test tenant/environment, verify signed HTTP end-to-end, consent, value events, idempotency, schedules, and subject deletion with authorized test accounts. No real push or charge during QA.
6. Before production: test real TLS termination with verified proxies, OneSignal APNs/FCM actual devices, verified payment settlement, PostHog and D1/D7/D30 experiments, load/saturation and recovery, erasure in processors, and rollback.

## Status semantics

- `npm test`/smoke only means **local contract tests**.
- Neon QA SQL tests do not mean Node→Neon SDK E2E. `db:verify-live` can only PASS when run in backend with real driver and credentials.
- Integration contract documents in app repositories do not activate runtime. Enable runtime **after** app-specific backend integration and security review.
