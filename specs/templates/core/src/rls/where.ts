export type RlsWhere =
  | { eq: { field: string; value: string | number } }
  | {
      via: {
        subject: string;
        subjectId: string | number;
        chain: Array<{ fromModel: string; fromField: string; toModel: string; toField: string }>;
      };
    }
  | { and: RlsWhere[] }
  | { or: RlsWhere[] };

export function andWhere(parts: Array<RlsWhere | null | undefined>): RlsWhere | null {
  const xs = parts.filter(Boolean) as RlsWhere[];
  if (!xs.length) return null;
  if (xs.length === 1) return xs[0]!;
  return { and: xs };
}

export function orWhere(parts: Array<RlsWhere | null | undefined>): RlsWhere | null {
  const xs = parts.filter(Boolean) as RlsWhere[];
  if (!xs.length) return null;
  if (xs.length === 1) return xs[0]!;
  return { or: xs };
}
