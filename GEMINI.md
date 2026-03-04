# EngineJS Agent Rules

You are an AI programming assistant working in the EngineJS repository.
EngineJS strictly uses a Conductor-Driven Monorepo workflow.

## Source of Truth

- The product vision is in `conductor/product.md`.
- Guidelines are in `conductor/product-guidelines.md`.
- Technical stack is documented in `conductor/tech-stack.md`.
- Overall workflow is detailed in `conductor/workflow.md`.
- Current work must be tracked in `conductor/tracks/<track_id>/plan.md`.

## Runtime Environment

- **Strictly Node.js 22+**.
- Always run `nvm use 22` before operations.

## Development Workflow

When completing tasks from the active `plan.md`:

1. **Mark In Progress**: Change the task marker in `plan.md` from `[ ]` to `[~]`.
2. **TDD is Mandatory**: You must write failing tests before implementing fixing application code.
3. **Green Phase**: Implement the minimal code required to pass the test. Aim for >80% coverage.
4. **Commits**: Commit code with the standard semantic commit format, e.g. `feat(scope): description`.
5. **Git Notes**: Run `git notes add -m "<note content>" <commit_hash>` to attach a task summary.
6. **Update Plan**: Mark task as complete by changing `[~]` to `[x]` and append the first 7 characters of the completion commit hash: e.g. `[x] ... <sha>`. Update `plan.md` and commit it as `conductor(plan): Mark task ... as complete`.

## Phase Completion

If a phase is complete in `plan.md`:

1. Determine phase scope by finding changed files since last phase checkpoint.
2. Ensure test coverage for all code changes.
3. Execute automated tests with proactive debugging.
4. Propose a manual verification plan to the user based on `product.md`.
5. Pause for user confirmation.
6. Create checkpoint commit, attach auditable verification report via git notes, update `plan.md` with `[checkpoint: <sha>]`, and commit the updated plan.

Never deviate from the `conductor/workflow.md` principles or `tech-stack.md`. If required to deviate from `tech-stack.md`, STOP and update it first.
