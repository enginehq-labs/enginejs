import type { EngineConfig } from '../config/types.js';
import type { EnginePlugin } from '../plugins/types.js';
import { AclEngine } from '../acl/engine.js';
import { compileDslFromFs, type CompiledDsl } from '../dsl/registry.js';
import type { DslModelSpec, DslRoot } from '../dsl/types.js';
import { isDslModelSpec } from '../dsl/types.js';
import { ENGINEJS_DEFAULT_DSL_SCHEMA } from '../dsl/schema.js';
import { PipelineEngine } from '../pipelines/engine.js';
import { initSequelizeModelsFromDsl } from '../orm/sequelizeAdapter.js';
import type { OrmInitResult } from '../orm/types.js';
import { RlsEngine } from '../rls/engine.js';
import { DefaultServiceRegistry } from '../services/DefaultServiceRegistry.js';
import { DefaultPipelineRegistry } from '../services/DefaultPipelineRegistry.js';
import { DefaultWorkflowRegistry } from '../services/DefaultWorkflowRegistry.js';
import type { EngineRuntime } from './types.js';

import { Sequelize } from 'sequelize';
import { SequelizeWorkflowOutboxStore } from '../workflows/outbox.js';
import { WorkflowEngine } from '../workflows/engine.js';
import { createWorkflowRunner } from '../workflows/runnerFactory.js';
import { WorkflowScheduler } from '../workflows/scheduler.js';
import { InMemoryWorkflowSchedulerStore, SequelizeWorkflowSchedulerStore } from '../workflows/schedulerStore.js';
import { WorkflowReplayer } from '../workflows/replayer.js';
import { MigrationRunner } from '../migrations/runner.js';
import { WorkflowOutboxMaintenance } from '../workflows/maintenance.js';
import { CrudService } from '../crud/service.js';
import { normalizeWorkflowsConfig, SequelizeWorkflowRegistryLoader } from '../workflows/registryDb.js';

function getModelSpecFromDsl(dsl: unknown, modelKey: string): DslModelSpec | null {
  if (!dsl || typeof dsl !== 'object') return null;
  const spec = (dsl as any)[modelKey];
  if (!isDslModelSpec(spec)) return null;
  return spec as DslModelSpec;
}

function createLogger() {
  return {
    info: (...args: any[]) => console.log(...args),
    warn: (...args: any[]) => console.warn(...args),
    error: (...args: any[]) => console.error(...args),
    debug: (...args: any[]) => console.debug(...args),
  };
}

