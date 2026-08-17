# fee[dB]ack Mobile Edition

A mobile-focused fee[dB]ack distribution with Mobile UI and
Section Map included. It is maintained as a separate edition so the tested
mobile experience can be released without waiting for upstream plugin bundling
or core pull request timing.

This is a community distribution based on fee[dB]ack Core. It is not an
official upstream release.

## Project Documentation

- `docs/PROJECT.md` explains the Edition's purpose and boundaries.
- `docs/ENGINEERING.md` explains how source work and Edition assembly are
  maintained.
- `docs/RELEASE.md` defines the release and validation process.
- `RELEASE-MANIFEST.md` records the exact source inputs for this candidate.

## Quick Start

Requirements:

- Git
- Docker Desktop with Compose
- a fee[dB]ack-compatible song library

Clone this repository, copy `.env.example` to `.env`, set `LIBRARY_PATH` to
your library folder, then run:

```powershell
Copy-Item .env.example .env
docker compose -f docker-compose.release.yml up --build
```

Open `http://localhost:8000` after the container starts. The release Compose
file mounts only the external song library and persistent application config.
It does not mount the repository source over the image, so the bundled Mobile
Edition plugins remain the versions recorded in `RELEASE-MANIFEST.md`.

To stop the edition:

```powershell
docker compose -f docker-compose.release.yml down
```

The default `docker-compose.yml` is retained from fee[dB]ack Core for
development workflows. Use `docker-compose.release.yml` for this distribution.

## Data And Privacy

The repository does not contain a song library, user profile, or personal
configuration. Songs are read from `LIBRARY_PATH`. Application configuration is
stored in the Docker volume `feedback-mobile-edition-config`.

Back up that volume if you need to preserve local application data before
removing the installation.

## Included Plugins

- Mobile UI: touch-first phone and tablet layouts, responsive Player controls,
  and optional 3D Highway camera controls when the required core bridge is
  present.
- Section Map: visual song-section navigation in the Player.

The included source commits and upstream locations are recorded in
`RELEASE-MANIFEST.md`.

## Licensing And Attribution

The core application is licensed under the GNU Affero General Public License
v3. Mobile UI is MIT licensed. Section Map declares MIT in its source README;
that declaration and the source README are preserved in the Edition snapshot.
The upstream project currently has no standalone `LICENSE` file. See
`ATTRIBUTIONS.md` for the recorded source and licensing evidence.
