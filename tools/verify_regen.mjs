import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs
    .readdirSync(src, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const ent of entries) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else if (ent.isFile()) fs.copyFileSync(s, d);
  }
}

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (res.status !== 0) {
    const joined = [cmd, ...args].join(' ');
    throw new Error(`Command failed (${res.status}): ${joined}`);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'enginejs-regen-'));
const tempRoot = path.join(tmp, 'repo');
fs.mkdirSync(tempRoot, { recursive: true });

// Clean-room: start from specs only.
copyDir(path.join(repoRoot, 'specs'), path.join(tempRoot, 'specs'));

const manifestPath = path.join(tempRoot, 'specs', 'templates', 'manifest.json');
const manifest = readJson(manifestPath);
void manifest;

const tplRoot = path.join(tempRoot, 'specs', 'templates');

// Bootstrap tools (includes tools/gen.mjs), then generate outputs from templates.
if (fs.existsSync(path.join(tplRoot, 'tools'))) {
  copyDir(path.join(tplRoot, 'tools'), path.join(tempRoot, 'tools'));
}
run('node', ['tools/gen.mjs'], tempRoot);

// Install + build + test in reconstructed repo.
run('npm', ['ci'], tempRoot);
run('npm', ['run', 'build'], tempRoot);
run('npm', ['run', 'test:unit'], tempRoot);
run('npm', ['run', 'test:integration'], tempRoot);

// Template cohesion check should pass in clean-room output too.
run('node', ['tools/verify_templates.mjs'], tempRoot);

console.log(`OK: clean-room regeneration succeeded at ${tempRoot}`);
