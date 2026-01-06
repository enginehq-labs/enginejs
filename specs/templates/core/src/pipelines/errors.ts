export class PipelineValidationError extends Error {
  override name = 'PipelineValidationError';
  readonly errors: Record<string, string>;

  constructor(message: string, errors: Record<string, string>) {
    super(message);
    this.errors = errors;
  }
}

export class PipelineNotImplementedError extends Error {
  override name = 'PipelineNotImplementedError';
}

