export default {
  slug: 'customer-created',
  name: 'Customer Created',
  description: 'Runs when a customer is created.',
  triggers: [{ type: 'model', model: 'customer', actions: ['create'] }],
  steps: [{ op: 'log', message: 'customer created' }],
} as const;
