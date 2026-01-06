import type { EngineConfig } from '../config/types.js';
import type { EngineRuntime } from '../engine/types.js';
import type { PipelineRegistry } from '../services/types.js';
import type { ServiceRegistry } from '../services/types.js';
import type { WorkflowRegistry } from '../services/types.js';

export interface EnginePlugin {
  name: string;
  registerServices?: (registry: ServiceRegistry, config: EngineConfig) => void;
  registerPipelines?: (pipelines: PipelineRegistry, ctx: EngineRuntime) => void;
  registerWorkflows?: (workflows: WorkflowRegistry, ctx: EngineRuntime) => void;
  onDslLoaded?: (dsl: unknown, ctx: EngineRuntime) => void;
  onModelsReady?: (ctx: EngineRuntime) => void;
}

