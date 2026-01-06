# AGENTS.md — EngineJS (Specs-Driven Monorepo)

## Source of truth

`specs/` is the only source of truth for EngineJS.

- If code and specs disagree, **specs win**.
- Any behavior change MUST update:
  - the relevant file(s) in `specs/`
  - `specs/99-changelog.md`

## Deterministic regeneration (hard requirement)

EngineJS must be reproducible even if all non-spec code is deleted and only `specs/` remains.

The regeneration contract is defined in:

- `specs/90-codegen.md`
- `specs/templates/manifest.json`

### Clean-room rebuild procedure (expected to work)

1) Delete everything except `specs/` (including `core/`, `node_modules/`, lockfiles, etc.)
2) Reconstruct the repo by copying templates as described in `specs/90-codegen.md`
3) Run `npm install`
4) Run `npm run build`

If anything in this procedure changes, update `specs/90-codegen.md` and `specs/99-changelog.md`.

## Generated vs handwritten

Until a standalone generator exists, treat these as generated outputs that MUST match specs/templates:

- `package.json`, `package-lock.json`, `tsconfig*.json`
- `core/**`

Do not “hotfix” generated files without first updating the corresponding spec and template.

## Editing rules

- Prefer changing specs first, then make code reflect the spec.
- Keep outputs deterministic:
  - stable ordering
  - no timestamps
  - no randomness
  - pinned toolchain (see `specs/templates/manifest.json`)

