# fee[dB]ack Mobile Edition

fee[dB]ack Mobile Edition is a clone-and-run community distribution of
fee[dB]ack for phones, tablets, and desktop browsers. It combines a tested Core
snapshot with the Mobile UI and Section Map plugins, plus offline practice
support built into the Edition. Run one local server, open it on your devices,
and download selected songs to keep practicing when the server is unavailable.

This edition is based on fee[dB]ack Core. It is not an official upstream
fee[dB]ack release.

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

You need Git, Docker Desktop with Docker Compose,
[Tailscale for Windows](https://tailscale.com/download/windows), the Tailscale
app on your mobile devices, and a fee[dB]ack-compatible song library.

1. Clone this repository and enter it:

```powershell
git clone https://github.com/saleemk/feedBack-mobile-edition.git
Set-Location feedBack-mobile-edition
```

2. Run Guided Setup:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Setup-MobileEdition.ps1
```

Guided Setup runs the read-only setup doctor first, asks before each change,
helps create or update `.env`, starts Mobile Edition with Docker when you
approve it, and configures private Tailscale HTTPS only when it can do so
without replacing an existing root Serve route.

Use `-WhatIf` to preview the proposed setup actions without changing `.env`,
Docker, or Tailscale.

3. Open the private HTTPS address reported by setup on your computer, phone, or
   tablet.

Guided Setup starts Mobile Edition in the background, so you can close the setup
terminal after it finishes. The first build can take a while. Tailscale Serve
continues in the background and resumes after restarts. Use
`tailscale serve status` to display the address again.

The release Compose file mounts only your external song library and a Docker
volume for application configuration. It does not replace the bundled app files
with your checkout, so Mobile UI and Section Map stay at the versions recorded
in `RELEASE-MANIFEST.md`.

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
Microphone features such as note detection also use this secure HTTPS address.

See the official [Tailscale Serve documentation](https://tailscale.com/docs/features/tailscale-serve)
for configuration and troubleshooting details.

## Updating, Restarting, And Stopping

To update this checkout and rebuild the app:

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