export function createEngine(config: EngineConfig): EngineRuntime {
  const services = new DefaultServiceRegistry(config);
  const plugins: EnginePlugin[] = [];
  const pipelines = new DefaultPipelineRegistry();
  const workflows = new DefaultWorkflowRegistry();
  const wfCfg = normalizeWorkflowsConfig(config.workflows as any);

  let compiled: CompiledDsl | null = null;
  let orm: OrmInitResult | null = null;
  let sequelize: Sequelize | null = null;

  services.register('config', 'singleton', () => config);
  services.register('services', 'singleton', () => services);
  services.register('logger', 'singleton', () => createLogger());
  services.register('pipelines', 'singleton', () => pipelines);
  services.register('workflows', 'singleton', () => workflows);
  services.register('dsl', 'singleton', () => {
    if (!compiled) throw new Error('DSL not initialized (call engine.init())');
    return compiled.dsl;
  });
  services.register('db', 'singleton', () => {
    if (!sequelize) throw new Error('DB not initialized (call engine.init())');
    return sequelize;
  });
  services.register('orm', 'singleton', () => {
    if (!orm) throw new Error('ORM not initialized (call engine.init())');
    return orm;
  });
  services.register('models', 'singleton', () => {
    if (!orm) throw new Error('Models not initialized (call engine.init())');
    return orm.models;
  });
  services.register('acl', 'singleton', () => new AclEngine());
  services.register('rls', 'singleton', () => new RlsEngine(config.rls));
  services.register('pipelineEngine', 'singleton', () => new PipelineEngine({ getModelSpec: getModelSpecFromDsl }));
  services.register('workflowEngine', 'singleton', () => {
    if (!orm) throw new Error('Workflow engine requires ORM (call engine.init())');
    const outboxModel = (orm.models as any).workflow_events_outbox;
    if (!outboxModel) throw new Error('Missing workflow_events_outbox model (enable DSL meta model)');
    return new WorkflowEngine(new SequelizeWorkflowOutboxStore(outboxModel));
  });
  services.register('workflowRunner', 'singleton', () => {
    if (!orm || !sequelize) throw new Error('Workflow runner requires ORM (call engine.init())');
    const outboxModel = (orm.models as any).workflow_events_outbox;
    if (!outboxModel) throw new Error('Missing workflow_events_outbox model (enable DSL meta model)');
    const logger = services.resolve<any>('logger', { scope: 'singleton' });
    return createWorkflowRunner({
      sequelize,
      outboxModel,
      models: orm.models,
      workflows,
      services,
      logger,
    });
  });
  services.register('workflowSchedulerStore', 'singleton', () => {
    if (!orm) throw new Error('Workflow scheduler store requires ORM (call engine.init())');
    const model = (orm.models as any).workflow_scheduler_kv;
    if (model) return new SequelizeWorkflowSchedulerStore(model);
    const logger = services.resolve<any>('logger', { scope: 'singleton' });
    logger.warn('[engine] workflow_scheduler_kv missing; using in-memory scheduler store (non-durable)');
    return new InMemoryWorkflowSchedulerStore();
  });
  services.register('workflowScheduler', 'singleton', () => {
    if (!orm) throw new Error('Workflow scheduler requires ORM (call engine.init())');
    const outboxModel = (orm.models as any).workflow_events_outbox;
    if (!outboxModel) throw new Error('Missing workflow_events_outbox model (enable DSL meta model)');
    const logger = services.resolve<any>('logger', { scope: 'singleton' });
    const store = services.resolve<any>('workflowSchedulerStore', { scope: 'singleton' });
    return new WorkflowScheduler({
      outbox: new SequelizeWorkflowOutboxStore(outboxModel),
      workflows,
      models: orm.models,
      logger,
      store,
    });
  });
  services.register('workflowReplayer', 'singleton', () => {
    if (!orm) throw new Error('Workflow replayer requires ORM (call engine.init())');
    const outboxModel = (orm.models as any).workflow_events_outbox;
    if (!outboxModel) throw new Error('Missing workflow_events_outbox model (enable DSL meta model)');
    const logger = services.resolve<any>('logger', { scope: 'singleton' });
    return new WorkflowReplayer({ outboxModel, logger });
  });
  services.register('workflowOutboxMaintenance', 'singleton', () => {
    if (!orm) throw new Error('Workflow outbox maintenance requires ORM (call engine.init())');
    const outboxModel = (orm.models as any).workflow_events_outbox;
    if (!outboxModel) throw new Error('Missing workflow_events_outbox model (enable DSL meta model)');
    const logger = services.resolve<any>('logger', { scope: 'singleton' });
    return new WorkflowOutboxMaintenance({ outboxModel, logger });
  });
  services.register('crudService', 'singleton', () => new CrudService({ services }));
  if (wfCfg.enabled && wfCfg.registry === 'db') {
    services.register('workflowRegistryLoader', 'singleton', () => {
      if (!orm) throw new Error('Workflow registry loader requires ORM (call engine.init())');
      const workflowModel = (orm.models as any)[wfCfg.db.modelKey];
      if (!workflowModel) {
        throw new Error(`Missing required meta model: ${wfCfg.db.modelKey} (create dsl/meta/${wfCfg.db.modelKey}.json)`);
      }
      const logger = services.resolve<any>('logger', { scope: 'singleton' });
      return new SequelizeWorkflowRegistryLoader({
        workflowModel,
        registry: workflows,
        logger,
        strict: wfCfg.strict,
      });
    });
  }

  function registerPlugin(plugin: EnginePlugin) {
    plugins.push(plugin);
  }

  async function init() {
    for (const plugin of plugins) plugin.registerServices?.(services, config);
    if (config.migrations?.migrations?.length && !services.has('migrationRunner')) {
      services.register('migrationRunner', 'singleton', () => {
        if (!sequelize) throw new Error('Migration runner requires DB (call engine.init())');
        const logger = services.resolve<any>('logger', { scope: 'singleton' });
        return new MigrationRunner({
          sequelize,
          migrations: config.migrations!.migrations,
          logger,
          ...(config.migrations?.tableName ? { tableName: config.migrations.tableName } : {}),
        });
      });
    }
    for (const plugin of plugins) plugin.registerPipelines?.(pipelines, runtime);
    for (const plugin of plugins) plugin.registerWorkflows?.(workflows, runtime);

    compiled = compileDslFromFs(
      {
        modelsDir: config.dsl.fragments.modelsDir,
        metaDir: config.dsl.fragments.metaDir,
        ...(config.dsl.allowMonolithDslJson !== undefined
          ? { allowMonolithDslJson: config.dsl.allowMonolithDslJson }
          : {}),
        ...(config.dsl.monolithPath !== undefined ? { monolithPath: config.dsl.monolithPath } : {}),
      },
      config.dsl.schema ?? config.dsl.schemaPath ?? ENGINEJS_DEFAULT_DSL_SCHEMA,
    );

    if (!(compiled.dsl as any).dsl) {
      throw new Error('Missing required meta model: dsl (create dsl/meta/dsl.json)');
    }

    const dialect = config.db.dialect || 'postgres';
    sequelize = new Sequelize(config.db.url, { logging: false, dialect: dialect as any });
    orm = initSequelizeModelsFromDsl(sequelize, compiled.dsl);
    runtime.dsl = compiled.dsl as DslRoot;
    runtime.orm = orm;

    if (wfCfg.enabled && wfCfg.registry === 'db') {
      const loader = services.resolve<any>('workflowRegistryLoader', { scope: 'singleton' });
      await loader.loadFromDb();
    }

    for (const plugin of plugins) plugin.onDslLoaded?.(compiled.dsl, runtime);
    for (const plugin of plugins) plugin.onModelsReady?.(runtime);
  }

  const runtime: EngineRuntime = {
    config,
    services,
    dsl: null,
    orm: null,
    registerPlugin,
    init,
  };

  return runtime;
}
