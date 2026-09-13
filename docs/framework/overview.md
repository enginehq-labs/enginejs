# EngineJS Framework — Technical Overview

## Introduction
EngineJS is a Schema-as-Code backend framework for building highly reliable and secure systems. This directory contains the technical specifications for each of its major modules.

## System Architecture
The framework is composed of several core engines and support systems that work together to provide a deterministic runtime environment.

### Core Engines
- **DSL Compilation & Model Init:** Rules for defining and initializing the system schema.
- **Durable Workflows & Outbox:** Guarantees for reliable business logic execution.
- **Security (ACL & RLS):** Multi-subject row-level security and access control.
- **Pipelines:** Pluggable request/data transformation and validation.

### Support Systems
- **Express Adapter & CRUD Service:** Request handling and generic data operations.
- **Migrations & Safe Sync:** Non-destructive schema evolution.
- **Auth Module:** Identity management and session control.
- **DI & Plugin System:** Framework extensibility and lifecycle management.

## Module Boundaries
EngineJS is designed with clear architectural boundaries to ensure stability and reusability:

1. **`@enginehq/core`**: The framework-agnostic runtime. Contains all logic engines (DSL, ACL, RLS, Pipelines, Workflows) and the non-HTTP CRUD service. It depends only on Sequelize and utility libraries.
2. **`@enginehq/express`**: The HTTP adapter layer. Connects Express middleware and routers to the `core` services.
3. **`@enginehq/auth`**: The identity management module. Handles JWT signing/verification and stateful session logic. It is used by the Express adapter to resolve actors.
4. **`enginehq`**: The top-level package that re-exports the entire framework for ease of use.

## System Lifecycle Summary
The framework follows a 3-stage lifecycle:

1. **Bootstrap (`createEngine`)**: Services are registered, and the container is initialized.
2. **Initialization (`engine.init`)**: The DSL is compiled, validated, and used to generate the ORM schema. Plugins are hooked into the ready state.
3. **Execution**: The system handles requests (HTTP or internal). Every write operation follows a strict flow: **Security -> Pipeline -> Persistence -> Outbox -> Pipeline -> Response**.

## Module Index
- [DSL Compilation & ORM Init](dsl.md)
- [Durable Workflows](workflows.md)
- [Security (ACL & RLS)](security.md)
- [Pipelines](pipelines.md)
- [Adapter & CRUD Service](adapter.md)
- [Lifecycle & Service Container](lifecycle.md)
- [Maintenance (Sync & Migrations)](maintenance.md)
- [Auth & Sessions](auth.md)