import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { autoloadRoutes } from '../../src/runtime/autoload.js';

test('autoloadRoutes: recursive file-based routing', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enginejs-routes-test-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    const routesDir = path.join(root, 'routes');
    fs.mkdirSync(routesDir);

    // 1. Basic route: routes/hello.js -> /api/hello
    fs.writeFileSync(path.join(routesDir, 'hello.js'), `
      export default async function register({ app }) {
        app.get('/', (req, res) => res.send('hello'));
      }
    `);

    // 2. Index route: routes/users/index.js -> /api/users
    const usersDir = path.join(routesDir, 'users');
    fs.mkdirSync(usersDir);
    fs.writeFileSync(path.join(usersDir, 'index.js'), `
      export default async function register({ app }) {
        app.get('/', (req, res) => res.send('users index'));
      }
    `);

    // 3. Dynamic segment: routes/users/[id].js -> /api/users/:id
    fs.writeFileSync(path.join(usersDir, '[id].js'), `
      export default async function register({ app }) {
        app.get('/', (req, res) => res.send('user ' + req.params.id));
      }
    `);

    // 4. Nested dynamic: routes/posts/[slug]/comments.js -> /api/posts/:slug/comments
    const postsDir = path.join(routesDir, 'posts');
    const postSlugDir = path.join(postsDir, '[slug]');
    fs.mkdirSync(postSlugDir, { recursive: true });
    fs.writeFileSync(path.join(postSlugDir, 'comments.js'), `
      export default async function register({ app }) {
        app.get('/', (req, res) => res.send('comments for ' + req.params.slug));
      }
    `);

    // 5. Override path: routes/special.js -> /v1/very-special
    fs.writeFileSync(path.join(routesDir, 'special.js'), `
      export const path = '/v1/very-special';
      export default async function register({ app }) {
        app.get('/', (req, res) => res.send('special'));
      }
    `);

    const app = express();
    const engine: any = {
      config: { http: { routesPath: '/api' } },
      services: { resolve: () => ({}) }
    };

    await autoloadRoutes({ cwd: root, routesDir: 'routes', app, engine });

    // Verify internal Express router stack (simplified)
    const paths = app._router.stack
      .filter((layer: any) => layer.name === 'router')
      .map((layer: any) => layer.regexp.toString());
    
    console.log('Detected paths:', paths);

    // Checking regex patterns for mount points
    assert.ok(paths.some((p: string) => p.includes('api\\/hello')), 'missing /api/hello');
    assert.ok(paths.some((p: string) => p.includes('api\\/users')), 'missing /api/users');
    assert.ok(paths.some((p: string) => p.includes('api\\/users') && (p.includes('([^/]+?)') || p.includes('[id]'))), 'missing /api/users/:id');
    assert.ok(paths.some((p: string) => p.includes('api\\/posts') && (p.includes('([^/]+?)') || p.includes('[slug]')) && p.includes('comments')), 'missing /api/posts/:slug/comments');
    assert.ok(paths.some((p: string) => p.includes('v1\\/very-special')), 'missing /v1/very-special');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
