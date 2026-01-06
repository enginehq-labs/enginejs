export type SortDir = 'asc' | 'desc';

export type SortSpec = { field: string; dir: SortDir };

export type Scalar = string | number | boolean | null;

export type FilterOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'range' | 'like';

export type FilterExpr =
  | { op: 'range'; field: string; min?: Scalar; max?: Scalar }
  | { op: Exclude<FilterOp, 'range'>; field: string; value: Scalar };

export type FilterGroup = {
  field: string;
  or: FilterExpr[];
};

export type ListQueryAst = {
  includeDeleted: boolean;
  includeArchived: boolean;
  includeDepth: number;
  page: number;
  limit: number;
  sort: SortSpec[];
  find?: string;
  filters: FilterGroup[];
};

