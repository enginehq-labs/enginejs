# EngineJS Framework — Security (ACL & RLS)

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
- **Wildcard (`*`):** Allows any actor (including unauthenticated ones if the adapter permits) to perform the action.
- **Role Match:** Access is granted if at least one of the actor's roles matches an entry in the allowed list for the action.

## RLS (Row-Level Security)
RLS is the second layer of defense, ensuring that an actor can only access specific rows within a model based on their associated subjects (identities).

### Multi-Subject Identity
Actors in EngineJS can hold multiple "subjects" (e.g., `user:1`, `customer:42`, `organization:7`). RLS rules map these subject IDs to model fields.

### RLS Scoping (Read/List)
The `RlsEngine` generates abstract "where" clauses that are transformed into Sequelize predicates.
- **`eq` rule:** Directly matches a subject ID to a field (e.g., `customer_id = 42`).
- **`via` rule (Join Paths):** Scopes access through a chain of relationships. The engine generates a `WHERE id IN (SELECT ...)` subquery that traverses the specified path while respecting `deleted` and `archived` flags at every step.
- **`anyOf` / `allOf`:** Logical combinators for building complex policies. `anyOf` ignores branches where the required subject is missing from the actor.

### RLS Write Guards (Create/Update/Delete)
For write operations, RLS operates in one of two modes:
- **`enforce`:** The system automatically overwrites the protected fields with the actor's subject IDs. The client cannot provide these values.
- **`validate`:** The system verifies that the values provided by the client match the actor's subject IDs. If they don't, the request is denied.

### Bypassing RLS
RLS can be bypassed based on:
- **Roles:** Defined in the global RLS config (e.g., `super_admin`).
- **Claims:** Bypassed if a specific JWT claim is present and truthy.

## Evaluation Flow
1. **ACL Check:** Verify actor roles against model access specs.
2. **RLS Bypass Check:** Check if actor has bypass roles or claims.
3. **RLS Rule Evaluation:**
    - For **Read/List**: Generate and append the RLS filter to the database query.
    - For **Write**: Apply the `writeGuard` logic (enforce or validate).
4. **Final Decision:** Access is granted only if both layers (or their bypasses) allow the operation.
