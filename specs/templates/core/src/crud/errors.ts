export class CrudError extends Error {
  readonly code: number;
  readonly errors: Record<string, unknown>;

  constructor(message: string, opts: { code: number; errors: Record<string, unknown> }) {
    super(message);
    this.name = 'CrudError';
    this.code = opts.code;
    this.errors = opts.errors;
  }
}

export class CrudNotFoundError extends CrudError {
  constructor(message = 'Not found') {
    super(message, { code: 404, errors: { root: 'NotFound' } });
    this.name = 'CrudNotFoundError';
  }
}

export class CrudForbiddenError extends CrudError {
  constructor(message = 'Forbidden') {
    super(message, { code: 403, errors: { root: 'Forbidden' } });
    this.name = 'CrudForbiddenError';
  }
}

export class CrudBadRequestError extends CrudError {
  constructor(message = 'Bad request') {
    super(message, { code: 400, errors: { root: 'BadRequest' } });
    this.name = 'CrudBadRequestError';
  }
}

