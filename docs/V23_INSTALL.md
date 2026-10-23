# TMNT v2.3 setup — study app bridge

1. Review the study app integration change in its own repository before merging. Leave `main` unchanged until approved.
2. Run central TMNT schema bootstrap `0000` followed by `0001`–`0012` on Neon QA, and register `study_session_completed` as value event in `qa/study_app/test`.
3. In the **trusted server only**, configure `STUDY_APP_TMNT_ENABLED=true`, `STUDY_APP_TMNT_GATEWAY_URL=https://...`, `STUDY_APP_TMNT_SCOPE=qa/study_app/test`, and separate `STUDY_APP_TMNT_SIGNING_SECRET`, `STUDY_APP_TMNT_IDENTITY_SECRET`, `STUDY_APP_TMNT_PSEUDONYM_SECRET` >=32 chars each. Feature flag defaults false.
4. A first-party identity service, not a browser, signs `x-study-app-learner`, `x-study-app-identity-ts`, `x-study-app-locale`, `x-study-app-timezone`, `x-study-app-identity-proof`. Never put the signing keys in the client.
5. The API endpoint `POST /api/v1/study/finish` only emits `study_session_completed` after loading a persisted completed session and confirming >=1 attempt. `tmntStatus: recorded` means a retained event, not notification delivery; error states do not roll back the completed study session.
6. Implement durable retries and test real Neon, TLS and physical devices before any production activation.

`npm test`, `npm run check`, and `npm run smoke` run the standalone QA suite. The study app repository runs its TypeScript adapter tests in its own CI.
