# EngineJS Framework: Durable Workflows & Outbox

## Introduction
EngineJS provides a built-in mechanism for executing durable business logic using the outbox pattern. The outbox write is not part of the data transaction (see "Event Emission"). This ensures that side effects (e.g., sending emails, updating external systems, or running complex aggregations) are eventually consistent and resilient to system failures.

## Outbox
The core of the workflow system is the `workflow_events_outbox` model.

### Event Emission
When a data operation occurs (e.g., via the CRUD service), an event is emitted into the outbox.
- **Not Atomic:** The event is written to the same database as the business data, but after the data transaction commits. If the process stops between the two writes, the event is lost (issue #10).
- **Payload Capture:** Events capture the `before` and `after` state of the record, as well as the `actor` (identity) and `origin` of the request.
- **Status Tracking:** Events start in a `pending` status.

## Workflow Triggers
Workflows are triggered by events in the outbox that match specific criteria:

1. **`model` Triggers**: Fires when a specific model undergoes a specific action (`create`, `update`, `delete`).
2. **`interval` Triggers**: Fires at regular time intervals (e.g., every 5 minutes). These are emitted by the `WorkflowScheduler`. Nothing in the runtime runs the scheduler today (issue #10).
3. **`datetime` Triggers**: Fires when a specific datetime field on a model record is reached (e.g., 2 hours before `appointment.appointment_at`). Write the field as `model.field`.

## Workflow Runner
The `WorkflowRunner` is responsible for processing pending events.

### Execution Cycle
1. **Claiming**: The runner reads up to `claimLimit` `pending` events (default 10), then claims each one with a conditional update to `processing`.
2. **Matching**: For each event, the runner finds all workflows whose triggers match the event criteria.
3. **Impersonation (Actor Modes)**: Workflows execute with a specific security context:
    - **`inherit`**: Uses the identity of the actor who emitted the event.
    - **`system`**: Uses a privileged system actor that bypasses ACL/RLS.
    - **`impersonate`**: Reads a subject ID from a path in the event (`idFrom`), and adds that subject to the inherited actor. The actor keeps its roles and claims.
4. **Step Execution**: The runner executes the workflow steps sequentially. Built-in steps include `crud.create`, `crud.list`, `db.update`, `log` and `custom`.
5. **Completion**: If all steps succeed, the event status is updated to `done`.

### Error Handling & Retries
- **Automatic Backoff**: If a step fails, the event is returned to `pending` with an incremented attempt count and a `next_run_at` timestamp calculated using exponential backoff. The defaults are 5 attempts, and a backoff from 1000 ms to 60000 ms. The spec `retry` field is not read (issue #10). A retry runs every matched workflow for the event again, including workflows that already succeeded.
- **Non-Retryable Errors**: Specific errors (e.g., validation failures or ACL denials) mark the event as `failed` immediately.
- **Max Attempts**: Events that exceed the maximum attempt limit are marked as `failed`.

## Support Systems
- **`WorkflowScheduler`**: Emits `interval` and `datetime` events into the outbox on each `runOnce` call. Interval state is in a key-value store. Only `datetime` triggers query model rows.
- **`WorkflowReplayer`**: Identifies events stuck in `processing` for too long (stale) and returns them to `pending`. It needs an `updated_at` column on the outbox.
- **`WorkflowOutboxMaintenance`**: Applies the retention policy. `none` (the default) does nothing, `archive` sets old events to `archived`, and `delete` removes done, failed and archived events.

Nothing in the runtime runs these three services today. `enginehq workflows worker` runs only the workflow runner (issue #10).

## Custom Steps
Custom workflow steps can be registered via plugins as services with the name `workflows.step.<step_name>`. The step function receives `{ event, actor, args }`.
