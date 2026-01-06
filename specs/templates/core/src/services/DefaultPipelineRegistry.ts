import type { PipelineRegistry } from './types.js';

export class DefaultPipelineRegistry implements PipelineRegistry {
  private readonly specs = new Map<string, unknown>();

  register(modelKey: string, spec: unknown) {
    if (!modelKey) throw new Error('modelKey is required');
    this.specs.set(modelKey, spec);
  }

  get(modelKey: string) {
    return this.specs.get(modelKey);
  }
}

