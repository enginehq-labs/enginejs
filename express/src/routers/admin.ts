import express from 'express';
import type { Request } from 'express';

import { AclEngine, safeSync, type EngineConfig, type MigrationRunner } from '@enginehq/core';

function isTruthy(v: unknown) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function httpDenyCode(config: EngineConfig): 403 | 404 {
  return isTruthy(config.http?.hideExistence) ? 404 : 403;
}

function getActor(req: Request): any {
  return (req as any).actor;
}

function canAdmin(actor: any, dslModelSpec: any): { allow: boolean; reason: string } {
  const acl = new AclEngine();
  const canCreate = acl.can({ actor, modelKey: 'dsl', modelSpec: dslModelSpec, action: 'create' });
  if (canCreate.allow) return { allow: true, reason: 'ok' };
  const canUpdate = acl.can({ actor, modelKey: 'dsl', modelSpec: dslModelSpec, action: 'update' });
  if (canUpdate.allow) return { allow: true, reason: 'ok' };
  return { allow: false, reason: canUpdate.reason || canCreate.reason || 'Forbidden' };
}

function getServices(req: Request): any {
  const svcs = (req as any).services;
  return {
    has: (name: string) => !!svcs?.has?.(name),
    get: (name: string) => svcs.get(name),
  };
}

export function createAdminRouter(deps: { getConfig: () => EngineConfig; getDsl: () => any; getOrm: () => any }) {
  const router = express.Router();

  router.post('/sync', async (req, res) => {
    try {
      const config = deps.getConfig();
      const actor = getActor(req);
      const dsl = deps.getDsl();
      const orm = deps.getOrm();
      const services = getServices(req);

      const dslModelSpec = (dsl as any)?.dsl;
      if (!dslModelSpec) {
        return res.fail({
          code: 500,
          message: 'DSL snapshot model is required for admin authorization',
          errors: { root: 'Misconfigured' },
        });
      }

      const perm = canAdmin(actor, dslModelSpec);
      if (!perm.allow) {
        const code = httpDenyCode(config);
        return res.fail({ code, message: code === 404 ? 'Not found' : perm.reason, errors: { root: 'Forbidden' } });
      }

      const sequelize = services.get('db');
      const body = req.body && typeof req.body === 'object' ? (req.body as any) : {};
      const dryRun = isTruthy(body.dryRun);
      const requireSnapshot = isTruthy(body.requireSnapshot);
      const allowNoSnapshot =
        body.allowNoSnapshot !== undefined ? isTruthy(body.allowNoSnapshot) : !requireSnapshot;

      const report = await safeSync({
        sequelize,
        orm,
        dsl,
        dryRun,
        snapshot: { modelKey: 'dsl', requireSnapshot, allowNoSnapshot },
      });
      return res.ok(report, { code: 200, pagination: null });
    } catch (e: any) {
      const code = (e && typeof e === 'object' && (e as any).code) || 500;
      const errors = (e && typeof e === 'object' && (e as any).errors) || { root: 'Error' };
      return res.fail({ code, message: e?.message || 'Error', errors });
    }
  });

  router.get('/migrations/status', async (req, res) => {
    try {
      const config = deps.getConfig();
      const actor = getActor(req);
      const dsl = deps.getDsl();
      const services = getServices(req);

      const dslModelSpec = (dsl as any)?.dsl;
      if (!dslModelSpec) {
        return res.fail({
          code: 500,
          message: 'DSL snapshot model is required for admin authorization',
          errors: { root: 'Misconfigured' },
        });
      }

      const perm = canAdmin(actor, dslModelSpec);
      if (!perm.allow) {
        const code = httpDenyCode(config);
        return res.fail({ code, message: code === 404 ? 'Not found' : perm.reason, errors: { root: 'Forbidden' } });
      }

      if (!services.has('migrationRunner')) {
        return res.fail({ code: 501, message: 'Migration runner not configured', errors: { root: 'Misconfigured' } });
      }
      const runner = services.get('migrationRunner') as MigrationRunner;
      const status = await (runner as any).status();
      return res.ok(status, { code: 200, pagination: null });
    } catch (e: any) {
      const code = (e && typeof e === 'object' && (e as any).code) || 500;
      const errors = (e && typeof e === 'object' && (e as any).errors) || { root: 'Error' };
      return res.fail({ code, message: e?.message || 'Error', errors });
    }
  });

  router.post('/migrations/up', async (req, res) => {
    try {
      const config = deps.getConfig();
      const actor = getActor(req);
      const dsl = deps.getDsl();
      const services = getServices(req);

      const dslModelSpec = (dsl as any)?.dsl;
      if (!dslModelSpec) {
        return res.fail({
          code: 500,
          message: 'DSL snapshot model is required for admin authorization',
          errors: { root: 'Misconfigured' },
        });
      }

      const perm = canAdmin(actor, dslModelSpec);
      if (!perm.allow) {
        const code = httpDenyCode(config);
        return res.fail({ code, message: code === 404 ? 'Not found' : perm.reason, errors: { root: 'Forbidden' } });
      }

      if (!services.has('migrationRunner')) {
        return res.fail({ code: 501, message: 'Migration runner not configured', errors: { root: 'Misconfigured' } });
      }
      const runner = services.get('migrationRunner') as MigrationRunner;
      const result = await (runner as any).up();
      return res.ok(result, { code: 200, pagination: null });
    } catch (e: any) {
      const code = (e && typeof e === 'object' && (e as any).code) || 500;
      const errors = (e && typeof e === 'object' && (e as any).errors) || { root: 'Error' };
      return res.fail({ code, message: e?.message || 'Error', errors });
    }
  });

  return router;
}
