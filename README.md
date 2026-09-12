# fee[dB]ack Mobile Edition

**Your fee[dB]ack library, ready for phones, tablets, and desktop browsers.**

fee[dB]ack Mobile Edition is a self-contained community distribution built
around one private local server. It combines a tested Core snapshot with Mobile
UI, Section Map, guided Windows setup, and offline practice support. Open your
library on your devices, then download selected songs to keep practicing when
the server is unavailable.

This edition is based on fee[dB]ack Core. It is not an official upstream
fee[dB]ack release.

<p align="center">
  <strong><a href="https://github.com/saleemk/feedBack-mobile-edition/releases/download/v0.3.2/feedback-mobile-edition-v0.3.2-windows-setup.exe">Download v0.3.2 for Windows</a></strong>
  &nbsp;&middot;&nbsp;
  <a href="https://github.com/saleemk/feedBack-mobile-edition/releases/tag/v0.3.2">Release notes</a>
  &nbsp;&middot;&nbsp;
  <a href="#clone-the-repository">Install with Git</a>
</p>

<p align="center">
  <img width="760" alt="fee[dB]ack Mobile Edition Player on a phone in landscape" src="https://github.com/user-attachments/assets/df6d677e-b6ed-41a9-b120-1664c68059b9">
</p>

## What Is Mobile Edition

- Run one tested combination of fee[dB]ack Core, Mobile UI, and Section Map
  instead of assembling the pieces yourself.
- Use touch-first layouts and Player controls designed for phones and tablets,
  while keeping the regular desktop browser experience.
- Pinch, pan, and reset the 3D Highway camera, with separate saved views for
  each device class and orientation.
- Navigate songs through the Section Map.
- Use offline capability built into Mobile Edition itself to download selected
  songs for practice when the server is unavailable. This is not provided by
  the standalone Mobile UI plugin.
- Keep your song library and application configuration outside the repository
  and release image.

<p align="center">
  <img width="360" alt="fee[dB]ack Mobile Edition offline practice library" src="https://github.com/user-attachments/assets/9195e37d-cf3d-4ec0-98d5-1733390ffc62">
</p>

## Quick Start

The Windows installer is recommended for most users. A Git clone is available
for experienced users who prefer repository-based updates. Both paths run the
same Docker-based Mobile Edition and open the same visual Setup Companion.

Before starting, have these ready:

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) with Docker
  Compose.
