import { AsyncLocalStorage } from 'node:async_hooks';

export class RequestContext {
  private static storage = new AsyncLocalStorage<string>();

  /**
   * Run a function within a request context with the given traceId.
   */
  static run<T>(traceId: string, fn: () => T): T {
    return this.storage.run(traceId, fn);
  }

  /**
   * Get the current traceId from the context.
   */
  static getTraceId(): string | undefined {
    return this.storage.getStore();
  }
}
