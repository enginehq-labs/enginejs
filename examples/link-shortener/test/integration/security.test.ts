import test from 'node:test';
import assert from 'node:assert';
import { createEngine, CrudService } from '@enginehq/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import registerPipelineOps from '../../pipeline/ops.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function dockerAvailable(): boolean {
    try {
        execFileSync('docker', ['version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function isTruthy(v: unknown): boolean {
    const s = String(v ?? '').trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes';
}

function ensureDockerImage(image: string): boolean {
    try {
        execFileSync('docker', ['image', 'inspect', image], { stdio: 'ignore' });
        return true;
    } catch {}

    if (!isTruthy(process.env.ENGINEJS_DOCKER_PULL)) return false;

    const timeoutMs = Number(process.env.ENGINEJS_DOCKER_PULL_TIMEOUT_MS || 30_000);
    try {
        execFileSync('docker', ['pull', image], { stdio: 'pipe', timeout: timeoutMs });
        return true;
    } catch {
        return false;
    }
}

function startPostgresContainer(image: string, password: string, db: string): { id: string; port: number } {
    const timeoutMs = Number(process.env.ENGINEJS_DOCKER_RUN_TIMEOUT_MS || 10_000);
    const id = execFileSync(
        'docker',
        ['run', '-d', '--rm', '-e', `POSTGRES_PASSWORD=${password}`, '-e', `POSTGRES_DB=${db}`, '-p', '127.0.0.1::5432', image],
        { encoding: 'utf8', timeout: timeoutMs },
    ).trim();

    const portLine = execFileSync('docker', ['port', id, '5432/tcp'], { encoding: 'utf8' }).trim();
    const port = Number(portLine.split(':').pop());
    if (!Number.isFinite(port) || port <= 0) throw new Error(`Failed to parse docker port: ${portLine}`);
    return { id, port };
}

async function waitFor<T>(fn: () => Promise<T>, timeoutMs: number) {
    const started = Date.now();
    let lastErr: unknown = null;
    while (Date.now() - started < timeoutMs) {
        try {
            return await fn();
        } catch (e) {
            lastErr = e;
            await new Promise((r) => setTimeout(r, 250));
        }
    }
    throw lastErr ?? new Error('Timed out');
}

test('docker postgres: Security: ACL & RLS policies', async (t) => {
    if (!dockerAvailable()) return t.skip('Docker not available');

    const image = process.env.ENGINEJS_TEST_PG_IMAGE || 'postgres:16-alpine';
    if (!ensureDockerImage(image)) {
        return t.skip(`Docker image not available: ${image} (pre-pull it, or set ENGINEJS_DOCKER_PULL=1)`);
    }

    const password = 'enginejs';
    const dbName = 'enginejs_link_shortener_security';
    const { id: containerId, port } = startPostgresContainer(image, password, dbName);
    t.after(() => {
        try {
            execFileSync('docker', ['rm', '-f', containerId], { stdio: 'ignore' });
        } catch {}
    });

    const cwd = path.resolve(__dirname, '../../');
    const config = {
        app: { name: 'test', env: 'test' },
        db: { url: `postgres://postgres:${password}@127.0.0.1:${port}/${dbName}`, dialect: 'postgres' },
        dsl: {
            fragments: {
                modelsDir: path.join(cwd, 'dsl/models'),
                metaDir: path.join(cwd, 'dsl/meta')
            }
        },
        auth: { jwt: { accessSecret: 'test', accessTtl: '1h' } },
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
        workflows: { enabled: false }
    };

    const engine = createEngine(config as any);
    await engine.init();
    await registerPipelineOps({ engine });
    
    // engine.init() populates orm, but the type is nullable until then.
    const orm = engine.orm;
    assert.ok(orm, 'engine.init() should have initialized the ORM');

    // Sync DB
    await waitFor(() => orm.sequelize.authenticate(), 30_000);
    await orm.sequelize.sync({ force: true });

    const crud = engine.services.resolve<CrudService>('crudService', { scope: 'singleton' });

    // Create users (Directly via model to avoid ACL/RLS if we hadn't set user to public, but user is public create)
    const User = orm.models.user;
    assert.ok(User, 'the user model should exist');
    const userA = await User.create({ email: 'userA@example.com' });
    const userB = await User.create({ email: 'userB@example.com' });

    const actorA = { 
        isAuthenticated: true, 
        roles: ['user'], 
        claims: { sub: userA.dataValues.id, id: userA.dataValues.id },
        subjects: {
            user: { type: 'user', model: 'user', id: userA.dataValues.id }
        }
    };
    const actorB = { 
        isAuthenticated: true, 
        roles: ['user'], 
        claims: { sub: userB.dataValues.id, id: userB.dataValues.id },
        subjects: {
            user: { type: 'user', model: 'user', id: userB.dataValues.id }
        }
    };
    const anon = { isAuthenticated: false, roles: [], claims: {}, subjects: {} };

    // 1. Create Link as User A (should enforce owner)
    const linkA = await crud.create({
        modelKey: 'link',
        values: { slug: 'a', url: 'http://a.com' },
        actor: actorA
    });
    assert.equal(linkA.owner, userA.dataValues.id, 'Owner should be set to User A');

    // Create Analytics Event for Link A (using ORM to simulate system creation)
    const Analytics = orm.models.analytics_event;
    assert.ok(Analytics, 'the analytics_event model should exist');
    await Analytics.create({ link: linkA.id, ip: '127.0.0.1' });

    // 2. Read Link A as User A (should allow)
    const readA = await crud.read({
        modelKey: 'link',
        id: linkA.id,
        actor: actorA
    });
    assert.equal(readA.id, linkA.id);

    // 3. Read Link A as User B (should deny via RLS)
    await assert.rejects(async () => {
        await crud.read({
            modelKey: 'link',
            id: linkA.id,
            actor: actorB
        });
    }, (e: any) => {
        // CrudService usually throws Not Found if RLS hides the record
        return e.message.includes('Not found') || e.message.includes('RLS denied');
    });

    // 4. Update Link A as User B (should deny)
     await assert.rejects(async () => {
        await crud.update({
            modelKey: 'link',
            id: linkA.id,
            values: { title: 'hacked' },
            actor: actorB
        });
    }, (e: any) => e.message.includes('Not found') || e.message.includes('RLS denied'));

    // 5. Update Link A as User A (should allow)
    const updatedA = await crud.update({
        modelKey: 'link',
        id: linkA.id,
        values: { title: 'updated' },
        actor: actorA
    });
    assert.equal(updatedA.title, 'updated');

    // 6. Anonymous access (should deny via ACL)
    await assert.rejects(async () => {
        await crud.create({
            modelKey: 'link',
            values: { slug: 'anon', url: 'http://anon.com' },
            actor: anon
        });
    }, (e: any) => e.message.includes('ACL denied'));

    // 7. List Analytics for Link A as User A (should allow and find 1)
    const analyticsA = await crud.list({
        modelKey: 'analytics_event',
        query: { filters: `link:${linkA.id}` },
        actor: actorA
    });
    assert.equal(analyticsA.rows.length, 1, 'User A should see analytics for Link A');

    // 8. List Analytics for Link A as User B (should return empty or deny)
    // RLS filters the results. Since User B doesn't own Link A, they shouldn't see any events linked to it.
    const analyticsB = await crud.list({
        modelKey: 'analytics_event',
        query: { filters: `link:${linkA.id}` },
        actor: actorB
    });
    assert.equal(analyticsB.rows.length, 0, 'User B should NOT see analytics for Link A');

});
