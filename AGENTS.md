# fee[dB]ack Mobile Edition Agent Guide

This repository assembles tested fee[dB]ack Core and plugin snapshots into a
self-contained mobile-focused distribution. It is a release repository, not
the primary feature-development repository for Core or the included plugins.

## Repository Documentation

- `docs/PROJECT.md` defines the Edition's purpose, goals, and boundaries.
- `docs/ENGINEERING.md` defines ownership, source-of-truth rules, and the
  development workflow.
- `docs/RELEASE.md` defines snapshot refresh, validation, and release steps.
- `README.md` covers user setup and operation.
- `RELEASE-MANIFEST.md` records the exact source inputs for the current
  Edition candidate.
- `ATTRIBUTIONS.md` records source and license information.
- `CLAUDE.md` is inherited Core implementation guidance. Read it only when a
  task concerns Core source behavior.

Read only the documentation relevant to the current task. When a prompt uses
`Start task`, `Implement task`, or `Review task`, follow the shortcut definition
in `docs/ENGINEERING.md`.

## Repository Role

The Edition owns:

- release packaging and setup
- pinned Core and plugin snapshots
- Edition documentation and release metadata
- attribution and license auditing
- clean-build and product-level release validation

Feature implementation belongs in its source repository:

- fee[dB]ack Core changes belong in the Core repository, normally on
  `mobile/main` or a focused feature branch.
- Mobile UI changes belong in the Mobile UI plugin repository.
- Section Map changes belong in the Section Map plugin repository.

Do not develop features by editing vendored files under `plugins/mobile_ui` or
`plugins/section_map`. Make and validate the change in the owning repository,
then refresh the Edition snapshot deliberately.

## Snapshot Rules

- Treat `RELEASE-MANIFEST.md` as the record of the exact source commits used.
- Vendor tracked source snapshots without nested `.git` directories, local
  handoffs, caches, build output, or unrelated workspace files.
- Preserve source license notices and attribution.
- Review the complete snapshot diff before accepting an update.
- Update the manifest in the same Edition change as the snapshot.
- Do not silently mix files from different source commits.

Upstream Core changes flow through the Core repository first:

```text
upstream Core -> Core mobile/main -> tested Mobile Edition snapshot
```

Plugin changes follow the equivalent source-repository-to-snapshot flow.

## Data Protection

Never add any of the following to the repository or image build context:

- song libraries or generated audio
- user profiles or statistics
- secrets, tokens, certificates, or private URLs
- local configuration or `.env` files
- caches, diagnostics, recordings, or personal test artifacts

The release Compose path must keep songs and configuration in external mounts.
Inspect ignore rules and the Docker build context whenever packaging changes.

## Change Rules

- Inspect repository state and `RELEASE-MANIFEST.md` before making changes.
- Preserve pre-existing work in a dirty working tree.
- Keep Edition changes focused on assembly, documentation, packaging, or
  release validation.
- Do not modify remotes, create tags, push, or publish artifacts unless Saleem
  explicitly approves the exact action.
- Do not commit unless Saleem explicitly approves.
- Do not add `Signed-off-by` to Edition commits unless explicitly requested.
- Do not rewrite inherited Core history.
- Do not claim the Edition is an official upstream fee[dB]ack release.

## Validation Expectations

Documentation-only work requires focused review, link and wording checks,
Compose validation where setup text changes, and whitespace validation.

Snapshot or release changes require:

- clean and identified source commits
- source-repository automated tests appropriate to each changed component
- Edition diff and manifest review
- clean Docker image construction from the release Compose path
- verification that Mobile UI and Section Map are present in the built image
- desktop, phone, tablet, online, offline, and recovery smoke checks
- a final privacy and attribution audit

Record exact validation results in `RELEASE-MANIFEST.md` or the release notes.

## AI Handoff

`AI_HANDOFF.local.md` is the temporary local task bridge. It is not committed.
Architect owns planning and review sections. Worker owns only Worker Report
Back. Saleem owns product decisions, manual acceptance, commits, tags, pushes,
and releases.

Always inspect the real working tree and diff. Conversation summaries are not
a substitute for repository state.
