import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestContext } from '../../../src/observability/context.js';

test('RequestContext: stores and retrieves traceId', () => {
  const traceId = 'test-trace-id';
  
  RequestContext.run(traceId, () => {
    assert.equal(RequestContext.getTraceId(), traceId);
  });
});

test('RequestContext: returns undefined when outside of context', () => {
  assert.equal(RequestContext.getTraceId(), undefined);
});

test('RequestContext: handles nested contexts correctly', () => {
  const traceId1 = 'trace-1';
  const traceId2 = 'trace-2';

  RequestContext.run(traceId1, () => {
    assert.equal(RequestContext.getTraceId(), traceId1);
    
    RequestContext.run(traceId2, () => {
      assert.equal(RequestContext.getTraceId(), traceId2);
    });
    
    assert.equal(RequestContext.getTraceId(), traceId1);
  });
});
