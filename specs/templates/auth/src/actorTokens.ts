import type { Actor, SubjectRef } from '@enginehq/core';
import { signJwtHS256, verifyJwtHS256, type JwtBody } from './jwt.js';
import type { AuthSessionStore } from './sessions.js';

export type ActorAccessTokenBody = JwtBody & {
  isAuthenticated: true;
  subjects: Record<string, SubjectRef>;
  roles: string[];
  claims: Record<string, unknown>;
  sid?: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function getBearerToken(authorizationHeader: string | undefined): string | null {
  const raw = String(authorizationHeader || '').trim();
  if (!raw) return null;
  const m = raw.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return m[1]?.trim() || null;
}

export function signActorAccessTokenHS256(args: {
  actor: Actor;
  secret: string;
  ttlSeconds: number;
  nowSeconds?: number;
}): string {
  const { actor, secret, ttlSeconds } = args;
  const body: Omit<ActorAccessTokenBody, 'iat' | 'exp'> & { iat?: number } = {
    isAuthenticated: true,
    subjects: actor.subjects,
    roles: actor.roles,
    claims: actor.claims,
    ...(actor.sessionId ? { sid: actor.sessionId } : {}),
    ...(args.nowSeconds !== undefined ? { iat: args.nowSeconds } : {}),
  };
  return signJwtHS256(body, secret, ttlSeconds);
}

export async function verifyActorAccessTokenHS256(args: {
  token: string;
  secret: string;
  nowSeconds?: number;
  sessionStore?: AuthSessionStore;
}): Promise<Actor> {
  const payload = verifyJwtHS256<ActorAccessTokenBody>(args.token, args.secret, args.nowSeconds);
  if (!payload.isAuthenticated) throw new Error('Invalid token');
  if (!isRecord(payload.subjects)) throw new Error('Invalid token');
  if (!Array.isArray(payload.roles)) throw new Error('Invalid token');
  if (!isRecord(payload.claims)) throw new Error('Invalid token');

  const actor: Actor = {
    isAuthenticated: true,
    subjects: payload.subjects,
    roles: payload.roles,
    claims: payload.claims,
    ...(payload.sid ? { sessionId: payload.sid } : {}),
  };

  if (payload.sid && args.sessionStore) {
    const rec = await args.sessionStore.getById(payload.sid);
    if (!rec) throw new Error('Session not found');
    if (rec.revoked) throw new Error('Session revoked');
    const now = args.nowSeconds !== undefined ? new Date(args.nowSeconds * 1000) : new Date();
    if (rec.refresh_expires_at.getTime() <= now.getTime()) throw new Error('Session expired');

    const subjectMatch = Object.values(actor.subjects).some(
      (s) =>
        s.type === rec.subject_type &&
        s.model === rec.subject_model &&
        String(s.id) === rec.subject_id,
    );
    if (!subjectMatch) throw new Error('Session subject mismatch');
  }

  return actor;
}

