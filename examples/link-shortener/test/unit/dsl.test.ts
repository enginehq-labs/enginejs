import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

test('DSL: Core Models Exist', () => {
    const dslDir = path.resolve(process.cwd(), 'examples/link-shortener/dsl/models');
    
    const models = ['user.json', 'link.json', 'tag.json', 'analytics_event.json'];
    
    for (const model of models) {
        const filePath = path.join(dslDir, model);
        assert.ok(fs.existsSync(filePath), `Model ${model} should exist`);
        
        // Basic JSON validation
        const content = fs.readFileSync(filePath, 'utf-8');
        try {
            JSON.parse(content);
        } catch (e) {
            assert.fail(`Model ${model} contains invalid JSON`);
        }
    }
});
