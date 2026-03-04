# Plan: Built-in Auth Routes & Auto-wired JWT Actor Resolver

## Phase 1: Auto-wired JWT `actorResolver`

> **Goal**: When `auth.jwt.accessSecret` is configured, the runtime automatically verifies `Authorization: Bearer` tokens and populates `req.actor` — no user-written resolver code needed.

- [ ] Task: Extend `EngineJsAppConfig` (`runtime/config.ts`) to document that `resolveActor` can be omitted when `auth.jwt` is set.
  - Sub-task: No schema change needed; the option already exists on `CreateEngineExpressAppOptions`. Document the convention.
- [ ] Task: Auto-wire the JWT `actorResolver` in `runtime/app.ts`.
  - Sub-task: After loading config, if `cfg.engine.auth?.jwt?.accessSecret` is set and no explicit `resolveActor` is provided in `cfg`, import `verifyActorAccessTokenHS256` from `@enginehq/auth` and construct a resolver that extracts the Bearer token from `Authorization` header, verifies it, and returns the decoded `Actor`. Falls back to anonymous actor on error.
  - Sub-task: Wire this resolver into `createEngineExpressApp({ resolveActor: ... })`.
- [ ] Task: Write unit tests for the auto-resolver logic (test that valid token → authenticated actor, invalid/missing → anonymous actor).
- [ ] Task: Update `enginehq init` scaffold to remove the placeholder `resolveActor` comment in `enginejs.config.ts` since it is no longer needed.

---

## Phase 2: `auth.local` Config Schema

> **Goal**: Define the `AuthLocalConfig` type and integrate it into `EngineConfig` so the runtime and router can read it.

- [ ] Task: Add `AuthLocalConfig` type to `@enginehq/core` (`src/engine/config.ts` or similar).
  - Sub-task: Fields: `userModel`, `emailField` (default `'email'`), `passwordField` (default `'password'`), `passwordHashField` (default `'password_hash'`), `rolesField?`, `subjectKey?` (default `'user'`), `onRegister?`, `buildClaims?`.
- [ ] Task: Add `local?: AuthLocalConfig` to the existing `auth` field in `EngineConfig`.
- [ ] Task: Write unit tests for config type completeness (ensure config round-trips through `createEngine`).

---

## Phase 3: `hashPassword` Pipeline Op

> **Goal**: a `hashPassword` built-in pipeline op in `@enginehq/auth` intercepts the virtual `password` field and writes the bcrypt hash before persist.

- [ ] Task: Implement `hashPassword` op in `@enginehq/auth/src/pipeline.ts`.
  - Sub-task: Reads `password` from `ctx.input`, bcrypt-hashes it, sets `passwordHashField` in `ctx.input`, deletes the plain-text `password` key.
  - Sub-task: Use Node.js built-in `crypto.pbkdf2` or add `bcryptjs` as a dependency (check tech-stack first; update `tech-stack.md` if adding a new dep).
- [ ] Task: Write unit tests covering: correct hash written, plain-text field removed, no-op when `password` not present.

---

## Phase 4: `BuiltinAuthRouter` in `@enginehq/express`

> **Goal**: When `auth.local` is present, auto-mount 5 auth endpoints with zero user code.

- [ ] Task: Create `src/routers/auth.ts` in `@enginehq/express` implementing `createBuiltinAuthRouter`.
  - Sub-task: `POST /register` — calls `CrudService.create` on `userModel` (bypassing ACL/RLS), auto-registers `hashPassword` op, returns access + refresh tokens.
  - Sub-task: `POST /login` — finds user by `emailField`, verifies password hash, mints tokens via `signActorAccessTokenHS256` + `SessionService.createSession`.
  - Sub-task: `POST /refresh` — calls `SessionService.rotateRefreshToken`, returns new token pair.
  - Sub-task: `POST /logout` — calls `SessionService.revokeSession` using `req.actor.sessionId`.
  - Sub-task: `GET /me` — returns `req.actor`.
- [ ] Task: Mount `BuiltinAuthRouter` in `createExpressApp` when `config.auth?.local` is set (before the CRUD router).
- [ ] Task: Write integration tests covering register → login → refresh → logout flow.

---

## Phase 5: `enginehq init` Scaffold Update

> **Goal**: `enginehq init --auth` scaffolds a ready-to-use auth setup.

- [ ] Task: Add `--auth` flag to `enginehq init` command in `cli.ts`.
  - Sub-task: When `--auth` is passed, write `dsl/models/user.json` with `email`, `password` (virtual, `save: false`), `password_hash`, `roles` fields.
  - Sub-task: Add `auth.local` section to the scaffolded `enginejs.config.ts`.
  - Sub-task: Add a sample `routes/auth` directory note in the generated README.
- [ ] Task: Write unit test for `initEngineJsApp` with `auth: true` option (verify expected files are created).

---

## Phase 6: Documentation & Integration Tests

- [ ] Task: Update `conductor/framework/auth.md` with the `auth.local` config reference and auto-resolver behaviour.
- [ ] Task: End-to-end integration test: `enginehq init --auth` → start app → register → login → authenticated CRUD request → logout.
- [ ] Task: Conductor - User Manual Verification 'Phase 6: Documentation & Integration Tests'
