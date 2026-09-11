# Mobile Edition Release Process

This document defines the durable process for producing a fee[dB]ack Mobile
Edition release. The `v0.3.1` candidate supports a Git clone-and-run path and a
one-file Windows installer. A pinned public Edition container image is not
currently available.

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

Only after the release owner approves the candidate:

1. Commit the Edition assembly with its manifest and documentation.
2. Build, audit, and manually test the final one-file Windows installer and
   standalone Setup Companion from that committed state.
3. Create and push the exact version tag without advancing public `main`; mark
   release-candidate tags as prereleases.
4. Publish the standalone Companion EXE and checksum for Git-clone bootstrap,
   plus the one-file Windows installer and its checksum, under that tag.
5. Verify the public assets and checksums.
6. Push `main` only after the bootstrap URL pinned there is live and verified.
7. Test the published installer and a fresh clone from public `main`.
8. Build and publish a pinned container image when that distribution path is
   ready.

This ordering prevents a public clone from activating a bootstrap URL before
the matching verified Companion asset exists. Commit, push, tag, and publishing
steps each require the release owner's explicit approval.

Do not use a moving image tag as the only release identity. Record a versioned
tag and immutable digest when a public image is introduced.

## Current Distribution Paths

The `v0.3.1` candidate has two Windows acquisition paths:

- A one-file Windows installer contains the committed Edition checkout and the
  visual Setup Companion. It installs for the current user, creates an optional
  desktop shortcut, and can open guided setup when installation finishes. Git
  is not required.
- A Git clone contains the same launcher and an immutable bootstrap manifest.
  When no local Companion exists, the launcher downloads the exact versioned
  standalone EXE, verifies SHA-256 before launch, caches it in an
  ignored checkout-relative directory, and falls back to terminal Guided Setup
  if bootstrap is unavailable.

The standalone Companion EXE is a bootstrap asset for Git clones, not the
newcomer installation. Both paths configure and run the same release Compose
stack. The default inherited `docker-compose.yml` remains the Core development
workflow and is not the Edition release command. The visual bootstrap and
installer paths become publicly usable only after the matching versioned
release assets are published.

## Local Windows Setup Bundle Tool

Maintainers can create an unpublished local Windows setup-bundle candidate from
a clean checkout:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\Build-MobileEditionSetupBundle.ps1 -Version <edition-version>
```

The builder runs `npm ci` from `setup-companion/package-lock.json`, builds the
Setup Companion in release `--no-bundle` mode, archives committed `HEAD`, adds
the companion as root `Setup-MobileEdition.exe`, and writes a legacy setup ZIP
under ignored `artifacts/setup-bundles/`. The built Companion can be inspected
or used as the standalone clone-bootstrap asset, but the ZIP is no longer a
public acquisition path. Publishing still requires the release owner's explicit
approval.

## Local Windows One-File Installer Candidate

Maintainers can create an unpublished local Windows installer candidate from a
clean checkout:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\Build-MobileEditionWindowsInstaller.ps1 -Version <edition-version>
```

The builder archives committed `HEAD` into an ignored staging payload, supplies
that payload to a build-only Tauri NSIS configuration as an `edition` resource,
builds a current-user Windows installer, and stores the versioned
`feedback-mobile-edition-<edition-version>-windows-setup.exe` plus `.sha256`
file under ignored `artifacts/windows-installer/`. Manual acceptance is still
required for every final candidate, and publishing requires the release owner's
explicit approval.
