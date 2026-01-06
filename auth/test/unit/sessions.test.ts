import test from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryAuthSessionStore, SessionService } from '../../src/sessions.js';

test('SessionService rotates refresh tokens and revokes sessions', async () => {
  const store = new InMemoryAuthSessionStore();
  const svc = new SessionService({ store, config: { refreshTtlDays: 30, refreshRotate: true } });
  const now = new Date('2026-01-01T00:00:00.000Z');

  const { sid, refreshToken } = await svc.createSession({
    subject: { type: 'customer', model: 'customer', id: 1 },
    actor: { isAuthenticated: true, subjects: {}, roles: [], claims: {} },
    now,
  });
  assert.ok(sid);
  assert.ok(refreshToken.startsWith(`${sid}.`));

  const rotated = await svc.rotateRefreshToken(refreshToken, now);
  assert.equal(rotated.sid, sid);
  assert.notEqual(rotated.refreshToken, refreshToken);

  await svc.revokeSession(sid, now);
  await assert.rejects(() => svc.verifyRefreshToken(rotated.refreshToken, now), /revoked/i);
});

