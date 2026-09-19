# EngineJS Framework: DSL & ORM Initialization

## Introduction

EngineJS uses a Schema-as-Code approach where the system's data model and logic are defined in JSON fragments. These fragments are compiled into a unified DSL and then used to initialize Sequelize models and associations.

## DSL Compilation Workflow

The `compileDslFromFs` function in `core/src/dsl/registry.ts` discovers, loads and validates DSL fragments.

### Fragment Discovery

Fragments load from two directories, set by `config.dsl.fragments.metaDir` and `config.dsl.fragments.modelsDir`. The `enginehq` scaffold uses:

1. **`dsl/meta/*.json`**: System-level models (e.g., `dsl`, `workflow`, `workflow_events_outbox`). Only `dsl` is always required. `workflow_events_outbox` is required when workflows are enabled, and the workflow model when `workflows.registry` is `db`.
2. **`dsl/models/*.json`**: Application-specific business models.

### Compilation Rules

- **Deterministic Order:** Every meta file loads before every model file. Inside each directory, files load in alphabetical order.
- **Last Write Wins:** If a model key is defined in multiple fragments, the last one loaded overwrites the previous ones.
- **Model Keys:** Fragments can define a single model (filename matches key) or a collection of models.

### System Field Augmentation

Before validation, every model is automatically augmented with mandatory system fields:

- `created_at`, `updated_at`: Timestamps.
- `deleted`, `deleted_at`: Soft-delete tracking.
- `archived`, `archived_at`: Archival tracking.
- `auto_name`: STRING field (512 chars) used for FK labels (`<field>_auto_name`). The `find` search parameter always searches it.
- `ui.sort`: Default list sort set to `["-created_at"]` if missing.

### Validation

- **JSON Schema:** The compiled DSL is validated against the built-in EngineJS JSON Schema using Ajv.
- **Constraint Checks:** Ensures virtual fields (`save: false`) do not define database-only properties (e.g., `columnName`, `unique`, `source`).

## ORM Initialization

The `initSequelizeModelsFromDsl` function in `core/src/orm/sequelizeAdapter.ts` transforms the compiled DSL into Sequelize model definitions.

### Model Creation

- **Freeze Table Names:** Database table names match the model key exactly (no pluralization). A model `table` option overrides the name.
- **Underscored:** Set to `false`. The column name is the DSL field name, unchanged, unless `columnName` is set.
- **Timestamps:** Set to `false` (handled by EngineJS system fields).

### Field Mapping

DSL types are mapped to Sequelize `DataTypes`:

- `string` -> `STRING` (respects `length`/`max`).
- `text` -> `TEXT`.
- `int`/`integer` -> `INTEGER`.
- `bigint` -> `BIGINT`.
- `boolean` -> `BOOLEAN`.
- `date`/`datetime` -> `DATE`.
- `json`/`jsonb` -> `JSONB`.
- `float`/`decimal`/`number` -> `DOUBLE`.
- `uuid` -> `UUID`.
- Any other type -> `STRING`, with `max`, `length` or `size` as the length, else 255.

### Associations

The adapter automatically creates Sequelize associations based on the DSL:

- **BelongsTo:** Created when a field specifies `source` and `sourceid`.
- **Junction Tables:** Created for `multi: true` integer fields (`int`, `integer` or `bigint`) with `source` and `sourceid`. These support `belongsToMany` conveniences.
- **String Arrays:** A `string` field with `multi: true` maps to `ARRAY(STRING)`. It cannot have `source` or `sourceid`.

## Virtual Fields

Fields with `save: false` are excluded from the Sequelize model definition and database schema. They exist only at the API and Pipeline levels. A field with `type: "embed"` is not excluded: it becomes a `STRING` column, like any unknown type.

## Query Capabilities

EngineJS provides powerful querying capabilities out-of-the-box for listing operations.

### Relationship Expansion (`includeDepth`)

The `includeDepth` query parameter recursively expands every association of the model, including `BelongsTo` and both sides of junction `belongsToMany` associations.

- By default `includeDepth=0`. The response holds scalar values, plus junction ID arrays and `<field>_auto_name` keys.
- Setting `includeDepth=1` automatically attaches the joined objects alongside their ID references. A junction field holds an array of joined objects instead of IDs, and `<field>_auto_name` keys are not added (e.g. for `company_id` with `source: "company"`, the nested key is the field `as` value, or else `company`).
- Settings like `includeDepth=2` traverses deeper relations (e.g. `user` -> `company` -> `location`). `list` and `read` cap the depth at 10.

### Complex Filtering (`filters`)

You can apply structured filters using the `filters` query parameter. Filters use a comma-separated list of `field:<op><value>` tokens. The field name ends at the first colon. The operator is optional and defaults to `eq`. `field:min..max` gives a range.

- Supported operators: `=`, `>`, `<`, `>=`, `<=` and `!=`. With no operator or `=`, a value with `*` creates an ILIKE filter, and each `*` matches any text. For example, `name:Al*` matches `Alice`.
- Example: `status:=active,created_at:>=2025-01-01`.
- **Logical AND / OR**: Same-field filter constraints are combined with `OR`, while constraints across different fields are combined with `AND`.
  - e.g. `name:=Alice,name:=Bob` resolves to `(name = 'Alice' OR name = 'Bob')`.
  - e.g. `status:=inactive,company_id:=1` resolves to `(status = 'inactive' AND company_id = 1)`.
