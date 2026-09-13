import type { DslRoot } from '../dsl/types.js';
import { isDslModelSpec } from '../dsl/types.js';
import type { RlsConfig, RlsRuleSet } from './types.js';

type ViaStep = { fromModel: string; fromField: string; toModel: string; toField: string };

/**
 * Checks each `via` rule in the RLS policies against the DSL.
 *
 * A chain that cannot convert to SQL denies every row at request time, so engine.init
 * reports it first, with the model and the action.
 */
export function validateRlsPolicies(rls: RlsConfig | undefined, dsl: DslRoot): void {
  const hasModel = (key: string) => isDslModelSpec((dsl as any)[key]);

  for (const [modelKey, policy] of Object.entries(rls?.policies ?? {})) {
    for (const [action, ruleSet] of Object.entries(policy ?? {})) {
      const fail = (reason: string): never => {
        throw new Error(`Invalid RLS policy ${modelKey}.${action}: ${reason}`);
      };

      const check = (rs: RlsRuleSet | undefined): void => {
        const r = rs as any;
        if (!r || typeof r !== 'object') return;
        if (Array.isArray(r.anyOf)) return r.anyOf.forEach(check);
        if (Array.isArray(r.allOf)) return r.allOf.forEach(check);
        if (r.via === undefined) return;

        const chain = (Array.isArray(r.via) ? r.via : []) as ViaStep[];
        if (!chain.length) fail('via chain is empty');
        if (!hasModel(modelKey)) fail(`via chain uses unknown model ${modelKey}`);

        let prev = modelKey;
        chain.forEach((step, i) => {
          if (String(step.fromModel) !== prev) {
            fail(i === 0 ? `via chain must start at model ${modelKey}` : `via step ${i + 1} must start at model ${prev}`);
          }
          if (!hasModel(String(step.toModel))) fail(`via step ${i + 1} uses unknown model ${step.toModel}`);
          prev = String(step.toModel);
        });
      };

      check(ruleSet as RlsRuleSet);
    }
  }
}
