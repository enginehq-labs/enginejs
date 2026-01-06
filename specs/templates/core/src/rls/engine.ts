import type { Actor } from '../actors/types.js';
import type { RlsConfig, RlsModelPolicy, RlsRuleSet } from './types.js';
import { RlsNotImplementedError } from './errors.js';
import { andWhere, orWhere, type RlsWhere } from './where.js';

export type RlsAction = 'list' | 'read' | 'create' | 'update' | 'delete';

export type RlsScopeResult =
  | { kind: 'bypass'; allow: true; where: null }
  | { kind: 'unscoped'; allow: true; where: null }
  | { kind: 'scoped'; allow: true; where: RlsWhere }
  | { kind: 'denied'; allow: false; where: null; reason: string };

export type RlsWriteGuard =
  | { kind: 'bypass'; allow: true; mode: 'bypass'; enforced: Record<string, never> }
  | {
      kind: 'unscoped';
      allow: true;
      mode: 'none';
      enforced: Record<string, never>;
    }
  | {
      kind: 'scoped';
      allow: true;
      mode: 'enforce' | 'validate';
      enforced: Record<string, string | number>;
      validateFields: string[];
    }
  | { kind: 'denied'; allow: false; mode: 'deny'; enforced: Record<string, never>; reason: string };

function isTruthy(v: unknown) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function bypassed(config: RlsConfig, actor: Actor): boolean {
  const roles = new Set(actor.roles || []);
  const bypassRoles = config.bypass?.roles || [];
  if (bypassRoles.some((r) => roles.has(r))) return true;
  const claim = config.bypass?.claim;
  if (claim && isTruthy(actor.claims?.[claim])) return true;
  return false;
}

function evalRuleSetToWhere(ruleSet: RlsRuleSet, actor: Actor): RlsWhere | null {
  if ((ruleSet as any)?.anyOf) {
    const parts = ((ruleSet as any).anyOf as RlsRuleSet[]).map((r) => evalRuleSetToWhere(r, actor));
    return orWhere(parts);
  }
  if ((ruleSet as any)?.allOf) {
    const parts = ((ruleSet as any).allOf as RlsRuleSet[]).map((r) => evalRuleSetToWhere(r, actor));
    if (parts.some((p) => !p)) return null;
    return andWhere(parts);
  }

  const r = ruleSet as any;
  if (r?.subject && r?.field) {
    const subj = actor.subjects?.[String(r.subject)];
    if (!subj) return null;
    return { eq: { field: String(r.field), value: subj.id } };
  }
  if (r?.subject && r?.via) {
    const subj = actor.subjects?.[String(r.subject)];
    if (!subj) return null;
    const chain = Array.isArray(r.via) ? r.via : [];
    if (!chain.length) return null;
    return {
      via: {
        subject: String(r.subject),
        subjectId: subj.id,
        chain: chain.map((s: any) => ({
          fromModel: String(s.fromModel),
          fromField: String(s.fromField),
          toModel: String(s.toModel),
          toField: String(s.toField),
        })),
      },
    };
  }
  if (r?.custom) {
    throw new RlsNotImplementedError('RLS custom predicates are not implemented yet');
  }

  return null;
}

function getPolicyForAction(policy: RlsModelPolicy | undefined, action: RlsAction): RlsRuleSet | undefined {
  if (!policy) return undefined;
  return (policy as any)[action] as RlsRuleSet | undefined;
}

export class RlsEngine {
  constructor(private readonly config: RlsConfig) {}

  scope({ actor, modelKey, action }: { actor: Actor; modelKey: string; action: RlsAction }): RlsScopeResult {
    if (bypassed(this.config, actor)) return { kind: 'bypass', allow: true, where: null };

    const modelPolicy = this.config.policies?.[modelKey];
    const ruleSet = getPolicyForAction(modelPolicy, action);
    if (!ruleSet) return { kind: 'unscoped', allow: true, where: null };

    const where = evalRuleSetToWhere(ruleSet, actor);
    if (!where) return { kind: 'denied', allow: false, where: null, reason: 'RLS denied' };
    return { kind: 'scoped', allow: true, where };
  }

  writeGuard({
    actor,
    modelKey,
    action,
  }: {
    actor: Actor;
    modelKey: string;
    action: Exclude<RlsAction, 'list' | 'read'>;
  }): RlsWriteGuard {
    if (bypassed(this.config, actor)) {
      return { kind: 'bypass', allow: true, mode: 'bypass', enforced: {} };
    }

    const modelPolicy = this.config.policies?.[modelKey];
    const ruleSet = getPolicyForAction(modelPolicy, action);
    if (!ruleSet) return { kind: 'unscoped', allow: true, mode: 'none', enforced: {} };

    const mode = ((ruleSet as any)?.writeMode as 'enforce' | 'validate' | undefined) ?? 'validate';
    const where = evalRuleSetToWhere(ruleSet, actor);
    if (!where) {
      return { kind: 'denied', allow: false, mode: 'deny', enforced: {}, reason: 'RLS denied' };
    }

    const enforced: Record<string, string | number> = {};
    const validateFields: string[] = [];

    const collect = (rs: RlsRuleSet) => {
      if ((rs as any)?.anyOf) for (const x of (rs as any).anyOf as RlsRuleSet[]) collect(x);
      else if ((rs as any)?.allOf) for (const x of (rs as any).allOf as RlsRuleSet[]) collect(x);
      else if ((rs as any)?.subject && (rs as any)?.field) {
        const subj = actor.subjects?.[String((rs as any).subject)];
        if (!subj) return;
        const field = String((rs as any).field);
        enforced[field] = subj.id;
        if (mode !== 'enforce') validateFields.push(field);
      }
    };
    collect(ruleSet);

    return { kind: 'scoped', allow: true, mode, enforced, validateFields };
  }
}
