# EngineJS Framework — DSL & ORM Initialization

## Introduction

EngineJS uses a Schema-as-Code approach where the system's data model and logic are defined in JSON fragments. These fragments are compiled into a unified DSL and then used to initialize Sequelize models and associations.

## DSL Compilation Workflow

The `DslRegistry` handles the discovery, loading, and validation of DSL fragments.

### Fragment Discovery

Fragments are loaded from two opinionated directories:

1. **`dsl/meta/*.json`**: System-level models (e.g., `dsl`, `workflow`, `outbox`).
2. **`dsl/models/*.json`**: Application-specific business models.

### Compilation Rules

- **Deterministic Order:** Files are loaded alphabetically by filename.
- **Last Write Wins:** If a model key is defined in multiple fragments, the last one loaded (according to alphabetical order) overwrites the previous ones.
- **Model Keys:** Fragments can define a single model (filename matches key) or a collection of models.

### System Field Augmentation

Before validation, every model is automatically augmented with mandatory system fields:

- `created_at`, `updated_at`: Timestamps.
- `deleted`, `deleted_at`: Soft-delete tracking.
- `archived`, `archived_at`: Archival tracking.
- `auto_name`: STRING field (512 chars) used for search and FK resolution.
- `ui.sort`: Default list sort set to `["-created_on"]` if missing.

### Validation

- **JSON Schema:** The compiled DSL is validated against the built-in EngineJS JSON Schema using Ajv.
- **Constraint Checks:** Ensures virtual fields (`save: false`) do not define database-only properties (e.g., `columnName`, `unique`, `source`).

## ORM Initialization

The `SequelizeAdapter` transforms the compiled DSL into Sequelize model definitions.

### Model Creation

- **Freeze Table Names:** Database table names match the model key exactly (no pluralization).
- **Underscored:** Set to `false` (uses camelCase for columns by default unless `columnName` is specified).
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

### Associations

The adapter automatically creates Sequelize associations based on the DSL:

- **BelongsTo:** Created when a field specifies `source` and `sourceid`.
- **HasMany:** (Reserved) Intended for reverse lookups.
- **Junction Tables:** Created for `multi: true` fields with `type: int` and a source. These support `belongsToMany` conveniences.
- **String Arrays:** Mapped to `ARRAY(STRING)` for Postgres.

## Virtual Fields & Embeds

Fields with `save: false` or `type: "embed"` are excluded from the Sequelize model definition and database schema. They exist only at the API and Pipeline levels.

## Query Capabilities

EngineJS provides powerful querying capabilities out-of-the-box for listing operations.

### Relationship Expansion (`includeDepth`)

The `includeDepth` query parameter recursively expands `BelongsTo` relationships (foreign-key to parent).

- By default `includeDepth=0`, meaning all responses securely return only native scalar values.
- Setting `includeDepth=1` automatically attaches the joined objects alongside their ID references (e.g. expanding `company_id` to include the nested `company` object).
- Settings like `includeDepth=2` traverses deeper relations (e.g. `user` -> `company` -> `location`).

### Complex Filtering (`filters`)

You can apply structured filters using the `filters` query parameter. Filters use a comma-separated syntax of `field:operator:value`.

- Supported operators: `=`, `>`, `<`, `>=`, `<=`, `!=`, `like` (mapped to `opToken`s like `eq`, `gt`, `lt`, etc.)
- Example: `status:=active,created_at:>=2025-01-01` (Note the `=` is represented implicitly or directly depending on parser operator tokens).
- **Logical AND / OR**: Same-field filter constraints are combined with `OR`, while constraints across different fields are combined with `AND`.
  - e.g. `name:=Alice,name:=Bob` resolves to `(name = 'Alice' OR name = 'Bob')`.
  - e.g. `status:=inactive,company_id:=1` resolves to `(status = 'inactive' AND company_id = 1)`.
