# Specification: System Observability & Structured Logging

## Overview
Implement a robust, end-to-end observability system for EngineJS centered around structured logging (JSON) and request/trace context propagation. This will enable developers to trace requests from the HTTP entry point through internal services, durable workflows, and database interactions.

## Functional Requirements
- **Structured Logging:** Adopt `pino` as the core logging engine, producing consistent JSON output across all environments (development and production).
- **Context Propagation:** Implement a system (using `AsyncLocalStorage`) to generate and propagate a unique `traceId` for every incoming request.
- **HTTP Instrumentation:** Add middleware to `@enginehq/express` to automatically log request metadata (method, path, status, duration) and include the `traceId`.
- **Service/Workflow Instrumentation:** Ensure that logs generated within services or durable workflows include the current `traceId` automatically.
- **Database Tracing:** Inject the `traceId` into Sequelize queries (e.g., via SQL comments) to allow for correlation at the database level.

## Non-Functional Requirements
- **Performance:** Logging must have minimal overhead (leveraging `pino`'s performance).
- **Type Safety:** Provide a strongly typed `Logger` interface available via the `Engine` container.
- **Reliability:** The logging system should not crash the application if the transport fails.

## Acceptance Criteria
- [ ] All logs are output as valid JSON.
- [ ] Every HTTP request has a unique `traceId` in its logs.
- [ ] Log messages from within a `Workflow` include the `traceId` of the request that triggered it.
- [ ] Integration tests verify that the `traceId` is present in log output for a sample request flow.
- [ ] Documentation explains how developers can access and use the logger in their custom routes and workflows.

## Out of Scope
- External log aggregation (e.g., ELK stack, Datadog) configuration.
- Real-time metrics (Prometheus/Grafana) — this track focuses strictly on logging/tracing.