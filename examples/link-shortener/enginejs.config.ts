import type { EngineConfig } from 'enginehq';

export default {
  http: { port: Number(process.env.PORT || 3000) },
  autoload: { pipelinesDir: 'pipeline', workflowsDir: 'workflow', routesDir: 'routes' },
  engine: {
    app: { name: "link-shortener", env: (process.env.NODE_ENV as any) || 'development' },
    db: { url: process.env.DATABASE_URL || 'postgres://postgres:mysecretpassword@localhost:5432/link_shortener', dialect: 'postgres' },
    dsl: {
      fragments: { modelsDir: 'dsl/models', metaDir: 'dsl/meta' },
    },
    auth: { jwt: { accessSecret: process.env.JWT_SECRET || 'dev', accessTtl: '1h' } },
    acl: {},
    rls: {
      subjects: {
        user: { model: 'user', idClaims: ['sub', 'id'] }
      },
      policies: {
        link: {
          list: { subject: 'user', field: 'owner' },
          read: { subject: 'user', field: 'owner' },
          update: { subject: 'user', field: 'owner' },
          delete: { subject: 'user', field: 'owner' },
          create: { subject: 'user', field: 'owner', writeMode: 'enforce' }
        },
        analytics_event: {
          list: {
            subject: 'user',
            via: [
              { fromModel: 'analytics_event', fromField: 'link', toModel: 'link', toField: 'id' },
              { fromModel: 'link', fromField: 'owner', toModel: 'user', toField: 'id' }
            ]
          },
          read: {
            subject: 'user',
            via: [
              { fromModel: 'analytics_event', fromField: 'link', toModel: 'link', toField: 'id' },
              { fromModel: 'link', fromField: 'owner', toModel: 'user', toField: 'id' }
            ]
          }
        }
      }
    },
    workflows: { enabled: true },
  } satisfies EngineConfig,
} as const;
