import type { RlsConfig } from '../rls/types.js';
import type { Migration } from '../migrations/types.js';

export type WorkflowsConfig = {
  enabled?: boolean;
  registry?: 'fs' | 'db';
  strict?: boolean;
  db?: { modelKey?: string };
};

export type EngineConfig = {
  app: { name: string; env: 'development' | 'test' | 'staging' | 'production' };
  http?: {
    basePath?: string;
    crudPath?: string;
    adminPath?: string;
    routesPath?: string;
    trustProxy?: boolean;
    hideExistence?: boolean;
  };
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
  workflows?: WorkflowsConfig;
  services?: Record<string, unknown>;
  compat?: Record<string, boolean>;
};
