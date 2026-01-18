import { startEngineJsApp } from 'enginehq/runtime/app';
import { createEngine } from '@enginehq/core';
import { createEngineExpressApp } from '@enginehq/express';
import { loadEngineJsConfig } from '../../enginehq/src/runtime/config.ts';
import { autoloadPipelines, autoloadRoutes, autoloadWorkflows } from '../../enginehq/src/runtime/autoload.ts';
import registerPipelineOps from './pipeline/ops.ts';
import registerWorkflowSteps from './workflow/steps.ts';
import registerRedirectRoutes from './routes/redirect.ts';

async function start() {
    const cwd = process.cwd();
    const cfg = await loadEngineJsConfig(cwd);
    const engine = createEngine(cfg.engine);
    
    // Register custom ops and steps BEFORE engine.init if needed, 
    // but usually plugins or manual registration happens around init.
    
    await engine.init();
    
    const services = engine.services;
    const workflows = services.resolve<any>('workflows', { scope: 'singleton' });

    // Register custom logic
    await registerPipelineOps({ engine });
    await registerWorkflowSteps({ engine });

    const autoload = cfg.autoload ?? {};
    await autoloadPipelines({ cwd, pipelinesDir: autoload.pipelinesDir ?? 'pipeline', services });
    await autoloadWorkflows({ cwd, workflowsDir: autoload.workflowsDir ?? 'workflow', registry: workflows });

    const app = createEngineExpressApp(engine);
    
    // Custom routes
    await registerRedirectRoutes({ app, engine });
    await autoloadRoutes({ cwd, routesDir: autoload.routesDir ?? 'routes', app, engine });

    const port = cfg.http.port || 3000;
    app.listen(port, () => {
        console.log(`[link-shortener] listening on :${port}`);
    });
}

start().catch(console.error);