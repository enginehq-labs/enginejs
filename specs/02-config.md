# EngineJS Specs — Configuration

## Source of truth

`EngineConfig` is the canonical configuration contract. Any new behavior MUST be represented as config or as a plugin.

## `EngineConfig` (minimum required)

```ts
import type { Migration } from '@enginehq/core/migrations';

export type EngineConfig = {
  app: { name: string; env: 'development' | 'test' | 'staging' | 'production' };
  http?: { basePath?: string; trustProxy?: boolean; hideExistence?: boolean };
  db: { url: string; dialect?: 'postgres' };
  dsl: {
    schemaPath: string;
    fragments: { modelsDir: string; metaDir: string };
    allowMonolithDslJson?: boolean;
    monolithPath?: string;
  };
  auth: {
    jwt: { accessSecret: string; accessTtl: string };
    sessions?: { enabled: boolean; refreshTtlDays: number; refreshRotate: boolean };
  };
  acl: { rolesModel?: string; roleNameField?: string };
  rls: RlsConfig;
  migrations?: { tableName?: string; migrations: Migration[] };
  workflows?: Record<string, unknown>;
  services?: Record<string, unknown>;
  compat?: Record<string, boolean>;
};
```

## Validation requirements

- Unknown keys SHOULD be rejected (strict mode) to avoid silent misconfiguration.
- Secrets MUST be provided via env or secret stores; committed secrets are forbidden.
- Per-environment overrides MUST be supported (merge strategy must be documented and deterministic).
