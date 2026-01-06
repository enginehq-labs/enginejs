# EngineJS Specs — Plugin System

## Plugin contract

```ts
export interface EnginePlugin {
  name: string;
  registerServices?(registry: ServiceRegistry, config: EngineConfig): void;
  registerRoutes?(app: import('express').Express, ctx: EngineRuntime): void;
  registerPipelines?(pipelines: PipelineRegistry, ctx: EngineRuntime): void;
  registerWorkflows?(workflows: WorkflowRegistry, ctx: EngineRuntime): void;
  onDslLoaded?(dsl: unknown, ctx: EngineRuntime): void;
  onModelsReady?(ctx: EngineRuntime): void;
}
```

## Load order

1) core services
2) plugin services
3) DSL compile/validate
4) ORM init
5) plugin lifecycle hooks
6) mount routes (adapter)

