# Releasing to npm

The repository uses two GitHub Actions workflows:

- `ci.yml` checks every pull request and every push to `main`.
- `release.yml` publishes a package when a matching `v*` Git tag is pushed.

Publishing uses npm Trusted Publishing (OIDC). No long-lived `NPM_TOKEN` is
stored in GitHub.

## One-time bootstrap

Trusted Publishing can only be configured after the package exists on the npm
registry. Publish the first version from an authenticated maintainer machine:

```bash
npm whoami
npm ci
npm test
npm publish --access public
```

For this repository, that initial package is `@jujuleaf/worker@0.1.0`.

Next, open the package on npmjs.com, go to **Settings → Trusted Publisher**, and
add a GitHub Actions publisher with these exact values:

| Field | Value |
| --- | --- |
| Organization or user | `CsomePro` |
| Repository | `jujuleaf-worker` |
| Workflow filename | `release.yml` |
| Environment | Leave empty |
| Allowed action | Enable `npm publish` |

The workflow filename is only the filename, not `.github/workflows/release.yml`.
All values are case-sensitive.

After one successful OIDC release, go to **Settings → Publishing access** and
select **Require two-factor authentication and disallow tokens**. This keeps
interactive account changes protected while allowing the trusted workflow to
publish.

## Publish a new version

Start from an up-to-date, clean `main` branch, then choose the appropriate
semantic version bump:

```bash
npm test
npm version patch
git push origin main --follow-tags
```

Use `npm version minor` or `npm version major` when appropriate. `npm version`
updates `package.json` and `package-lock.json`, creates a release commit, and
creates a matching tag such as `v0.1.1`. Pushing that tag starts the publish
workflow.

The release workflow verifies that the Git tag exactly matches the version in
`package.json`, installs from the lockfile, type-checks, tests, inspects the
package archive, and then publishes. Re-running a release for a version already
on npm is a safe no-op.

## Verify a release

```bash
npm view @jujuleaf/worker version
npx @jujuleaf/worker@latest --help
```

Also check the **Actions** tab on GitHub. Public packages published from this
public repository through Trusted Publishing receive npm provenance
automatically.
