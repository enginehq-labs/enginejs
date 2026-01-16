# Product Guidelines

## Prose Style
- **Technical & Precise:** Focus on exact specifications, API contracts, and internal logic.
- **Educational & Guiding:** Explain the "why" behind architectural choices and framework design to help users understand the system's philosophy.

## Architectural Principles
- **Schema-as-Code:** Core system components, including models, ACL (Access Control Lists), RLS (Row-Level Security), and workflows, must be defined declaratively via schemas rather than imperative code.
- **Framework Agnostic Core:** The core runtime logic (`@enginehq/core`) must remain independent of any specific adapter (like Express) or runtime environment to ensure maximum reusability and stability.

## Versioning & Release
- **Semantic Versioning:** Publicly published packages must strictly follow SemVer (MAJOR.MINOR.PATCH) principles.
- **Lockstep Releases:** All packages within the monorepo must be versioned and published in sync to maintain compatibility across the workspace.
- **Technical Preview Transparency:** During the Technical Preview phase, breaking changes are permitted but must be clearly documented in the changelog and migration guides.

## Security & Compliance
- **Secure by Default:** Enforcement of ACL and RLS is mandatory for all CRUD operations. Any bypass must be intentional, explicit, and audited.
- **Strict Secrets Management:** Hardcoded secrets are forbidden. Sensitive information must be managed via environment variables or external secret management systems.
- **Auditability:** All critical system events, security bypasses, and workflow executions must be logged to provide a clear audit trail.

## Testing & Verification
- **Multi-Layered Strategy:** Every feature must be verified through a comprehensive suite of unit tests (logic), integration tests (service cohesion), and E2E tests (real-world scenarios).
