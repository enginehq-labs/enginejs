# EngineJS — Specs Index

Status: Source of truth  
Last updated: 2026-01-02  

This folder (`specs/`) is the **only source of truth** for EngineJS behavior and structure.
All code in this monorepo is treated as **derivative output** that can be regenerated deterministically from these specs.

## How to read these specs

- Start here, then follow the section docs below.
- Any behavior change MUST update the relevant spec file(s) and `specs/99-changelog.md`.

## Specs map

- `specs/01-architecture.md` — runtime architecture, module boundaries, lifecycle
- `specs/02-config.md` — `EngineConfig` + validation rules
- `specs/03-dsl.md` — DSL model schema, fragments, virtual fields, relations, indexes
- `specs/04-orm-sync.md` — ORM adapter boundary + safe sync semantics
- `specs/05-http-crud.md` — Express adapter, envelope, CRUD routes, filters/find/sort/includeDepth
- `specs/06-auth-acl-rls.md` — auth→actor model, ACL, **multi-subject configurable RLS**
- `specs/07-pipelines.md` — pipelines phases, built-in ops, user functions, safety
- `specs/08-workflows-outbox.md` — outbox guarantees, dispatcher/executor/scheduler, actor modes
- `specs/09-services-di.md` — service container/DI and required services
- `specs/10-plugins.md` — plugin contract + load order
- `specs/90-codegen.md` — deterministic regeneration contract (bootstrap + generation rules)
- `specs/91-testing.md` — unit/integration/e2e verification after regeneration
- `specs/92-packaging.md` — npm package names and publishing rules
- `specs/93-ai-workflow.md` — AI-assisted spec→code loop (tests as oracle)
- `specs/99-changelog.md` — required change log for spec/behavior changes

## Determinism requirements (non-negotiable)

- Regeneration MUST NOT depend on timestamps, randomness, OS-specific paths, or nondeterministic ordering.
- All generated outputs MUST be stable across machines when using the same Node/TS versions.
- Any “generated” file MUST be reproducible byte-for-byte from `specs/` (see `specs/90-codegen.md`).
