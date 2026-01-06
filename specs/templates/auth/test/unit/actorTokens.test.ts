import test from 'node:test';
import assert from 'node:assert/strict';

import { signActorAccessTokenHS256, verifyActorAccessTokenHS256 } from '../../src/actorTokens.js';
import { InMemoryAuthSessionStore, SessionService } from '../../src/sessions.js';

test('verifyActorAccessTokenHS256 validates sid via session store', async () => {
  const store = new InMemoryAuthSessionStore();
  const sessions = new SessionService({ store, config: { refreshTtlDays: 30, refreshRotate: true } });
  const now = new Date('2026-01-01T00:00:00.000Z');
  const nowSeconds = Math.floor(now.getTime() / 1000);

  const { sid } = await sessions.createSession({
    subject: { type: 'customer', model: 'customer', id: 1 },
    actor: { isAuthenticated: true, subjects: {}, roles: [], claims: {} },
    now,
  });

  const token = signActorAccessTokenHS256({
    actor: {
      isAuthenticated: true,
      subjects: { customer: { type: 'customer', model: 'customer', id: 1 } },
      roles: ['customer'],
      claims: {},
      sessionId: sid,
    },
    secret: 'secret',
    ttlSeconds: 60,
    nowSeconds,
  });

  const actor = await verifyActorAccessTokenHS256({
    token,
    secret: 'secret',
    nowSeconds,
    sessionStore: store,
  });
  assert.equal(actor.sessionId, sid);
  assert.equal(actor.subjects.customer?.id, 1);

  await sessions.revokeSession(sid, now);
  await assert.rejects(
    () => verifyActorAccessTokenHS256({ token, secret: 'secret', nowSeconds, sessionStore: store }),
    /revoked|not found|expired/i,
  );
});

test('verifyActorAccessTokenHS256 rejects tokens whose sid subject does not match token subjects', async () => {
  const store = new InMemoryAuthSessionStore();
  const sessions = new SessionService({ store, config: { refreshTtlDays: 30, refreshRotate: true } });
  const now = new Date('2026-01-01T00:00:00.000Z');
  const nowSeconds = Math.floor(now.getTime() / 1000);

  const { sid } = await sessions.createSession({
    subject: { type: 'customer', model: 'customer', id: 1 },
    actor: { isAuthenticated: true, subjects: {}, roles: [], claims: {} },
    now,
  });

  const token = signActorAccessTokenHS256({
    actor: {
      isAuthenticated: true,
      subjects: { customer: { type: 'customer', model: 'customer', id: 2 } },
      roles: ['customer'],
      claims: {},
      sessionId: sid,
    },
    secret: 'secret',
    ttlSeconds: 60,
    nowSeconds,
  });

  await assert.rejects(
    () => verifyActorAccessTokenHS256({ token, secret: 'secret', nowSeconds, sessionStore: store }),
    /mismatch/i,
  );
});

