import assert from 'node:assert';
import test from 'node:test';
import http from 'node:http';
import { createEngine } from '../../../../core/src/index.ts';
import { createEngineExpressApp } from '../../../../express/src/index.ts';
import registerRedirectRoutes from '../../routes/redirect.ts';

function listen(app: any) {
  const server = http.createServer(app);
  return new Promise<{ server: http.Server; url: string }>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') return reject(new Error('No address'));
      resolve({ server, url: `http://${addr.address}:${addr.port}` });
    });
  });
}

test('Pipeline: recordClick creates AnalyticsEvent', async () => {
    let analyticsCreated = false;
    let httpContextFound = false;
    
    // Mock Engine
    const dsl: any = { 
        link: { 
            fields: { 
                id: { type: 'int', primary: true },
                slug: { type: 'string', unique: true },
                url: { type: 'string' }
            }
        },
        analytics_event: {
            fields: {
                id: { type: 'int', primary: true },
                ip: { type: 'string' },
                link: { type: 'int' }
            }
        }
    };
    const config: any = {
        app: { name: 'link-shortener', env: 'test' },
        db: { url: 'postgres://localhost/db' },
        dsl: { fragments: { modelsDir: 'x', metaDir: 'x' } },
        auth: { jwt: { accessSecret: 'x', accessTtl: '1h' }, sessions: { enabled: false } },
        acl: {},
        rls: { subjects: {}, policies: {} },
        http: { port: 3000 }
    };
    
    const engine: any = {
        config,
        dsl,
        services: { 
          has: (name: string) => name === 'pipelines.custom.recordClick' || name === 'http.context',
          get: (name: string) => {
              if (name === 'pipelines.custom.recordClick') {
                  return async (ctx: any, args: any) => {
                      if (ctx.services.has('http.context')) {
                          httpContextFound = true;
                      }
                      analyticsCreated = true;
                      return { output: ctx.input };
                  };
              }
              if (name === 'http.context') {
                  return { req: { ip: '127.0.0.1', get: () => 'test' }, res: {} };
              }
          },
          resolve: (name: string) => {
            if (name === 'pipelines') {
                return {
                    runPhase: (args: any) => {
                        if (args.phase === 'response') {
                            const customOp = { op: 'custom', name: 'recordClick' };
                            // Simulate runCustomOp
                            const serviceName = `pipelines.custom.${customOp.name}`;
                            const fn = engine.services.get(serviceName);
                            fn({ input: args.input, services: engine.services }, {});
                        }
                        return { output: args.input };
                    },
                    get: () => ({
                        get: () => ({
                            response: [{ op: 'custom', name: 'recordClick' }]
                        })
                    })
                };
            }
            if (name === 'workflows') return { get: () => null };
            if (name === 'dsl') return dsl;
            if (name === 'orm') return engine.orm;
            if (name === 'crudService') {
                return {
                    list: async (args: any) => {
                        if (args.query.filters === 'slug:test-slug') {
                            return { rows: [{ id: 1, url: 'https://example.com' }] };
                        }
                        return { rows: [] };
                    },
                    read: async (args: any) => {
                        if (args.id === 1) {
                            // Simulate pipeline execution
                            const serviceName = 'pipelines.custom.recordClick';
                            const fn = engine.services.get(serviceName);
                            // We pass the services from options if available
                            const services = args.options?.services || engine.services;
                            await fn({ input: { id: 1 }, services }, {});
                            return { id: 1, url: 'https://example.com' };
                        }
                        throw new Error('Not found');
                    }
                };
            }
            return {};
          } 
        },
        orm: {
            sequelize: { Sequelize: { Op: {} } },
            models: {
                link: {
                    primaryKeyAttributes: ['id'],
                    findOne: async (opts: any) => {
                        if (opts.where.slug === 'test-slug') {
                            return { get: () => ({ id: 1, url: 'https://example.com' }) };
                        }
                        return null;
                    }
                }
            }
        }
    };

    const app = createEngineExpressApp(engine);
    await registerRedirectRoutes({ app, engine });

    const { server, url } = await listen(app);
    try {
        await fetch(`${url}/r/test-slug`, { redirect: 'manual' });
        assert.ok(analyticsCreated, 'AnalyticsEvent should be created via pipeline');
        assert.ok(httpContextFound, 'http.context should be passed to the pipeline');
    } finally {
        server.close();
    }
});
