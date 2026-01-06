export type ServiceScope = 'singleton' | 'request' | 'job';

export type ServiceFactoryCtx = {
  config: unknown;
};

export type ResolveCtx = {
  scope: ServiceScope;
};

export interface ServiceRegistry {
  register<T>(name: string, scope: ServiceScope, factory: (ctx: ServiceFactoryCtx) => T): void;
  resolve<T>(name: string, ctx: ResolveCtx): T;
  has(name: string): boolean;
}

export type PipelineRegistry = {
  register: (modelKey: string, spec: unknown) => void;
  get: (modelKey: string) => unknown | undefined;
};

export type WorkflowRegistry = {
  register: (name: string, spec: unknown) => void;
  get: (name: string) => unknown | undefined;
  list: () => string[];
};
