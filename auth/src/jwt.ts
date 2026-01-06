import crypto from 'node:crypto';

function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64urlJson(obj: unknown): string {
  return base64url(Buffer.from(JSON.stringify(obj), 'utf8'));
}

function decodeBase64urlJson<T>(s: string): T {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const raw = padded + '='.repeat(padLen);
  const buf = Buffer.from(raw, 'base64');
  return JSON.parse(buf.toString('utf8')) as T;
}

function hmacSha256(secret: string, input: string): Buffer {
  return crypto.createHmac('sha256', secret).update(input).digest();
}

export type JwtHeader = { alg: 'HS256'; typ: 'JWT' };

export type JwtBody = Record<string, unknown> & {
  iat: number;
  exp: number;
};

export function parseDurationToSeconds(ttl: string): number {
  const s = String(ttl || '').trim().toLowerCase();
  const m = s.match(/^(\d+)\s*(s|m|h|d)$/);
  if (!m) throw new Error(`Invalid duration: ${ttl}`);
  const n = Number(m[1]);
  const unit = m[2];
  if (unit === 's') return n;
  if (unit === 'm') return n * 60;
  if (unit === 'h') return n * 3600;
  if (unit === 'd') return n * 86400;
  throw new Error(`Invalid duration: ${ttl}`);
}

export function signJwtHS256(body: Omit<JwtBody, 'iat' | 'exp'> & { iat?: number; exp?: number }, secret: string, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const iat = body.iat ?? now;
  const exp = body.exp ?? iat + ttlSeconds;
  const header: JwtHeader = { alg: 'HS256', typ: 'JWT' };
  const payload: JwtBody = { ...body, iat, exp };

  const h = base64urlJson(header);
  const p = base64urlJson(payload);
  const signingInput = `${h}.${p}`;
  const sig = base64url(hmacSha256(secret, signingInput));
  return `${signingInput}.${sig}`;
}

export function verifyJwtHS256<T extends JwtBody>(token: string, secret: string, nowSeconds?: number): T {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid token');
  const [h, p, sig] = parts as [string, string, string];
  const signingInput = `${h}.${p}`;
  const expected = base64url(hmacSha256(secret, signingInput));
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new Error('Invalid signature');

  const payload = decodeBase64urlJson<T>(p);
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) throw new Error('Token expired');
  if (typeof payload.iat !== 'number') throw new Error('Invalid token');
  return payload;
}

