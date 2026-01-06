# EngineJS Specs — Workflows + Outbox

## Event schema (minimum)

Outbox events MUST include:

- `model`, `action`
- `before`, `after`, `changedFields`
- timestamps + retry metadata
- `origin`, `originChain`, `parentEventId` (loop suppression)
- optional actor snapshot

### Actions

`action` MUST support:

- model mutations: `create|update|delete`
- time triggers: `interval|datetime`

## Outbox storage (MVP)

EngineJS MUST provide an outbox store abstraction and a Sequelize-backed implementation:

- Preferred table/model key: `workflow_events_outbox`
- Sequelize store writes events as a row with these columns (snake_case):
  - `model`, `action`
  - `before` (JSON), `after` (JSON), `changed_fields` (string[])
  - `origin`, `origin_chain` (string[]), `parent_event_id`
  - `actor` (JSON)
  - `status` (`pending|processing|done|failed|archived`)
  - `attempts` (int), `next_run_at` (datetime nullable)

If workflows are enabled but the outbox model is missing, CRUD MUST fail with 500 (misconfigured).

## Guarantees

- Outbox insert MUST be durable before acknowledging HTTP mutation success.
- Replayer MUST re-enqueue **stale processing** events (crash recovery).
- Dispatcher MUST suppress circular/self-triggering via origin-chain.
- Executor MUST support retries with backoff and completion marking.

## Emission from CRUD (MVP)

When workflows are enabled, CRUD create/update/delete MUST enqueue an outbox event **after** the `afterPersist` pipeline phase (so plugins can mutate the saved row) and **before** the HTTP response is returned.

## Triggers

Workflows MUST support:

- model events (create/update/delete)
- interval triggers (`minutes|hours|days|weeks|months|years`)
- datetime triggers (`exact|before|after` with offset)

### Trigger matching rules

- Model trigger matches when:
  - `event.action` is `create|update|delete`
  - `event.model` matches the trigger `model`
  - trigger `actions` includes `event.action`
- Interval trigger matches when:
  - `event.action` is `interval`
  - `event.after.unit` and `event.after.value` match the trigger `unit` and `value`
- Datetime trigger matches when:
  - `event.action` is `datetime`
  - trigger `field|direction|unit|value` matches the scheduler-produced metadata stored on `event.before`

## Workflow spec (MVP)

Workflows are registered by name into the `workflows` registry.

Minimum supported workflow fields:

- `triggers`: array of trigger objects
  - model trigger: `{ type: "model", model: "<modelKey>", actions: ["create"|"update"|"delete"] }`
- `steps`: array of step objects
  - built-in: `db.update`
  - built-in: `log`
  - extensible: `custom`

### Step: `db.update` (MVP)

Updates rows in a model using Sequelize, enforcing ACL/RLS based on the workflow actor.

Rules:

- For `actorMode=inherit|impersonate`, `db.update` MUST:
  - require model-level ACL `update` access
  - apply RLS scope to the update target
  - apply write-guard enforcement (anti-forgery)
- For `actorMode=system`, `db.update` MAY bypass ACL/RLS (audited).

```json
{
  "op": "db.update",
  "model": "post",
  "where": { "field": "id", "value": { "from": "after.id" } },
  "set": { "status": "processed" }
}
```

Value references:

- `{ "from": "after.id" }` resolves against the outbox event object (e.g., `after.id`, `before.customer_id`).

## Runner (MVP)

EngineJS MUST provide a runner that:

- claims `pending` events from the outbox and marks them `processing`
- dispatches to matching workflows by model trigger
- executes workflow steps with retries/backoff
- marks events `done` on success, `failed` when attempts exceed max

Runner MUST treat an event as due when:

- `status = pending`, and
- `next_run_at IS NULL` OR `next_run_at <= now` (if `next_run_at` exists)

## Actor mode

Workflows MUST declare actor mode:

- `system` (bypass; audited)
- `impersonate`
- `inherit`

### Actor mode semantics (MVP)

- `inherit`: steps receive `event.actor` (or an unauthenticated actor if missing)
- `system`: steps receive a system actor (roles include `system`, claim `system=true`) and this MUST be logged as an audited bypass
- `impersonate`: steps receive an actor derived from `inherit`, but with one subject injected from workflow config:

```json
{
  "actorMode": "impersonate",
  "impersonate": { "subject": "customer", "idFrom": "after.customer_id" }
}
```

`idFrom` resolves against the outbox event object. Optional overrides:

- `type` (defaults to `subject`)
- `model` (defaults to `subject`)

## Scheduler + Replayer (MVP)

EngineJS MUST provide worker-friendly services:

- a scheduler that can emit `interval` and `datetime` events into the outbox
- a replayer that requeues stale `processing` rows back to `pending`

### Scheduler (minimum behavior)

- Interval scheduler emits `interval` events with:
  - `model="__scheduler"`
  - `after={ "unit": "<unit>", "value": <value>, "at": "<iso>" }`
- Datetime scheduler emits `datetime` events with:
  - `model="<modelKey>"` derived from trigger `field` as `<modelKey>.<fieldName>`
  - `after=<row>` (raw DB row)
  - `before={ "field": "<modelKey>.<fieldName>", "direction": "...", "unit": "...", "value": <n>, "fireAt": "<iso>" }`
  - `next_run_at="<iso fireAt>"` (runner picks it up when due)

Scheduler SHOULD support idempotency/deduplication via a pluggable store (e.g., a KV store), but MUST still function without one.

### Replayer (minimum behavior)

- Replayer selects rows where `status="processing"` and `updated_at < now - staleMs` (when `updated_at` exists)
- Replayer updates those rows to `status="pending"` and clears `next_run_at` (if present)

## Retention

Retention MUST be configurable:

- archive processed events
- or hard-delete after N days

### Maintenance runner (MVP)

Core MUST provide a maintenance helper (service-friendly) that applies retention:

- Mode `none`: keep unlimited history (no-op)
- Mode `archive`: set `status="archived"` and, when available, set `archived=true` and `archived_at`
- Mode `delete`: hard-delete rows

Retention targets terminal states: `done|failed`. When using a two-stage flow (`archive` first), `delete` mode MAY also hard-delete `archived` rows.

## CRUD steps (built-in, MVP)

WorkflowRunner MUST additionally support CRUD-based steps implemented via the core `CrudService` (see `specs/13-core-crud-service.md`).

- `crud.create`
- `crud.list` (minimal; no variable binding yet)
