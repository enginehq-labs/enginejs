import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initEngineJsApp } from '../../src/cli.js';

let tmpDir: string;

describe('initEngineJsApp', () => {
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginejs-init-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('scaffolds scripts with enginehq start/dev (no "main")', () => {
    const dir = path.join(tmpDir, 'basic-app');
    initEngineJsApp({ dir, name: 'my-app' });

    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
    assert.strictEqual(pkg.scripts?.start, 'enginehq start');
    assert.strictEqual(pkg.scripts?.dev, 'enginehq dev');
    assert.ok(!('main' in pkg), '"main" field should not be present');
  });

  it('scaffolds auth.local config and user.json when --auth is specified', () => {
    const dir = path.join(tmpDir, 'auth-app');
    initEngineJsApp({ dir, name: 'auth-app', auth: true });

    // user model DSL should be created
    const userModelPath = path.join(dir, 'dsl', 'models', 'user.json');
    assert.ok(fs.existsSync(userModelPath), 'user.json should exist');

    const model = JSON.parse(fs.readFileSync(userModelPath, 'utf-8'));
    assert.ok(model.user, 'user model should exist');
    assert.ok(model.user.fields?.email, 'user model should have email field');
    assert.ok(model.user.fields?.password_hash, 'user model should have password_hash field');

    // enginejs.config.ts should contain auth.local section
    const config = fs.readFileSync(path.join(dir, 'enginejs.config.ts'), 'utf-8');
    assert.ok(config.includes('local:'), 'config should include auth.local section');
    assert.ok(config.includes('userModel:'), 'config should include userModel in auth.local');
  });

  it('scaffolds a hello route that does not double the /api prefix', () => {
    const dir = path.join(tmpDir, 'route-app');
    initEngineJsApp({ dir, name: 'route-app' });

    const route = fs.readFileSync(path.join(dir, 'routes', 'hello.ts'), 'utf8');
    // autoloadRoutes prefixes the mount with engine.http.routesPath, default '/api'.
    // A route declaring the full '/api/hello' would be served at /api/hello/api/hello.
    assert.ok(route.includes("export const path = '/api'"), 'should declare a path override');
    assert.ok(route.includes("app.get('/hello'"), 'the handler path should be relative');
    assert.ok(!route.includes("app.get('/api/hello'"), 'must not repeat the /api prefix');
  });

  it('scaffolds the auth_session meta model with --auth', () => {
    const dir = path.join(tmpDir, 'auth-session-app');
    initEngineJsApp({ dir, name: 'auth-session-app', auth: true });

    const sessionModelPath = path.join(dir, 'dsl', 'meta', 'auth_session.json');
    assert.ok(fs.existsSync(sessionModelPath), 'auth_session.json should exist with --auth');

    const model = JSON.parse(fs.readFileSync(sessionModelPath, 'utf8'));
    const fields = model.auth_session.fields;
    // These are the columns SequelizeAuthSessionStore reads and writes.
    for (const f of [
      'id',
      'subject_type',
      'subject_model',
      'subject_id',
      'refresh_hash',
      'refresh_expires_at',
      'revoked',
      'revoked_at',
    ]) {
      assert.ok(fields[f], `auth_session should declare '${f}'`);
    }
    assert.equal(fields.id.primary, true, 'id should be the primary key');
  });

  it('does NOT scaffold auth_session without --auth', () => {
    const dir = path.join(tmpDir, 'no-session-app');
    initEngineJsApp({ dir, name: 'no-session-app' });
    assert.ok(
      !fs.existsSync(path.join(dir, 'dsl', 'meta', 'auth_session.json')),
      'auth_session.json should NOT exist without --auth',
    );
  });

  it('does NOT scaffold user.json without --auth', () => {
    const dir = path.join(tmpDir, 'no-auth-app');
    initEngineJsApp({ dir, name: 'no-auth-app' });

    const userModelPath = path.join(dir, 'dsl', 'models', 'user.json');
    assert.ok(!fs.existsSync(userModelPath), 'user.json should NOT exist without --auth');

    const config = fs.readFileSync(path.join(dir, 'enginejs.config.ts'), 'utf-8');
    assert.ok(!config.includes('local:'), 'config should NOT include auth.local without --auth');
  });
});
