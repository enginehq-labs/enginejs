import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readBytes(p) {
  return fs.readFileSync(p);
}

function normalizeRel(p) {
  return p.split(path.sep).join('/');
}

function compareFilePairs(pairs) {
  const mismatches = [];
  for (const { templatePath, targetPath } of pairs) {
    const tpl = readBytes(templatePath);
    const out = readBytes(targetPath);
    if (!tpl.equals(out)) {
      mismatches.push({
        template: normalizeRel(path.relative(repoRoot, templatePath)),
        target: normalizeRel(path.relative(repoRoot, targetPath)),
      });
    }
  }
  return mismatches;
}

const manifestPath = path.join(repoRoot, 'specs', 'templates', 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`Missing manifest: ${manifestPath}`);
  process.exit(2);
}

const manifest = readJson(manifestPath);
const tplRoot = path.join(repoRoot, 'specs', 'templates');

const filePairs = [];

for (const rel of manifest.templates?.root || []) {
  filePairs.push({
    templatePath: path.join(tplRoot, 'root', rel),
    targetPath: path.join(repoRoot, rel),
  });
}

for (const rel of manifest.templates?.tools || []) {
  filePairs.push({
    templatePath: path.join(tplRoot, 'tools', rel),
    targetPath: path.join(repoRoot, 'tools', rel),
  });
}

const workspaceKeys = Object.keys(manifest.templates || {})
  .filter((k) => k !== 'root' && k !== 'tools')
  .sort((a, b) => a.localeCompare(b));

for (const k of workspaceKeys) {
  for (const rel of manifest.templates?.[k] || []) {
    filePairs.push({
      templatePath: path.join(tplRoot, k, rel),
      targetPath: path.join(repoRoot, k, rel),
    });
  }
}

const missing = filePairs.filter(
  (p) => !fs.existsSync(p.templatePath) || !fs.existsSync(p.targetPath),
);
if (missing.length) {
  for (const m of missing) {
    if (!fs.existsSync(m.templatePath)) console.error(`Missing template: ${m.templatePath}`);
    if (!fs.existsSync(m.targetPath)) console.error(`Missing target: ${m.targetPath}`);
  }
  process.exit(3);
}

const mismatches = compareFilePairs(filePairs);
if (mismatches.length) {
  console.error('Template mismatch detected (specs/templates must match outputs):');
  for (const m of mismatches) console.error(`- ${m.template} != ${m.target}`);
  process.exit(1);
}

console.log(`OK: ${filePairs.length} files match templates`);
