# EngineJS Specs — Deterministic Regeneration (Codegen Contract)

## Purpose

EngineJS is **spec-driven**: the `specs/` folder contains everything needed to reconstruct the monorepo deterministically, even if all non-spec code is deleted.

This document defines:

- what is considered “generated”
- how regeneration works
- determinism rules
- what must be present in `specs/` to rebuild the repo

## Determinism rules (MUST)

- No timestamps in generated outputs.
- No randomness; if IDs/hashes are needed, they MUST be derived deterministically from inputs.
- Stable ordering everywhere:
  - sort directory listings, keys, emitted files, and exports.
- Pinned toolchain:
  - Node and TypeScript versions MUST be declared (see templates/manifest).
- Generated files MUST be byte-for-byte stable given the same specs and toolchain.

## What is the source of truth?

Only `specs/**` (including `specs/templates/**`) is source of truth.

Everything outside `specs/` is derivative output.

## Bootstrap strategy

Because “all code may be deleted”, EngineJS MUST keep its **bootstrap templates** inside `specs/templates/`.

Regeneration algorithm (human/agent or future script):

1) Copy `specs/templates/tools/*` to `tools/` (this includes `tools/gen.mjs`)
2) Run `node tools/gen.mjs` (materializes root + workspaces from templates)
3) Run `npm ci`
4) Run `npm run build`

Verification (expected in CI):

- `node tools/verify_templates.mjs` (templates match outputs)
- `node tools/verify_regen.mjs` (clean-room rebuild from specs only)

## Practical hybrid (spec → code)

Workflow:

1) Humans/LLMs edit `specs/**` (and `specs/templates/**` when outputs change).
2) `npm run gen` materializes deterministic outputs from `specs/templates/**`.
3) `npm test` validates unit + integration + clean-room regen.

Non-goal: LLMs generating arbitrary repo code directly without templates; templates are the determinism anchor.

Future work (optional but recommended):

- add a small generator in `tools/codegen` that performs the above copy + validates checksums.

## Template invariants

- Template paths MUST mirror output paths.
- Templates MUST be updated before changing generated output.
- If any output changes, `specs/99-changelog.md` MUST be updated.
