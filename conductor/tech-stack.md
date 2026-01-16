# Technology Stack

## Core Technologies
- **Programming Language:** TypeScript (v5.9.3)
- **Runtime Environment:** Node.js (>=22)
- **Backend Framework:** Express (v4.21.2)
- **ORM:** Sequelize (v6.37.7)
- **Database:** PostgreSQL (using `pg` v8.16.3 driver)

## Monorepo Architecture
- **Workspaces:** `@enginehq/core`, `@enginehq/auth`, `@enginehq/express`, `enginehq`
- **Dependency Management:** npm workspaces

## Testing & Verification
- **Test Runner:** Node.js built-in `node:test`
- **Validation:** Ajv (v8.17.1) for JSON Schema validation

## Tooling & Utilities
- **Transpilation:** TypeScript (`tsc`)
- **Execution:** `tsx` for development runtime
- **Development Framework:** [Conductor](https://github.com/gemini-cli-extensions/conductor) for track-based feature implementation and documentation.
