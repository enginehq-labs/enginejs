export default {
    slug: 'aggregate-clicks',
    name: 'Aggregate Clicks',
    description: 'Increments the total_clicks counter on a Link when an AnalyticsEvent is created.',
    triggers: [
        {
            type: 'model',
            model: 'analytics_event',
            actions: ['create']
        }
    ],
    actorMode: 'system',
    steps: [
        {
            op: 'custom',
            name: 'incrementClickCounter'
        }
    ]
} as const;
