import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function runCapture(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  const out = String(res.stdout || '') + String(res.stderr || '');
  if (out) process.stdout.write(out);
  return { status: res.status ?? 1, out };
}

function writeFailureLog(text) {
  const dir = path.join(repoRoot, '.enginejs');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'last-failure.log');
  fs.writeFileSync(p, text);
  return p;
}

const steps = [
  { cmd: 'node', args: ['tools/gen.mjs'], name: 'gen' },
  { cmd: 'npm', args: ['test'], name: 'test' },
];

let combined = '';
for (const s of steps) {
  const { status, out } = runCapture(s.cmd, s.args, repoRoot);
  combined += `\n\n### ${s.name}\n` + out;
  if (status !== 0) {
    const logPath = writeFailureLog(combined);
    console.error(`FAILED: ${s.name}. See ${logPath}`);
    process.exit(status || 1);
  }
}

console.log('OK: cycle complete');

