import { Router } from 'express';
import crypto from 'node:crypto';
import type { AuthLocalConfig, EngineConfig, ServiceRegistry } from '@enginehq/core';
import { CrudService } from '@enginehq/core';
import type { Actor } from '@enginehq/core';
import {
  hashPassword,
  hashPasswordOp,
  verifyPasswordHash,
  signActorAccessTokenHS256,
  InMemoryAuthSessionStore,
  SequelizeAuthSessionStore,
  SessionService,
  type AuthSessionStore,
} from '@enginehq/auth';

const DEFAULT_EMAIL_FIELD = 'email';
const DEFAULT_PASSWORD_FIELD = 'password';
const DEFAULT_HASH_FIELD = 'password_hash';
const DEFAULT_ROLES_FIELD = 'roles';
const DEFAULT_SUBJECT_KEY = 'user';
const DEFAULT_SESSION_MODEL = 'auth_session';

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

/**
 * Picks the session store backing refresh tokens.
 *
 * Order of precedence:
 *   1. a store registered in the ServiceRegistry as 'authSessionStore' (bring your
 *      own — Redis, a custom table, a test double)
 *   2. auth.sessions.store: 'memory' forces in-memory, 'model' requires the DB model
 *   3. 'auto' (the default): the DB model when it exists, in-memory otherwise
 *
 * The in-memory store keeps sessions in process memory: they are lost on restart
 * and are not shared across workers, so logout and refresh rotation only hold for
 * a single process. That is fine for tests and local development and wrong for
 * anything else, which is why the fallback is logged.
 */
export function resolveSessionStore(args: {
  config: EngineConfig;
  services: ServiceRegistry;
}): { store: AuthSessionStore; kind: string } {
  const { config, services } = args;
  const cfg = config.auth.sessions;

  if (services.has('authSessionStore')) {
    return {
      store: services.resolve<AuthSessionStore>('authSessionStore', { scope: 'singleton' }),
      kind: 'custom (authSessionStore service)',
    };
  }

  const mode = cfg?.store ?? 'auto';
  const modelKey = cfg?.modelKey ?? DEFAULT_SESSION_MODEL;

  if (mode === 'memory') return { store: new InMemoryAuthSessionStore(), kind: 'memory (configured)' };

  const model = services.has('orm')
    ? ((services.resolve<any>('orm', { scope: 'singleton' })?.models ?? {})[modelKey] ?? null)
    : null;

  if (model) return { store: new SequelizeAuthSessionStore({ model }), kind: `model (${modelKey})` };

  if (mode === 'model') {
    throw new Error(
      `auth.sessions.store is 'model' but the '${modelKey}' model is missing. ` +
        `Add dsl/meta/${modelKey}.json, or set auth.sessions.store to 'memory'.`,
    );
  }

  return { store: new InMemoryAuthSessionStore(), kind: 'memory (no model found)' };
}

/** Resolves the store and reports the choice, warning when the fallback is unsafe. */
export function resolveAndLogSessionStore(args: {
  config: EngineConfig;
  services: ServiceRegistry;
}): { store: AuthSessionStore; kind: string } {
  const resolved = resolveSessionStore(args);
  if (!args.services.has('logger')) return resolved;

  const logger = args.services.resolve<any>('logger', { scope: 'singleton' });
  const msg = `[auth] session store: ${resolved.kind}`;
  if (resolved.kind.startsWith('memory') && args.config.auth.sessions?.enabled) {
    logger?.warn?.(
      `${msg} — sessions are per-process and lost on restart; not safe for multi-process deployments`,
    );
  } else {
    logger?.info?.(msg);
  }
  return resolved;
}

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
  const { store: sessionStore } = resolveAndLogSessionStore({ config, services });
  const sessions = new SessionService({ store: sessionStore, config: sessionCfg });

  // User models declare { op: 'custom', name: 'hashPassword' } so that CRUD writes hash
  // passwords too. The guard keeps an app op of the same name, and register() throws on
  // a duplicate name.
  if (!services.has('pipelines.custom.hashPassword')) {
    services.register('pipelines.custom.hashPassword', 'singleton', () => hashPasswordOp);
  }

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
      // The client must not choose its own roles.
      delete body[cfg.rolesField];

      const crud = new CrudService({ services });
      const user = (await crud.create({
        modelKey: cfg.userModel,
        actor: SYSTEM_ACTOR,
        values: body,
      })) as Record<string, unknown>;

      if (cfg.onRegister) await cfg.onRegister(user, { config, services });

      const actor = buildActor(user, cfg);
      if (cfg.buildClaims) Object.assign(actor.claims, cfg.buildClaims(user));

      // Create the session before signing so the access token carries the `sid`
      // claim; without it `req.actor.sessionId` is undefined and logout cannot
      // revoke the session.
      const subject = Object.values(actor.subjects)[0]!;
      const { sid, refreshToken } = await sessions.createSession({ subject, actor });
      actor.sessionId = sid;

      const accessToken = signActorAccessTokenHS256({
        actor,
        secret: jwtCfg.accessSecret,
        ttlSeconds: parseTtlSeconds(jwtCfg.accessTtl),
      });

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

      // Exact match on the login field. A list query cannot do this safely: 'find' is
      // parsed but never applied, so every user came back and the newest row was
      // checked, and 'filters' interprets commas and '*' in the caller's input.
      // A direct lookup also skips the response pipeline, so the hash stays readable.
      const orm       = services.resolve<any>('orm', { scope: 'singleton' });
      const userModel = orm.models[cfg.userModel];
      const where: Record<string, unknown> = { [cfg.emailField]: email };
      if (userModel.rawAttributes?.deleted) where.deleted = false;
      if (userModel.rawAttributes?.archived) where.archived = false;

      const user       = (await userModel.findOne({ where, raw: true })) as Record<string, unknown> | null;
      const storedHash = user?.[cfg.passwordHashField] as string | undefined;

      if (!user || !storedHash || !verifyPasswordHash(plain, storedHash)) {
        return res.fail({ code: 401, message: 'Invalid credentials', errors: { root: 'Invalid credentials' } });
      }

      const actor = buildActor(user, cfg);
      if (cfg.buildClaims) Object.assign(actor.claims, cfg.buildClaims(user));

      // See /register: the session must exist before the token is signed.
      const subject = Object.values(actor.subjects)[0]!;
      const { sid, refreshToken } = await sessions.createSession({ subject, actor });
      actor.sessionId = sid;

      const accessToken = signActorAccessTokenHS256({
        actor,
        secret: jwtCfg.accessSecret,
        ttlSeconds: parseTtlSeconds(jwtCfg.accessTtl),
      });

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
