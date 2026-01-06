# Examples

## `hello-enginejs-app`

Scaffolded via the `enginehq` CLI:

```sh
node ../enginehq/bin/enginehq.js init hello-enginejs-app --force
```

Run it:

```sh
cd hello-enginejs-app
npm i
export DATABASE_URL="postgres://postgres:postgres@localhost:5432/postgres"
npm run dev
```

Try:

- `GET http://localhost:3000/health`
- `GET http://localhost:3000/api/hello`

