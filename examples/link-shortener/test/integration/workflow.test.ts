import assert from 'node:assert';
import test from 'node:test';
import { createEngine } from '../../../../core/src/index.ts';
import registerWorkflowSteps from '../../workflow/steps.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.skip('Workflow: aggregate-clicks increments Link.total_clicks', async () => {
    // Mock Engine
    const dsl: any = { 
        link: { 
            fields: { 
                id: { type: 'int', primary: true },
                total_clicks: { type: 'int', default: 0 }
            }
        },
        analytics_event: {
            fields: {
                id: { type: 'int', primary: true },
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
        http: { port: 3000 },
        workflows: { enabled: true }
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
                        if (args.modelKey === 'analytics_event' && args.query.filters === 'status:pending') {
                            return { rows: [{ id: 101, link: 1 }] };
                        }
                        return { rows: [] };
                    },
                    update: async (args: any) => {
                        if (args.modelKey === 'analytics_event' && args.id === 101) {
                            // Mark as processed
                            return { status: 'processed' };
                        }
                        throw new Error('Not found');
                    },
                    read: async (args: any) => {
                        if (args.modelKey === 'link' && args.id === 1) {
                            return { id: 1, total_clicks: 0 };
                        }
                        throw new Error('Not found');
                    }
                };
            }
            return {};
          },
          has: (name: string) => {
            if (name === 'workflowEngine') return true;
            return false;
          }
        },
        orm: {
            sequelize: { Sequelize: { Op: {} } },
            models: {
                link: {
                    primaryKeyAttributes: ['id'],
                    findOne: async (opts: any) => {
                        if (opts.where.id === 1) {
                            return { get: () => ({ id: 1, total_clicks: 0 }) };
                        }
                        return null;
                    }
                },
                analytics_event: {
                    primaryKeyAttributes: ['id'],
                    findAll: async (opts: any) => {
                        if (opts.where.status === 'pending') {
                            return [{ get: () => ({ id: 101, link: 1, status: 'pending' }) }];
                        }
                        return [];
                    }
                },
                workflow_events_outbox: {
                    create: async () => {}
                }
            }
        }
    };
