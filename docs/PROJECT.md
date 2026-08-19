# fee[dB]ack Mobile Edition

## Purpose

fee[dB]ack Mobile Edition is a self-contained, mobile-focused distribution of
fee[dB]ack. It combines a tested Core snapshot with Mobile UI, Section Map, and
Edition-owned packaging so a user can clone or install one coherent product.

The Edition exists so the mobile product can be tested and released on its own
schedule while remaining open about its relationship with upstream Core and
the included plugin projects.

## Vision

Provide an approachable fee[dB]ack experience that can be installed as a PWA,
used comfortably on phones and tablets, and remain useful for selected offline
practice without requiring users to assemble several repositories themselves.

## Goals

- Deliver one reproducible distribution with tested component versions.
- Make phone and tablet use a first-class product experience.
- Preserve desktop access to the underlying fee[dB]ack application.
- Support an installable PWA with clear online, recovery, and offline states.
- Allow users to download selected practice packages for offline playback.
- Keep song libraries and personal data outside the repository and image.
- Remain able to incorporate useful upstream Core changes deliberately.
- Preserve source attribution, licenses, and component identity.
- Provide a clone-and-run path and, later, a packaged release path for average
  users.

## Non-Goals

- Mobile Edition is not the primary source repository for Core, Mobile UI, or
  Section Map feature development.
- It is not an official upstream fee[dB]ack release.
- It does not hide or erase the identity of upstream or plugin contributors.
- It does not include user songs, profiles, statistics, secrets, or personal
  configuration.
- It does not attempt to make every server function available offline.
- It is not currently a native iOS or Android application.

## Product Principles

### One coherent product

Users should receive a tested combination of Core and plugins, not a list of
manual patches and compatibility instructions.

### Mobile first, not mobile only

Phone and tablet behavior drives the Edition, but the underlying desktop
experience remains available and should not be casually broken.

### Offline practice is explicit

Offline support is based on selected downloaded practice packages. The Edition
should communicate clearly when the server is unavailable and which songs are
actually ready offline.

### Source ownership stays clear

Core and plugin changes are developed and validated in their owning
repositories. The Edition assembles approved snapshots and does not become a
second implementation fork by accident.

### Compatibility is deliberate

Upstream changes are reviewed through Core `mobile/main`, tested with the
Edition's product behavior, and incorporated intentionally. Upstream approval
is useful but is not a release gate for accepted Edition capabilities.

### Releases are reproducible

Every Edition release records exact source commits, validation results,
licenses, and packaging inputs. A moving branch name alone is not a release
definition.

## Relationship To Components

fee[dB]ack Core provides the application server, library, Player, plugin host,
and the majority of the application runtime.

Mobile UI remains an independent fee[dB]ack plugin. It owns touch layouts,
mobile navigation, Player adaptations, and mobile camera controls through
documented Core and renderer contracts.

Section Map remains an independent plugin. The Edition includes a tested
snapshot because it is part of the accepted mobile Player experience.

Mobile Edition owns the combination: component selection, pinned versions,
packaging, documentation, distribution, and product-level validation.

## Current Status

The current Edition is a public `0.1.0` release candidate. The source checkout,
release Compose path, manifest, attribution audit, and public Edition repository
are available. A downloadable setup bundle and pinned public image have not yet
been published.
