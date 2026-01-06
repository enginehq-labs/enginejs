# EngineJS Specs — Auth + Sessions (MVP)

EngineJS MUST provide a reusable auth module that supports:

- JWT access tokens (HS256)
- optional DB-backed sessions with refresh token rotation + revocation
- multiple actor subjects (customer/user/both/more)

## Token requirements

- Access tokens MUST embed enough information to reconstruct an `Actor`:
  - `subjects`, `roles`, `claims`, `isAuthenticated`
  - optional `sid` (session id)
- Tokens MUST include `iat` and `exp`.

## Sessions (optional)

When sessions are enabled:

- Refresh tokens MUST be long-lived and rotated (rolling expiry).
- Refresh tokens MUST be stored as hashes in the DB (never plaintext).
- Access token verification MUST validate `sid` against session table (not revoked, not expired).

## Auth session model (DSL meta)

When using Sequelize store, apps SHOULD define `auth_session` in DSL meta.

Minimum fields:

- `id` (string primary) — session id (`sid`)
- `subject_type` (string)
- `subject_model` (string)
- `subject_id` (string)
- `refresh_hash` (string)
- `refresh_expires_at` (datetime)
- `revoked` (boolean default false)
- `revoked_at` (datetime)
- optional `device_token` (string)

System fields are added by the DSL loader (`created_at`, `updated_at`, `deleted`, `archived`, etc.).

## Integration

- Auth module MUST expose helpers usable from Express `resolveActor`:
  - decode/verify Bearer access token
  - optional session validation when `sid` is present

## Package surface (MVP)

Published as `@enginehq/auth`.

- JWT helpers:
  - `signJwtHS256`, `verifyJwtHS256`, `parseDurationToSeconds`
- Actor access tokens:
  - `signActorAccessTokenHS256({ actor, secret, ttlSeconds })`
  - `verifyActorAccessTokenHS256({ token, secret, sessionStore? })`
  - `getBearerToken(authorizationHeader)` → `token | null`
- Sessions:
  - `SessionService` (create, verify, rotate, revoke, revokeAll, listBySubject, updateDeviceToken)
  - `AuthSessionStore` (pluggable persistence)
- Optional Sequelize-backed store:
  - `import { SequelizeAuthSessionStore } from '@enginehq/auth/sequelize'`
