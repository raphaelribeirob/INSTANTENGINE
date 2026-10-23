# TMNT v2.3 setup — InstantStudy

1. Inspect draft PR https://github.com/raphaelribeirob/InstantStudy/pull/61. Leave `main` unchanged until approved.
2. Run central TMNT schema bootstrap `0000` followed by `0001`–`0012` on Neon QA, and register `study_session_completed` as value event in `qa/instantstudy/test`.
3. In the **trusted server only**, configure `INSTANTSTUDY_TMNT_ENABLED=true`, `INSTANTSTUDY_TMNT_GATEWAY_URL=https://...`, `INSTANTSTUDY_TMNT_SCOPE=qa/instantstudy/test`, and separate `INSTANTSTUDY_TMNT_SIGNING_SECRET`, `INSTANTSTUDY_TMNT_IDENTITY_SECRET`, `INSTANTSTUDY_TMNT_PSEUDONYM_SECRET` >=32 chars each. Feature flag defaults false.
4. A first-party identity service, not a browser, signs `x-instantstudy-learner`, `x-instantstudy-identity-ts`, `x-instantstudy-locale`, `x-instantstudy-timezone`, `x-instantstudy-identity-proof`. Never put the signing keys in the client.
5. The API endpoint `POST /api/v1/study/finish` only emits `study_session_completed` after loading a persisted completed session and confirming >=1 attempt. `tmntStatus: recorded` means a retained event, not notification delivery; error states do not roll back the completed study session.
6. Implement durable retries and test real Neon, TLS and physical devices before any production activation.

`npm test`, `npm run check`, and `npm run smoke` run the standalone QA suite. The InstantStudy repo additionally has TypeScript tests in its existing CI.
