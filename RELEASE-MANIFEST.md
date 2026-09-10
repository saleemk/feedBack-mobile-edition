# Mobile Edition Release Manifest

Edition version: `0.3.1`
Status: release candidate validated; final packaging and publication pending
Captured: 2026-09-10

This manifest pins the source inputs used by this checkout. It is intentionally
separate from the core application's `VERSION` file.

## Source Inputs

| Component | Repository | Branch | Commit |
| --- | --- | --- | --- |
| fee[dB]ack Core integration | This Edition repository, based on `https://github.com/got-feedBack/feedBack` | `mobile/main` source history | `c954997ce12ff8ca4324ea2e05e4c5f66f19c50d` |
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

The accepted one-file Windows installer rehearsal was built from Edition commit
`51cab2b2c1a85416cc71abb7ed2a37a86e326552`:

- Candidate version: `v0.3.1-rc.1`
- Candidate filename:
  `feedback-mobile-edition-v0.3.1-rc.1-windows-setup.exe`
- Candidate size: `536.7 MiB`
- Candidate SHA-256:
  `6f077a2ae25143cbb1a23cb6e4e43b59ff89f745ef5f249e16580485bc267796`
- Bundled Career venues: Bar and Club. Arena is intentionally omitted from the
  initial installer and remains an optional upstream download.

This rehearsal artifact is not the final public asset. Before the final tag,
build the standalone Companion and installer from the final committed state,
update `SETUP-COMPANION-BOOTSTRAP.json` with the immutable `v0.3.1` Companion
URL and SHA-256, and rerun the focused launcher, installer, and manual checks.
The release tag and adjacent checksum files record the final artifact identity;
checksums are not embedded here because that would make the release payload
identify itself recursively.

## Validation Recorded

- The complete Core Python suite passed under the CI platform, Linux Python
  3.12: `2878 passed`, `4 skipped`, `0 failed`.
- The full Edition root JavaScript suite passed: `1572/1572`.
- Setup Companion JavaScript tests passed: `1656/1656`.
- Setup Companion Rust tests passed: `29/29`; `cargo fmt --check`, Clippy with
  warnings denied, and the optimized Tauri `--no-bundle` build also passed.
- All nine PowerShell setup suites passed: bundle and installer construction,
  release Compose, server/device actions, library selection, guided setup,
  launcher/bootstrap, and setup doctor.
- Edition ESLint completed with zero errors; twelve existing size and unused
  directive warnings remain non-blocking.
- A pinned Tailwind rebuild produced no tracked diff; the stylesheet SHA-256 is
  `4ae5b85ea40c83970b7874d7c867ab0793980544d093cc71c3eb476109cb35a4`.
- All 14 bundled plugin manifests passed ID, name, casing, and directory checks.
- Feedpak conformance passed all four layers against specification commit
  `52548b742f64c2a35052a141976ea1b7889f4b1a`, including all seven committed
  packages.
- Release Compose validation and a clean `--no-cache` image build passed. The
  local candidate image ID is
  `sha256:1022013360888ebf37b94b3edf6b0403498868e65237f0314bd24d8d1cea2192`.
- An isolated candidate container returned HTTP 200, reported all 14 plugins,
  and included Career, Mobile UI, and Section Map. The user's existing server
  and external library were not replaced for this smoke check.
- Manual Windows acceptance covered uninstall/reinstall, prerequisite links,
  library selection, Docker start/stop/restart, Tailscale private HTTPS, QR
  device connection, online playback, offline download in a normal browser
  tab, and Career visibility. Private Browsing correctly exposed its OPFS
  storage limitation.
- The one-file installer includes no Git metadata or local configuration and
  reduced the accepted rehearsal download from about `875.6 MiB` to `536.7 MiB`
  by omitting Arena while retaining Bar and Club.
- Repository and tracked-path audits found no `.env`, personal paths, private
  test URLs, song libraries, caches, build output, credentials, or certificate
  files. The Docker build context uses a narrow allowlist and now prunes local
  test/build trees before traversal.
- The Setup Companion is not digitally signed. Windows may display an
  unrecognized-app warning; published checksums remain part of the release
  verification path.

## Known Browser Storage Limits

- Private Browsing can deny the persistent OPFS storage required for offline
  packages. The tested iPhone flow works in normal Safari and the installed
  PWA.
- Browsers without the Web Locks API use the compatible per-arrangement audio
  layout. Offline downloads and playback remain supported, but those browsers
  may use more storage until shared-audio mutation locking is available.

## Release Notes

- Replaces the newcomer setup ZIP with one Windows installer that installs the
  Edition and opens the visual Setup Companion.
- Keeps the Git clone path for experienced users, with one immutable verified
  Companion download and terminal Guided Setup as the failure fallback.
- Simplifies the Companion around first setup instead of managing previous
  Edition installations or presenting version-selection controls.
- Improves library-save feedback and guided progression across Library, Server,
  Check, and Devices while tolerating users who complete steps in another order.
- Adds start, restart, and stop controls for the local Docker server.
- Adds prerequisite links in the installer, a local QR device guide, a
  ready-state phone/tablet shortcut, and clickable private HTTPS URLs.
- Includes Bar and Club Career venues in the installer while leaving the much
  larger Arena pack as an optional upstream download.
- Core, Mobile UI, and Section Map source pins are unchanged from `v0.3.0`;
  this release focuses on setup and distribution.
- User libraries and configuration remain external mounts and are not part of
  the repository, installer payload, or image build context.
- A pinned public Edition container image has not been published.
