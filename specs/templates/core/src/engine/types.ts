import type { EngineConfig } from '../config/types.js';
import type { ServiceRegistry } from '../services/types.js';
import type { EnginePlugin } from '../plugins/types.js';
import type { DslRoot } from '../dsl/types.js';
import type { OrmInitResult } from '../orm/types.js';

export type EngineRuntime = {
  config: EngineConfig;
  services: ServiceRegistry;
  dsl: DslRoot | null;
  orm: OrmInitResult | null;
  registerPlugin: (plugin: EnginePlugin) => void;
  init: () => Promise<void>;
};
