import type { EngineRuntime } from '@enginehq/core';

export default async function registerWorkflowSteps({ engine }: { engine: EngineRuntime }) {
    engine.services.register('workflows.step.incrementClickCounter', 'job', () => {
        return async ({ event }: { event: any }) => {
            const orm = engine.services.resolve<any>('orm', { scope: 'singleton' });
            if (!orm || !orm.models.link) {
                console.error('[workflow] Link model not found');
                return;
            }

            const analyticsEvent = event.after;
            const linkId = analyticsEvent.link;

            if (!linkId) {
                console.warn('[workflow] No link ID found in AnalyticsEvent', analyticsEvent.id);
                return;
            }

            const link = await orm.models.link.findByPk(linkId);
            if (!link) {
                console.warn('[workflow] Link not found', linkId);
                return;
            }

            const currentClicks = link.get().total_clicks || 0;
            await orm.models.link.update(
                { total_clicks: currentClicks + 1 },
                { where: { id: linkId } }
            );
        };
    });
}
