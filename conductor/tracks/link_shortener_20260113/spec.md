# Track Spec: Link Shortener with Analytics Example

## Overview
This track involves creating a standalone example project at `examples/link-shortener` that demonstrates the core capabilities of the EngineJS framework. The project will implement a robust link shortener system with integrated analytics, utilizing the Schema-as-Code DSL, durable workflows, and pluggable pipelines.

## Functional Requirements
1. **Core Entities (DSL):**
    - `User`: Standard user model for link ownership.
    - `Link`: Stores original URL, a unique short `slug`, `title`, and owner reference.
    - `AnalyticsEvent`: Records click details including `ip`, `userAgent`, `referrer`, and `timestamp`.
    - `Tag`: Allows categorization of links.
2. **Redirection Logic:**
    - Custom route `/r/:slug` to resolve short links.
    - Redirects the user to the original URL with a `302 Found` status.
3. **Analytics Recording (Pipeline):**
    - Implement a `response` phase pipeline on the redirection route.
    - Asynchronously record an `AnalyticsEvent` for every successful redirection.
4. **Analytics Aggregation (Workflows):**
    - Demonstrate durable workflows by using the outbox pattern to process click events.
    - (Optional) Use a workflow to update a `total_clicks` counter on the `Link` model.
5. **API Interface:**
    - Demonstrate generic HTTP CRUD for managing Links, Tags, and viewing Analytics.
    - Secure management endpoints using ACL/RLS (only owners can view analytics for their links).

## Technical Requirements
- **Location:** `examples/link-shortener/`
- **Framework:** EngineJS (Core + Express + Auth).
- **Database:** PostgreSQL.
- **Documentation:** Include a README within the example folder explaining the implementation of pipelines and workflows.

## Acceptance Criteria
- A standalone, runnable EngineJS application exists in the `examples/` folder.
- Users can create short links via the API.
- Navigating to a short link successfully redirects to the target URL.
- Every redirection triggers the creation of an analytics record.
- Analytics data is queryable via the API.
- The example clearly showcases the use of DSL, Pipelines, and Workflows.

## Out of Scope
- A graphical user interface (Frontend).
- Advanced geo-location resolution for IP addresses.
- Rate limiting or spam prevention (beyond default framework capabilities).
