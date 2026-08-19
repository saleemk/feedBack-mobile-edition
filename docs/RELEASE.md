# Mobile Edition Release Process

This document defines the durable process for producing a fee[dB]ack Mobile
Edition release. The current `0.1.0` state is a public release candidate. No
versioned source release, setup bundle, or Edition image is implied until it has
been built, tested, and published.

## Release Inputs

Every candidate must identify:

- the Edition version
- the exact Core commit from the accepted Core integration branch
- the exact Mobile UI commit
- the exact Section Map commit
- any other included component and its exact source commit
- the license and source location for every vendored component

Record these values in `RELEASE-MANIFEST.md`. The Edition version is independent
of the inherited Core `VERSION` and plugin versions.

## 1. Establish Source State

Inspect each source repository before assembly:

- confirm the expected branch and commit
- identify all uncommitted changes
- preserve unrelated or protected work
- ensure the accepted implementation is committed in its owning repository
- record focused automated and manual validation results

Update upstream Core changes through the Core repository first. Reconcile them
on Core `mobile/main`, validate the result, and only then bring the accepted
Core state into the Edition.

## 2. Refresh Vendored Plugins

Create each plugin snapshot from tracked files at one recorded commit. Do not
copy a live working directory wholesale.

The refreshed snapshot must exclude:

- nested `.git` metadata
- source-repository AI, specification, and CI scaffolding not needed by the
  packaged plugin
- `AI_HANDOFF.local.md` and other local-only workflow files
- caches, virtual environments, generated output, recordings, and test reports
- untracked personal files

Do not patch the vendored snapshot to fix product behavior. Make that change in
the plugin source repository, validate it there, and refresh the snapshot.

Review the full old-to-new snapshot diff and update `RELEASE-MANIFEST.md` in the
same Edition change.

## 3. Audit Licensing And Data

Before any public release:

- verify the root AGPL license and source offer remain present
- preserve each plugin's copyright and license notice
- update `ATTRIBUTIONS.md` when components change
- resolve every missing or ambiguous license before publishing
- verify the repository and Docker context contain no songs, profiles,
  statistics, secrets, certificates, private URLs, `.env` files, caches,
  diagnostics, or personal configuration

Section Map currently declares MIT in its source README but lacks a separate
license file. Preserve its README, source URL, exact commit, and attribution,
and record the absent standalone file as an upstream metadata limitation. Do
not add or alter licensing terms on behalf of the upstream project.

## 4. Validate The Candidate

Validate repository hygiene and Compose configuration:

```powershell
git status --short
git diff --check -- .
docker compose -f docker-compose.release.yml config --quiet
```

Run the current automated Core and plugin test suites appropriate to the source
changes. Record exact commands and result counts in the release manifest or
release notes.

Perform a clean image build:

```powershell
Copy-Item .env.example .env
docker compose -f docker-compose.release.yml build --no-cache
docker compose -f docker-compose.release.yml up -d
docker compose -f docker-compose.release.yml ps
```

Use an external test library. Do not place songs inside the repository.

Verify the built product includes the pinned Mobile UI and Section Map
snapshots rather than local junctions, bind-mounted source, or stale image
content.

## 5. Manual Release Matrix

At minimum, check:

- fresh startup and profile continuity
- desktop Home, Library, and Player
- phone portrait and landscape
- tablet portrait and landscape
- Mobile UI navigation and Player controls
- Section Map display, tap, and drag behavior
- 3D Highway and Venue rendering
- camera gestures and saved orientation views
- online song playback and seeking
- offline package download, library state, playback, and deletion
- offline startup, server-unavailable recovery, and reconnect
- service-worker update behavior after installing the candidate
- no duplicate controls, stale UI, or unexpected console errors

Record device and browser coverage honestly. Untested scenarios remain
untested; do not imply broader support from automated checks alone.

## 6. Approve And Publish

Only after Saleem approves the candidate:

1. Commit the Edition assembly with its manifest and documentation.
2. Tag the approved Edition version.
3. Create or update the public Edition repository.
4. Publish the source archive or setup bundle.
5. Build and publish a pinned container image when that distribution path is
   ready.
6. Verify the published artifact from a clean machine or clean checkout.

Do not use a moving image tag as the only release identity. Record a versioned
tag and immutable digest when a public image is introduced.

## Current Distribution Paths

The current local candidate supports one clone-and-build path through
`docker-compose.release.yml`. The default inherited `docker-compose.yml` remains
the Core development workflow and is not the Edition release command.

A downloadable setup bundle and pinned public image are planned distribution
paths. They are not available until a release explicitly publishes them.
