# Mobile Edition Engineering

This document defines how fee[dB]ack Mobile Edition is maintained. It covers
ownership, source-of-truth rules, snapshot assembly, validation, and AI
collaboration. It is not Core or plugin implementation documentation.

## Engineering Philosophy

The Edition is assembled from tested source inputs. Product code should have a
clear owner, release inputs should be pinned, and every public artifact should
be reproducible from the repository state that describes it.

Keep Edition changes small enough to answer three questions clearly:

- Which source components changed?
- Why is the new combination accepted?
- What evidence shows the release still works?

## Roles And Responsibilities

Saleem owns product direction, UX decisions, manual testing, acceptance,
commits, tags, publishing, and final release decisions.

Architect owns investigation, task definition, source and Edition boundary
decisions, implementation review, release review, and durable documentation
recommendations.

Worker owns approved implementation and validation. Worker does not change
planning or review sections in the handoff and does not commit or push without
Saleem's explicit approval.

## Sources Of Truth

Implementation truth is determined by:

1. The owning source repository and its current diff.
2. The Edition working tree and `RELEASE-MANIFEST.md`.
3. The running product and manual device observations.
4. Durable repository documentation.
5. Conversation summaries.

Current task authority is determined by:

1. Saleem's explicit current instruction.
2. `AI_HANDOFF.local.md`.
3. Edition and source-repository agent guidance.
4. Durable project documentation.

No task may silently override data protection, source ownership, attribution,
or the rule that commits and publishing require explicit approval.

## Repository Ownership

Core implementation work occurs in the fee[dB]ack Core repository, normally on
`mobile/main` or a focused branch. General changes may also be prepared as
upstream pull requests, but upstream timing does not block accepted mobile
product work.

Mobile UI implementation work occurs in the Mobile UI repository. Section Map
implementation work occurs in the Section Map repository.

Mobile Edition work is limited to:

- selecting tested source commits
- refreshing vendored snapshots
- release packaging and setup
- Edition documentation and metadata
- attribution and license auditing
- product-level release validation

Direct edits to vendored plugin source are not an accepted shortcut. Make the
change in the source repository and refresh the snapshot.

## Integration Flow

Core changes follow this path:

```text
upstream Core
    -> Core mobile/main
    -> focused source validation
    -> Mobile Edition snapshot
    -> Edition release validation
```

Plugin changes follow this path:

```text
plugin source branch
    -> plugin validation and acceptance
    -> vendored Edition snapshot
    -> Edition release validation
```

Once Edition-specific commits exist, do not assume future Core updates can be
fast-forwarded. Merge or apply the accepted Core change set deliberately,
preserve Edition-owned packaging and documentation, and review the resulting
diff.

## Standard Development Cycle

1. Identify the owning repository for the requested change.
2. Inspect its branch, working tree, and relevant durable documentation.
3. Define the behavior and compatibility contract.
4. Implement and validate in the owning repository.
5. Review and accept the source change.
6. Refresh the Edition snapshot only when preparing an Edition candidate.
7. Update `RELEASE-MANIFEST.md` with exact source commits and validation.
8. Build and test the Edition as a clean product.
9. Commit, tag, push, and publish only after explicit approval.

## AI Handoff Process

`AI_HANDOFF.local.md` is the ignored, temporary bridge between Architect and
Worker. Architect owns repository state, task intent, behavior contract,
approved implementation, validation, decisions, and Architect Review. Worker
owns only Worker Report Back. Saleem owns manual acceptance and release
authority.

Read the existing handoff before overwriting it. The current working tree and
diff remain authoritative when a handoff or conversation is stale.

## Prompt Shortcuts

- `Start task: [description]` tells Architect to inspect the owning repository,
  define the contract, populate the handoff, and make no production edits.
- `Implement task` tells Worker to verify the recorded state, implement only
  the approved scope, validate it, and complete Worker Report Back.
- `Review task` tells Architect to inspect the real diff, review it against the
  contract, and complete Architect Review.

These shortcuts do not authorize commits, pushes, tags, publishing, or remote
changes.

## Validation Philosophy

Validate behavior first in the repository that owns it, then validate the
assembled product. Passing source tests does not prove that a packaged Edition
contains the correct files or behaves correctly on mobile devices.

Edition release validation should cover:

- exact source revisions and a reviewed assembly diff
- automated Core and plugin tests appropriate to the changes
- clean Compose configuration and Docker build
- presence of included plugins in the built image
- desktop, phone, and tablet smoke testing
- online playback, offline package playback, recovery, and orientation changes
- absence of songs, profiles, secrets, caches, and local-only artifacts
- attribution and license completeness

## Documentation Hierarchy

- `docs/PROJECT.md` explains what the Edition is building.
- `docs/ENGINEERING.md` explains how Edition work is developed.
- `docs/RELEASE.md` defines release assembly and validation.
- `AGENTS.md` is the implementation and maintenance entry point.
- `README.md` is the user setup guide.
- `RELEASE-MANIFEST.md` records the current pinned inputs and evidence.
- `ATTRIBUTIONS.md` records source and license information.
- Component implementation documentation remains in its source repository.

Document stable decisions and contracts. Keep temporary plans and individual
task history in the handoff rather than committed documentation.
