import type { ServiceFactoryCtx, ServiceRegistry, ServiceScope, ResolveCtx } from './types.js';

type Factory = (ctx: ServiceFactoryCtx) => unknown;

type Registration = {
  scope: ServiceScope;
  factory: Factory;
  singleton?: unknown;
};

export class DefaultServiceRegistry implements ServiceRegistry {
  private readonly registrations = new Map<string, Registration>();
  private readonly defaultFactoryCtx: ServiceFactoryCtx;

  constructor(config: unknown = {}) {
    this.defaultFactoryCtx = { config };
  }

  register<T>(name: string, scope: ServiceScope, factory: (ctx: ServiceFactoryCtx) => T): void {
    if (!name) throw new Error('Service name is required');
    if (this.registrations.has(name)) throw new Error(`Service already registered: ${name}`);
    this.registrations.set(name, { scope, factory });
  }

  resolve<T>(name: string, ctx: ResolveCtx): T {
    const reg = this.registrations.get(name);
    if (!reg) throw new Error(`Unknown service: ${name}`);

    if (reg.scope === 'singleton') {
      if (reg.singleton === undefined) reg.singleton = reg.factory(this.defaultFactoryCtx);
      return reg.singleton as T;
    }

    // Request/job-scoped lifecycle is implemented later; for now, factory-per-resolve.
    void ctx;
    return reg.factory(this.defaultFactoryCtx) as T;
  }

  has(name: string): boolean {
    return this.registrations.has(name);
  }
}
