# EngineJS Framework — Lifecycle & Service Container

## Introduction
The EngineJS framework uses a Service Container for Dependency Injection (DI) and follows a strict initialization lifecycle. This ensures that all components, including plugins and logic engines, are correctly configured and available before the system starts handling requests.

## Service Container (DI)
The `ServiceRegistry` is responsible for registering and resolving system components.

### Service Scopes
Services can be registered with the following scopes:
- **`singleton`:** The service factory is executed once per application lifetime. The result is cached and returned for all subsequent resolutions.
- **`request`:** (Reserved) Intended for services that are recreated for each incoming HTTP request.
- **`job`:** (Reserved) Intended for services recreated for each workflow execution or background job.

### Default Services
The following core services are registered during `createEngine()`:
- `config`: Canonical `EngineConfig`.
- `logger`: System logging utility.
- `pipelines`: Registry for per-model pipeline specifications.
- `workflows`: Registry for durable workflow definitions.
- `dsl`: The compiled system DSL.
- `db`: The initialized Sequelize instance.
- `orm`: The ORM adapter result containing all models.
- `models`: Shortcut to all initialized Sequelize models.
- `acl`: The ACL engine.
- `rls`: The RLS engine.
- `pipelineEngine`: The executor for pipeline phases.
- `workflowEngine`: The emitter for outbox events.
- `workflowRunner`: The executor for background workflows.
- `crudService`: The non-HTTP generic CRUD implementation.

## Engine Initialization Lifecycle
The `engine.init()` method executes the system bootstrap in a deterministic order:

1. **Plugin Registration:**
    - Call `registerServices` on all plugins to allow them to add custom services to the container.
    - Initialize internal runners (e.g., `migrationRunner`).
    - Call `registerPipelines` and `registerWorkflows` on all plugins.

2. **DSL Compilation:**
    - Load DSL fragments from the filesystem (`dsl/meta` then `dsl/models`).
    - Augment fragments with system fields (`created_at`, `auto_name`, etc.).
    - Validate the compiled DSL against the EngineJS JSON Schema.
    - Check virtual field constraints.

3. **Pipeline Registration:**
    - Extract per-model `pipelines` from the DSL and register them in the `PipelineRegistry`.

4. **ORM Initialization:**
    - Initialize the Sequelize connection.
    - Create models and associations (BelongsTo, HasMany, Junctions) from the compiled DSL.

5. **Workflow Registry Hydration:**
    - If `registry: "db"` is enabled, load workflow definitions from the database into the memory registry.

6. **Lifecycle Hooks:**
    - Call `onDslLoaded` on all plugins.
    - Call `onModelsReady` on all plugins.

7. **Runtime Ready:**
    - The `engine` object is now fully populated with `dsl` and `orm` and ready for use by adapters (e.g., Express).

## Plugin System
Plugins extend the framework by implementing the `EnginePlugin` interface. They can observe and react to different stages of the lifecycle, register custom pipeline operations, and add business-specific services.
