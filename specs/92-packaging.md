# EngineJS Specs — Packaging & Publishing

EngineJS is the **monorepo brand** and repository name. Published npm packages use the `@enginehq/*` scope plus one unscoped umbrella package.

Status: EngineJS is currently a **Technical Preview**. Expect breaking changes before `1.0.0` (publish semver-compatible migration notes per release).

## Package names (required)

- `@enginehq/core` — EngineJS core runtime primitives (types, engine bootstrap, registries, etc.)
- `@enginehq/auth` — Auth helpers (HS256 JWT + optional refresh sessions)
- `@enginehq/express` — Express adapter (HTTP server wiring, request context, envelope, routing)
- `enginehq` — unscoped umbrella package that re-exports the public API from `@enginehq/core` and other EngineJS packages

## Publishing requirements

- Monorepo root (`enginejs/`) is private and not published.
- Publishable workspace packages MUST NOT be marked `"private": true`.
- Scoped packages MUST set:
  - `"publishConfig": { "access": "public" }`
- A `LICENSE` file MUST exist at repo root and in each publishable package.

## Ignore files (required)

- Repo root MUST include `.gitignore` to ignore build artifacts and local-only files (e.g., `node_modules`, `dist`, `dist-test`, logs, `.env`).
- Each workspace package (`core`, `express`, `enginehq`) MUST include:
  - `.gitignore` (package-local build artifacts)
  - `.npmignore` to exclude `src/`, `test/`, and `dist-test/` from published tarballs (publish `dist/` output only).
- Each publishable package MUST additionally define a `"files"` allowlist in `package.json` so publishing does not depend on `.npmignore`.
  - Minimum: `"files": ["dist", "README.md"]`

## READMEs (required)

Each publishable package MUST ship a minimal `README.md` in the npm tarball (install + quick usage).

## Reproducible release flow (required)

Publishing MUST be done from monorepo root so the order is deterministic.

Order (dependency-first):

1) `@enginehq/core`
2) `@enginehq/auth`
3) `@enginehq/express`
4) `enginehq`

Commands:

- Validate + preview tarballs: `npm run release:check`
- Publish all: `npm run release:publish`

Notes:

- This npm account has 2FA enabled for writes (`npm profile get`), so publishing requires an OTP.
- For first-time publishes, you can sanity-check name availability first:
  - `npm view enginehq` (should 404 before first publish)
  - `npm view @enginehq/core` (should 404 before first publish)

## Git tags + GitHub releases (required)

For each published version:

- Create and push a matching git tag: `vX.Y.Z`
- Create a GitHub Release for the tag (use `gh release create ...`)
- Keep release notes aligned with `specs/99-changelog.md`

## Determinism requirement

`specs/templates/**` MUST include the publishable package manifests and any lockfiles needed to reproduce installs/builds.
