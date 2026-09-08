# Mobile Edition Release Manifest

Edition version: `0.3.0-rc.1`
Status: prepared local prerelease candidate
Captured: 2026-09-08

This manifest pins the source inputs used by this checkout. It is intentionally
separate from the core application's `VERSION` file.

## Source Inputs

| Component | Repository | Branch | Commit |
| --- | --- | --- | --- |
| fee[dB]ack Core integration | This Edition repository, based on `https://github.com/got-feedBack/feedBack` | `mobile/main` source history | `f0d61eee22434b57e5531ef9a97eafb54ada377f` |
| Mobile UI | `https://github.com/saleemk/feedBack-plugin-mobile-ui` | `main` | `c1d0ddb471ff459484b21c537be453091bb03440` |
| Section Map | `https://github.com/saleemk/feedBack-plugin-sectionmap` | `mobile/main` | `cd082b8a4d0a58de90b7aaf8389c2dc4f6eae4bb` |

## Packaging Inputs

The release Compose file overrides Core's expired daily FFmpeg autobuild pin
with BtbN's retained final monthly build for July 2026:

- Release: `autobuild-2026-07-31-14-10`
- AMD64: `ffmpeg-n7.1.5-12-g1fdbca85aa-linux64-gpl-7.1.tar.xz`
- AMD64 SHA-256: `c1e6caf48923dd8e6bc5e54d51ba70c321175b8162ae9c414c392990e72f0e79`
- ARM64: `ffmpeg-n7.1.5-12-g1fdbca85aa-linuxarm64-gpl-7.1.tar.xz`
- ARM64 SHA-256: `a9a50c5782ef5e45306d58d1a9a819015b472d8da30ab6a77f15f571c861a71b`

This is an Edition packaging override. The pinned Core snapshot remains
unchanged.

The Windows Setup Companion for this candidate was built from Edition commit
`eeb81932b95845146202b1975e948bbaa2f351d2`:

- Bootstrap schema: `feedback-mobile-edition.setup-companion-bootstrap.v1`
- Companion version: `v0.3.0-rc.1`
- Planned standalone asset:
  `https://github.com/saleemk/feedBack-mobile-edition/releases/download/v0.3.0-rc.1/Setup-MobileEdition.exe`
- Companion SHA-256:
  `a8a7b60363f9ff2019db579e0958fb5afe6db8f0cec6a14eddaa38b8cb89a842`

The final Edition commit and setup ZIP checksum are recorded by the release tag,
the bundle's `SETUP-BUNDLE-MANIFEST.json`, and its adjacent checksum file after
the documentation commit. They are not embedded here because doing so would
make the release archive identify itself recursively.

## Validation Recorded

- Mobile UI JavaScript syntax checks passed.
- Section Map tests passed: `23/23`.
- Core JavaScript tests passed: `61/61`.
- Core Python tests passed: `23/23`.
- Practice-package and highway snapshot regressions passed: `19/19`.
- Offline practice storage startup and retry tests passed: `12/12`.
- Current focused Core offline PWA suite passed: `134/134`.
- The current Edition snapshot passed online startup and offline recovery smoke
  testing, including grouped artwork cards, playback, arrangement switching,
  seeking, Mobile UI controls, Section Map, and deletion confirmation.
- Clean exported-index image build and startup passed.
- Bundled Mobile UI, Section Map, service worker, and diagnostic practice
  package manifest were verified in the isolated stack.
- Manual mobile and offline playback checks passed for the tested scenarios.
- Normal iPhone Safari recovered from an initial storage failure and downloaded
  an offline package; Private Browsing truthfully reported OPFS unavailable.
- The clean Edition candidate passed final online startup, offline download,
  server-unavailable recovery, and offline playback testing.
- Setup Companion JavaScript tests passed: `40/40`.
- The dependency-free PowerShell suites for setup orchestration, setup doctor,
  launcher/bootstrap, library selection, server/device actions, and bundle
  construction passed.
- The secure clone bootstrap tests covered strict manifest validation, local
  precedence, explicit terminal arguments, verified cache reuse, corrupt-cache
  replacement, download/hash/cache failures, temporary-file cleanup, and
  terminal fallback without real network access.
- An extracted Windows setup-bundle rehearsal opened the visual Companion from
  `Setup-MobileEdition.cmd` against the fresh extracted checkout without using
  terminal fallback.
- The audited pre-documentation bundle contained 1,035 entries with no tracked
  `.env`, Git metadata, local handoff, build cache, song library, or generated
  artifact paths. Its embedded Companion hash matched the bootstrap pin.
- The prerelease Setup Companion is not digitally signed. Windows may display
  an unrecognized-app warning; published checksums remain part of the release
  verification path.

## Release Notes

- Adds the visual Windows Setup Companion with guided system checks, library
  selection, Docker server controls, Tailscale recovery, and device connection.
- Adds a local QR device guide and a ready-state shortcut for connecting a
  phone or tablet.
- Adds a complete Windows setup ZIP for users who do not want to install Git.
- Adds a secure clone bootstrap that downloads one exact versioned Companion,
  verifies SHA-256 before launch, caches it locally, and retains terminal Guided
  Setup as the failure fallback.
- Core, Mobile UI, and Section Map source pins are unchanged from `v0.2.0`;
  this candidate focuses on setup and distribution.
- Offline practice packages now store every supported arrangement while sharing
  one downloaded audio file per song.
- The offline Player supports arrangement switching, Mobile UI controls,
  Section Map, 3D Highway and Venue, seeking, and recovery when the server is
  unavailable.
- The offline library groups arrangements into one artwork card per song and
  uses a compact mobile layout.
- Mobile UI is updated to `v0.5.0`.
- This checkout vendors the two plugin snapshots under `plugins/` so a clone
  is self-contained.
- User libraries and configuration are external mounts and are not part of the
  repository or image build context.
- A pinned public Edition container image has not been published.
