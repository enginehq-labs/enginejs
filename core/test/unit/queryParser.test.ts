import test from 'node:test';
import assert from 'node:assert/strict';

import { parseFilters, parseListQuery, parseSort } from '../../src/query/parser.js';

test('parseSort: parses comma list and -prefix for desc', () => {
  assert.deepEqual(parseSort('a,-b'), [
    { field: 'a', dir: 'asc' },
    { field: 'b', dir: 'desc' },
  ]);
});

test('parseFilters: groups same-field tokens as OR and sorts fields deterministically', () => {
  const out = parseFilters('b:2,a:1,a:>3');
  assert.deepEqual(out, [
    {
      field: 'a',
      or: [
        { op: 'eq', field: 'a', value: 1 },
        { op: 'gt', field: 'a', value: 3 },
      ],
    },
    { field: 'b', or: [{ op: 'eq', field: 'b', value: 2 }] },
  ]);
});

test('parseFilters: supports range and open-ended range', () => {
  assert.deepEqual(parseFilters('age:10..20'), [
    { field: 'age', or: [{ op: 'range', field: 'age', min: 10, max: 20 }] },
  ]);
  assert.deepEqual(parseFilters('age:..20'), [
    { field: 'age', or: [{ op: 'range', field: 'age', max: 20 }] },
  ]);
  assert.deepEqual(parseFilters('age:10..'), [
    { field: 'age', or: [{ op: 'range', field: 'age', min: 10 }] },
  ]);
});

test('parseFilters: treats * as like when using equality', () => {
  assert.deepEqual(parseFilters('name:john*'), [
    { field: 'name', or: [{ op: 'like', field: 'name', value: 'john*' }] },
  ]);
});

test('parseListQuery: parses include flags, includeDepth, page/limit, filters/sort/find', () => {
  const q = parseListQuery({
    includeDeleted: '1',
    includeArchived: 'true',
    includeDepth: '2',
    page: '3',
    limit: '10',
    sort: '-id',
    filters: 'age:>=18,name:*doe*',
    find: 'hello',
  });

  assert.equal(q.includeDeleted, true);
  assert.equal(q.includeArchived, true);
  assert.equal(q.includeDepth, 2);
  assert.equal(q.page, 3);
  assert.equal(q.limit, 10);
  assert.deepEqual(q.sort, [{ field: 'id', dir: 'desc' }]);
  assert.equal(q.find, 'hello');
  assert.deepEqual(q.filters, [
    { field: 'age', or: [{ op: 'gte', field: 'age', value: 18 }] },
    { field: 'name', or: [{ op: 'like', field: 'name', value: '*doe*' }] },
  ]);
});

test('parseListQuery: limit=0 returns limit 0 (no pagination use)', () => {
  const q = parseListQuery({ limit: '0' });
  assert.equal(q.limit, 0);
  assert.equal(q.page, 1);
});
