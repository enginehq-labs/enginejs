import test from 'node:test';
import assert from 'node:assert/strict';

import type { DslRoot } from '../../src/dsl/types.js';
import type { RlsConfig } from '../../src/rls/types.js';
import { validateRlsPolicies } from '../../src/rls/validate.js';

const dsl = {
  customer: { fields: { id: { type: 'int', primary: true } } },
  order: { fields: { id: { type: 'int', primary: true }, customer_id: { type: 'int' } } },
  order_item: { fields: { id: { type: 'int', primary: true }, order_id: { type: 'int' } } },
} as unknown as DslRoot;

const itemToOrder = { fromModel: 'order_item', fromField: 'order_id', toModel: 'order', toField: 'id' };
const orderToCustomer = { fromModel: 'order', fromField: 'customer_id', toModel: 'customer', toField: 'id' };

function rls(policies: Record<string, unknown>): RlsConfig {
  return { subjects: {}, policies } as unknown as RlsConfig;
}

test('validateRlsPolicies: a valid via chain passes', () => {
  assert.doesNotThrow(() =>
    validateRlsPolicies(rls({ order_item: { list: { subject: 'customer', via: [itemToOrder, orderToCustomer] } } }), dsl),
  );
});

test('validateRlsPolicies: a field rule passes', () => {
  assert.doesNotThrow(() => validateRlsPolicies(rls({ order: { list: { subject: 'customer', field: 'customer_id' } } }), dsl));
});

test('validateRlsPolicies: an empty via chain throws', () => {
  assert.throws(
    () => validateRlsPolicies(rls({ order_item: { read: { subject: 'customer', via: [] } } }), dsl),
    /order_item\.read.*empty/,
  );
});

test('validateRlsPolicies: a chain that does not start at the policy model throws', () => {
  assert.throws(
    () => validateRlsPolicies(rls({ order_item: { list: { subject: 'customer', via: [orderToCustomer] } } }), dsl),
    /order_item\.list.*must start at model order_item/,
  );
});

test('validateRlsPolicies: a step that does not follow the previous step throws', () => {
  const skip = { fromModel: 'customer', fromField: 'id', toModel: 'customer', toField: 'id' };
  assert.throws(
    () => validateRlsPolicies(rls({ order_item: { list: { subject: 'customer', via: [itemToOrder, skip] } } }), dsl),
    /order_item\.list.*step 2 must start at model order/,
  );
});

test('validateRlsPolicies: a chain with an unknown model throws', () => {
  const missing = { fromModel: 'order_item', fromField: 'order_id', toModel: 'missing', toField: 'id' };
  assert.throws(
    () => validateRlsPolicies(rls({ order_item: { update: { subject: 'customer', via: [missing] } } }), dsl),
    /order_item\.update.*unknown model missing/,
  );
});

test('validateRlsPolicies: a via policy on an unknown model throws', () => {
  assert.throws(
    () => validateRlsPolicies(rls({ missing: { list: { subject: 'customer', via: [itemToOrder] } } }), dsl),
    /missing\.list.*unknown model missing/,
  );
});

test('validateRlsPolicies: a via rule inside anyOf and allOf is checked', () => {
  assert.throws(
    () =>
      validateRlsPolicies(
        rls({
          order_item: {
            list: { anyOf: [{ subject: 'customer', field: 'order_id' }, { allOf: [{ subject: 'customer', via: [orderToCustomer] }] }] },
          },
        }),
        dsl,
      ),
    /order_item\.list.*must start at model order_item/,
  );
});

test('validateRlsPolicies: no policies passes', () => {
  assert.doesNotThrow(() => validateRlsPolicies(rls({}), dsl));
  assert.doesNotThrow(() => validateRlsPolicies(undefined as unknown as RlsConfig, dsl));
});
