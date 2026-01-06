import type { Model, ModelStatic } from 'sequelize';

import type { WorkflowOutboxEvent } from './types.js';

export type OutboxEnqueueResult = { id: string | number };

export interface WorkflowOutboxStore {
  enqueue: (evt: WorkflowOutboxEvent) => Promise<OutboxEnqueueResult>;
}

export class InMemoryWorkflowOutboxStore implements WorkflowOutboxStore {
  readonly events: WorkflowOutboxEvent[] = [];
  private seq = 1;

  async enqueue(evt: WorkflowOutboxEvent): Promise<OutboxEnqueueResult> {
    const id = evt.id ?? this.seq++;
    const stored = { ...evt, id };
    this.events.push(stored);
    return { id };
  }
}

export class SequelizeWorkflowOutboxStore implements WorkflowOutboxStore {
  constructor(private readonly model: ModelStatic<Model>) {}

  async enqueue(evt: WorkflowOutboxEvent): Promise<OutboxEnqueueResult> {
    const row = await (this.model as any).create({
      model: evt.model,
      action: evt.action,
      before: evt.before,
      after: evt.after,
      changed_fields: evt.changedFields,
      origin: evt.origin,
      origin_chain: evt.originChain,
      parent_event_id: evt.parentEventId,
      actor: evt.actor,
      status: evt.status,
      attempts: evt.attempts,
      next_run_at: evt.nextRunAt ?? null,
    });
    const id = (row as any)?.get?.('id') ?? (row as any)?.id;
    return { id: id ?? 'unknown' };
  }
}

