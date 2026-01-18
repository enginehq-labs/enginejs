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

- **Create User:**
  `POST /api/user`
  ```json
  { "email": "me@example.com" }
  ```

- **Create Link:**
  `POST /api/link`
  ```json
  { "slug": "my-link", "url": "https://google.com", "owner": 1 }
  ```

- **Visit Link:**
  Open `http://localhost:3000/r/my-link` in your browser.

- **View Analytics:**
  `GET /api/analytics_event?filters=link:1`

## Testing

Run the integration tests:

```sh
node --import tsx --test test/integration/*.test.ts
```
