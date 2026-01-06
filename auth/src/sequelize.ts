import type { AuthSessionRecord, AuthSessionStore, SessionSubject } from './sessions.js';

type AuthSessionRowLike = Record<string, unknown>;

type SequelizeModelLike = {
  create: (values: AuthSessionRowLike) => Promise<unknown>;
  findOne: (opts: { where: Record<string, unknown> }) => Promise<unknown | null>;
  findAll: (opts: { where: Record<string, unknown>; order?: unknown }) => Promise<unknown[]>;
  update: (values: Record<string, unknown>, opts: { where: Record<string, unknown> }) => Promise<unknown>;
};

function toDate(v: unknown): Date {
  if (v instanceof Date) return v;
  if (typeof v === 'string' || typeof v === 'number') return new Date(v);
  throw new Error('Invalid date field');
}

function toRecord(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object') throw new Error('Invalid session row');
  return v as Record<string, unknown>;
}

function toAuthSessionRecord(row: unknown): AuthSessionRecord {
  const r = toRecord(row);
  const raw = (r as any).dataValues && typeof (r as any).dataValues === 'object' ? (r as any).dataValues : r;

  return {
    id: String((raw as any).id),
    subject_type: String((raw as any).subject_type),
    subject_model: String((raw as any).subject_model),
    subject_id: String((raw as any).subject_id),
    refresh_hash: String((raw as any).refresh_hash),
    refresh_expires_at: toDate((raw as any).refresh_expires_at),
    revoked: Boolean((raw as any).revoked),
    revoked_at: (raw as any).revoked_at ? toDate((raw as any).revoked_at) : null,
    device_token: (raw as any).device_token !== undefined ? ((raw as any).device_token as any) : undefined,
  };
}

export class SequelizeAuthSessionStore implements AuthSessionStore {
  constructor(
    private readonly deps: {
      model: SequelizeModelLike;
      includeDeletedArchived?: boolean;
    },
  ) {}

  private activeWhere(): Record<string, unknown> {
    if (this.deps.includeDeletedArchived) return {};
    return { deleted: false, archived: false };
  }

  async create(row: AuthSessionRecord): Promise<void> {
    await this.deps.model.create({ ...row });
  }

  async getById(id: string): Promise<AuthSessionRecord | null> {
    const row = await this.deps.model.findOne({ where: { id, ...this.activeWhere() } });
    return row ? toAuthSessionRecord(row) : null;
  }

  async updateRefreshHash(id: string, refresh_hash: string, refresh_expires_at: Date): Promise<void> {
    await this.deps.model.update({ refresh_hash, refresh_expires_at }, { where: { id, ...this.activeWhere() } });
  }

  async revoke(id: string, now: Date): Promise<void> {
    await this.deps.model.update({ revoked: true, revoked_at: now }, { where: { id, ...this.activeWhere() } });
  }

  async listBySubject(subject: SessionSubject): Promise<AuthSessionRecord[]> {
    const rows = await this.deps.model.findAll({
      where: {
        subject_type: subject.type,
        subject_model: subject.model,
        subject_id: String(subject.id),
        revoked: false,
        ...this.activeWhere(),
      },
      order: [['created_at', 'DESC']],
    });
    return rows.map((r) => toAuthSessionRecord(r));
  }

  async revokeAllForSubject(subject: SessionSubject, now: Date): Promise<number> {
    const res = await this.deps.model.update(
      { revoked: true, revoked_at: now },
      {
        where: {
          subject_type: subject.type,
          subject_model: subject.model,
          subject_id: String(subject.id),
          revoked: false,
          ...this.activeWhere(),
        },
      },
    );

    if (Array.isArray(res)) {
      const updated = res[0];
      return typeof updated === 'number' ? updated : 0;
    }
    return 0;
  }

  async updateDeviceToken(id: string, device_token: string | null): Promise<void> {
    await this.deps.model.update({ device_token }, { where: { id, ...this.activeWhere() } });
  }
}

