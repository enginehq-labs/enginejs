import type { AclAction, AclCheckArgs, AclDecision, DslAccessSpec } from './types.js';

function normalizeAccessSpec(v: unknown): DslAccessSpec | null {
  if (!v || typeof v !== 'object') return null;
  const out: DslAccessSpec = {};
  for (const k of ['read', 'create', 'update', 'delete'] as const) {
    const arr = (v as any)[k];
    if (arr === undefined) continue;
    if (!Array.isArray(arr)) return null;
    out[k] = arr.map((x) => String(x));
  }
  return out;
}

function rolesAllow(allowed: readonly string[], actorRoles: readonly string[]): boolean {
  if (allowed.includes('*')) return true;
  const roles = new Set(actorRoles || []);
  for (const r of allowed) if (roles.has(r)) return true;
  return false;
}

export class AclEngine {
  can({ actor, modelKey, modelSpec, action }: AclCheckArgs): AclDecision {
    const access = normalizeAccessSpec((modelSpec as any).access);
    if (!access) return { allow: false, reason: `ACL denied (${modelKey}.${action})` };
    const allowed = access[action] ?? [];
    if (!allowed.length) return { allow: false, reason: `ACL denied (${modelKey}.${action})` };
    if (!rolesAllow(allowed, actor.roles || [])) return { allow: false, reason: `ACL denied (${modelKey}.${action})` };
    return { allow: true };
  }

  // Field pruning is implemented later (specs/06-auth-acl-rls.md).
  pruneRead<T>(row: T): T {
    return row;
  }
}

