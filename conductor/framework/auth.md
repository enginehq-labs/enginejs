# EngineJS Framework — Auth & Sessions

## Introduction
The Auth module (`@enginehq/auth`) provides a robust, identity-based authentication system for EngineJS. It utilizes JWT (JSON Web Tokens) with HS256 signing for stateless authentication and an optional session management system for stateful revocation and token rotation.

## Actor Identity
The core concept of authentication in EngineJS is the **`Actor`**. An actor represents the identity of the person or system making a request.
- **`isAuthenticated`**: Boolean flag.
- **`subjects`**: A map of identity references (e.g., `user:123`, `org:42`). These are used by the RLS engine to scope data access.
- **`roles`**: A list of role strings used by the ACL engine (e.g., `admin`, `editor`).
- **`claims`**: Arbitrary key-value pairs from the token payload.
- **`sessionId`**: (Optional) Reference to a stateful session.

## JWT Management
EngineJS uses self-contained JWTs for access tokens.

### Signing & Verification
- **Algorithm**: HMAC-SHA256 (HS256).
- **Signing**: Done via `signActorAccessTokenHS256`, which bundles the actor's identity into the token payload.
- **Verification**: Done via `verifyActorAccessTokenHS256`. It ensures the signature is valid, the token is not expired, and optionally validates the session against a store.

### Token TTL
Durations can be specified using human-readable strings:
- `s`: Seconds
- `m`: Minutes
- `h`: Hours
- `d`: Days

## Session Management (Optional)
For applications requiring stateful control over logins, EngineJS provides a `SessionService`.

### Refresh Tokens
- **Structure**: `<sessionId>.<random_bytes>`.
- **Hashing**: Refresh tokens are stored as SHA256 hashes in the session store to prevent exposure in case of database leaks.
- **Rotation**: Configurable token rotation on every use to mitigate replay attacks.

### Session Lifecycle
1. **Creation**: A session is created upon login, generating an access token and a refresh token.
2. **Verification**: Access tokens containing a `sid` (session ID) can be verified against the session store to check for revocation.
3. **Rotation**: The `rotateRefreshToken` method validates a refresh token and generates a new pair.
4. **Revocation**: Sessions can be revoked individually by ID or globally for a specific subject (e.g., "log out from all devices").

## Security Hardening
- **Timing-Safe Equality**: Signature verification uses `crypto.timingSafeEqual` to prevent timing attacks.
- **Stateless/Stateful Hybrid**: Access tokens are stateless for performance, but the inclusion of a `sid` allows for near-real-time revocation checks via middleware.
- **Subject Validation**: Verification ensures that the subjects in the JWT payload match the subjects associated with the stateful session record.
