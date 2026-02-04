# EngineJS Roadmap

EngineJS is currently in **Technical Preview**. This roadmap outlines the path toward a stable `1.0.0` release, focusing on architectural integrity, developer ergonomics, and production-grade reliability.

## ✅ Completed (0.1.x Foundations)

- **Schema-as-Code core:** DSL registry, ORM initialization, and safe schema synchronization.
- **Security Engine:** Robust ACL and Row-Level Security (RLS) enforcement, including `via` join scoping.
- **Durable Workflows:** Outbox-backed workflow engine with retry logic, scheduling, and retention management.
- **Structured Observability:** Integrated `Logger` interface (Pino), request tracing (`traceId`), and database query instrumentation.
- **File-Based Routing:** Recursive, convention-based routing for Express.

## 0.1.x (Stability & Refactoring)

- **API Stabilization:** Finalize public exported surface for core modules to ensure long-term compatibility.
- **Logic Consolidation:** Move shared CRUD utilities (payload pruning, field stripping, junction handling) from `@enginehq/express` to `@enginehq/core` to eliminate duplication.
- **Node.js 22+ Enforcement:** Standardize monorepo scripts and enforce compatibility with Node.js 22+ (using `node:test` and latest ESM features).
- **Refine Routing Ergonomics:** Formalize file-based routing behavior for dynamic segments and nested middleware.
- **Expanded `CrudService` Parity:** Ensure full feature parity between internal service calls and HTTP endpoints (includeDepth, complex filters, junction behaviors).
- **Improved CLI UX:** Better error reporting for `enginehq sync` and interactive prompts for `enginehq init`.
- **Reference Examples:** Complete the Link Shortener example and add a multi-tenant SaaS starter template.

## 0.2.x (Ergonomics & Extensions)

- **Workflow Management UI Foundations:**
  - Admin endpoints for real-time workflow management (list, update, enable/disable).
  - Validation error surfaces optimized for a future UI-based workflow editor.
  - Import/export capabilities for workflow definitions.
- **Auth Service Enhancements:**
  - Standardized DB-backed session management (`auth_session`) with refresh rotation and revocation.
  - Ergonomic `resolveActor` helpers for common auth patterns (JWT, Session, API Key).
- **Advanced Pipeline & Workflow Ops:**
  - More built-in workflow steps: `crud.update`, `crud.read`, `db.delete` (scoped/audited).
  - Pluggable validation and transform libraries.

## 0.3.x (Production Readiness)

- **Enhanced Observability:**
  - OpenTelemetry (OTEL) integration for distributed tracing.
  - Performance metrics (Prometheus/Grafana) for CRUD latency and workflow throughput.
- **Migration Ergonomics:**
  - Support for zero-downtime migrations.
  - Safe rollback patterns and migration audit logs.
- **Multi-Dialect Support:** Official verification and testing for SQLite, MySQL, and MSSQL (beyond PostgreSQL).

## 1.0.0 (General Availability)

- **Stability Guarantees:** Strict SemVer enforcement and long-term support (LTS) policy.
- **Comprehensive Documentation:** Full API reference, architectural deep-dives, and best practices guides.
- **Production-Ready Ecosystem:** A collection of stable plugins for standard needs (file storage, email, background jobs).