- A fee[dB]ack-compatible song library.
- [Tailscale for Windows](https://tailscale.com/download/windows) and Tailscale
  on your other devices only if you want private phone or tablet access.

### Install On Windows (Recommended)

This is the simplest path and does not require Git:

1. Download the
   [v0.3.2 Windows installer](https://github.com/saleemk/feedBack-mobile-edition/releases/download/v0.3.2/feedback-mobile-edition-v0.3.2-windows-setup.exe).
2. Optionally download its
   [SHA-256 checksum](https://github.com/saleemk/feedBack-mobile-edition/releases/download/v0.3.2/feedback-mobile-edition-v0.3.2-windows-setup.exe.sha256)
   and compare it with:

```powershell
Get-FileHash .\feedback-mobile-edition-*-windows-setup.exe -Algorithm SHA256
```

3. Run the installer. Leave **Run fee[dB]ack Mobile Edition** selected to open
   the visual Setup Companion when installation finishes.

The installer and Companion are not digitally signed, so Windows may show an
unrecognized-app warning. Verify that the installer came from this repository's
GitHub release and that its checksum matches before running it.

### Clone The Repository

This path requires Git and is convenient when you want to update with
`git pull`.

1. Clone this repository and enter it:

```powershell
git clone https://github.com/saleemk/feedBack-mobile-edition.git
Set-Location feedBack-mobile-edition
```

2. Open the checkout folder in File Explorer and double-click
   `Setup-MobileEdition.cmd`.

On the first visual launch from a Git clone, the launcher downloads the exact
Companion version pinned by the checkout, verifies its SHA-256 checksum, caches
it locally, and then opens it. If the download is unavailable or verification
fails, the launcher reports the problem and deliberately falls back to terminal
Guided Setup. The managed cache is local to the checkout and is not committed.

### Finish Guided Setup

The Setup Companion checks what is already ready and guides you through the
remaining steps:

1. Choose your song library.
2. Start the local Docker server.
3. Optionally enable private Tailscale HTTPS access.
4. Connect a phone or tablet using the device guide and QR code.

The Companion asks before making changes and does not overwrite an existing
Tailscale service. The device-guide QR code is generated locally, so your
private address is not sent to an online QR service.

Mobile Edition runs in the background after setup, so you can close the
Companion. The first Docker build can take a few minutes.

Command-line users can run `.\Setup-MobileEdition.cmd` directly and add
`-WhatIf` to preview changes. If the visual Companion cannot open, the launcher
automatically falls back to terminal Guided Setup.

## Manual Setup Fallback

Use these commands if you prefer to configure the checkout by hand.

1. Create your local environment file:

```powershell
Copy-Item .env.example .env
notepad .env
```

Set `LIBRARY_PATH` in `.env` to the full path of your song library folder. For
example:

```text
LIBRARY_PATH=C:\path\to\your\feeBack-library
```

2. Build and start Mobile Edition:

```powershell
docker compose -f docker-compose.release.yml up --build
```

3. Open a second PowerShell window, sign in to Tailscale on the computer, then
   publish Mobile Edition privately to your tailnet over HTTPS:

```powershell
tailscale serve --bg 8000
```

The first run may ask you to enable HTTPS for your tailnet. Tailscale then shows
the private `https://<computer-name>.<tailnet>.ts.net` address for Mobile
Edition. Only devices signed in to your tailnet can open it.

4. Open that HTTPS address on your computer, phone, or tablet.

## Check Your Setup

Run the setup doctor to inspect this checkout, Docker, the local server, and
private Tailscale HTTPS access:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-MobileEditionSetup.ps1
```

The doctor is read-only. It reports what is ready and the next action for
anything that still needs setup. For structured output, add `-Json`.

## Install On A Phone Or Tablet

1. Install Tailscale from the
   [Apple App Store](https://apps.apple.com/us/app/tailscale/id1470499037) or
   [Google Play](https://play.google.com/store/apps/details?id=com.tailscale.ipn),
   then sign in to the same tailnet as the computer running Mobile Edition.
2. Open the private HTTPS address shown by `tailscale serve status`.
3. On iPhone or iPad, use Safari's **Add to Home Screen** action. On Android,
   use Chrome's **Install app** or **Add to Home screen** action.
4. Open the installed app while connected so its application files are cached.
5. Download the songs you want available for offline practice.

Offline packages belong to the browser installation on that device. Download a
song separately on every phone or tablet where you want it available offline.
Use a normal browser tab or installed PWA for downloads; Private Browsing can
deny the persistent OPFS storage required by offline packages. Browsers without
the Web Locks API use a compatible storage layout, but may store one audio copy
per arrangement instead of sharing a single copy per song.
Microphone features such as note detection also use this secure HTTPS address.

See the official [Tailscale Serve documentation](https://tailscale.com/docs/features/tailscale-serve)
for configuration and troubleshooting details.

## Updating, Restarting, And Stopping

Installer users can reopen **fee[dB]ack Mobile Edition** from the desktop or
Start menu. The Setup Companion's **Server** page provides start, restart, and
stop controls.

Git users can update their checkout and rebuild the app with:

```powershell
git pull
docker compose -f docker-compose.release.yml up --build
```

To restart after stopping:

```powershell
docker compose -f docker-compose.release.yml up
```

To stop Mobile Edition:

```powershell
docker compose -f docker-compose.release.yml down
```

The default `docker-compose.yml` is inherited from fee[dB]ack Core for
development workflows. Use `docker-compose.release.yml` for this distribution.

## Data And Privacy

This repository does not contain your song library, user profile, statistics,
or personal configuration. Songs are read from the folder named by
`LIBRARY_PATH`. Application configuration is stored in the Docker volume
`feedback-mobile-edition-config`.

Back up that Docker volume if you need to preserve local application data before
removing the installation.

## Technical Details

`RELEASE-MANIFEST.md` records the exact Core and plugin commits, Edition release
identity, and validation evidence for this checkout. The root `VERSION` and
`CHANGELOG.md` belong to the pinned Core snapshot.

Maintainer documentation lives in `docs/PROJECT.md`, `docs/ENGINEERING.md`, and
`docs/RELEASE.md`. Source and licensing evidence is recorded in
`ATTRIBUTIONS.md`.

## Licensing And Attribution

The core application is licensed under the GNU Affero General Public License
v3. Mobile UI is MIT licensed. Section Map declares MIT in its source README;
that declaration and the source README are preserved in the Edition snapshot.
The upstream Section Map project currently has no standalone `LICENSE` file.
See `ATTRIBUTIONS.md` for the recorded source and licensing evidence.
