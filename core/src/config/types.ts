import type { RlsConfig } from '../rls/types.js';
import type { Migration } from '../migrations/types.js';

export type WorkflowsConfig = {
  enabled?: boolean;
  registry?: 'fs' | 'db';
  strict?: boolean;
  db?: { modelKey?: string };
};

export type LoggingConfig = {
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
};

/**
 * Configuration for built-in local (email/password) authentication.
 * When set, the runtime auto-mounts /auth/register, /auth/login,
 * /auth/refresh, /auth/logout, and /auth/me endpoints.
 */
export type AuthLocalConfig = {
  /** DSL model key for the identity model (e.g. 'user') */
  userModel: string;
  /** Field used as the login identifier. Default: 'email' */
  emailField?: string;
  /** Virtual input field carrying the plain-text password. Default: 'password' */
  passwordField?: string;
  /** Persisted field for the password hash. Default: 'password_hash' */
  passwordHashField?: string;
  /** Field providing the roles array. Default: 'roles' */
  rolesField?: string;
  /** RLS subject key mapped to this user. Default: 'user' */
  subjectKey?: string;
  /** Hook called after a successful registration. */
  onRegister?: (user: Record<string, unknown>, engine: unknown) => Promise<void>;
  /** Returns extra claims to embed in the JWT beyond subjects/roles. */
  buildClaims?: (user: Record<string, unknown>) => Record<string, unknown>;
};

export type EngineConfig = {
  app: { name: string; env: 'development' | 'test' | 'staging' | 'production' };
  logging?: LoggingConfig;
  http?: {
    basePath?: string;
    crudPath?: string;
    adminPath?: string;
    routesPath?: string;
    trustProxy?: boolean;
    hideExistence?: boolean;
  };
  db: { url: string; dialect?: 'postgres'; logging?: (sql: string) => void };
  dsl: {
    schemaPath?: string;
    schema?: Record<string, unknown>;
    fragments: { modelsDir: string; metaDir: string };
    allowMonolithDslJson?: boolean;
    monolithPath?: string;
  };
  auth: {
    jwt: { accessSecret: string; accessTtl: string };
    sessions?: {
      enabled: boolean;
      refreshTtlDays: number;
      refreshRotate: boolean;
      /**
       * Which session store backs refresh tokens.
       *  - 'auto' (default): use the DB model when it exists, else in-memory
       *  - 'model': require the DB model; fail fast if it is missing
       *  - 'memory': always in-memory (single process only)
       * A store registered in the ServiceRegistry as 'authSessionStore' overrides this.
       */
      store?: 'auto' | 'model' | 'memory';
      /** DSL meta model backing DB sessions. Default: 'auth_session' */
      modelKey?: string;
    };
    /** Built-in local auth routes. When set, /auth/register, /auth/login etc. are auto-mounted. */
    local?: AuthLocalConfig;
  };
  acl: { rolesModel?: string; roleNameField?: string };
  rls: RlsConfig;
  migrations?: { tableName?: string; migrations: Migration[] };
  workflows?: WorkflowsConfig;
  services?: Record<string, unknown>;
  compat?: Record<string, boolean>;
};

