# Track Plan: Migrate EngineJS to Conductor

## Phase 1: Remove Generation Scripts
- [x] Task: Remove generation scripts from root `package.json` (`gen`, `gen:clean`, `cycle`, `verify`, `test:e2e`, `gen:check`). e3431af
- [x] Task: Remove `tools/` directory scripts related to generation. 7dfbe27
- [x] Task: Conductor - User Manual Verification 'Phase 1: Remove Generation Scripts' (Protocol in workflow.md) [checkpoint: e3431af]

## Phase 2: Remove Specs Directory
- [x] Task: Delete the `specs/` directory. b58b70c
- [x] Task: Conductor - User Manual Verification 'Phase 2: Remove Specs Directory' (Protocol in workflow.md) [checkpoint: b58b70c]

## Phase 3: Verify and Fix Builds/Tests
- [x] Task: Verify `npm run build` runs successfully. b58b70c
- [x] Task: Verify `npm run test` (unit and integration) runs successfully. b58b70c
- [x] Task: Fix any issues arising from the removal of specs. b58b70c
- [x] Task: Conductor - User Manual Verification 'Phase 3: Verify and Fix Builds/Tests' (Protocol in workflow.md) [checkpoint: b58b70c]

## Phase 4: Documentation Update
- [x] Task: Update root `README.md` to remove references to the specs-driven development model. d428351
- [x] Task: Update `AGENTS.md` to reflect the new Conductor-driven workflow. afcea0c
- [x] Task: Conductor - User Manual Verification 'Phase 4: Documentation Update' (Protocol in workflow.md) [checkpoint: afcea0c]
