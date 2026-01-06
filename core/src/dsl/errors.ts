export class DslLoadError extends Error {
  readonly code = 'dsl_load_error';
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'DslLoadError';
    this.details = details;
  }
}

export class DslValidationError extends Error {
  readonly code = 'dsl_schema_invalid';
  readonly ajvErrors: unknown[];

  constructor(message: string, ajvErrors: unknown[] = []) {
    super(message);
    this.name = 'DslValidationError';
    this.ajvErrors = ajvErrors;
  }
}

export class DslConstraintError extends Error {
  readonly code = 'dsl_constraint_error';
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'DslConstraintError';
    this.details = details;
  }
}

