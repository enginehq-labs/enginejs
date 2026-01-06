import type { WorkflowRegistry } from './types.js';

export class DefaultWorkflowRegistry implements WorkflowRegistry {
  private readonly specs = new Map<string, unknown>();

  register(name: string, spec: unknown) {
    if (!name) throw new Error('Workflow name is required');
    this.specs.set(name, spec);
  }

  get(name: string) {
    return this.specs.get(name);
  }

  list() {
    return [...this.specs.keys()].sort((a, b) => a.localeCompare(b));
  }
}
