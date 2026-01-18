# Track Plan: Link Shortener with Analytics Example

## Phase 1: Project Scaffolding & DSL [checkpoint: 67562be]
- [x] Task: Scaffold EngineJS app in `examples/link-shortener`. 279b60e
    - [x] Sub-task: Create directory structure and `package.json`.
    - [x] Sub-task: Initialize `enginejs.config.ts`.
- [x] Task: Define DSL for core entities. 282049c
    - [x] Sub-task: Create `User`, `Link`, `Tag`, and `AnalyticsEvent` models in `dsl/models/`.
    - [x] Sub-task: Define relationships (Link belongs to User, Link has many Tags).
- [x] Task: Conductor - User Manual Verification 'Phase 1: Project Scaffolding & DSL' (Protocol in workflow.md)

## Phase 2: Redirection & Analytics Pipeline
- [x] Task: Implement redirection route logic. be92d0b
    - [x] Sub-task: Create custom route in `routes/redirect.ts` for `/r/:slug`.
    - [x] Sub-task: Write tests for redirection logic.
- [x] Task: Implement analytics recording pipeline. 0554f6b
    - [x] Sub-task: Register `recordClick` custom op in `pipeline/ops.ts`.
    - [x] Sub-task: Attach `response` phase pipeline to the redirection route.
    - [x] Sub-task: Write tests to verify `AnalyticsEvent` creation during redirect.
- [x] Task: Conductor - User Manual Verification 'Phase 2: Redirection & Analytics Pipeline' (Protocol in workflow.md)

## Phase 3: Durable Workflows [checkpoint: 2680d75]
- [x] Task: Implement click aggregation workflow. 2680d75
    - [x] Sub-task: Create workflow in `workflow/aggregate-clicks.ts`.
    - [x] Sub-task: Trigger workflow on `AnalyticsEvent` creation to increment `Link.total_clicks`.
    - [x] Sub-task: Write tests for outbox processing and counter increment.
- [x] Task: Conductor - User Manual Verification 'Phase 3: Durable Workflows' (Protocol in workflow.md)

## Phase 4: API Security & ACL
- [x] Task: Configure ACL & RLS.
    - [x] Sub-task: Restrict Link management to owners.
    - [x] Sub-task: Ensure users can only see analytics for their own links.
    - [x] Sub-task: Write integration tests for security policies.
- [x] Task: Conductor - User Manual Verification 'Phase 4: API Security & ACL' (Protocol in workflow.md)

## Phase 5: Documentation & Final Polish
- [x] Task: Finalize documentation.
    - [x] Sub-task: Create `examples/link-shortener/README.md` with setup and usage instructions.
- [x] Task: Conductor - User Manual Verification 'Phase 5: Documentation & Final Polish' (Protocol in workflow.md)
