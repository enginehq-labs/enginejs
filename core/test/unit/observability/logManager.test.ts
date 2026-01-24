import test from 'node:test';
import assert from 'node:assert/strict';
import { LogManager } from '../../../src/observability/logManager.js';
import { RequestContext } from '../../../src/observability/context.js';

test('LogManager: creates a logger that includes traceId from context', (t) => {
  const logOutputs: any[] = [];
  
  // Custom stream to capture output
  const stream = {
    write: (msg: string) => {
      logOutputs.push(JSON.parse(msg));
    }
  };

  const logger = LogManager.createLogger({ 
    level: 'info',
    stream 
  });

  const traceId = 'test-trace-id';
  RequestContext.run(traceId, () => {
    logger.info('hello world');
  });

  assert.equal(logOutputs.length, 1);
  assert.equal(logOutputs[0].msg, 'hello world');
  assert.equal(logOutputs[0].traceId, traceId);
});

test('LogManager: handles child loggers with merged context', () => {
  const logOutputs: any[] = [];
  const stream = {
    write: (msg: string) => {
      logOutputs.push(JSON.parse(msg));
    }
  };

  const logger = LogManager.createLogger({ level: 'info', stream });
  const child = logger.child({ component: 'test' });

  const traceId = 'test-trace-id';
  RequestContext.run(traceId, () => {
    child.info('child log');
  });

  assert.equal(logOutputs[0].msg, 'child log');
  assert.equal(logOutputs[0].traceId, traceId);
  assert.equal(logOutputs[0].component, 'test');
});
