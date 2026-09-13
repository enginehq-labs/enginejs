# EngineJS Framework — Durable Workflows & Outbox

## Introduction
EngineJS provides a built-in mechanism for executing durable business logic using the Transactional Outbox pattern. This ensures that side effects (e.g., sending emails, updating external systems, or running complex aggregations) are eventually consistent and resilient to system failures.

## Transactional Outbox
The core of the workflow system is the `workflow_events_outbox` model.

### Event Emission
When a data operation occurs (e.g., via the CRUD service), an event is emitted into the outbox.
- **Atomic Writes:** The event is written to the same database as the business data. If using managed transactions, the event emission and data write are atomic.
- **Payload Capture:** Events capture the `before` and `after` state of the record, as well as the `actor` (identity) and `origin` of the request.
- **Status Tracking:** Events start in a `pending` status.

## Workflow Triggers
Workflows are triggered by events in the outbox that match specific criteria:

1. **`model` Triggers**: Fires when a specific model undergoes a specific action (`create`, `update`, `delete`).
2. **`interval` Triggers**: Fires at regular time intervals (e.g., every 5 minutes). These are emitted by the `WorkflowScheduler`.
3. **`datetime` Triggers**: Fires when a specific datetime field on a model record is reached (e.g., 2 hours before `appointment_at`).

## Workflow Runner
The `WorkflowRunner` is responsible for processing pending events.

### Execution Cycle
1. **Claiming**: The runner claims a batch of `pending` events by updating their status to `processing`.
2. **Matching**: For each event, the runner finds all workflows whose triggers match the event criteria.
3. **Impersonation (Actor Modes)**: Workflows execute with a specific security context:
    - **`inherit`**: Uses the identity of the actor who emitted the event.
    - **`system`**: Uses a privileged system actor that bypasses ACL/RLS.
    - **`impersonate`**: Resolves a specific subject ID from the event payload to act as that subject.
4. **Step Execution**: The runner executes the workflow steps sequentially. Built-in steps include `crud.create`, `crud.list`, `db.update`, and `log`.
5. **Completion**: If all steps succeed, the event status is updated to `done`.

### Error Handling & Retries
- **Automatic Backoff**: If a step fails, the event is returned to `pending` with an incremented attempt count and a `next_run_at` timestamp calculated using exponential backoff.
- **Non-Retryable Errors**: Specific errors (e.g., validation failures or ACL denials) mark the event as `failed` immediately.
- **Max Attempts**: Events that exceed the maximum attempt limit are marked as `failed`.

## Support Systems
- **`WorkflowScheduler`**: Periodically scans the database to emit `interval` and `datetime` events into the outbox.
- **`WorkflowReplayer`**: Identifies events stuck in `processing` for too long (stale) and returns them to `pending`.
- **`WorkflowOutboxMaintenance`**: Cleans up old `done` or `failed` events based on retention policies.

## Custom Steps
Custom workflow steps can be registered via plugins as services with the name `workflows.step.<step_name>`. They receive the event payload and the resolved actor context.
