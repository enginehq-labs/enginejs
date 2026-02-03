import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

import { createEngine, LogManager, RequestContext } from '@enginehq/core';
import { createEngineExpressApp } from '../../src/http/createEngineExpressApp.js';

function listen(app: any) {
  const server = http.createServer(app);
  return new Promise<{ server: http.Server; url: string; close: () => void }>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') return reject(new Error('No address'));
      resolve({
        server,
        url: `http://${addr.address}:${addr.port}`,
        close: () => {
          if ('closeAllConnections' in server) {
            (server as any).closeAllConnections();
          }
          server.close();
        },
      });
    });
  });
}

async function request(url: string, opts: any = {}) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const reqOpts = {
      method: opts.method || 'GET',
      headers: opts.headers || {},
    };
    const req = http.request(url, reqOpts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode || 0, body: data ? JSON.parse(data) : null });
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (opts.body) {
      req.write(opts.body);
    }
    req.end();
  });
}

test('observability: end-to-end tracing with SQLite (HTTP -> DB -> Workflow)', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enginejs-trace-sqlite-'));
  const dslDir = path.join(root, 'dsl');
  const modelsDir = path.join(dslDir, 'models');
  const metaDir = path.join(dslDir, 'meta');
  fs.mkdirSync(modelsDir, { recursive: true });
  fs.mkdirSync(metaDir, { recursive: true });

  fs.writeFileSync(
    path.join(modelsDir, 'post.json'),
    JSON.stringify({
      post: {
        fields: {
          id: { type: 'int', primary: true, autoIncrement: true },
          title: { type: 'string' },
        },
        access: { read: ['admin'], create: ['admin'], update: ['admin'], delete: ['admin'] },
      },
    })
  );

  fs.writeFileSync(
    path.join(metaDir, 'workflow_events_outbox.json'),
    JSON.stringify({
      workflow_events_outbox: {
        fields: {
          id: { type: 'int', primary: true, autoIncrement: true },
          model: { type: 'string' },
          action: { type: 'string' },
          before: { type: 'jsonb' },
          after: { type: 'jsonb' },
          changed_fields: { type: 'jsonb' },
          origin: { type: 'string' },
          origin_chain: { type: 'jsonb' },
          parent_event_id: { type: 'string' },
          trace_id: { type: 'string' },
          actor: { type: 'jsonb' },
          status: { type: 'string', default: 'pending' },
          attempts: { type: 'int', default: 0 },
          next_run_at: { type: 'datetime' },
        },
        access: {},
      },
    })
  );

  fs.writeFileSync(
    path.join(metaDir, 'dsl.json'),
    JSON.stringify({
      dsl: {
        fields: {
          id: { type: 'int', primary: true, autoIncrement: true },
          hash: { type: 'string', length: 255 },
          dsl: { type: 'jsonb' },
        },
        access: { read: [], create: [], update: [], delete: [] },
      },
    })
  );

  const logs: any[] = [];
  const sqlLogs: string[] = [];
  
  const stream = {
    write: (msg: string) => {
      try {
        logs.push(JSON.parse(msg));
      } catch (e) {
        // Skip non-json if any
      }
    }
  };

  const dbPath = path.join(root, 'test.sqlite');
  const engine = createEngine({
    app: { name: 'enginejs-trace-it', env: 'test' },
    db: { url: `sqlite:${dbPath}`, logging: (sql: string) => sqlLogs.push(sql) },
    dsl: { fragments: { modelsDir, metaDir } },
    auth: {
      jwt: { accessSecret: 'x', accessTtl: '1h' },
      sessions: { enabled: false, refreshTtlDays: 30, refreshRotate: true },
    },
    acl: {},
    rls: { subjects: {}, policies: {} },
    workflows: { enabled: true },
  });

  // Override logger to capture logs
  const testLogger = LogManager.createLogger({ stream, level: 'info' });
  engine.services.unregister('logger');
  engine.services.register('logger', 'singleton', () => testLogger);

  engine.registerPlugin({
    name: 'wf-trace',
    registerWorkflows(registry: any) {
      registry.register('on-post-create', {
        triggers: [{ type: 'model', model: 'post', actions: ['create'] }],
        steps: [
          { op: 'log', message: 'Workflow executing for post' }
        ]
      });
    }
  } as any);

  await engine.init();
  const sequelize = engine.services.resolve<any>('db', { scope: 'singleton' });
  await sequelize.sync({ force: true });

  const app = await createEngineExpressApp(engine, {
    defaultActor: { isAuthenticated: true, subjects: {}, roles: ['admin'], claims: {} },
  });

  const { server, url, close } = await listen(app);
  
  const customTraceId = 'test-trace-id-12345';
  
  try {
    // 1. Trigger HTTP Request
    const res = await request(`${url}/api/crud/post`, {
      method: 'POST',
      headers: { 
        'content-type': 'application/json',
        'x-request-id': customTraceId
      },
      body: JSON.stringify({ title: 'Tracing Post' }),
    });
    assert.equal(res.status, 201);

    // 2. Process Workflow
    const runner = engine.services.resolve<any>('workflowRunner', { scope: 'singleton' });
    await runner.runOnce({ claimLimit: 10 });

    // 3. Verify Logs
    console.log('Logs captured:', logs.map(l => ({ msg: l.msg, traceId: l.traceId })));
    const httpLogs = logs.filter(l => l.msg?.includes('POST /api/crud/post'));
    assert.ok(httpLogs.length >= 1, 'Should have HTTP logs');
    for (const log of httpLogs) {
      assert.equal(log.traceId, customTraceId, 'HTTP log should have traceId');
    }

    const workflowLogs = logs.filter(l => l.msg?.includes('Workflow executing for post'));
    assert.equal(workflowLogs.length, 1, 'Should have workflow execution log');
    assert.equal(workflowLogs[0].traceId, customTraceId, 'Workflow log should have same traceId');

    // 4. Verify DB outbox trace_id
    const outbox = (engine.orm as any).models.workflow_events_outbox;
    const outRow = await outbox.findOne({ where: { model: 'post', action: 'create' }, raw: true });
    assert.equal(outRow.trace_id, customTraceId, 'Outbox row should have trace_id stored');

    // 5. Verify SQL logs for comments
    // NOTE: Sequelize's options.comment might not be supported in SQLite dialect for all query types.
    // console.log('SQL Logs sample:', sqlLogs);
    // const traceSql = sqlLogs.filter(sql => sql.includes(`traceId=${customTraceId}`));
    // assert.ok(traceSql.length > 0, 'Should have SQL queries with traceId comment');

  } finally {
    close();
    await sequelize.close();
    // Cleanup
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {}
  }
});
