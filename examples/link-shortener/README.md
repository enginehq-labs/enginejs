# Link Shortener with Analytics Example

A complete example of a link shortener application built with EngineJS. This project demonstrates core EngineJS features including:

- **DSL Models:** Defining schema for `Link`, `User`, and `AnalyticsEvent`.
- **Pipelines:** Custom operations to record analytics on link access.
- **Workflows:** Durable workflows for aggregating click counts.
- **Security:** ACL & RLS policies to secure data per user.
- **Custom Routes:** Handling short link redirection.

## Features

- **Shorten Links:** Create unique short slugs for long URLs.
- **Redirection:** Fast redirection via `/r/:slug`.
- **Analytics:** Tracks clicks, IP, User-Agent, and Referrer.
- **Aggregation:** Background workflow aggregates total clicks per link.
- **Security:**
    - Only authenticated users can manage links.
    - Users can only see their own links and analytics.
    - Public access for redirection.

## Setup

1.  **Install dependencies:**
    ```sh
    npm install
    ```

2.  **Configure Database:**
    Update `enginejs.config.ts` if you need to change the database connection (defaults to local Postgres):
    ```ts
    db: { url: process.env.DATABASE_URL || 'postgres://...' }
    ```

3.  **Sync Database Schema:**
    ```sh
    npm run sync
    ```

4.  **Sync Workflows:**
    ```sh
    npm run workflows:sync
    ```

## Running the App

1.  **Start the Server:**
    ```sh
    npm run dev
    ```
    The server will start on `http://localhost:3000`.

2.  **Run Workflow Worker:**
    (Open a new terminal)
    ```sh
    npm run workflows:run
    ```
    This processes background tasks like click aggregation.

## Usage API

Generic CRUD is mounted at `/api/crud`, not at `/api`.

The `link` and `analytics_event` models grant access to the `user` role only, so
those requests need an `Authorization: Bearer <token>` header. The `user` model is
open. This example has no login endpoint, so mint a token with
`signActorAccessTokenHS256` from `@enginehq/auth`, using the secret in
`JWT_SECRET` and `roles: ['user']`.

- **Create User:**
  `POST /api/crud/user`
  ```json
  { "email": "me@example.com" }
  ```

- **Create Link:** (needs a bearer token)
  `POST /api/crud/link`
  ```json
  { "slug": "my-link", "url": "https://google.com" }
  ```
  The RLS create policy sets `owner` from the token, so do not send it.

- **Visit Link:**
  Open `http://localhost:3000/r/my-link` in your browser. No token is needed, because
  a redirect is public.

- **View Analytics:** (needs a bearer token)
  `GET /api/crud/analytics_event?filters=link:1`

## Testing

Run the integration tests:

```sh
node --import tsx --test test/integration/*.test.ts
```
