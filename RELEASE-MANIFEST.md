# Mobile Edition Release Manifest

Edition version: `0.1.0`
Status: local release candidate
Captured: 2026-08-17

This manifest pins the source inputs used by this checkout. It is intentionally
separate from the core application's `VERSION` file.

## Source Inputs

| Component | Repository | Branch | Commit |
| --- | --- | --- | --- |
| fee[dB]ack Core integration | This Edition repository, based on `https://github.com/got-feedBack/feedBack` | `mobile/main` source history | `151fc5f84472bc4cebe7164a32b972a24aca8c03` |
| Mobile UI | `https://github.com/saleemk/feedBack-plugin-mobile-ui` | `main` | `a6a3df5d8b15b7147a38162924d13aa33acfe296` |
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

## Validation Recorded

- Mobile UI JavaScript syntax checks passed.
- Section Map tests passed: `23/23`.
- Core JavaScript tests passed: `61/61`.
- Core Python tests passed: `23/23`.
- Practice-package and highway snapshot regressions passed: `19/19`.
- Manual mobile and offline playback checks passed for the tested scenarios.

## Release Notes

- This checkout vendors the two plugin snapshots under `plugins/` so a clone
  is self-contained.
- User libraries and configuration are external mounts and are not part of the
  repository or image build context.
- The public release image and downloadable setup bundle are not published by
  this local release candidate.
