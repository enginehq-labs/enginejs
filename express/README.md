# @enginehq/express

Express adapter for EngineJS: request context (actor + services), response envelope, and generic DSL CRUD routes.

> Status: **Technical Preview (v0.1.1)** — Active development; APIs may change.

## Install

```sh
npm i @enginehq/express
```

## Usage

```ts
import express from 'express';
import { createEngine } from '@enginehq/core';
import { createEngineExpressApp } from '@enginehq/express';
import { getBearerToken, verifyActorAccessTokenHS256 } from '@enginehq/auth';

const engine = createEngine(/* ... */);
await engine.init();

const app = express();
app.use(
  createEngineExpressApp(engine, {
    resolveActor: async (req) => {
      const token = getBearerToken(req.header('authorization'));
      if (!token) return { isAuthenticated: false, subjects: {}, roles: [], claims: {} };
      return verifyActorAccessTokenHS256({ token, secret: process.env.JWT_SECRET || 'dev' });
    },
  }),
);
app.listen(3000);
```
