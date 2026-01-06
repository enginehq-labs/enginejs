import type { Actor } from '../actors/types.js';
import type { WorkflowOutboxStore } from './outbox.js';
import type { WorkflowEventAction, WorkflowOutboxEvent } from './types.js';

function stableChangedFields(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string[] {
  const keys = new Set<string>();
  for (const k of Object.keys(before || {})) keys.add(k);
  for (const k of Object.keys(after || {})) keys.add(k);
  const out: string[] = [];
  for (const k of [...keys].sort((a, b) => a.localeCompare(b))) {
    const b = before ? (before as any)[k] : undefined;
    const a = after ? (after as any)[k] : undefined;
    if (b !== a) out.push(k);
  }
  return out;
}

export type EmitWorkflowEventArgs = {
  model: string;
  action: WorkflowEventAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changedFields?: string[];
  actor?: Actor;
  origin?: string;
  originChain?: string[];
  parentEventId?: string | number;
};

export class WorkflowEngine {
  constructor(private readonly outbox: WorkflowOutboxStore) {}

  async emitEvent(args: EmitWorkflowEventArgs): Promise<{ id: string | number }> {
    const actor =
      args.actor != null
        ? {
            isAuthenticated: args.actor.isAuthenticated,
            subjects: args.actor.subjects,
            roles: args.actor.roles,
            claims: args.actor.claims,
            ...(args.actor.sessionId ? { sessionId: args.actor.sessionId } : {}),
          }
        : undefined;

    const evt: WorkflowOutboxEvent = {
      model: args.model,
      action: args.action,
      before: args.before,
      after: args.after,
      changedFields: args.changedFields ?? stableChangedFields(args.before, args.after),
      ...(args.origin ? { origin: args.origin } : {}),
      ...(args.originChain ? { originChain: args.originChain } : {}),
      ...(args.parentEventId != null ? { parentEventId: args.parentEventId } : {}),
      ...(actor ? { actor } : {}),
      status: 'pending',
      attempts: 0,
    };
    return this.outbox.enqueue(evt);
  }

  async emitModelEvent(args: EmitWorkflowEventArgs): Promise<{ id: string | number }> {
    return this.emitEvent(args);
  }
}
