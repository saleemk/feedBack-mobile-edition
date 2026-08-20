# Mobile UI

A touch-optimized phone and tablet interface plugin for [fee[dB]ack](https://github.com/got-feedBack/feedBack). Mobile
UI improves shell navigation, Home, Song Library, Progress, Settings, Plugins,
Collections, Player controls, and touch gestures while leaving desktop behavior
to core.

The plugin is optimized for phones and tablets in portrait and landscape.
Browser and device testing is ongoing, so the focus is practical touch
improvements with honest limits.

> **3D camera setup:** Mobile UI works with standard fee[dB]ack core, but its
> optional 3D Highway camera controls require core changes that are still
> awaiting upstream approval. Pinch zoom, two-finger pan, camera defaults,
> and Reset view require [PR #1043](https://github.com/got-feedBack/feedBack/pull/1043).
> Correct Venue backdrop fitting requires
> [PR #1049](https://github.com/got-feedBack/feedBack/pull/1049). See
> [3D Highway Camera Support](#3d-highway-camera-support) for the recommended
> integrated route or continue without the optional camera controls.

## What You Get

- touch-first phone and tablet layouts in portrait and landscape
- dynamic bottom navigation that includes valid core and plugin destinations
- responsive Home, Library, Career, Progress, Settings, Plugins, and collection
  screens
- compact topbar controls, with Songs and Active stats linking to Library and
  Plugins
- Player controls tailored to phone portrait, phone landscape, and tablet use
- quick Speed, Arrangement, Difficulty, and Player action controls
- tap-to-play, vertical scrub, and optional two-finger 3D camera controls
- touch-friendly tuner, instrument, Practice, and plugin panels
- offline Library controls when Mobile UI is used with fee[dB]ack Mobile
  Edition
- standalone iPhone and Android browser support
- unchanged desktop behavior

## Screenshots

> **Tip:** The screenshots below were taken in standalone (Home Screen) mode
> where available to maximize usable screen space.

Mobile UI adapts its navigation, content density, and Player controls for phone
and tablet portrait/landscape layouts.

### Phone Portrait

<p>
  <img width="280" alt="Mobile UI Home on phone portrait" src="https://github.com/user-attachments/assets/628e319c-cca7-4d16-a97d-a82367824fcb">
  &nbsp;&nbsp;
  <img width="280" alt="Mobile UI Song Library on phone portrait" src="https://github.com/user-attachments/assets/0c13cce1-5207-4979-8e7b-2fa89239f7e8" >
</p>

Fixed Home with scrollable touch navigation, responsive Home cards, and a
touch-friendly two-column Song Library layout.

<p>
  <img width="280" alt="Mobile UI Player controls and Player More shelf on phone portrait" src="https://github.com/user-attachments/assets/b0c41ff6-37f7-4452-ba4c-e3181212d21b">
  &nbsp;&nbsp;
  <img width="280" alt="Mobile UI Plugins screen on phone portrait" src="https://github.com/user-attachments/assets/c9e47a07-2d01-43a6-9b98-ad11d26884ec">
</p>

Phone portrait Player More shelf and touch controls; compact Plugins management
layout.

### Phone Landscape

<p>
  <img width="600" alt="Mobile UI Home on phone landscape" src="https://github.com/user-attachments/assets/27a29499-266a-497b-9e9e-f7edc39bfe9f">
</p>

Landscape Home uses a two-column hero and Continue Playing layout.

<p>
  <img width="600" alt="Mobile UI Song Library on phone landscape" src="https://github.com/user-attachments/assets/03d84e2b-749d-4b04-b072-735cc7221cb2" >
</p>

Landscape Library uses denser cards and touch navigation.

<p>
  <img width="600" alt="Mobile UI Player direct action controls on phone landscape" src="https://github.com/user-attachments/assets/df6d677e-b6ed-41a9-b120-1664c68059b9" >
</p>
<p>
  <img width="600" alt="Mobile UI Player plugin controls panel on phone landscape" src="https://github.com/user-attachments/assets/fd985f50-6dba-47b8-81d2-a73101c68d6d">
</p>

Phone landscape uses direct Player controls. Player category panels remain open
while their controls are used.

## Touch Gestures

On the phone and tablet Player:

- tap the highway to play or pause
- drag vertically on the highway to scrub
- drag down to seek forward
- drag up to seek backward
- pinch with two fingers to zoom a supported 3D Highway view
- drag with two fingers to pan the camera view
- use **Reset view** to restore the mobile camera baseline

Camera views are saved separately for phone and tablet portrait and landscape
so each layout can retain an appropriate perspective. Camera gestures apply
only when the explicit 3D Highway or Venue visualization is active and the
documented core camera bridge is available. Auto visualization selection is not
treated as camera-gesture eligible. Desktop and mouse behavior are excluded.

## Installation

Mobile UI requires a [fee[dB]ack](https://github.com/got-feedBack/feedBack)
installation that can load external plugins. Clone this repo into the
fee[dB]ack `plugins/` directory as `mobile_ui`, then restart fee[dB]ack or reload
the page.

```bash
cd /path/to/feedback/plugins
git clone https://github.com/saleemk/feedBack-plugin-mobile-ui.git mobile_ui
```

### Docker / local mount

If you run fee[dB]ack with Docker, mount the plugin folder into the container:

```yaml
services:
  web:
    volumes:
      - ../feedBack-plugin-mobile-ui:/app/plugins/mobile_ui
```

Then restart the container so the server discovers the updated `plugin.json`.

Once enabled, Mobile UI activates automatically on phones and tablets.

## Settings

Open **Settings -> Plugins -> Mobile UI** to configure:

- **Enable mobile UI enhancements** - turns the plugin's layout changes on or off
- **Pause song when opening Player More controls** - pauses playback when
  opening the phone portrait Player More shelf
- **Show Mobile UI debug view** - displays runtime/device diagnostics while
  debugging
- **Reset all saved 3D camera views** - restores the default camera view for
  every phone and tablet orientation

Pause-on-Player-More applies only to the phone portrait Player More shelf. It
does not apply to phone landscape direct controls or tablet direct controls.

Settings also reports 3D camera support. If unavailable, the red **Core update
required. Click for more info** link opens the [camera
instructions](#3d-highway-camera-support).

## 3D Highway Camera Support

> **Camera setup required:** If Mobile UI reports `Core update required`, your
> installed fee[dB]ack core does not include the complete 3D Highway camera
> bridge. Mobile UI continues to work, but camera gestures and **Reset view**
> remain unavailable. Continue without the optional controls, use the
> integrated route below, or wait for upstream support.

Mobile UI's standard layout, navigation, Player, and touch adaptations work
with official fee[dB]ack core builds.
Pinch zoom, two-finger pan, saved camera views, and **Reset view** activate only
when the complete 3D Highway camera bridge is available.

For the complete experience with compatible Core camera support and offline
practice, use
[fee[dB]ack Mobile Edition](https://github.com/saleemk/feedBack-mobile-edition).
Mobile Edition is a separate community distribution based on fee[dB]ack Core;
it is not an official fee[dB]ack release.

For technical and upstream status, see the camera bridge in
[fee[dB]ack PR #1043](https://github.com/got-feedBack/feedBack/pull/1043) and
Venue backdrop fitting in
[fee[dB]ack PR #1049](https://github.com/got-feedBack/feedBack/pull/1049).

## Phone and Tablet Setup

Mobile UI works in a supported browser, but launching fee[dB]ack from the Home
Screen provides more usable Player space, especially in phone landscape.

### iPhone / iPad (Safari)

- Open fee[dB]ack in Safari.
- Use **Share -> Add to Home Screen**.
- Launch it from the new Home Screen icon.

### Android (Chrome)

- Serve fee[dB]ack over **HTTPS** so Chrome can launch it in standalone mode.
- Use Chrome's Home Screen installation option, then launch the new icon.

Mobile UI still works through a normal browser tab. An HTTP LAN address may
create a shortcut that retains the browser address bar.

### HTTPS for Note Detection

Mobile browsers require HTTPS before Note Detection can access microphone input
from a fee[dB]ack server on another device.

[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) provides
a private HTTPS address accessible only through your Tailscale network:

1. Install Tailscale on the fee[dB]ack server and phone.
2. Sign in to the same Tailscale network on both devices.
3. Keep fee[dB]ack available locally on port `8000`.
4. On the server, run:

   ```bash
   tailscale serve --bg 8000
   ```

5. Display the private HTTPS address:

   ```bash
   tailscale serve status
   ```

6. Open the displayed `https://...ts.net` address on the mobile device and
   allow microphone access when prompted.

Tailscale Serve remains private to devices authorized on the same Tailscale
network. Tailscale Funnel is not required.

## Compatibility / Known Limits

- Optimized for phone and tablet portrait/landscape layouts.
- Desktop behavior is intentionally left to core.
- Two-finger camera controls require the documented 3D Highway camera bridge
  and currently support explicit 3D Highway and Venue selection, not Auto.
- Offline Library controls require fee[dB]ack Mobile Edition. Mobile Edition
  owns package storage, downloads, and offline playback.
- Venue uses a fixed background composition, so extreme camera adjustments can
  expose its background framing beyond the highway scene.
- A tiny old menu/sidebar flash can still appear during refresh on some devices
  before Mobile UI initializes.

## Development

See [AGENTS.md](AGENTS.md) for implementation guidance and
[ROADMAP.md](ROADMAP.md) for planned work.

## License

MIT. See [LICENSE](LICENSE).
