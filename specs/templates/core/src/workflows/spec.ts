import type { WorkflowEventAction } from './types.js';

export type WorkflowTrigger =
  | { type: 'model'; model: string; actions: WorkflowEventAction[] }
  | { type: 'interval'; unit: 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years'; value: number }
  | {
      type: 'datetime';
      field: string;
      direction: 'exact' | 'before' | 'after';
      unit?: 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years';
      value?: number;
    };

export type WorkflowActorMode = 'inherit' | 'system' | 'impersonate';

export type WorkflowImpersonate = {
  subject: string;
  idFrom: string;
  type?: string;
  model?: string;
};

export type WorkflowValue = unknown | { from: string };

export type WorkflowStep =
  | {
      op: 'db.update';
      model: string;
      where: { field: string; value: WorkflowValue };
      set: Record<string, WorkflowValue>;
    }
  | {
      op: 'crud.create';
      model: string;
      values: Record<string, WorkflowValue>;
      options?: { runPipelines?: boolean };
    }
  | {
      op: 'crud.list';
      model: string;
      query?: Record<string, unknown>;
      options?: { runPipelines?: boolean };
    }
  | { op: 'log'; message: string }
  | { op: 'custom'; name: string; args?: unknown };

export type WorkflowSpec = {
  name?: string;
  slug?: string;
  description?: string;
  actorMode?: WorkflowActorMode;
  impersonate?: WorkflowImpersonate;
  triggers: WorkflowTrigger[];
  steps: WorkflowStep[];
  retry?: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number };
};
