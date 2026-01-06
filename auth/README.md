# @enginehq/auth

EngineJS auth helpers: HS256 JWT access tokens and optional refresh sessions (rotation + revocation).

> Status: **Technical Preview (v0.1.1)** — Active development; APIs may change.

## Install

```sh
npm i @enginehq/auth
```

## Usage

This package provides building blocks (token + session services) that you can plug into Express `resolveActor`.

- Access tokens: `signActorAccessTokenHS256`, `verifyActorAccessTokenHS256`
- Sessions: `SessionService` + `AuthSessionStore` implementations
- Sequelize store: `import { SequelizeAuthSessionStore } from '@enginehq/auth/sequelize'` (expects the `auth_session` DSL/meta model fields from `enginejs/specs/12-auth-sessions.md`)
