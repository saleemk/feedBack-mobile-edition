# Mobile UI Roadmap

This roadmap records the current direction of the fee[dB]ack mobile product
line. The standalone Mobile UI plugin remains its touch adaptation layer, while
an owned core branch provides PWA, distribution, and server-owned capabilities.
It is intentionally short and forward-looking. Released plugin capabilities and
setup instructions belong in [README.md](README.md), and implementation rules
belong in [AGENTS.md](AGENTS.md).

## Current Release

### v0.4.0 - Touch Camera Controls and Mobile Polish

Released `v0.4.0` adds bridge-based 3D Highway camera controls to the existing
phone and tablet experience:

- pinch zoom and two-finger pan
- Reset view
- separate saved views for phone and tablet portrait and landscape
- improved camera baselines for each supported device and orientation
- camera-support diagnostics and safe fallback when the required core bridge
  is unavailable

The release also includes accumulated topbar, Player, layout, gesture,
lifecycle, and compatibility improvements. Desktop remains core-controlled.

The camera controls depend on upstream fee[dB]ack changes that are not yet in
the official core release. Mobile UI remains usable without them. The README
documents the temporary preview options and compatibility behavior.

### Earlier Milestones

- **v0.2.x:** touch-first foundation, responsive screens, Player layouts, and
  mobile browser support.
- **v0.3.0:** dynamic navigation, Player quick controls, and plugin-panel
  compatibility.

## Current Focus

### 1. Owned PWA Foundation

- Maintain `mobile/main` as the long-lived owned product base.
- The offline launch foundation is complete and merged into `mobile/main`.
- Make installation and updates understandable for average users.
- Continue validating standalone launch and recovery on iPhone and Android.
- Keep offline behavior explicit: the first slice provides launch and recovery,
  not offline song practice.

Planned offline expansion proceeds in deliberate phases:

1. Browser-local tools that can operate without the server.
2. Explicitly downloaded full-mix practice bundles with visible storage
   controls.
3. Queued progress synchronization with defined reconnect and conflict rules.

### 2. Upstream Integration

- Track the camera bridge work in
  [fee[dB]ack PR #1043](https://github.com/got-feedBack/feedBack/pull/1043).
- Track Venue backdrop fitting in
  [fee[dB]ack PR #1049](https://github.com/got-feedBack/feedBack/pull/1049).
- Keep the public preview branch usable while those changes remain pending.
- Retest Mobile UI against the official core implementation after each merge.
- Remove temporary preview guidance when official releases contain the required
  contracts.
- Review useful upstream changes into `mobile/main`; upstream approval must not
  block owned mobile releases.
- Extract broadly useful work onto focused upstream branches when appropriate.

### 3. Release Stability And Compatibility

- Fix reproducible phone or tablet regressions as focused slices.
- Watch for core navigation, Player, and plugin DOM changes that affect current
  integrations.
- Preserve lifecycle cleanup, safe fallback, and unchanged desktop behavior.
- Avoid broad responsive or Player refactors while the current release is
  stable.

### 4. Section Map Direct Manipulation

Touch and mouse drag seeking is implemented in the standalone
[Section Map plugin](https://github.com/got-feedBack/feedBack-plugin-sectionmap)
and submitted upstream in
[PR #11](https://github.com/got-feedBack/feedBack-plugin-sectionmap/pull/11).
Mobile UI should change only if real integration testing reveals a responsive
or gesture conflict.

## Planned Mobile UI Work

### User-Adjustable Camera Profiles

The initial investigation confirmed that the documented camera bridge can
support user-adjustable mobile perspective and vertical composition without
patching renderer internals.

The next product decision is how much control to expose. A first version should
remain limited to:

- perspective
- vertical position
- separate values for phone and tablet portrait and landscape
- Reset view returning to the configured profile baseline

Final ranges and settings presentation require focused device testing before
implementation.

### Performance And Device Testing

- Investigate Player and gesture latency on older iPads.
- Complete iPhone note-detection and audio-routing tests with the iRig HD X.
- Continue testing iOS and Android standalone behavior on real devices.

These are investigation areas, not promises of plugin-side fixes. Findings may
belong in core or another plugin.

## Adjacent Work

These efforts relate to Mobile UI but belong in their own repositories:

- An optional desktop Highway camera-controls plugin using mouse drag and
  wheel or trackpad zoom.
- Core profile persistence and stronger protection of player statistics.
- Native iOS and Android clients are not on the active roadmap; the installable
  PWA is the chosen mobile client direction.

Each should be planned and versioned independently rather than expanding Mobile
UI's ownership.

## Deferred Decisions

- A Mobile UI Venue-specific workaround is deferred unless Venue still has a
  concrete issue after the core backdrop fix.
- Further Player or CSS refactoring should happen only when a concrete change
  justifies the risk.
- New gestures, visual presets, haptics, themes, and overlay systems are not on
  the active roadmap. They require a fresh product decision before work starts.
