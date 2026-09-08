# Staged releases to npm

The repository uses two GitHub Actions workflows:

- `ci.yml` checks every pull request and every push to `main`.
- `release.yml` stages a package when a matching `v*` Git tag is pushed.

Publishing uses npm Trusted Publishing (OIDC). No long-lived `NPM_TOKEN` is
stored in GitHub. A maintainer reviews every staged artifact and approves it
with 2FA before the version becomes public.

## One-time bootstrap

Trusted and staged publishing can only be configured after the package exists
on the npm registry. A brand-new package therefore needs one direct bootstrap
publish from an authenticated maintainer machine:

```bash
npm whoami
npm ci
npm test
npm publish --access public
```

For this repository, `@jujuleaf/worker@0.1.0` completed that bootstrap.

Next, open the package on npmjs.com, go to **Settings → Trusted Publisher**, and
add a GitHub Actions publisher with these exact values:

| Field | Value |
| --- | --- |
| Organization or user | `CsomePro` |
| Repository | `jujuleaf-worker` |
| Workflow filename | `release.yml` |
| Environment | Leave empty |
| Allowed action | Enable only `npm stage publish` |

The workflow filename is only the filename, not `.github/workflows/release.yml`.
All values are case-sensitive.

After one successful staged release, go to **Settings → Publishing access** and
select **Require two-factor authentication and disallow tokens**. This keeps
interactive account changes protected while allowing the trusted workflow to
stage releases.

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
creates a matching tag such as `v0.1.1`. Pushing that tag starts the staging
workflow.

The release workflow verifies that the Git tag exactly matches the version in
`package.json`, installs from the lockfile, type-checks, tests, inspects the
package archive, and submits it to npm's staging area. A version already public
on npm is a safe no-op.

## Review and approve

Open **Staged Packages** on npmjs.com, inspect the staged version, and click
**Approve**. npm requires 2FA at approval time.

The same review can be performed with npm 11.15 or newer:

```bash
npm stage list @jujuleaf/worker
npm stage view STAGE_ID
npm stage download STAGE_ID
npm stage approve STAGE_ID
```

The last command promotes the reviewed artifact to the public registry.

## Verify a release

```bash
npm view @jujuleaf/worker version
npx @jujuleaf/worker@latest --help
```

Also check the **Actions** tab on GitHub. Public packages published from this
public repository through Trusted Publishing receive npm provenance
automatically.
