/**
 * Shared Docker Postgres helper for integration tests.
 *
 * Starts a single Postgres container lazily on first call to `getSharedPgPort()`
 * and reuses it for the lifetime of the test process. Each test should use a
 * unique database name; call `ensurePgDatabase` before connecting.
 * The container is removed automatically on process exit.
 */
import { execFileSync, execSync } from 'node:child_process';

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export async function waitFor<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  const started = Date.now();
  let lastErr: unknown = null;
  while (Date.now() - started < timeoutMs) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await sleep(250);
    }
  }
  throw lastErr ?? new Error('Timed out');
}

function isTruthy(v: unknown): boolean {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

let sharedContainerId: string | null = null;
let sharedPort: number | null = null;

export function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function ensureDockerImage(image: string): boolean {
  try {
    execFileSync('docker', ['image', 'inspect', image], { stdio: 'ignore' });
    return true;
  } catch {}

  if (!isTruthy(process.env.ENGINEJS_DOCKER_PULL)) return false;

  const timeoutMs = Number(process.env.ENGINEJS_DOCKER_PULL_TIMEOUT_MS || 30_000);
  try {
    execFileSync('docker', ['pull', image], { stdio: 'pipe', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the host port of the shared Postgres container, starting it if needed.
 * The container accepts any database name — callers create databases as needed.
 */
export function getSharedPgPort(image: string, password: string): number {
  if (sharedPort !== null) return sharedPort;

  const timeoutMs = Number(process.env.ENGINEJS_DOCKER_RUN_TIMEOUT_MS || 10_000);
  // Start the container without a specific DB so any DB can be created via sequelize.sync
  const id = execFileSync(
    'docker',
    [
      'run',
      '-d',
      '--rm',
      '-e',
      `POSTGRES_PASSWORD=${password}`,
      '-p',
      '127.0.0.1::5432',
      image,
    ],
    { encoding: 'utf8', timeout: timeoutMs },
  ).trim();

  const portLine = execFileSync('docker', ['port', id, '5432/tcp'], { encoding: 'utf8' }).trim();
  const portStr = portLine.split(':').pop();
  const port = Number(portStr);
  if (!Number.isFinite(port) || port <= 0) throw new Error(`Failed to parse docker port: ${portLine}`);

  sharedContainerId = id;
  sharedPort = port;

  // Clean up on process exit
  process.on('exit', stopSharedContainer);
  process.on('SIGINT', () => { stopSharedContainer(); process.exit(130); });
  process.on('SIGTERM', () => { stopSharedContainer(); process.exit(143); });

  return port;
}

function stopSharedContainer(): void {
  if (!sharedContainerId) return;
  try {
    execSync(`docker rm -f ${sharedContainerId}`, { stdio: 'ignore' });
  } catch {}
  sharedContainerId = null;
  sharedPort = null;
}

/**
 * Creates a named database inside the shared container, retrying until Postgres
 * accepts connections (up to `timeoutMs`). Must be called after `getSharedPgPort()`.
 * Blocks synchronously — call before creating the engine / Sequelize pool.
 */
export function ensurePgDatabase(dbName: string, timeoutMs = 30_000): void {
  if (!sharedContainerId) throw new Error('Call getSharedPgPort() first to start the container');
  const containerId = sharedContainerId;
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      execFileSync(
        'docker',
        ['exec', containerId, 'psql', '-U', 'postgres', '-c', `CREATE DATABASE "${dbName}";`],
        { stdio: 'pipe' },
      );
      return; // success
    } catch (e: any) {
      const msg = String(e?.stderr ?? e?.message ?? '');
      if (msg.includes('already exists')) return; // idempotent OK
      lastErr = e;
      // Postgres not ready yet — sleep 250 ms and retry
      const end = Date.now() + 250;
      while (Date.now() < end) { /* busy-wait */ }
    }
  }
  throw lastErr ?? new Error(`Timed out waiting for Postgres to create database "${dbName}"`);
}
