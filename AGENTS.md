# AGENTS.md — EngineJS (Conductor-Driven Monorepo)

## Source of truth

This project uses [Conductor](https://github.com/Primefit/conductor) for development. The source of truth for the product vision, technical stack, and development workflow is the `conductor/` directory.

- **Product Vision:** `conductor/product.md`
- **Guidelines:** `conductor/product-guidelines.md`
- **Tech Stack:** `conductor/tech-stack.md`
- **Workflow:** `conductor/workflow.md`
- **Tracks & Plans:** `conductor/tracks.md` and `conductor/tracks/<track_id>/plan.md`

## Development model

EngineJS has transitioned from a spec-driven codegen model to a **standard code-first monorepo** managed by Conductor.

- Code in `core/`, `express/`, `auth/`, and `enginehq/` is now the primary source of truth for implementation.
- All changes must be tracked through Conductor Tracks.
- Each track must have a corresponding `spec.md` and `plan.md` in its directory under `conductor/tracks/`.

## Quality Gates

All changes must pass the quality gates defined in `conductor/workflow.md`, which include:
- Test-Driven Development (TDD)
- >80% test coverage
- Strict adherence to the documented tech stack
- Automated and manual verification phases

## Editing rules

- Follow the sequential task list in the active track's `plan.md`.
- Mark tasks as in-progress `[~]` and completed `[x]` as work proceeds.
- Commit frequently after completing individual tasks.
- Perform phase-level verification and checkpointing as prescribed by the workflow.