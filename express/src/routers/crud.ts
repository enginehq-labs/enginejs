import express from 'express';
import type { Request } from 'express';

import type { Actor, DslRoot, EngineConfig, OrmInitResult } from '@enginehq/core';
import {
  PipelineValidationError,
  QueryParseError,
  CrudService,
  CrudBadRequestError,
  CrudForbiddenError,
  CrudNotFoundError,
  type ServiceRegistry,
} from '@enginehq/core';

export type CrudRouterDeps = {
  getDsl: () => DslRoot;
  getOrm: () => OrmInitResult;
  getConfig: () => EngineConfig;
  services: ServiceRegistry;
};

function httpDenyCode(config: EngineConfig, kind: 'single' | 'collection'): 403 | 404 {
  if (kind === 'collection') return 403;
  return config.http?.hideExistence === false ? 403 : 404;
}

function getActor(req: Request): Actor {
  const a = (req as any).actor;
  return (
    a ??
    ({
      isAuthenticated: false,
      subjects: {},
      roles: [],
      claims: {},
    } satisfies Actor)
  );
}

function getOrigin(req: Request): string {
  const h = (req.headers as any)['x-engine-origin'];
  if (typeof h === 'string' && h.trim()) return h.trim();
  return 'http';
}

function getOriginChain(req: Request): string[] | undefined {
  const h = (req.headers as any)['x-engine-origin-chain'];
  const raw = Array.isArray(h) ? h[0] : h;
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const s = raw.trim();
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) {
      const out = parsed.map((x) => String(x)).map((x) => x.trim()).filter(Boolean);
      return out.length ? out : undefined;
    }
  } catch {}
  const out = s.split(',').map((x) => x.trim()).filter(Boolean);
  return out.length ? out : undefined;
}

function getParentEventId(req: Request): string | number | undefined {
  const h = (req.headers as any)['x-engine-parent-event-id'];
  if (typeof h === 'string' && h.trim()) return h.trim();
  return undefined;
}

function getServicesForPipeline(req: Request) {
  const svcs = (req as any).services;
  return {
    has: (name: string) => !!svcs?.has?.(name),
    get: (name: string) => svcs.get(name),
  };
}

