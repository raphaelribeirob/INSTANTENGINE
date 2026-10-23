# InstantStudy executable TMNT QA bridge

This is a *backend-only* bridge to the central TMNT gateway. It does not duplicate retention algorithms or put TMNT credentials in a client.

- Files: `tmntBridge.ts` and `tmntBridge.test.ts` (to be copied to `apps/mcp-server/src` on the QA branch)
- Never enable with an unverified learner ID. The first-party identity service must sign `x-instantstudy-learner`, `x-instantstudy-identity-ts`, `x-instantstudy-identity-proof` using a dedicated `INSTANTSTUDY_TMNT_IDENTITY_SECRET`. A client must not be given this key.
- Configure `INSTANTSTUDY_TMNT_ENABLED=true`, `INSTANTSTUDY_TMNT_GATEWAY_URL=https://...`, `INSTANTSTUDY_TMNT_SCOPE=tenant/instantstudy/test`, `INSTANTSTUDY_TMNT_SIGNING_SECRET`, `INSTANTSTUDY_TMNT_IDENTITY_SECRET`, and `INSTANTSTUDY_TMNT_PSEUDONYM_SECRET` with three distinct secrets >=32 characters in the backend only. Default false.
- TMNT must have registered `study_session_completed` as a value event, and must be running with durable Neon nonce storage for production.
- The bridge emits `study_session_completed` only from a backend-persisted completed session with at least one attempt, and only when the identity proof exactly binds the session ID to its learner owner. `eventId` is deterministic for idempotency.
- A failure to deliver does not roll back study completion; track `tmntStatus=unavailable` and add a durable retry outbox before claiming delivery guarantees.
- This bridge is QA-only until full authenticated tests, installation of the central gateway, device validation and acceptance gates are completed.
