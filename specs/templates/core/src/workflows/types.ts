import type { Actor } from '../actors/types.js';

export type WorkflowEventAction = 'create' | 'update' | 'delete' | 'interval' | 'datetime';

export type WorkflowOutboxStatus = 'pending' | 'processing' | 'done' | 'failed' | 'archived';

export type WorkflowOutboxEvent = {
  id?: string | number;
  model: string;
  action: WorkflowEventAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changedFields: string[];

  origin?: string;
  originChain?: string[];
  parentEventId?: string | number;
  actor?: Pick<Actor, 'isAuthenticated' | 'subjects' | 'roles' | 'claims' | 'sessionId'>;

  status: WorkflowOutboxStatus;
  attempts: number;
  nextRunAt?: string;
  createdAt?: string;
};
