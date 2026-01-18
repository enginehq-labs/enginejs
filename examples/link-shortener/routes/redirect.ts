import type { Express } from 'express';
import type { EngineRuntime, CrudService } from '@enginehq/core';

export default async function registerRedirectRoutes({ app, engine }: { app: Express, engine: EngineRuntime }) {
    app.get('/r/:slug', async (req, res) => {
        const { slug } = req.params;
        const crud = engine.services.resolve<CrudService>('crudService', { scope: 'singleton' });
        
        try {
            // Define a services provider that includes http.context
            const servicesProvider = {
                has: (name: string) => name === 'http.context' || engine.services.has(name),
                get: (name: string) => engine.services.resolve(name, { scope: 'singleton' }),
                resolve: (name: string, ctx: any) => {
                    if (name === 'http.context') return { req, res };
                    return engine.services.resolve(name, ctx);
                }
            } as any;

            // Find the link by slug using CrudService.list.
            const listResult = await crud.list({
                modelKey: 'link',
                query: { filters: `slug:${slug}`, limit: 1 },
                actor: (req as any).actor,
                options: { 
                    runPipelines: false,
                    services: servicesProvider,
                    bypassAclRls: true
                }
            });

            if (listResult.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Link not found' });
            }

            const link = listResult.rows[0];

            // Use CrudService.read to trigger the 'read' pipeline automatically.
            const linkData = await crud.read({
                modelKey: 'link',
                id: link.id,
                actor: (req as any).actor,
                options: {
                    services: servicesProvider,
                    bypassAclRls: true
                }
            });

            console.log('[redirect] found link', linkData);
            return res.redirect(302, linkData.url as string);
        } catch (e: any) {
            console.error('[redirect] error', e);
            const status = e.name === 'CrudNotFoundError' ? 404 : (e.code || 500);
            return res.status(status).json({ success: false, message: e.message || 'Internal server error' });
        }
    });
}