import type { EngineConfig } from 'enginehq';

export default {
  http: { port: Number(process.env.PORT || 3000) },
  autoload: { pipelinesDir: 'pipeline', workflowsDir: 'workflow', routesDir: 'routes' },
  engine: {
    app: { name: "hello-enginejs-app", env: (process.env.NODE_ENV as any) || 'development' },
    db: { url: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/postgres', dialect: 'postgres' },
    dsl: {
      schemaPath: 'dsl/schema.json',
      fragments: { modelsDir: 'dsl/models', metaDir: 'dsl/meta' },
    },
    auth: { jwt: { accessSecret: process.env.JWT_SECRET || 'dev', accessTtl: '1h' } },
    acl: {},
    rls: { subjects: {}, policies: {} },
    workflows: { enabled: true },
  } satisfies EngineConfig,
} as const;
