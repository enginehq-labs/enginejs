import crypto from 'node:crypto';
import type { Actor } from '@enginehq/core';

export type SessionSubject = { type: string; model: string; id: string | number };

export type AuthSessionRecord = {
  id: string;
  subject_type: string;
  subject_model: string;
  subject_id: string;
  refresh_hash: string;
  refresh_expires_at: Date;
  revoked: boolean;
  revoked_at: Date | null;
  device_token?: string | null;
};

export interface AuthSessionStore {
  create: (row: AuthSessionRecord) => Promise<void>;
  getById: (id: string) => Promise<AuthSessionRecord | null>;
  updateRefreshHash: (id: string, refresh_hash: string, refresh_expires_at: Date) => Promise<void>;
  revoke: (id: string, now: Date) => Promise<void>;
  listBySubject: (subject: SessionSubject) => Promise<AuthSessionRecord[]>;
  revokeAllForSubject: (subject: SessionSubject, now: Date) => Promise<number>;
  updateDeviceToken: (id: string, device_token: string | null) => Promise<void>;
}

export class InMemoryAuthSessionStore implements AuthSessionStore {
  private readonly rows = new Map<string, AuthSessionRecord>();

  async create(row: AuthSessionRecord): Promise<void> {
    this.rows.set(row.id, row);
  }

  async getById(id: string): Promise<AuthSessionRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async updateRefreshHash(id: string, refresh_hash: string, refresh_expires_at: Date): Promise<void> {
    const r = this.rows.get(id);
    if (!r) return;
    this.rows.set(id, { ...r, refresh_hash, refresh_expires_at });
  }

  async revoke(id: string, now: Date): Promise<void> {
    const r = this.rows.get(id);
    if (!r) return;
    this.rows.set(id, { ...r, revoked: true, revoked_at: now });
  }

  async listBySubject(subject: SessionSubject): Promise<AuthSessionRecord[]> {
    const id = String(subject.id);
    return [...this.rows.values()].filter(
      (r) =>
        r.subject_type === subject.type &&
        r.subject_model === subject.model &&
        r.subject_id === id &&
        !r.revoked,
    );
  }

  async revokeAllForSubject(subject: SessionSubject, now: Date): Promise<number> {
    const matches = await this.listBySubject(subject);
    for (const r of matches) this.rows.set(r.id, { ...r, revoked: true, revoked_at: now });
    return matches.length;
  }

  async updateDeviceToken(id: string, device_token: string | null): Promise<void> {
    const r = this.rows.get(id);
    if (!r) return;
    this.rows.set(id, { ...r, device_token });
  }
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function randomToken(bytes = 32): string {
  const buf = crypto.randomBytes(bytes);
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export type SessionServiceConfig = {
  refreshTtlDays: number;
  refreshRotate: boolean;
};

export class SessionService {
  constructor(
    private readonly deps: {
      store: AuthSessionStore;
      config: SessionServiceConfig;
    },
  ) {}

  async createSession(args: { subject: SessionSubject; actor: Actor; now?: Date; deviceToken?: string | null }) {
    const now = args.now ?? new Date();
    const sid = crypto.randomUUID();
    const refreshToken = `${sid}.${randomToken(32)}`;
    const refresh_hash = sha256Hex(refreshToken);
    const refresh_expires_at = new Date(now.getTime() + this.deps.config.refreshTtlDays * 86_400_000);

    await this.deps.store.create({
      id: sid,
      subject_type: args.subject.type,
      subject_model: args.subject.model,
      subject_id: String(args.subject.id),
      refresh_hash,
      refresh_expires_at,
      revoked: false,
      revoked_at: null,
      ...(args.deviceToken !== undefined ? { device_token: args.deviceToken } : {}),
    });

    return { sid, refreshToken, refreshExpiresAt: refresh_expires_at };
  }

  async verifyRefreshToken(refreshToken: string, now: Date = new Date()): Promise<{ sid: string; record: AuthSessionRecord }> {
    const sid = String(refreshToken || '').split('.')[0] || '';
    if (!sid) throw new Error('Invalid refresh token');
    const rec = await this.deps.store.getById(sid);
    if (!rec) throw new Error('Invalid refresh token');
    if (rec.revoked) throw new Error('Session revoked');
    if (rec.refresh_expires_at.getTime() <= now.getTime()) throw new Error('Refresh expired');
    if (rec.refresh_hash !== sha256Hex(refreshToken)) throw new Error('Invalid refresh token');
    return { sid, record: rec };
  }

  async rotateRefreshToken(refreshToken: string, now: Date = new Date()): Promise<{ sid: string; refreshToken: string; refreshExpiresAt: Date }> {
    const { sid } = await this.verifyRefreshToken(refreshToken, now);
    if (!this.deps.config.refreshRotate) {
      const rec = await this.deps.store.getById(sid);
      if (!rec) throw new Error('Invalid refresh token');
      return { sid, refreshToken, refreshExpiresAt: rec.refresh_expires_at };
    }

    const next = `${sid}.${randomToken(32)}`;
    const refresh_hash = sha256Hex(next);
    const refresh_expires_at = new Date(now.getTime() + this.deps.config.refreshTtlDays * 86_400_000);
    await this.deps.store.updateRefreshHash(sid, refresh_hash, refresh_expires_at);
    return { sid, refreshToken: next, refreshExpiresAt: refresh_expires_at };
  }

  async revokeSession(sid: string, now: Date = new Date()): Promise<void> {
    await this.deps.store.revoke(sid, now);
  }

  async listSessionsForSubject(subject: SessionSubject): Promise<AuthSessionRecord[]> {
    return this.deps.store.listBySubject(subject);
  }

  async revokeAllSessionsForSubject(subject: SessionSubject, now: Date = new Date()): Promise<number> {
    return this.deps.store.revokeAllForSubject(subject, now);
  }

  async updateDeviceToken(sid: string, deviceToken: string | null): Promise<void> {
    await this.deps.store.updateDeviceToken(sid, deviceToken);
  }
}
