import type { NextFunction, Request, Response } from 'express';

export type Pagination = {
  limit: number;
  totalCount: number;
  totalPages: number;
  currentPage: number;
  nextPage: number | null;
  previousPage: number | null;
};

export type OkOptions = {
  code?: number;
  pagination?: Pagination | null;
};

export type FailPayload = {
  code: number;
  message: string;
  errors?: Record<string, unknown>;
};

declare global {
  namespace Express {
    interface Response {
      ok: (data: unknown, opts?: OkOptions) => Response;
      fail: (payload: FailPayload) => Response;
    }
  }
}

export function responseEnvelope(req: Request, res: Response, next: NextFunction) {
  void req;

  res.ok = (data: unknown, opts?: OkOptions) => {
    const code = opts?.code ?? 200;
    return res.status(code).json({
      success: true,
      code,
      data,
      pagination: opts?.pagination ?? null,
    });
  };

  res.fail = (payload: FailPayload) => {
    const code = payload.code ?? 500;
    return res.status(code).json({
      success: false,
      code,
      errors: payload.errors ?? { root: payload.message },
      message: payload.message,
    });
  };

  next();
}
