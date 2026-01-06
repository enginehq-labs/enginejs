import type { Actor } from '../actors/types.js';
import type { DslModelSpec } from '../dsl/types.js';

export type PipelinePhase = 'beforeValidate' | 'validate' | 'beforePersist' | 'afterPersist' | 'response';
export type PipelineAction = 'list' | 'read' | 'create' | 'update' | 'delete';

export type PipelineOp =
  | { op: 'trim'; field?: string; fields?: string[] }
  | { op: 'lowercase'; field?: string; fields?: string[] }
  | { op: 'defaults'; values: Record<string, unknown> }
  | { op: 'set'; field: string; value: unknown }
  | { op: 'remove'; fields: string[] }
  | { op: 'redact'; fields: string[]; value?: unknown }
  | { op: 'fieldBasedTransform' }
  | { op: 'fieldBasedValidator' }
  | { op: 'custom'; name: string; args?: unknown };

export type PipelineModelSpec = Partial<
  Record<PipelineAction, Partial<Record<PipelinePhase, PipelineOp[]>>>
>;

export type PipelineCtx = {
  action: PipelineAction;
  phase: PipelinePhase;
  modelKey: string;
  modelSpec: DslModelSpec;
  actor: Actor;
  input: Record<string, unknown>;
  services: {
    has: (name: string) => boolean;
    get: <T>(name: string) => T;
  };
};

export type PipelineResult = {
  output: Record<string, unknown>;
};

