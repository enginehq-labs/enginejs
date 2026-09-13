# Observability & Structured Logging

EngineJS provides a built-in observability system based on structured JSON logging and request tracing.

## Core Logger

The system uses `pino` under the hood to produce high-performance JSON logs. The logger is available as a singleton service in the Engine container.

### Interface

```typescript
export interface Logger {
  trace(msg: string, context?: LogContext): void;
  debug(msg: string, context?: LogContext): void;
  info(msg: string, context?: LogContext): void;
  warn(msg: string, context?: LogContext): void;
  error(msg: string, context?: LogContext): void;
  fatal(msg: string, context?: LogContext): void;
  child(context: LogContext): Logger;
}
```

### Usage in Custom Routes

When implementing custom routes, you can resolve the logger from the engine services.

```typescript
app.get('/custom', async (req, res) => {
  const logger = req.services.resolve<Logger>('logger', { scope: 'singleton' });
  
  logger.info('Custom route accessed', { query: req.query });
  
  res.send('OK');
});
```

### Usage in Workflows

Logs generated within a workflow automatically include the `traceId` of the event that triggered the workflow.

```json
{
  "op": "log",
  "message": "Processing event"
}
```

Or via custom steps:

```typescript
registry.register('workflows.step.my-step', 'singleton', () => async (ctx) => {
  const logger = ctx.services.resolve<Logger>('logger', { scope: 'singleton' });
  logger.info('Executing custom step');
});
```

## Request Tracing

Every HTTP request is assigned a unique `traceId`.

1.  **Generation:** If an incoming request has an `x-request-id` header, it is used as the `traceId`. Otherwise, a new UUID is generated.
2.  **Propagation:** The `traceId` is stored in an `AsyncLocalStorage` context (`RequestContext`) during the request lifecycle.
3.  **Automatic Inclusion:** The logger automatically includes the current `traceId` in every log message via a Pino mixin.
4.  **Workflow Correlation:** When an event is emitted to the workflow outbox, the current `traceId` is stored with it. The Workflow Runner then restores this `traceId` in the `RequestContext` before executing the workflow.
5.  **Database Correlation:** Sequelize queries automatically include the `traceId` as a SQL comment (e.g., `/* traceId=... */`) for correlation in database logs.

## Configuration

You can configure the log level in the engine config:

```typescript
const engine = createEngine({
  app: { name: 'my-app', env: 'development' },
  logging: {
    level: 'debug' // Default is 'info'
  },
  // ...
});
```
