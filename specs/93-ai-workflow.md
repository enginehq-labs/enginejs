# EngineJS Specs — AI-Assisted Spec → Code Workflow

EngineJS uses a **practical hybrid** workflow:

- **Deterministic generator** materializes outputs from `specs/templates/**`.
- **AI (or humans)** edit specs and templates, then use tests as the correctness oracle.

This avoids making CI/build depend on a remote LLM while still enabling fast AI-driven iteration.

## Invariants

- `specs/**` is the source of truth.
- `specs/templates/**` is the source of truth for **generated outputs**.
- `npm run gen` MUST be deterministic.
- `node tools/verify_templates.mjs` MUST fail on any drift between templates and outputs.
- `npm test` MUST fail if behavior diverges from specs (unit/integration/e2e).

## The loop (human/AI)

1) Update specs and/or templates
2) Run `npm run gen`
3) Run `npm test` (or `npm run cycle`)
4) If failing:
   - Use failure output as feedback
   - Fix by updating templates/specs (not by hot-fixing generated outputs)
   - Repeat

## Optional automation

`npm run cycle` is a convenience runner:

- runs `gen` then `test`
- writes a failure log to `.enginejs/last-failure.log` to make iterative debugging easier

