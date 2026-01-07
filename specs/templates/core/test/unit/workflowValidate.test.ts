import test from 'node:test';
import assert from 'node:assert/strict';

import { validateWorkflowSpec } from '../../src/workflows/validate.js';

test('validateWorkflowSpec: returns ok=true for minimal valid spec', () => {
  const res = validateWorkflowSpec({
    triggers: [{ type: 'model', model: 'post', actions: ['create'] }],
    steps: [{ op: 'log', message: 'ok' }],
  });
  assert.equal(res.ok, true);
  assert.equal(res.issues.length, 0);
});

test('validateWorkflowSpec: returns field-level errors for invalid spec', () => {
  const res = validateWorkflowSpec({
    actorMode: 'impersonate',
    triggers: [{ type: 'model', model: '', actions: ['nope'] }],
    steps: [{ op: 'db.update', model: '', where: { field: '', value: 1 }, set: {} }],
  });
  assert.equal(res.ok, false);
  assert.equal(typeof res.fields['impersonate'], 'string');
  assert.equal(typeof res.fields['triggers[0].model'], 'string');
  assert.equal(typeof res.fields['triggers[0].actions'], 'string');
  assert.equal(typeof res.fields['steps[0].model'], 'string');
  assert.equal(typeof res.fields['steps[0].where.field'], 'string');
  assert.equal(typeof res.fields['steps[0].set'], 'string');
});

