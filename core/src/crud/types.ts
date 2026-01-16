import type { Actor } from '../actors/types.js';

export type CrudAction = 'list' | 'read' | 'create' | 'update' | 'delete';

export type CrudListQuery = {
  includeDeleted?: boolean;
  includeArchived?: boolean;
  includeDepth?: number;
  page?: number;
  limit?: number;
  sort?: string;
  filters?: string;
  find?: string;
};

export type CrudCallOptions = {
  runPipelines?: boolean;
  runResponsePipeline?: boolean;
  bypassAclRls?: boolean;
};

export type CrudListResult = {
  rows: Array<Record<string, unknown>>;
  pagination:
    | {
        limit: number;
        totalCount: number;
        totalPages: number;
        currentPage: number;
        nextPage: number | null;
        previousPage: number | null;
      }
    | null;
};

export type CrudCtx = {
  actor: Actor;
};
