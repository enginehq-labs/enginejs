# EngineJS Specs — Auth, ACL, and Multi-Subject RLS

## Actor model

EngineJS MUST normalize every request into an `Actor`:

```ts
export type SubjectRef = { type: string; model: string; id: string | number };

export type Actor = {
  isAuthenticated: boolean;
  subjects: Record<string, SubjectRef>;
  roles: string[];
  claims: Record<string, unknown>;
  sessionId?: string;
};
```

Actors MAY have multiple subjects (customer/user/both/more).

## Subject resolution

Subject resolution MUST be config-driven:

- map token claims to subject ids
- optionally hydrate subject rows to compute roles/metadata
- keep all resolved subjects on the actor; RLS policy decides which apply

## ACL

ACL MUST include:

- model action access (`read/create/update/delete`)
- field pruning on response

ACL MUST be enforced for CRUD routes.

## DSL `access` format (MVP)

Each DSL model MAY define an `access` object:

```json
{
  "access": {
    "read": ["admin", "trainer"],
    "create": ["admin"],
    "update": ["admin"],
    "delete": ["admin"]
  }
}
```

Rules:

- If `access` is missing OR `access.<action>` is missing/empty, the action is denied.
- An action list MAY contain `"*"` to allow any actor (including unauthenticated).
- Model-level access is required for Step 5.2 CRUD.

Field-pruning rules are specified later; initial implementation may no-op pruning while still enforcing model-level access.

## RLS configuration (declarative)

### `RlsConfig`

```ts
export type RlsConfig = {
  subjects: Record<string, { model: string; idClaims: string[] }>;
  actorRoles?: { fromModel?: string; roleNameField?: string; roleIdField?: string };
  policies: Record<string, RlsModelPolicy>;
  bypass?: { roles?: string[]; claim?: string };
};
```

### Policies

```ts
export type RlsModelPolicy = {
  list?: RlsRuleSet;
  read?: RlsRuleSet;
  create?: RlsWriteRuleSet;
  update?: RlsWriteRuleSet;
  delete?: RlsWriteRuleSet;
};
```

### Rule sets and combinators

RLS MUST support:

- `anyOf` (OR)
- `allOf` (AND)

### Minimum rule types

1) Direct FK scoping:

```ts
{ subject: 'customer', field: 'customer_id' }
```

2) Join/path scoping:

```ts
{ subject: 'customer', via: [ { fromModel, fromField, toModel, toField }, ... ] }
```

3) Custom predicate hook:

```ts
{ custom: 'predicateName' }
```

## Enforcement points (must be complete)

RLS MUST apply to:

- list/read queries
- update/delete target checks
- create/update write guards (anti-forgery)
- FK lookups used by includes and by `find`

## Write guards

Per model/action, RLS MUST support:

- `enforce` ownership (server sets ownership fields)
- `validate` ownership (reject mismatches)

## Bypass

Bypass MUST be explicit and audited:

- only allowed via configured roles/claims
- audit log required when bypass is used

## RlsEngine (core implementation boundary)

EngineJS core MUST provide an `RlsEngine` that can:

- evaluate a model/action policy for an `Actor`
- compute a deterministic scope result:
  - `unscoped` when no policy exists for that model/action
  - `scoped` with a where expression when a policy matches the actor subjects
  - `denied` when a policy exists but cannot match the actor subjects
  - `bypass` when bypass roles/claims apply

Custom predicates may raise “not implemented” errors until implemented.

## Join/path scoping (implemented)

For rules of the form:

```ts
{ subject: 'customer', via: [ { fromModel, fromField, toModel, toField }, ... ] }
```

Semantics:

- The chain MUST start at the scoped model key and be sequential (`via[i].fromModel === via[i-1].toModel`).
- The last `toField` is compared to the actor subject id (i.e., the join path must reach the subject row or a row keyed by the subject id).

Adapters MUST translate this to a DB-level predicate (e.g., `IN (SELECT ...)` or `EXISTS (...)`) and MUST apply default “active row” filters (`deleted=false AND archived=false`) for all tables in the chain when those columns exist.
