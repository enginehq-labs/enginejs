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

test('Redirection: /r/:slug redirects to URL', async () => {
    // Mock Engine
    const dsl: any = { 
        link: { 
            fields: { 
                id: { type: 'int', primary: true },
                slug: { type: 'string', unique: true },
                url: { type: 'string' }
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
          resolve: (name: string) => {
            if (name === 'pipelines') return { get: () => null };
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
                            return { get: () => ({ url: 'https://example.com' }) };
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
        const res = await fetch(`${url}/r/test-slug`, { redirect: 'manual' });
        assert.equal(res.status, 302);
        assert.equal(res.headers.get('location'), 'https://example.com');
        
        const res404 = await fetch(`${url}/r/unknown`, { redirect: 'manual' });
        assert.equal(res404.status, 404);
    } finally {
        server.close();
    }
});
