/**
 * Study app -> central TMNT Engine bridge (trusted server only).
 * No browser tokens, no shared TMNT engine code duplicated here.
 * By default disabled. Activation requires dedicated trusted identity proof.
 */
import { createHmac, createHash, randomUUID, timingSafeEqual } from 'node:crypto';

type HeaderInput = { [key: string]: string | string[] | undefined };
type VerifiedSession = {
  sessionId: string;
  learnerId?: string;
  completed: boolean;
  attempts: number;
  completedAt?: string;
};
type DispatchStatus = 'disabled' | 'identity_required' | 'not_completed' | 'recorded' | 'rejected' | 'unavailable';
type BridgeConfig = {
  endpoint?: string;
  scope?: string;
  signingSecret?: string;
  identitySecret?: string;
  pseudonymSecret?: string;
  enabled?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCOPE = /^[a-z][a-z0-9_-]{1,49}\/[a-z][a-z0-9_-]{1,49}\/(?:test|staging|prod)$/;
const LEARNER = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{2,127}$/;
const PATH = '/tmnt/v1/action';
function digest(value: string): Buffer { return createHash('sha256').update(value).digest(); }
function equal(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8'), right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
function uuidFromSession(sessionId: string, signingSecret: string): string {
  const b = createHmac('sha256', signingSecret).update('study-session-completed\n').update(sessionId).digest();
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const h = b.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function header(headers: HeaderInput, key: string): string {
  const v = headers[key.toLowerCase()] ?? headers[key];
  return typeof v === 'string' ? v : '';
}
export function signVerifiedLearner({learnerId, sessionId, timestamp, secret, locale, timezone}: {
  learnerId: string; sessionId: string; timestamp: number; secret: string; locale: string; timezone: string;
}): string {
  return 'sha256=' + createHmac('sha256', secret)
    .update(['study-app/tmnt-identity/v1', learnerId, sessionId, String(timestamp), locale, timezone].join('\n'))
    .digest('hex');
}
export function createTMNTStudyBridge(config: BridgeConfig = {}) {
  const {enabled = false, endpoint, scope, signingSecret, identitySecret, pseudonymSecret,
    fetchImpl = fetch, now = Date.now} = config;
  if (!enabled) return { emitCompleted: async (): Promise<DispatchStatus> => 'disabled' as const };
  if (!endpoint || !scope || !SCOPE.test(scope) || !signingSecret || signingSecret.length < 32 ||
      !identitySecret || identitySecret.length < 32 || !pseudonymSecret || pseudonymSecret.length < 32 ||
      new Set([signingSecret, identitySecret, pseudonymSecret]).size !== 3) {
    throw new Error('TMNT bridge: required dedicated secrets and scope missing');
  }
  const target = new URL(PATH, endpoint);
  if (target.search || target.hash || (target.protocol !== 'https:' &&
      !(scope.endsWith('/test') && target.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)))) {
    throw new Error('TMNT bridge: invalid gateway transport (HTTPS required)');
  }
  return {
    async emitCompleted({session, headers}: {session: VerifiedSession; headers: HeaderInput}): Promise<DispatchStatus> {
      if (!session.completed || session.attempts < 1 || !UUID.test(session.sessionId)) return 'not_completed';
      const learnerId = session.learnerId;
      if (!learnerId || !LEARNER.test(learnerId)) return 'identity_required';
      const claimedLearner = header(headers, 'x-study-app-learner');
      const stamp = header(headers, 'x-study-app-identity-ts');
      const proof = header(headers, 'x-study-app-identity-proof');
      const locale = header(headers, 'x-study-app-locale');
      const timezone = header(headers, 'x-study-app-timezone');
      let timezoneValid = false;
      try { new Intl.DateTimeFormat('en', {timeZone:timezone}); timezoneValid = true; } catch { /* reject */ }
      const timestamp = Number(stamp);
      if (claimedLearner !== learnerId || !/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(locale) || !timezoneValid || !/^\d{13}$/.test(stamp) || !Number.isSafeInteger(timestamp) ||
          Math.abs(now() - timestamp) > 120000 || !/^sha256=[0-9a-f]{64}$/.test(proof) ||
          !equal(proof, signVerifiedLearner({learnerId, sessionId: session.sessionId, timestamp, secret: identitySecret, locale, timezone})))
        return 'identity_required';
      const subject = createHmac('sha256', pseudonymSecret)
        .update(scope).update('\n').update(learnerId).digest('hex').slice(0, 48);
      const eventId = uuidFromSession(session.sessionId, signingSecret);
      const when = session.completedAt ? new Date(session.completedAt) : new Date(now());
      if (!Number.isFinite(when.getTime()) || when.getTime() > now() + 5 * 60_000) return 'not_completed';
      const packet = JSON.stringify({operation:'track', params:{
        event:'study_session_completed', eventId, occurredAt:when.toISOString(),
        locale, timezone
      }});
      const nonce = randomUUID();
      const ts = now();
      const canonical = ['tmnt/v1', scope, subject, nonce, String(ts), 'POST', PATH,
        digest(packet).toString('hex')].join('\n');
      const sig = 'sha256=' + createHmac('sha256', signingSecret).update(canonical).digest('hex');
      try {
        const r = await fetchImpl(target, {
          method:'POST', headers:{'content-type':'application/json','x-tmnt-scope':scope,
            'x-tmnt-subject':subject,'x-tmnt-nonce':nonce,'x-tmnt-timestamp':String(ts),
            'x-tmnt-signature':sig}, body:packet, signal:AbortSignal.timeout(2500)
        });
        if (!r.ok) return r.status >= 500 ? 'unavailable' : 'rejected';
        const payload: unknown = await r.json();
        return Boolean(payload && typeof payload === 'object' && 'result' in payload &&
          (payload as {result: unknown}).result === true) ? 'recorded' : 'rejected';
      } catch { return 'unavailable'; }
    }
  };
}
