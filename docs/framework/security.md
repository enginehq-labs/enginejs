# EngineJS Framework: Security (ACL & RLS)

## Introduction
EngineJS implements a multi-layered security model that combines role-based Access Control Lists (ACL) with identity-based Row-Level Security (RLS). All security policies are defined declaratively in the system configuration and DSL.

## ACL (Access Control Lists)
ACL is the first layer of defense, governing whether an actor can perform a specific action on a model based on their roles.

### Action Mapping
ACL rules are defined per model in the DSL under the `access` key:
- `read`: View single or list of records.
- `create`: Create new records.
- `update`: Modify existing records.
- `delete`: Delete records.

### Evaluation Logic
- **Deny by Default:** If no `access` spec is provided for a model or action, access is denied.
- **Wildcard (`*`):** Allows every actor to perform the action, including the anonymous actor.
- **Role Match:** Access is granted if at least one of the actor's roles matches an entry in the allowed list for the action.

## RLS (Row-Level Security)
RLS is the second layer of defense, ensuring that an actor can only access specific rows within a model based on their associated subjects (identities).

### Multi-Subject Identity
Actors in EngineJS can hold multiple "subjects". `actor.subjects` is a map keyed by subject type, and each value is `{ type, model, id }`. RLS rules map these subject IDs to model fields.

### RLS Scoping (Read/List)
The `RlsEngine` generates abstract "where" clauses that are transformed into Sequelize predicates.
- **Field rule `{ subject, field }`:** Matches the subject ID of the actor to a field (e.g., `customer_id = 42`).
- **`via` rule (Join Paths):** Scopes access through a chain of relationships. The engine generates a `WHERE <primary key> IN (SELECT ...)` subquery that follows the path. It checks the `deleted` and `archived` flags on each model that has those columns. `engine.init` throws when a chain is empty, does not start at the policy model, has a step that does not start where the previous step ends, or uses an unknown model. If a chain still cannot convert at request time, the filter matches no row.
- **`anyOf` / `allOf`:** Logical combinators for building complex policies. `anyOf` ignores branches where the required subject is missing from the actor.

### RLS Write Guards (Create/Update)
For create and update, RLS operates in one of two modes. The default is `validate`. A delete uses the read scope filter, not a write guard.
- **`enforce`:** The system overwrites the protected fields with the actor's subject IDs. A value from the client is replaced with no error. Only `{ subject, field }` rules add fields. The guard runs before the pipeline phases and again after `beforePersist`, so a pipeline op cannot change a protected field.
- **`validate`:** The system checks each protected field that the payload contains, with strict equality, before and after the pipeline phases. A missing field passes and is not filled in. A mismatch denies the request.
- **`via` rules:** A `via` rule protects no field. On create and update, the system selects the written row with the `via` subquery inside the write transaction. If the row is out of scope, the write rolls back and the request is denied.

### Bypassing RLS
RLS can be bypassed based on:
- **Roles:** Defined in the global RLS config (e.g., `super_admin`).
- **Claims:** Bypassed if the configured claim in `actor.claims` is `true`, `1`, `'1'` or `'true'`.

## Evaluation Flow
1. **ACL Check:** Verify actor roles against model access specs.
2. **RLS Bypass Check:** Check if actor has bypass roles or claims. These do not skip the ACL check.
3. **RLS Rule Evaluation:**
    - For **Read/List**: Generate and append the RLS filter to the database query.
    - For **Create**: Apply the `writeGuard` logic (enforce or validate).
    - For **Update**: Add the `update` scope filter to find the row, then apply the `writeGuard` logic.
    - For **Delete**: Apply the scope filter.
4. **Final Decision:** Access is granted only if both layers allow the operation. The only way to skip ACL is the `bypassAclRls` call option, which skips ACL and RLS together. Each such call writes the info log line `[crud] audited bypass` with the model, the action, the origin, and the actor subjects and roles. The line does not contain the actor claims.
