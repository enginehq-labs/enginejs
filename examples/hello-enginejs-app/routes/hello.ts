export default function register({ app }: any) {
  app.get('/api/hello', (_req: any, res: any) => res.ok({ message: 'hello from enginejs app' }));
}
