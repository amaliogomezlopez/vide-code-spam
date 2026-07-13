# Publishing a clean public repository

The public repository should be created from a clean source snapshot, not by
making the development repository public. This avoids transferring its Git
history while preserving the auditable source tree.

## 1. Export the source snapshot

Run from the private development checkout:

```powershell
.\scripts\export-public-snapshot.ps1 -Destination D:\VIBE-SPAM-PUBLIC
```

The script exports only files tracked by the current `HEAD`, excludes `.git`,
the private-checkout `AGENTS.md`, build outputs and local configuration, scans
the result for common secret file names and initializes a new repository with
one root commit. Review that commit manually before any push.

## 2. Create the GitHub repository

Create an empty public repository without a generated README, license or
`.gitignore`, then add it as `origin` in the exported directory and push
`main`.

## 3. Protect `main`

In **Settings → Branches → Add branch protection rule**, target `main` and
enable:

- require a pull request before merging;
- require one approval and dismiss stale approvals;
- require status checks: all `CI` jobs and both `CodeQL` analyses;
- require branches to be up to date;
- require conversation resolution;
- block force pushes and deletion;
- include administrators once the initial import is complete.

Also enable **Settings → Security → Code security**:

- Dependency graph and Dependabot alerts;
- Dependabot security updates;
- Code scanning with the committed CodeQL workflow;
- secret scanning and push protection;
- private vulnerability reporting.

GitHub settings are server-side and cannot be encoded completely in Git. They
must be enabled after the new public repository exists. With GitHub CLI already
authenticated, the repeatable portion can be applied with:

```powershell
.\scripts\configure-public-github.ps1 -Repository OWNER/REPOSITORY
```

Run it only after `main` and the workflow files have been pushed. Then verify
the named checks and secret-scanning availability in the GitHub UI.

## 4. Publish unsigned Windows artifacts

Unsigned publication is an explicit project decision for the initial release:

```powershell
.\scripts\build-windows-installer.ps1 -AllowUnsigned
.\scripts\build-windows-installer.ps1 -Cuda -AllowUnsigned
```

Release notes must state that SmartScreen can warn, link to
`docs/KNOWN_LIMITATIONS.md`, and publish SHA-256 values. Do not claim that the
release is signed or advise users to disable SmartScreen.

## 5. Release gate

Complete `docs/RELEASE_CHECKLIST.md` after downloading the release artifacts
from GitHub onto a clean Windows machine. Linux and macOS remain experimental
until they pass equivalent real-device tests.
