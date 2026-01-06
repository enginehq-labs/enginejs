import type { Actor } from '../actors/types.js';
import type { DslModelSpec } from '../dsl/types.js';

export type AclAction = 'read' | 'create' | 'update' | 'delete';

export type DslAccessSpec = {
  read?: string[];
  create?: string[];
  update?: string[];
  delete?: string[];
};

export type AclDecision =
  | { allow: true }
  | { allow: false; reason: string };

export type AclCheckArgs = {
  actor: Actor;
  modelKey: string;
  modelSpec: DslModelSpec;
  action: AclAction;
};

