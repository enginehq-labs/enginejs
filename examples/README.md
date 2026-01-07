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
npx enginehq sync
npm run dev
```

Try:

- `GET http://localhost:3000/health`
- `GET http://localhost:3000/api/hello`

Notes:

- This example uses file-based workflows (`engine.workflows.registry` defaults to `fs`); see `specs/08-workflows-outbox.md` for DB-backed workflow storage and `enginehq workflows sync`.
