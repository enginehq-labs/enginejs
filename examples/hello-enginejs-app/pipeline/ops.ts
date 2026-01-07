import type { PipelineCtx } from '@enginehq/core';

export const ops = {
  // Example custom pipeline op:
  //
  // In a pipeline spec: { op: 'custom', name: 'logPayload', args: { label: 'x' } }
  logPayload: (ctx: PipelineCtx, args: unknown) => {
    void args;
    console.log('[pipeline op] payload', { model: ctx.modelKey, action: ctx.action, phase: ctx.phase, input: ctx.input });
  },
} as const;
