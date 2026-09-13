import crypto from 'node:crypto';

import type { PipelineCtx } from '@enginehq/core';

/**
 * Hashes a plain-text password using PBKDF2-SHA256.
 * Parameters are compatible with the verifyPasswordHash function below.
 */
export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = 100_000;
  const keylen = 64;
  const digest = 'sha256';
  const derived = crypto.pbkdf2Sync(plain, salt, iterations, keylen, digest).toString('hex');
  return `pbkdf2:${digest}:${iterations}:${salt}:${derived}`;
}

/**
 * Returns true if the plain-text password matches the stored hash.
 */
export function verifyPasswordHash(plain: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') return false;
  const [, digest, iterStr, salt, expected] = parts;
  const iterations = Number(iterStr);
  if (!digest || !salt || !expected || !iterations) return false;
  const derived = crypto.pbkdf2Sync(plain, salt, iterations, 64, digest).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Pipeline op that hashes a virtual password field before persist. Declare it in
 * create.beforePersist and update.beforePersist as { "op": "custom", "name": "hashPassword" }.
 * Optional args: from (default 'password') and to (default 'password_hash').
 * The op changes ctx.input in place, because the pipeline engine ignores its return value.
 */
export function hashPasswordOp(ctx: PipelineCtx, args?: { from?: string; to?: string }): void {
  const from = args?.from ?? 'password';
  const to = args?.to ?? 'password_hash';
  const plain = ctx.input[from];
  if (typeof plain === 'string' && plain) ctx.input[to] = hashPassword(plain);
  delete ctx.input[from];
}