export function createCrudRouter({ getConfig, services }: CrudRouterDeps) {
  const router = express.Router();

  router.get('/:model', async (req, res) => {
    try {
      const actor = getActor(req);
      const modelKey = String(req.params.model || '');
      const crud = new CrudService({ services });

      const result = await crud.list({
        modelKey,
        actor,
        query: req.query as any,
        options: { services: getServicesForPipeline(req) },
      });

      return res.ok(result.rows, { code: 200, pagination: result.pagination });
    } catch (e: any) {
      if (e instanceof CrudBadRequestError || e instanceof QueryParseError || e instanceof PipelineValidationError) {
        return res.fail({ code: 400, message: e.message, errors: (e as any).errors || { root: 'Bad request' } });
      }
      if (e instanceof CrudForbiddenError) {
        return res.fail({ code: 403, message: e.message, errors: { root: 'Forbidden' } });
      }
      if (e instanceof CrudNotFoundError) {
        return res.fail({ code: 404, message: e.message, errors: { root: 'Not found' } });
      }
      const code = (e && typeof e === 'object' && (e as any).code) || 500;
      const errors = (e && typeof e === 'object' && (e as any).errors) || { root: 'Error' };
      return res.fail({ code, message: e?.message || 'Error', errors });
    }
  });

  router.get('/:model/:id', async (req, res) => {
    try {
      const actor = getActor(req);
      const modelKey = String(req.params.model || '');
      const crud = new CrudService({ services });

      const result = await crud.read({
        modelKey,
        id: req.params.id,
        actor,
        query: req.query as any,
        options: { services: getServicesForPipeline(req) },
      });

      return res.ok(result, { code: 200, pagination: null });
    } catch (e: any) {
      if (e instanceof CrudBadRequestError || e instanceof QueryParseError || e instanceof PipelineValidationError) {
        return res.fail({ code: 400, message: e.message, errors: (e as any).errors || { root: 'Bad request' } });
      }
      if (e instanceof CrudForbiddenError) {
        const hCode = httpDenyCode(getConfig(), 'single');
        return res.fail({ code: hCode, message: hCode === 404 ? 'Not found' : e.message, errors: { root: 'Forbidden' } });
      }
      if (e instanceof CrudNotFoundError) {
        return res.fail({ code: 404, message: e.message, errors: { root: 'Not found' } });
      }
      const code = (e && typeof e === 'object' && (e as any).code) || 500;
      const errors = (e && typeof e === 'object' && (e as any).errors) || { root: 'Error' };
      return res.fail({ code, message: e?.message || 'Error', errors });
    }
  });

  router.post('/:model', async (req, res) => {
    try {
      const actor = getActor(req);
      const modelKey = String(req.params.model || '');
      const crud = new CrudService({ services });

      const originChain = getOriginChain(req);
      const parentEventId = getParentEventId(req);
      const result = await crud.create({
        modelKey,
        actor,
        values: req.body,
        origin: getOrigin(req),
        ...(originChain ? { originChain } : {}),
        ...(parentEventId != null ? { parentEventId } : {}),
        options: { services: getServicesForPipeline(req) },
      });

      return res.ok(result, { code: 201, pagination: null });
    } catch (e: any) {
      if (e instanceof CrudBadRequestError || e instanceof QueryParseError || e instanceof PipelineValidationError) {
        return res.fail({ code: 400, message: e.message, errors: (e as any).errors || { root: 'Bad request' } });
      }
      if (e instanceof CrudForbiddenError) {
        return res.fail({ code: 403, message: e.message, errors: { root: 'Forbidden' } });
      }
      if (e instanceof CrudNotFoundError) {
        return res.fail({ code: 404, message: e.message, errors: { root: 'Not found' } });
      }
      const code = (e && typeof e === 'object' && (e as any).code) || 500;
      const errors = (e && typeof e === 'object' && (e as any).errors) || { root: 'Error' };
      return res.fail({ code, message: e?.message || 'Error', errors });
    }
  });

  router.patch('/:model/:id', async (req, res) => {
    try {
      const actor = getActor(req);
      const modelKey = String(req.params.model || '');
      const crud = new CrudService({ services });

      const originChain = getOriginChain(req);
      const parentEventId = getParentEventId(req);
      const result = await crud.update({
        modelKey,
        id: req.params.id,
        actor,
        values: req.body,
        origin: getOrigin(req),
        ...(originChain ? { originChain } : {}),
        ...(parentEventId != null ? { parentEventId } : {}),
        options: { services: getServicesForPipeline(req) },
      });

      return res.ok(result, { code: 200, pagination: null });
    } catch (e: any) {
      if (e instanceof CrudBadRequestError || e instanceof QueryParseError || e instanceof PipelineValidationError) {
        return res.fail({ code: 400, message: e.message, errors: (e as any).errors || { root: 'Bad request' } });
      }
      if (e instanceof CrudForbiddenError) {
        const hCode = httpDenyCode(getConfig(), 'single');
        return res.fail({ code: hCode, message: hCode === 404 ? 'Not found' : e.message, errors: { root: 'Forbidden' } });
      }
      if (e instanceof CrudNotFoundError) {
        return res.fail({ code: 404, message: e.message, errors: { root: 'Not found' } });
      }
      const code = (e && typeof e === 'object' && (e as any).code) || 500;
      const errors = (e && typeof e === 'object' && (e as any).errors) || { root: 'Error' };
      return res.fail({ code, message: e?.message || 'Error', errors });
    }
  });

  router.delete('/:model/:id', async (req, res) => {
    try {
      const actor = getActor(req);
      const modelKey = String(req.params.model || '');
      const crud = new CrudService({ services });

      const originChain = getOriginChain(req);
      const parentEventId = getParentEventId(req);
      await crud.delete({
        modelKey,
        id: req.params.id,
        actor,
        origin: getOrigin(req),
        ...(originChain ? { originChain } : {}),
        ...(parentEventId != null ? { parentEventId } : {}),
        options: { services: getServicesForPipeline(req) },
      });

      return res.ok({ ok: true }, { code: 200, pagination: null });
    } catch (e: any) {
      if (e instanceof CrudForbiddenError) {
        const hCode = httpDenyCode(getConfig(), 'single');
        return res.fail({ code: hCode, message: hCode === 404 ? 'Not found' : e.message, errors: { root: 'Forbidden' } });
      }
      if (e instanceof CrudNotFoundError) {
        return res.fail({ code: 404, message: e.message, errors: { root: 'Not found' } });
      }
      const code = (e && typeof e === 'object' && (e as any).code) || 500;
      const errors = (e && typeof e === 'object' && (e as any).errors) || { root: 'Error' };
      return res.fail({ code, message: e?.message || 'Error', errors });
    }
  });

  return router;
}
