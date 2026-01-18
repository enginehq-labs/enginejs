import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

test('Scaffolding: Core files exist', () => {
    const projectRoot = path.resolve(process.cwd(), 'examples/link-shortener');
    
    const packageJsonPath = path.join(projectRoot, 'package.json');
    assert.ok(fs.existsSync(packageJsonPath), 'package.json should exist');

    const configPath = path.join(projectRoot, 'enginejs.config.ts');
    assert.ok(fs.existsSync(configPath), 'enginejs.config.ts should exist');
});
