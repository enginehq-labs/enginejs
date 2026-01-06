# enginehq

Unscoped umbrella package that re-exports EngineJS public API (`@enginehq/core`, `@enginehq/express`, `@enginehq/auth`).

> Status: **Technical Preview (v0.1.1)** — Active development; APIs may change.

## Install

```sh
npm i enginehq
```

## CLI

Create a new EngineJS app:

```sh
npx enginehq init my-app
cd my-app
npm i
npm run dev
```

## Usage

```ts
import { createEngine } from 'enginehq';
```
