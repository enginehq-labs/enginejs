import type { PipelineCtx } from '@enginehq/core';

export const transforms = {
  // Return the transformed value.
  trimString: (_ctx: PipelineCtx, args: { value: unknown }) => {
    return typeof args.value === 'string' ? args.value.trim() : args.value;
  },
} as const;

