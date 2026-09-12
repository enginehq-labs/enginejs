import assert from 'node:assert';
import test from 'node:test';
import registerWorkflowSteps from '../../workflow/steps.ts';

/**
 * Covers the incrementClickCounter step that the aggregate-clicks workflow runs.
 * The step reads event.after.link, loads that link, and increments total_clicks.
 *
 * This uses mocks only, so it needs no database.
 */
type StepFn = (args: { event: any }) => Promise<void>;

function buildEngine(opts: { link?: { id: number; total_clicks: number } | null }) {
    const updates: Array<{ values: any; where: any }> = [];
    const registered = new Map<string, () => unknown>();

    const engine: any = {
        services: {
            register: (name: string, _scope: string, factory: () => unknown) => {
                registered.set(name, factory);
            },
            resolve: (name: string) => {
                if (name === 'orm') return engine.orm;
                return {};
            },
        },
        orm: {
            models: {
                link: {
                    findByPk: async (id: number) =>
                        opts.link && opts.link.id === id ? { get: () => opts.link } : null,
                    update: async (values: any, where: any) => {
                        updates.push({ values, where });
                    },
                },
            },
        },
    };

    return { engine, updates, registered };
}

async function loadStep(engine: any, registered: Map<string, () => unknown>): Promise<StepFn> {
    await registerWorkflowSteps({ engine });
    const factory = registered.get('workflows.step.incrementClickCounter');
    assert.ok(factory, 'the step should be registered');
    return factory!() as StepFn;
}

test('workflow: incrementClickCounter increments total_clicks on the link', async () => {
    const { engine, updates, registered } = buildEngine({ link: { id: 1, total_clicks: 4 } });
    const step = await loadStep(engine, registered);

    await step({ event: { after: { id: 101, link: 1 } } });

    assert.equal(updates.length, 1, 'the link should be updated once');
    assert.equal(updates[0]!.values.total_clicks, 5, 'the counter should advance by one');
    assert.deepEqual(updates[0]!.where, { where: { id: 1 } });
});

test('workflow: incrementClickCounter treats a missing counter as zero', async () => {
    const { engine, updates, registered } = buildEngine({ link: { id: 1 } as any });
    const step = await loadStep(engine, registered);

    await step({ event: { after: { id: 101, link: 1 } } });

    assert.equal(updates[0]!.values.total_clicks, 1);
});

test('workflow: incrementClickCounter does nothing when the event has no link', async () => {
    const { engine, updates, registered } = buildEngine({ link: { id: 1, total_clicks: 0 } });
    const step = await loadStep(engine, registered);

    await step({ event: { after: { id: 101 } } });

    assert.equal(updates.length, 0, 'no link id means no update');
});

test('workflow: incrementClickCounter does nothing when the link is gone', async () => {
    const { engine, updates, registered } = buildEngine({ link: null });
    const step = await loadStep(engine, registered);

    await step({ event: { after: { id: 101, link: 999 } } });

    assert.equal(updates.length, 0, 'a missing link must not be updated');
});
