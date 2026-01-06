# Releasing EngineJS

This repo is **specs-driven and deterministic**. Always regenerate from `specs/` before publishing.

## One-time setup

- Confirm auth:
  - `npm whoami`
  - `gh auth status`
- Confirm org access:
  - `npm org ls enginehq`

## Release checklist (vX.Y.Z)

1) Update versions (all workspaces)
   - Update `specs/templates/**/package.json` versions and internal deps.

2) Regenerate + run all tests + verify tarballs
   - `npm run release:check`

3) Publish to npm (dependency order)
   - `npm publish -w @enginehq/core --otp=<OTP>`
   - `npm publish -w @enginehq/auth --otp=<OTP>`
   - `npm publish -w @enginehq/express --otp=<OTP>`
   - `npm publish -w enginehq --otp=<OTP>`

Notes:
- This npm account has 2FA enabled for writes, so publishing requires an OTP.
- For first-time publishes, confirm name availability (e.g., `npm view enginehq` should 404 before publish).

4) Tag and push
   - `git tag -a vX.Y.Z -m "vX.Y.Z"`
   - `git push origin main --tags`

5) Create GitHub release
   - `gh release create vX.Y.Z --title "vX.Y.Z" --notes-file specs/99-changelog.md`

## CI/automation (future)

If you want non-interactive publishing:

- Create an npm **automation** token.
- Configure package-level MFA to allow automation publishing (per package, after first publish).

