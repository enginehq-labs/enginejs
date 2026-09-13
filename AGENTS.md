# AGENTS.md

Instructions for AI agents that work in the EngineJS repository.

Claude Code loads this file through the `@AGENTS.md` import in `CLAUDE.md`. The
communication rules for Claude Code are in `.claude/rules/communication.md`.

## What EngineJS is

EngineJS is a schema-as-code TypeScript and Express backend framework. You define
models, access control lists (ACL), and row-level security (RLS) in a JSON DSL. The
framework generates Sequelize models and generic CRUD endpoints. It adds pluggable
pipelines, durable outbox-backed workflows, and structured tracing.

The status is Technical Preview. The API can change.

## Runtime

- The project targets Node.js 22 or later. Run `nvm use 22` before any command.
- Do not use features or flags that Node.js 22 does not support.
- The project uses ES modules. Every package sets `"type": "module"`.

## Packages

The repository is an npm workspace with four published packages:

| Package | Directory | Purpose |
|---|---|---|
| `@enginehq/core` | `core/` | DSL, ORM, ACL and RLS, pipelines, workflows, migrations, CrudService |
| `@enginehq/auth` | `auth/` | JWT HS256, password hashing, refresh sessions |
| `@enginehq/express` | `express/` | Express adapter, middleware, HTTP CRUD, admin and auth routers |
| `enginehq` | `enginehq/` | CLI and app runtime, and an umbrella re-export |

The `examples/` directory holds sample apps. It is not part of the workspace.

## Commands

Run these from the repository root:

```bash
npm run build         # build every package, in dependency order
npm run typecheck     # tsc --noEmit in every package
npm run test:unit     # unit tests
npm run test:integration  # integration tests, needs Docker
npm test              # unit tests, then integration tests
```

## Build order matters

The packages resolve each other through their built `dist/` output, not through
source. The `workspaces` array in the root `package.json` sets the order:

```
core, auth, express, enginehq
```

Two results follow:

1. On a clean checkout you must run `npm run build` before `npm run typecheck`.
   Nothing typechecks until the packages are built.
2. After you edit a package, rebuild it before another package sees the change.
   `enginehq start` runs `dist/runtime/app.js`, not the source.

### The stale tsbuildinfo trap

`core/tsconfig.json` sets `"composite": true`. If you delete `dist/` but leave
`tsconfig.tsbuildinfo`, tsc reads the buildinfo, decides the output is current, and
emits nothing. You then get `Cannot find module '@enginehq/core'`, which looks like a
dependency problem but is a skipped emit.

To force a full rebuild, delete both:

```bash
rm -rf */dist && find . -name "*.tsbuildinfo" -not -path "*/node_modules/*" -delete
npm run build
```

## Database

**EngineJS supports PostgreSQL only.** The config type permits one value:
`dialect?: 'postgres'`. The codebase has no dialect guards. SQLite was removed.

Do not add support for another database without a decision from the repository owner.

## Testing

- Unit tests use `node:test`. They need no external service.
- Integration tests start their own PostgreSQL containers through the Docker CLI.
  Docker must run.

Run the integration tests like this:

```bash
ENGINEJS_DOCKER_PULL=1 npm run test:integration
```

**A skipped test is a failure, not a pass.** When Docker is absent, each test reports
`ok N - ... # SKIP` and the process exits 0. The suite then reads as green while it
asserts nothing. `ENGINEJS_DOCKER_PULL=1` lets the harness pull the image when it is
missing. `.github/workflows/ci.yml` fails the build if any test reports a skip.

## Continuous integration

`.github/workflows/ci.yml` runs on each push to `main` and on each pull request. The
steps are install, build, typecheck, unit tests, integration tests, and the skip guard.

## Project rules

- `@enginehq/core` stays framework-agnostic. It imports no adapter or auth package.
- All four packages share one version, and they pin each other to that exact version.
  `npm run release:publish` publishes them in the order core, auth, express, enginehq.
- Follow Semantic Versioning. During the Technical Preview a breaking change is
  allowed, but record it in the release notes.
- Do not add a hardcoded secret. Read secrets from the environment. The `--auth`
  scaffold still writes a `'dev'` JWT secret fallback, and issue #9 tracks it.
- Keep ACL and RLS on for CRUD operations. A bypass must be explicit, with the
  `bypassAclRls` call option. The code does not log bypasses today (issue #9).

The product vision is in `docs/product.md`.

## Development model

EngineJS is a code-first monorepo. The code in `core/`, `auth/`, `express/`, and
`enginehq/` is the source of truth for the implementation.

Track work in **GitHub issues**. Do not create process directories, track files, spec
files, or plan files in the repository.

This replaces the previous Conductor workflow. Issue #1 removes the remaining
`conductor/` directory.

## Quality gates

- Write the test before the implementation. Confirm the test fails first.
- Cover new code. Aim for more than 80 percent.
- Prefer non-interactive commands. Use `CI=true` for tools that watch files.
- Run `npm run typecheck` and `npm test` before you open a pull request.
- Report results honestly. If a test fails, say so and show the output.

## Code style

Match the style of the code around you. Keep the same comment density, naming, and
idiom as the file you edit.

Reference documents:

- `conductor/code_styleguides/typescript.md`
- `conductor/code_styleguides/javascript.md`
- `conductor/code_styleguides/general.md`

These files describe the Google TypeScript style. The repository does not follow every
rule in them. For example, route modules and pipeline operations use default exports,
which that guide forbids. Where the guide and the surrounding code disagree, follow the
surrounding code.

Issue #1 moves these files out of `conductor/`.

## Framework documentation

The prose documentation for the framework lives in `docs/framework/`:

| File | Subject |
|---|---|
| `overview.md` | the framework as a whole |
| `dsl.md` | the JSON model DSL |
| `lifecycle.md` | engine startup and initialization |
| `adapter.md` | the Express adapter and the app entry point |
| `auth.md` | JWT, actors, sessions, and the built-in auth routes |
| `pipelines.md` | transforms, validators, and custom operations |
| `workflows.md` | the outbox, the runner, the scheduler |
| `security.md` | ACL and RLS |
| `observability.md` | logging and request tracing |
| `maintenance.md` | safe schema sync and migrations |


## Git

- Do not add attribution lines to commit messages or pull request descriptions.
- Use conventional commit subjects, such as `fix(runtime): ...` or `docs: ...`.
- Explain the cause in the commit body, not only the change.
- Commit only when the user asks.
