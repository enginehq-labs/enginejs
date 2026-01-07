# EngineJS Specs — Testing System

EngineJS MUST ship a testing system that can validate correctness after:

- any spec update
- any regeneration of code from `specs/`

Specs-to-code workflow requirement:

- tests SHOULD be run after `npm run gen`
- CI MUST fail if generated outputs drift from `specs/templates/**`

## Test layers

### Unit tests (fast)

- run in each workspace package (starting with `core`)
- validate pure logic and deterministic behavior
- MUST NOT require network or external services

### Integration tests (spec↔code cohesion)

Integration tests MUST verify that the repository can be deterministically regenerated:

- `specs/templates/**` must match generated outputs in the repo (byte-for-byte)
- mismatch should fail CI immediately

Integration tests MAY additionally include Docker-backed tests (e.g., Postgres) to validate end-to-end behavior. These tests MUST:

- auto-skip when Docker is unavailable
- avoid network by default (prefer pre-pulled images); if pulling is required, it MUST be opt-in via env
- use pinned images (default `postgres:16-alpine`)
- clean up containers on exit

### E2E tests (clean-room regeneration)

E2E tests MUST simulate a “clean-room rebuild”:

1) start from `specs/` only (no other repo files)
2) reconstruct repo outputs using templates defined in `specs/90-codegen.md`
3) run `npm ci`
4) run `npm run build`
5) run unit + integration tests in the reconstructed repo

## Required scripts

At monorepo root:

- `npm run test:unit`
- `npm run test:integration`
- `npm run test:e2e`
- `npm test` runs all the above

## Determinism constraints for tests

- tests must not rely on wall clock time, randomness, or filesystem ordering without explicit sorting
- any temp directories used in tests are allowed, but must not change repo outputs

## Build output hygiene

TypeScript test builds MUST not allow stale compiled tests to linger.

- Workspace `test:unit` and `test:integration` scripts MUST clear `dist-test/` before running `tsc`.
