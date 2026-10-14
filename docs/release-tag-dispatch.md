# Release Tag Dispatch Workflow

When creating a new tag using the repository’s default `GITHUB_TOKEN` to perform tasks on behalf of GitHub Actions, events triggered by the `GITHUB_TOKEN` **will not** start a new workflow run.
To work around this, you can set up an **SSH key** to fetch the repository in the pipeline instead of relying on `GITHUB_TOKEN`.

## Repository workflow

`.github/workflows/release-tag-changelog.yml` builds and runs the local release-tag package with `pnpm release-tag`. It signs the release commit, creates and labels the release-candidate PR, merges it, and deletes the changelog branch after a successful merge. Appended tag signatures are removed from generated PR descriptions.

The Git preflight preserves the `core.sshCommand` configured by `actions/checkout`, so the same deploy key is used for the authentication probe and subsequent pushes.

The built-in `GITHUB_TOKEN` is an App installation token. Repository metadata may omit `permissions` or report `permissions.push: false` for this token even when the workflow grants write access. Preflight confirms the token type with a read-only installation probe; the workflow grants `contents: write`, `issues: write`, and `pull-requests: write` for the release requests. That probe is fail-fast only: it does not prove write permission on every endpoint the run will touch, and GitHub still enforces each permission when the PR is created, labeled, merged, or deleted.

Serialize releases so only one runs at a time, and never cancel an active release mid-push: branch cleanup is a non-atomic GET-then-DELETE without a SHA lease, a cancelled job can strand a pushed branch or tag, and there is no distributed release lock. Add a concurrency guard to any workflow that runs the release step:

```yaml
concurrency:
  group: release-tag
  cancel-in-progress: false
```

When the release step fails after the branch or tag exists, recover without rerunning the release or deleting the tag: inspect the stranded state with `git status --short --branch`, `git show-ref`, and `git ls-remote origin`, then resume only the PR step from the verified local identity:

```sh
repo-toolkit-release-tag --only pr --tag 1.2.3 --base-branch main --auto-merge-pr --delete-merged-branch
```

Release tags are immutable; choosing a new version is always preferred over deleting or overwriting a tag. A retry that reruns the full release against an existing target tag is correctly refused.

The workflow uses these repository secrets:

| Secret                    | Purpose                                              |
| ------------------------- | ---------------------------------------------------- |
| `SSH_KEY`                 | Git authentication for branch and tag pushes.        |
| `RELEASE_GPG_PRIVATE_KEY` | ASCII-armored private key for release signing.       |
| `RELEASE_GPG_PASSPHRASE`  | Key passphrase; may be empty for an unprotected key. |
| `RELEASE_USER_EMAIL`      | Git author email associated with the signing key.    |

The built-in `GITHUB_TOKEN` is passed through the environment for GitHub API requests. The private key is imported through stdin into a temporary `GNUPGHOME` under `RUNNER_TEMP` with owner-only permissions, then removed from the release command's environment. The signing wrapper passes the passphrase through a file descriptor. The GPG agent is stopped and the temporary keyring is removed when the step exits.

## Steps

1. **Generate a new OpenSSH key**:

   ```sh
   ssh-keygen -t ed25519 -f id_ed25519 -N "" -q -C ""
   ```

   This creates:
   - A private key file: `id_ed25519`
   - A public key file: `id_ed25519.pub`
     in the current working directory.

2. **Add the private key** to the repository’s **Secrets** in GitHub.
   - Name it: `SSH_KEY`

3. **Add the public key** to the repository’s **Deploy Keys** in GitHub.
   - Name it: `SSH_KEY`
   - Enable `Allow write access` if you plan to push changes.

4. Update Repository Settings
   1. Go to your GitHub repository.
   2. Click **Settings** (top tab) -> **Actions** -> **General**.
   3. Scroll down to **Workflow permissions**.
   4. Toggle the checkbox: **"Allow GitHub Actions to create and approve pull requests"**.
   5. Click **Save**.

5. **Update your GitHub Actions workflow** to use the SSH key:
   ```yaml
   jobs:
     tag-changelog:
       runs-on: ubuntu-22.04
       permissions:
         contents: write
         issues: write
         pull-requests: write
       steps:
         - uses: actions/checkout@v4
           with:
             ssh-key: ${{ secrets.SSH_KEY }}
             fetch-depth: 0
   ```
