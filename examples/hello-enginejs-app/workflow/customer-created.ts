export default {
  name: 'customer-created',
  triggers: [{ type: 'model', model: 'customer', actions: ['create'] }],
  steps: [{ op: 'log', message: 'customer created' }],
} as const;
