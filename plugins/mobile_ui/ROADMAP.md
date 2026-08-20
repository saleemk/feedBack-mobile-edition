# Mobile UI Roadmap

This roadmap records the current direction of the standalone Mobile UI plugin.
It is intentionally short and forward-looking. Released plugin capabilities and
setup instructions belong in [README.md](README.md), and implementation rules
belong in [AGENTS.md](AGENTS.md). Product distribution, PWA, and offline-practice
work belongs to the separate
[fee[dB]ack Mobile Edition](https://github.com/saleemk/feedBack-mobile-edition)
project.

## Current Release

### v0.5.0 - Offline Library Integration and Touch Refinement

Released `v0.5.0` adds host-integrated Library affordances and focused touch
and settings refinements:

- Offline Library toolbar and stored-song chip integration when Mobile UI is
  used with fee[dB]ack Mobile Edition
- complete declaration of Mobile UI runtime assets for offline use by a
  compatible host
- Reset all saved 3D camera views from plugin settings
- larger phone bottom-navigation touch targets
- refreshed plugin icon

fee[dB]ack Mobile Edition owns offline package storage, downloads, and
playback. Mobile UI only adapts the host-provided controls and declares its
runtime assets.

### Earlier Milestones

- **v0.2.x:** touch-first foundation, responsive screens, Player layouts, and
  mobile browser support.
- **v0.3.0:** dynamic navigation, Player quick controls, and plugin-panel
  compatibility.
- **v0.4.0:** touch camera controls, saved orientation-specific views, and
  mobile polish with safe fallback when the required Core bridge is unavailable.

## Current Focus

### 1. Release Stability And Core Compatibility

- Fix reproducible phone or tablet regressions as focused slices.
- Watch for core navigation, Player, and plugin DOM changes that affect current
  integrations.
- Preserve lifecycle cleanup, safe fallback, and unchanged desktop behavior.
- Avoid broad responsive or Player refactors while the current release is
  stable.
- Validate Mobile UI against official core updates before changing compatibility
  assumptions.

### 2. Camera Bridge Integration

- Track the camera bridge work in
  [fee[dB]ack PR #1043](https://github.com/got-feedBack/feedBack/pull/1043).
- Track Venue backdrop fitting in
  [fee[dB]ack PR #1049](https://github.com/got-feedBack/feedBack/pull/1049).
- Retest Mobile UI against the official core implementation after each merge.

### 3. User-Adjustable Camera Profiles

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

### 4. Performance And Device Testing

- Investigate Player and gesture latency on older iPads.
- Complete iPhone note-detection and audio-routing tests with the iRig HD X.
- Continue testing iOS and Android standalone behavior on real devices.

These are investigation areas, not promises of plugin-side fixes. Findings may
belong in core or another plugin.

### 5. Optional Plugin Compatibility

- Continue validating body-level plugin panels and Player action surfaces on
  supported touch layouts.
- Keep Section Map integration compatible with the standalone plugin and its
  [drag-seeking PR](https://github.com/got-feedBack/feedBack-plugin-sectionmap/pull/11).
- Change Mobile UI only when real integration testing reveals a responsive,
  lifecycle, or gesture conflict.

## Separate Projects

These efforts relate to Mobile UI but are planned and versioned independently:

- PWA distribution, offline practice, and owned core integration in
  [fee[dB]ack Mobile Edition](https://github.com/saleemk/feedBack-mobile-edition).
- An optional desktop Highway camera-controls plugin using mouse drag and
  wheel or trackpad zoom.
- Core profile persistence and stronger protection of player statistics.

## Deferred Decisions

- A Mobile UI Venue-specific workaround is deferred unless Venue still has a
  concrete issue after the core backdrop fix.
- Further Player or CSS refactoring should happen only when a concrete change
  justifies the risk.
- New gestures, visual presets, haptics, themes, and overlay systems are not on
  the active roadmap. They require a fresh product decision before work starts.
