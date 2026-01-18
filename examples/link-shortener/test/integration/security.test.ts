import test from 'node:test';
import assert from 'node:assert';
import { createEngine, CrudService } from '@enginehq/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import registerPipelineOps from '../../pipeline/ops.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Security: ACL & RLS policies', async (t) => {
    const cwd = path.resolve(__dirname, '../../');
    const config = {
        app: { name: 'test', env: 'test' },
        db: { url: 'sqlite::memory:', dialect: 'sqlite' },
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
    
    // Sync DB
    await engine.orm.sequelize.sync({ force: true });

    const crud = engine.services.resolve<CrudService>('crudService', { scope: 'singleton' });

    // Create users (Directly via model to avoid ACL/RLS if we hadn't set user to public, but user is public create)
    const User = engine.orm.models.user;
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
    const Analytics = engine.orm.models.analytics_event;
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
