import test from 'node:test';
import assert from 'node:assert/strict';

import { WorkflowEngine } from '../../src/workflows/engine.js';
import { InMemoryWorkflowOutboxStore } from '../../src/workflows/outbox.js';

test('WorkflowEngine: emits event into outbox with defaults', async () => {
  const outbox = new InMemoryWorkflowOutboxStore();
  const wf = new WorkflowEngine(outbox);

  const res = await wf.emitModelEvent({
    model: 'customer',
    action: 'create',
    before: null,
    after: { id: 1, email: 'a@b.com' },
    actor: { isAuthenticated: true, subjects: {}, roles: ['admin'], claims: {}, sessionId: 's1' },
    origin: 'http',
  });

  assert.equal(res.id, 1);
  assert.equal(outbox.events.length, 1);
  const evt = outbox.events[0] as any;
  assert.equal(evt.model, 'customer');
  assert.equal(evt.action, 'create');
  assert.equal(evt.status, 'pending');
  assert.equal(evt.attempts, 0);
  assert.deepEqual(evt.actor.roles, ['admin']);
});

