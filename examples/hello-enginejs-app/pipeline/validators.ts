import type { PipelineCtx } from '@enginehq/core';

export const validators = {
  // Return a string to fail validation; return void/true to pass.
  nonEmptyString: (_ctx: PipelineCtx, args: { value: unknown }) => {
    if (typeof args.value === 'string' && args.value.trim()) return;
    return 'Required';
  },
} as const;

