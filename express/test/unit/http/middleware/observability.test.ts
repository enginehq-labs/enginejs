import test from 'node:test';
import assert from 'node:assert/strict';
import { createObservabilityMiddleware } from '../../../../src/http/middleware/observability.js';
import { RequestContext } from '@enginehq/core';

test('createObservabilityMiddleware: sets traceId on request and context', (t, done) => {
  const logger = {
    info: () => {},
    child: () => logger
  };
  
  const middleware = createObservabilityMiddleware({ logger: logger as any });
  
  const req: any = {
    headers: {},
    method: 'GET',
    url: '/test'
  };
  const res: any = {
    on: (event: string, cb: () => void) => {
      if (event === 'finish') cb();
    }
  };
  
  middleware(req, res, () => {
    assert.ok(req.traceId, 'traceId should be set on request');
    assert.ok(RequestContext.getTraceId(), 'traceId should be available in context');
    assert.equal(RequestContext.getTraceId(), req.traceId);
    done();
  });
});

test('createObservabilityMiddleware: uses existing x-request-id header', (t, done) => {
  const logger = {
    info: () => {},
    child: () => logger
  };
  const middleware = createObservabilityMiddleware({ logger: logger as any });
  const existingId = 'existing-id-123';
  
  const req: any = {
    headers: { 'x-request-id': existingId },
    method: 'GET',
    url: '/test'
  };
  const res: any = {
    on: () => {}
  };
  
  middleware(req, res, () => {
    assert.equal(req.traceId, existingId);
    assert.equal(RequestContext.getTraceId(), existingId);
    done();
  });
});
