# Spec: Built-in Auth Routes & Auto-wired JWT Actor Resolver

## Background

The EngineJS zero-boilerplate entry point is already complete: `enginehq init` scaffolds an app, and `enginehq start` boots it via `runtime/app.ts` without any user-written `server.ts`. The app's `package.json` points `"main"` to `enginehq/dist/runtime/app.js`.

However, two gaps remain before auth is truly zero-boilerplate:

1. **No auto-wired `actorResolver`**: Every app currently must supply its own `resolveActor` function to `createEngineExpressApp`. There is no automatic JWT verification wired from `auth.jwt` config.

2. **No built-in auth routes**: Login, register, refresh, and logout must be implemented as custom files in `routes/auth/`. This is significant boilerplate for a very common pattern.

## Goals

### Goal 1 — Auto-wired JWT `actorResolver`
When `auth.jwt.accessSecret` is present in `enginejs.config.ts`, the runtime (`runtime/app.ts`) should automatically wire a JWT `actorResolver` into `createEngineExpressApp`. Apps that need custom resolution can still supply their own `resolveActor`.

The resolver extracts `Authorization: Bearer <token>`, verifies it using `verifyActorAccessTokenHS256` from `@enginehq/auth`, and returns the decoded `Actor`. On invalid/missing tokens it returns the anonymous actor `{ isAuthenticated: false, ... }`.

### Goal 2 — Built-in Auth Routes via `auth.local` config
When `auth.local` is set in `enginejs.config.ts`, the runtime auto-mounts the following endpoints at `${basePath}/auth`:

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/register` | Creates a user record, hashes the password, returns tokens |
| `POST` | `/auth/login` | Verifies credentials, returns access + refresh tokens |
| `POST` | `/auth/refresh` | Rotates refresh token using `SessionService` |
| `POST` | `/auth/logout` | Revokes the current session |
| `GET`  | `/auth/me` | Returns the resolved `req.actor` |

### `auth.local` Config Schema

```typescript
type AuthLocalConfig = {
  userModel: string;         // DSL model key for the identity model (e.g. 'user')
  emailField: string;        // field used as login identifier (default: 'email')
  passwordField: string;     // virtual input field name (default: 'password')
  passwordHashField: string; // persisted hash field (default: 'password_hash')
  rolesField?: string;       // optional field providing roles array (default: 'roles')
  subjectKey?: string;       // RLS subject key for this user (default: 'user')

  // Extension hooks (all optional)
  onRegister?: (user: Record<string, unknown>, engine: EngineRuntime) => Promise<void>;
  buildClaims?: (user: Record<string, unknown>) => Record<string, unknown>;
};
```

### Password Handling
The `password` field must be `"save": false` in the DSL (virtual). A built-in pipeline op `hashPassword` in `@enginehq/auth` intercepts it during `beforePersist` and writes the bcrypt hash to `passwordHashField`. This op is auto-registered on the `userModel` by the auth router bootstrap.

### Token Minting
On /login and /register, the router calls `signActorAccessTokenHS256` (access token) and `SessionService.createSession` (refresh token) from `@enginehq/auth`.

## Conventions (for scaffolded apps)
`enginehq init` will be updated to scaffold a `dsl/models/user.json` when `auth.local` is provided (or via `--auth` flag), with sensible defaults.

## What Is Already Built (do not re-implement)
- `enginehq init`, `enginehq start`, `enginehq dev` CLI commands
- `runtime/app.ts` — the bootstrap entry point
- `runtime/autoload.ts` — pipeline/workflow/route autoloading
- `@enginehq/auth` — `signActorAccessTokenHS256`, `verifyActorAccessTokenHS256`, `SessionService`, `hashPassword` utilities
- `createEngineExpressApp` — accepts `resolveActor` option
