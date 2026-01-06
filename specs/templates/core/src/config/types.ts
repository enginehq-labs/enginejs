import type { RlsConfig } from '../rls/types.js';
import type { Migration } from '../migrations/types.js';

export type EngineConfig = {
  app: { name: string; env: 'development' | 'test' | 'staging' | 'production' };
  http?: { basePath?: string; trustProxy?: boolean; hideExistence?: boolean };
  db: { url: string; dialect?: 'postgres' };
  dsl: {
    schemaPath?: string;
    schema?: Record<string, unknown>;
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
