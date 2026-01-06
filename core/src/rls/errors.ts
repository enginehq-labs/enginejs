export class RlsNotImplementedError extends Error {
  readonly code = 'rls_not_implemented';

  constructor(message: string) {
    super(message);
    this.name = 'RlsNotImplementedError';
  }
}

