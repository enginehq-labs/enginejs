export class QueryParseError extends Error {
  readonly code = 'query_parse_error';
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'QueryParseError';
    this.details = details;
  }
}

