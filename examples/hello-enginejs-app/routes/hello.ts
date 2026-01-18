export const path = '/api';

export default function register({ app }: any) {
  app.get('/hello', (_req: any, res: any) => res.ok({ message: 'hello from enginejs app' }));
}
