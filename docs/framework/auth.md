# EngineJS Framework: Auth & Sessions

## Introduction
The Auth module (`@enginehq/auth`) provides a robust, identity-based authentication system for EngineJS. It utilizes JWT (JSON Web Tokens) with HS256 signing for stateless authentication and an optional session management system for stateful revocation and token rotation.

## Actor Identity
The core concept of authentication in EngineJS is the **`Actor`**. An actor represents the identity of the person or system making a request.
- **`isAuthenticated`**: Boolean flag.
- **`subjects`**: A map of identity references (e.g., `user:123`, `org:42`). These are used by the RLS engine to scope data access.
- **`roles`**: A list of role strings used by the ACL engine (e.g., `admin`, `editor`).
- **`claims`**: Arbitrary key-value pairs from the token payload.
- **`sessionId`**: (Optional) Reference to a stateful session.

## JWT Management
EngineJS uses self-contained JWTs for access tokens.

### Signing & Verification
- **Algorithm**: HMAC-SHA256 (HS256).
- **Signing**: Done via `signActorAccessTokenHS256`, which bundles the actor's identity into the token payload.
- **Verification**: Done via `verifyActorAccessTokenHS256`. It ensures the signature is valid, the token is not expired, and optionally validates the session against a store.

### Secret
Set `auth.jwt.accessSecret` from the `JWT_SECRET` environment variable. The secret must have 32 or more characters.
- `createExpressApp` throws when `auth.local` is set and the secret is shorter.
- The `enginehq` runtime throws at startup when the secret is set and shorter.
- An empty secret turns off the JWT resolver. Every request then gets the anonymous actor.

The `enginehq init` scaffolds write `process.env.JWT_SECRET ?? ''`, with no default value.

### Token TTL
Durations can be specified using human-readable strings:
- `s`: Seconds
- `m`: Minutes
- `h`: Hours
- `d`: Days

### Auto-wired `actorResolver`
When `auth.jwt.accessSecret` is present in `enginejs.config.ts`, the runtime (`runtime/app.ts`) **automatically** wires a JWT `actorResolver` into the Express adapter. Apps do not need to write a custom resolver.

The built-in resolver:
1. Reads the `Authorization: Bearer <token>` header.
2. Calls `verifyActorAccessTokenHS256` to decode and validate the token.
3. Returns the decoded `Actor` on success, or the anonymous actor `{ isAuthenticated: false, ... }` on missing/invalid tokens.

A custom `resolveActor` can still be supplied via `enginejs.config.ts` to override this behaviour.

## Built-in Auth Routes (`auth.local`)

