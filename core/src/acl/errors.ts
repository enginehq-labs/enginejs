export class AclDeniedError extends Error {
  override name = 'AclDeniedError';

  constructor(message = 'ACL denied') {
    super(message);
  }
}

