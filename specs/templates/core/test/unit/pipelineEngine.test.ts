import test from 'node:test';
import assert from 'node:assert/strict';

import { PipelineEngine } from '../../src/pipelines/engine.js';

function getModelSpec(dsl: unknown, modelKey: string) {
  if (!dsl || typeof dsl !== 'object') return null;
  const spec = (dsl as any)[modelKey];
  if (!spec || typeof spec !== 'object') return null;
  if (!(spec as any).fields) return null;
  return spec as any;
}

const services = { has: () => false, get: <T,>(_name: string) => (undefined as T) };
const actor = { isAuthenticated: true, subjects: {}, roles: ['admin'], claims: {} };

test('PipelineEngine: implicit fieldBasedTransform applies per-field transforms', () => {
  const dsl: any = {
    customer: {
      fields: {
        email: {
          type: 'string',
          transforms: [{ name: 'trim' }, { name: 'lowercase' }],
        },
      },
    },
  };

  const eng = new PipelineEngine({ getModelSpec });
  const res = eng.runPhase({
    dsl,
    action: 'create',
    phase: 'beforeValidate',
    modelKey: 'customer',
    actor,
    input: { email: '  TEST@EXAMPLE.COM  ' },
    services,
  });

  assert.deepEqual(res.output, { email: 'test@example.com' });
});

test('PipelineEngine: implicit fieldBasedValidator enforces required and email', () => {
  const dsl: any = {
    customer: {
      fields: {
        email: {
          type: 'string',
          required: true,
          validate: [{ name: 'email' }],
        },
      },
    },
  };

  const eng = new PipelineEngine({ getModelSpec });
  assert.throws(
    () =>
      eng.runPhase({
        dsl,
        action: 'create',
        phase: 'validate',
        modelKey: 'customer',
        actor,
        input: { email: 'not-an-email' },
        services,
      }),
    /Validation failed/,
  );
});

test('PipelineEngine: update required only validates provided fields', () => {
  const dsl: any = {
    customer: {
      fields: {
        email: { type: 'string', required: true, validate: [{ name: 'email' }] },
        name: { type: 'string', required: true },
      },
    },
  };

  const eng = new PipelineEngine({ getModelSpec });
  // Name is required but not in payload -> OK for update.
  eng.runPhase({
    dsl,
    action: 'update',
    phase: 'validate',
    modelKey: 'customer',
    actor,
    input: { email: 'a@b.com' },
    services,
  });
});

test('PipelineEngine: registrySpec ops run and can mutate payload', () => {
  const dsl: any = {
    customer: {
      fields: {
        email: { type: 'string' },
      },
    },
  };
  const registrySpec: any = {
    create: { beforeValidate: [{ op: 'trim', field: 'email' }] },
  };

  const eng = new PipelineEngine({ getModelSpec });
  const res = eng.runPhase({
    dsl,
    registrySpec,
    action: 'create',
    phase: 'beforeValidate',
    modelKey: 'customer',
    actor,
    input: { email: '  a@b.com  ' },
    services,
  });

  assert.deepEqual(res.output, { email: 'a@b.com' });
});