When `auth.local` is configured, the runtime automatically mounts the following endpoints at `${basePath}/auth`. No custom route files are needed.

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/register` | Creates a user, hashes password, returns access + refresh tokens |
| `POST` | `/auth/login` | Verifies credentials, returns token pair |
| `POST` | `/auth/refresh` | Rotates refresh token, returns new token pair |
| `POST` | `/auth/logout` | Revokes the current session |
| `GET`  | `/auth/me` | Returns the resolved `req.actor` |

### `auth.local` Config Reference

```typescript
type AuthLocalConfig = {
  userModel:         string;   // DSL model key (e.g. 'user')
  emailField?:       string;   // login identifier field (default: 'email')
  passwordField?:    string;   // virtual input field name (default: 'password')
  passwordHashField?: string;  // persisted hash field (default: 'password_hash')
  rolesField?:       string;   // field providing roles array (default: 'roles')
  subjectKey?:       string;   // RLS subject key (default: 'user')

  // Optional extension hooks
  onRegister?:   (user: Record<string, unknown>, engine: EngineRuntime) => Promise<void>;
  buildClaims?:  (user: Record<string, unknown>) => Record<string, unknown>;
};
```

### Password Handling
Declare the `password` field as `"save": false` in the DSL. It is a virtual field, so the database never stores it.

- `/auth/register` hashes the password with PBKDF2-SHA256 and writes the hash to `passwordHashField`. It ignores a `roles` value in the request body.
- For CRUD writes, declare the `hashPassword` pipeline op in `create.beforePersist` and `update.beforePersist`: `{ "op": "custom", "name": "hashPassword" }`. The optional `args` are `from` (default `password`) and `to` (default `password_hash`). The auth router registers the op when `auth.local` is set, unless the app already registers `pipelines.custom.hashPassword`.
- To keep the hash out of API responses, add `{ "op": "remove", "fields": ["password_hash"] }` to the `create`, `update`, `read` and `list` response phases.
- `/auth/login` finds the user with an exact match on `emailField`. That lookup runs no pipeline, so login can verify the hash when the response phases remove it.
- A `CrudService.update` call with `bypassAclRls` runs no pipeline, so it does not hash a password. Issue #6 tracks this.

`enginehq init --auth` scaffolds a user model with this setup.

### Minimal Config Example

```typescript
// enginejs.config.ts
export default {
  engine: {
    auth: {
      jwt: { accessSecret: process.env.JWT_SECRET!, accessTtl: '15m' },
      local: {
        userModel: 'user',
      },
    },
    rls: {
      subjects: { user: { idClaim: 'sub' } },
      policies: {
        post: {
          read:   { rule: { eq: { field: 'user_id', subject: 'user' } } },
          create: { enforce: { user_id: 'user' } },
        },
      },
    },
  },
} as const;
```

## Session Management (Optional)
For applications requiring stateful control over logins, EngineJS provides a `SessionService`.

### Refresh Tokens
- **Structure**: `<sessionId>.<random_bytes>`.
- **Hashing**: Refresh tokens are stored as SHA256 hashes in the session store to prevent exposure in case of database leaks.
- **Rotation**: Configurable token rotation on every use to mitigate replay attacks.

### Session Lifecycle
1. **Creation**: A session is created upon login, generating an access token and a refresh token.
2. **Verification**: Access tokens containing a `sid` (session ID) can be verified against the session store to check for revocation.
3. **Rotation**: The `rotateRefreshToken` method validates a refresh token and generates a new pair.
4. **Revocation**: Sessions can be revoked individually by ID or globally for a specific subject (e.g., "log out from all devices").

### Session Stores
The built-in auth routes select a session store automatically. Precedence:

1. **Custom**: a store registered in the ServiceRegistry as `authSessionStore`. Anything
   implementing `AuthSessionStore` works (Redis, a bespoke table, a test double).
2. **Configured**, through `auth.sessions.store`:
   - `'memory'` always uses the in-memory store
   - `'model'` requires the DB model and throws at startup if it is missing
3. **Auto** (the default): the DB model when it exists, in-memory otherwise.

```ts
auth: {
  jwt: { accessSecret: process.env.JWT_SECRET!, accessTtl: '15m' },
  sessions: {
    enabled: true,
    refreshTtlDays: 7,
    refreshRotate: true,
    store: 'auto',            // 'auto' | 'model' | 'memory'
    modelKey: 'auth_session', // DSL meta model backing DB sessions
  },
  local: { userModel: 'user' },
}
```

The chosen store is logged at startup. Falling back to in-memory while
`sessions.enabled` is true logs a **warning**: that store keeps sessions in process
memory, so they are lost on restart and are not shared between workers. Logout and
refresh rotation then only hold within a single process. Use it for tests and local
development only.

`enginehq init --auth` scaffolds `dsl/meta/auth_session.json`, so a new app gets
durable sessions with no extra configuration. To add it to an existing app, create
that meta model with the fields `SequelizeAuthSessionStore` reads: `id` (uuid,
primary), `subject_type`, `subject_model`, `subject_id`, `refresh_hash`,
`refresh_expires_at`, `revoked`, `revoked_at`, `device_token`.

## Security Hardening
- **Timing-Safe Equality**: Signature verification uses `crypto.timingSafeEqual` to prevent timing attacks.
- **Stateless/Stateful Hybrid**: Access tokens are stateless for performance, but the inclusion of a `sid` allows for near-real-time revocation checks via middleware.
- **Subject Validation**: Verification ensures that the subjects in the JWT payload match the subjects associated with the stateful session record.
