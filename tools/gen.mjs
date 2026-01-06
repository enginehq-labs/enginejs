import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function removePath(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyManifestList({ tplBase, outBase, relPaths }) {
  for (const rel of relPaths) {
    const src = path.join(tplBase, rel);
    const dst = path.join(outBase, rel);
    ensureDir(path.dirname(dst));
    fs.copyFileSync(src, dst);
  }
}

const args = new Set(process.argv.slice(2));
const doClean = args.has('--clean');

const manifestPath = path.join(repoRoot, 'specs', 'templates', 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`Missing manifest: ${manifestPath}`);
  process.exit(2);
}

const manifest = readJson(manifestPath);
const tplRoot = path.join(repoRoot, 'specs', 'templates');

function getWorkspaceKeys(templates) {
  return Object.keys(templates || {})
    .filter((k) => k !== 'root' && k !== 'tools')
    .sort((a, b) => a.localeCompare(b));
}

if (doClean) {
  // Do not remove specs/ or tools/; gen must be callable.
  for (const k of getWorkspaceKeys(manifest.templates)) {
    removePath(path.join(repoRoot, k));
  }
  for (const rel of manifest.templates?.root || []) {
    removePath(path.join(repoRoot, rel));
  }
}

// Root files
copyManifestList({
  tplBase: path.join(tplRoot, 'root'),
  outBase: repoRoot,
  relPaths: manifest.templates?.root || [],
});

// Workspace packages
for (const k of getWorkspaceKeys(manifest.templates)) {
  copyManifestList({
    tplBase: path.join(tplRoot, k),
    outBase: path.join(repoRoot, k),
    relPaths: manifest.templates?.[k] || [],
  });
}

// Tools
if (manifest.templates?.tools?.length) {
  copyManifestList({
    tplBase: path.join(tplRoot, 'tools'),
    outBase: path.join(repoRoot, 'tools'),
    relPaths: manifest.templates.tools,
  });
}

console.log('OK: generated outputs from specs/templates');
