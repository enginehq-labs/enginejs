import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  pruneUnknownPayload,
  stripVirtualFields,
  parseArrayish,
  normalizePayloadMultiFields,
} from '../../../src/crud/utils.js';
import type { DslModelSpec } from '../../../src/dsl/types.js';

describe('CRUD Payload Utilities', () => {
  const dummySpec: DslModelSpec = {
    fields: {
      name: { type: 'string' },
      age: { type: 'int' },
      virtual_field: { type: 'string', save: false },
      tags: { type: 'string', multi: true },
      category_ids: { type: 'int', multi: true, source: 'category', sourceid: 'id' },
    },
  };

  describe('pruneUnknownPayload', () => {
    it('removes fields not defined in the DSL spec', () => {
      const payload = { name: 'Alice', age: 30, unknown: 'drop me' };
      const pruned = pruneUnknownPayload(dummySpec, payload, true);
      assert.deepEqual(pruned, { name: 'Alice', age: 30 });
    });

    it('keeps all fields if RESTRICT_UNKNOWN_FIELDS is false', () => {
      const payload = { name: 'Alice', age: 30, unknown: 'keep me' };
      const pruned = pruneUnknownPayload(dummySpec, payload, false);
      assert.deepEqual(pruned, payload);
    });
  });

  describe('stripVirtualFields', () => {
    it('removes fields marked with save: false', () => {
      const payload = { name: 'Alice', virtual_field: 'compute me' };
      const stripped = stripVirtualFields(dummySpec, payload);
      assert.deepEqual(stripped, { name: 'Alice' });
    });
  });

  describe('parseArrayish', () => {
    it('returns arrays as-is', () => {
      assert.deepEqual(parseArrayish([1, 2, 3]), [1, 2, 3]);
    });

    it('parses JSON string arrays', () => {
      assert.deepEqual(parseArrayish('["a", "b"]'), ['a', 'b']);
    });

    it('parses comma separated strings', () => {
      assert.deepEqual(parseArrayish('a, b, c'), ['a', 'b', 'c']);
    });

    it('wraps single items in an array', () => {
      assert.deepEqual(parseArrayish('single'), ['single']);
      assert.deepEqual(parseArrayish(123), [123]);
    });

    it('returns an empty array for null/undefined', () => {
      assert.deepEqual(parseArrayish(null), []);
      assert.deepEqual(parseArrayish(undefined), []);
      assert.deepEqual(parseArrayish(''), []);
    });
  });

  describe('normalizePayloadMultiFields', () => {
    it('normalizes string array fields', () => {
      const payload = { tags: 'a, b' };
      const { body, joinPayloads } = normalizePayloadMultiFields(dummySpec, payload);
      assert.deepEqual(body.tags, ['a', 'b']);
      assert.deepEqual(joinPayloads, {});
    });

    it('normalizes junction foreign key arrays and separates them', () => {
      const payload = { category_ids: '1, 2, 3', name: 'Alice' } as any;
      const { body, joinPayloads } = normalizePayloadMultiFields(dummySpec, payload);
      assert.ok(!('category_ids' in body));
      assert.deepEqual(body.name, 'Alice');
      assert.deepEqual(joinPayloads.category_ids, [1, 2, 3]);
    });

    it('handles mixed valid and invalid numbers in junction arrays', () => {
        const payload = { category_ids: '1, invalid, 3' } as any;
        const { body, joinPayloads } = normalizePayloadMultiFields(dummySpec, payload);
        assert.deepEqual(joinPayloads.category_ids, [1, 3]);
    });
  });
});
