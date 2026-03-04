import { Router } from 'express';
import crypto from 'node:crypto';
import type { AuthLocalConfig, EngineConfig, ServiceRegistry } from '@enginehq/core';
import { CrudService } from '@enginehq/core';
import type { Actor } from '@enginehq/core';
import {
  hashPassword,
  verifyPasswordHash,
  signActorAccessTokenHS256,
  InMemoryAuthSessionStore,
  SessionService,
} from '@enginehq/auth';

const DEFAULT_EMAIL_FIELD = 'email';
const DEFAULT_PASSWORD_FIELD = 'password';
const DEFAULT_HASH_FIELD = 'password_hash';
const DEFAULT_ROLES_FIELD = 'roles';
const DEFAULT_SUBJECT_KEY = 'user';

/** Parse human-readable TTL strings: '15m', '1h', '7d' → seconds. */
function parseTtlSeconds(ttl: string): number {
  const m = /^(\d+)([smhd])$/.exec(String(ttl).trim().toLowerCase());
  if (!m) return 3600;
  const n = parseInt(m[1]!, 10);
  switch (m[2]) {
    case 's': return n;
    case 'm': return n * 60;
    case 'h': return n * 3600;
    case 'd': return n * 86400;
    default:  return 3600;
  }
}

function resolvedCfg(local: AuthLocalConfig) {
  return {
    userModel:         local.userModel,
    emailField:        local.emailField         ?? DEFAULT_EMAIL_FIELD,
    passwordField:     local.passwordField       ?? DEFAULT_PASSWORD_FIELD,
    passwordHashField: local.passwordHashField   ?? DEFAULT_HASH_FIELD,
    rolesField:        local.rolesField          ?? DEFAULT_ROLES_FIELD,
    subjectKey:        local.subjectKey          ?? DEFAULT_SUBJECT_KEY,
    onRegister:        local.onRegister,
    buildClaims:       local.buildClaims,
  };
}

function buildActor(user: Record<string, unknown>, cfg: ReturnType<typeof resolvedCfg>): Actor {
  const id    = String(user['id'] ?? crypto.randomUUID());
  const roles = Array.isArray(user[cfg.rolesField]) ? (user[cfg.rolesField] as string[]) : [];
  return {
    isAuthenticated: true,
    subjects: { [cfg.subjectKey]: { type: cfg.subjectKey, model: cfg.userModel, id } },
    roles,
    claims: { sub: id },
  };
}

const SYSTEM_ACTOR: Actor = {
  isAuthenticated: true,
  subjects: {},
  roles: ['system'],
  claims: {},
};

export function createBuiltinAuthRouter(opts: {
  local: AuthLocalConfig;
  config: EngineConfig;
  services: ServiceRegistry;
}): Router {
  const { local, config, services } = opts;
  const cfg    = resolvedCfg(local);
  const jwtCfg = config.auth.jwt;
  const router = Router();

  const sessionCfg = config.auth.sessions ?? { enabled: false, refreshTtlDays: 7, refreshRotate: true };
  const sessionStore = new InMemoryAuthSessionStore();
  const sessions = new SessionService({ store: sessionStore, config: sessionCfg });

  // ── POST /auth/register ──────────────────────────────────────────────────
  router.post('/register', async (req, res) => {
    try {
      const body = { ...(req.body as Record<string, unknown>) };
      const plain = body[cfg.passwordField];
      if (typeof plain !== 'string' || !plain) {
        return res.fail({ code: 400, message: `${cfg.passwordField} is required` });
      }
      delete body[cfg.passwordField];
      body[cfg.passwordHashField] = hashPassword(plain);

      const crud = new CrudService({ services });
      const user = (await crud.create({
        modelKey: cfg.userModel,
        actor: SYSTEM_ACTOR,
        values: body,
      })) as Record<string, unknown>;

      if (cfg.onRegister) await cfg.onRegister(user, { config, services });

      const actor = buildActor(user, cfg);
      if (cfg.buildClaims) Object.assign(actor.claims, cfg.buildClaims(user));

      const accessToken = signActorAccessTokenHS256({
        actor,
        secret: jwtCfg.accessSecret,
        ttlSeconds: parseTtlSeconds(jwtCfg.accessTtl),
      });

      const subject = Object.values(actor.subjects)[0]!;
      const { refreshToken } = await sessions.createSession({ subject, actor });

      return res.ok({ user, accessToken, refreshToken }, { code: 201 });
    } catch (e: unknown) {
      return res.fail({ code: 400, message: e instanceof Error ? e.message : String(e) });
    }
  });

  // ── POST /auth/login ─────────────────────────────────────────────────────
  router.post('/login', async (req, res) => {
    try {
      const body  = req.body as Record<string, unknown>;
      const email = body[cfg.emailField];
      const plain = body[cfg.passwordField];

      if (typeof email !== 'string' || typeof plain !== 'string') {
        return res.fail({ code: 400, message: 'email and password required' });
      }

      const crud   = new CrudService({ services });
      const result = await crud.list({
        modelKey: cfg.userModel,
        actor: SYSTEM_ACTOR,
        query: { find: JSON.stringify({ [cfg.emailField]: email }) },
      });

      const user       = result.rows[0] as Record<string, unknown> | undefined;
      const storedHash = user?.[cfg.passwordHashField] as string | undefined;

      if (!user || !storedHash || !verifyPasswordHash(plain, storedHash)) {
        return res.fail({ code: 401, message: 'Invalid credentials', errors: { root: 'Invalid credentials' } });
      }

      const actor = buildActor(user, cfg);
      if (cfg.buildClaims) Object.assign(actor.claims, cfg.buildClaims(user));

      const accessToken = signActorAccessTokenHS256({
        actor,
        secret: jwtCfg.accessSecret,
        ttlSeconds: parseTtlSeconds(jwtCfg.accessTtl),
      });
      const subject = Object.values(actor.subjects)[0]!;
      const { refreshToken } = await sessions.createSession({ subject, actor });

      return res.ok({ accessToken, refreshToken });
    } catch (e: unknown) {
      return res.fail({ code: 500, message: e instanceof Error ? e.message : String(e) });
    }
  });

  // ── POST /auth/refresh ───────────────────────────────────────────────────
  router.post('/refresh', async (req, res) => {
    try {
      const { refreshToken } = req.body as { refreshToken?: string };
      if (!refreshToken) return res.fail({ code: 400, message: 'refreshToken required' });
      const { refreshToken: nextToken, refreshExpiresAt } = await sessions.rotateRefreshToken(refreshToken);
      return res.ok({ refreshToken: nextToken, refreshExpiresAt });
    } catch {
      return res.fail({ code: 401, message: 'Invalid or expired refresh token' });
    }
  });

  // ── POST /auth/logout ────────────────────────────────────────────────────
  router.post('/logout', async (req, res) => {
    const actor = (req as any).actor as Actor | undefined;
    if (actor?.sessionId) await sessions.revokeSession(actor.sessionId);
    return res.ok({ ok: true });
  });

  // ── GET /auth/me ─────────────────────────────────────────────────────────
  router.get('/me', (req, res) => {
    const actor = (req as any).actor ?? { isAuthenticated: false, subjects: {}, roles: [], claims: {} };
    return res.ok(actor);
  });

  return router;
}
