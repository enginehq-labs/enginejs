import type { EngineRuntime } from '@enginehq/core';

export default async function registerPipelineOps({ engine }: { engine: EngineRuntime }) {
    engine.services.register('pipelines.custom.recordClick', 'singleton', () => {
        return async (ctx: any, args: any) => {
            try {
                const crud = engine.services.resolve<any>('crudService', { scope: 'singleton' });
                
                let httpCtx = null;
                if (typeof ctx.services.resolve === 'function') {
                     // Custom services provider from redirect route usually has a safe resolve or we can try/catch
                     try {
                        httpCtx = ctx.services.resolve('http.context', { scope: 'request' });
                     } catch {}
                } else if (ctx.services.has('http.context')) {
                     httpCtx = ctx.services.get('http.context');
                }

                if (!httpCtx) {
                    console.log('[pipeline] recordClick skipped: http.context missing');
                    return { output: ctx.input };
                }

                console.log('[pipeline] recordClick: found http.context');
                const { req } = httpCtx || {};
                
                const ip = req?.ip || '0.0.0.0';
                const userAgent = req?.get('user-agent') || 'unknown';
                const referrer = req?.get('referrer') || 'none';
                const linkId = ctx.input.id;

                console.log('[pipeline] recordClick starting', { linkId });

                await crud.create({
                    modelKey: 'analytics_event',
                    actor: { isAuthenticated: true, roles: ['system'], claims: { system: true } },
                    values: {
                        ip,
                        userAgent,
                        referrer,
                        link: linkId,
                        timestamp: new Date()
                    },
                    options: {
                        bypassAclRls: true
                    }
                });
                console.log('[pipeline] recordClick success');
            } catch (e) {
                console.error('[pipeline] recordClick error', e);
            }

            return { output: ctx.input };
        };
    });
}