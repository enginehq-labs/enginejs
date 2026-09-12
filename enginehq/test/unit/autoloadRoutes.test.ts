import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import express from 'express';
import { autoloadRoutes } from '../../src/runtime/autoload.js';

function listen(app: any) {
  const server = http.createServer(app);
  return new Promise<{ url: string; close: () => void }>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') return reject(new Error('No address'));
      resolve({
        url: `http://${addr.address}:${addr.port}`,
        close: () => {
          if ('closeAllConnections' in server) (server as any).closeAllConnections();
          server.close();
        },
      });
    });
  });
}

/**
 * Builds a temp routes tree.
 *
 * Convention: the mount path drops a TRAILING dynamic segment, and the module
 * declares that segment itself. A dynamic segment in the MIDDLE of the path stays
 * in the mount path, so the module reads it from req.params.
 */
function scaffoldRoutes(root: string): void {
  const routesDir = path.join(root, 'routes');
  fs.mkdirSync(routesDir);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }));

  // routes/hello.js -> /api/hello
  fs.writeFileSync(
    path.join(routesDir, 'hello.js'),
    `export default async function register({ app }) {
      app.get('/', (req, res) => res.send('hello'));
    }`,
  );

  const usersDir = path.join(routesDir, 'users');
  fs.mkdirSync(usersDir);

  // routes/users/index.js -> /api/users
  fs.writeFileSync(
    path.join(usersDir, 'index.js'),
    `export default async function register({ app }) {
      app.get('/', (req, res) => res.send('users index'));
    }`,
  );

  // routes/users/[id].js -> mounts at /api/users, module owns ':id'
  fs.writeFileSync(
    path.join(usersDir, '[id].js'),
    `export default async function register({ app }) {
      app.get('/:id', (req, res) => res.send('user ' + req.params.id));
    }`,
  );

  // routes/posts/[slug]/comments.js -> /api/posts/:slug/comments
  // The param sits mid-path, so it is read from req.params inside the router.
  const postSlugDir = path.join(routesDir, 'posts', '[slug]');
  fs.mkdirSync(postSlugDir, { recursive: true });
  fs.writeFileSync(
    path.join(postSlugDir, 'comments.js'),
    `export default async function register({ app }) {
      app.get('/', (req, res) => res.send('comments for ' + req.params.slug));
    }`,
  );

  // routes/special.js -> /v1/very-special via an explicit override
  fs.writeFileSync(
    path.join(routesDir, 'special.js'),
    `export const path = '/v1/very-special';
    export default async function register({ app }) {
      app.get('/', (req, res) => res.send('special'));
    }`,
  );
}

async function bootRoutes(root: string, routesPath: string) {
  const app = express();
  const engine: any = { config: { http: { routesPath } }, services: { resolve: () => ({}) } };
  await autoloadRoutes({ cwd: root, routesDir: 'routes', app, engine });
  return listen(app);
}

async function getText(url: string): Promise<{ status: number; text: string }> {
  const res = await fetch(url);
  return { status: res.status, text: await res.text() };
}

test('autoloadRoutes: serves file-based routes over HTTP', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enginejs-routes-test-'));
  scaffoldRoutes(root);

  const { url, close } = await bootRoutes(root, '/api');
  t.after(() => {
    close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  await t.test('static route', async () => {
    assert.deepEqual(await getText(`${url}/api/hello`), { status: 200, text: 'hello' });
  });

  await t.test('index route collapses to the directory', async () => {
    assert.deepEqual(await getText(`${url}/api/users`), { status: 200, text: 'users index' });
  });

  await t.test('trailing dynamic segment resolves the parameter', async () => {
    // Fails while the [param] conversion is disabled: the mount is the literal
    // /api/users/[id], which Express reads as a regex character class.
    assert.deepEqual(await getText(`${url}/api/users/123`), { status: 200, text: 'user 123' });
  });

  await t.test('a multi-character parameter is not treated as a character class', async () => {
    assert.deepEqual(await getText(`${url}/api/users/abc-def`), {
      status: 200,
      text: 'user abc-def',
    });
  });

  await t.test('mid-path dynamic segment reaches the module', async () => {
    assert.deepEqual(await getText(`${url}/api/posts/my-post/comments`), {
      status: 200,
      text: 'comments for my-post',
    });
  });

  await t.test('explicit path override wins', async () => {
    assert.deepEqual(await getText(`${url}/v1/very-special`), { status: 200, text: 'special' });
  });

  await t.test('an unmatched path is a 404', async () => {
    assert.equal((await getText(`${url}/api/nope`)).status, 404);
  });
});

test('autoloadRoutes: routesPath "/" mounts at the root', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enginejs-routes-root-'));
  scaffoldRoutes(root);

  const { url, close } = await bootRoutes(root, '/');
  t.after(() => {
    close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  assert.deepEqual(await getText(`${url}/hello`), { status: 200, text: 'hello' });
  assert.deepEqual(await getText(`${url}/users/123`), { status: 200, text: 'user 123' });
});
