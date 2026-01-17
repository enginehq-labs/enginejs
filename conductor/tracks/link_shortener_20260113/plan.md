# Track Plan: Link Shortener with Analytics Example

## Phase 1: Project Scaffolding & DSL
- [ ] Task: Scaffold EngineJS app in `examples/link-shortener`.
    - [ ] Sub-task: Create directory structure and `package.json`.
    - [ ] Sub-task: Initialize `enginejs.config.ts`.
- [ ] Task: Define DSL for core entities.
    - [ ] Sub-task: Create `User`, `Link`, `Tag`, and `AnalyticsEvent` models in `dsl/models/`.
    - [ ] Sub-task: Define relationships (Link belongs to User, Link has many Tags).
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Project Scaffolding & DSL' (Protocol in workflow.md)

## Phase 2: Redirection & Analytics Pipeline
- [ ] Task: Implement redirection route logic.
    - [ ] Sub-task: Create custom route in `routes/redirect.ts` for `/r/:slug`.
    - [ ] Sub-task: Write tests for redirection logic.
- [ ] Task: Implement analytics recording pipeline.
    - [ ] Sub-task: Register `recordClick` custom op in `pipeline/ops.ts`.
    - [ ] Sub-task: Attach `response` phase pipeline to the redirection route.
    - [ ] Sub-task: Write tests to verify `AnalyticsEvent` creation during redirect.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Redirection & Analytics Pipeline' (Protocol in workflow.md)

## Phase 3: Durable Workflows
- [ ] Task: Implement click aggregation workflow.
    - [ ] Sub-task: Create workflow in `workflow/aggregate-clicks.ts`.
    - [ ] Sub-task: Trigger workflow on `AnalyticsEvent` creation to increment `Link.total_clicks`.
    - [ ] Sub-task: Write tests for outbox processing and counter increment.
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Durable Workflows' (Protocol in workflow.md)

## Phase 4: API Security & ACL
- [ ] Task: Configure ACL & RLS.
    - [ ] Sub-task: Restrict Link management to owners.
    - [ ] Sub-task: Ensure users can only see analytics for their own links.
    - [ ] Sub-task: Write integration tests for security policies.
- [ ] Task: Conductor - User Manual Verification 'Phase 4: API Security & ACL' (Protocol in workflow.md)

## Phase 5: Documentation & Final Polish
- [ ] Task: Finalize documentation.
    - [ ] Sub-task: Create `examples/link-shortener/README.md` with setup and usage instructions.
- [ ] Task: Conductor - User Manual Verification 'Phase 5: Documentation & Final Polish' (Protocol in workflow.md)
