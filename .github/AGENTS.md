<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-20 | Updated: 2026-06-20 -->

# .github

## Purpose
Container for GitHub-specific configuration for the M4L QuickSearch project. Currently it holds only the `workflows/` subdirectory with the CI/CD release automation; there are no configuration files directly in this directory.

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `workflows/` | GitHub Actions workflows — release automation that builds and publishes the `.amxd` device (see [`workflows/AGENTS.md`](workflows/AGENTS.md)) |

## For AI Agents

### Working In This Directory
- This directory has no files of its own — do not create loose files here (e.g. `CODEOWNERS`, `FUNDING.yml`, `dependabot.yml`) unless there is an explicit requirement, since the project is a single-developer Max for Live device with no dependency-update needs.
- All substantive work is inside `workflows/`; navigate there for anything related to the release pipeline.

### Testing / Verifying Changes
- There is nothing to test at the `.github/` level directly.
- Changes to `workflows/release.yml` are verified by triggering the workflow on GitHub (push a tag that matches the release trigger pattern) and confirming the `.amxd` artifact is attached to the release.

### Common Patterns
- The only convention currently in use is a single release workflow. Keep the directory lean; add new workflow files under `workflows/` rather than adding GitHub App configuration or extra actions directories unless a concrete need arises.

## Dependencies

### Internal
- `tools/build.mjs` — the workflow invokes `npm run build` which calls this script to produce `dist/QuickSearch Dev.amxd` before the release artifact is uploaded.
- `package.json` — defines the `build` script and project version used by the release workflow.

### External
- **GitHub Actions** — the workflow runtime; no third-party actions beyond those already referenced in `workflows/release.yml`.

<!-- MANUAL: Notes added below this line are preserved on regeneration -->
