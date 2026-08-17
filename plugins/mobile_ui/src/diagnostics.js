import { detectScreen, getElementPresence } from './dom.js';
import { getPlayerDiagnostics } from './player.js';
import { PLUGIN_ID, PLUGIN_VERSION } from './state.js';

const CLIENT_DIAGNOSTICS_SCHEMA = 'mobile_ui.client_diag.v1';

export function createDiagnostics({ state, getViewport, getMountedFeatures }) {
  return {
    snapshot() {
      // Keep snapshots current even if they are called between queued refreshes.
      state.screen = detectScreen();

      return {
        id: PLUGIN_ID,
        version: PLUGIN_VERSION,
        installed: state.installed,
        installedAt: state.installedAt,
        disabled: state.disabled,
        debug: state.debug,
        uiVersion: state.uiVersion,
        isV3: state.isV3,
        lastRefreshReason: state.lastRefreshReason,
        viewport: getViewport(),
        rootClasses: [...document.documentElement.classList].filter((name) => name.startsWith('mobile-ui-')),
        mountedFeatures: getMountedFeatures(),
        elements: getElementPresence(),
        shell: getShellDiagnostics(),
        location: {
          href: window.location.href,
          path: window.location.pathname,
          hash: window.location.hash
        },
        screen: state.screen,
        safeArea: state.safeArea
      };
    },
    contribute() {
      const contribute = window.feedBack?.diagnostics?.contribute;
      if (typeof contribute !== 'function') return;
      try {
        contribute(PLUGIN_ID, buildClientDiagnostics(state, getViewport()));
      } catch (_) {
        /* Diagnostics must never affect the UI runtime. */
      }
    }
  };
}

function buildClientDiagnostics(state, viewport) {
  return {
    schema: CLIENT_DIAGNOSTICS_SCHEMA,
    version: PLUGIN_VERSION,
    installed: !!state.installed,
    disabled: !!state.disabled,
    debug: !!state.debug,
    uiVersion: state.uiVersion || null,
    screen: sanitizeIdentifier(state.screen || detectScreen() || 'unknown'),
    screenId: sanitizeIdentifier(state.screenId || null),
    viewport: {
      deviceClass: sanitizeIdentifier(viewport?.deviceClass || 'unknown'),
      orientation: viewport?.orientation === 'landscape' ? 'landscape' : 'portrait',
      standalone: !!viewport?.standalone
    },
    player: getPlayerDiagnostics(),
    navigation: getNavigationDiagnostics()
  };
}

function sanitizeIdentifier(value) {
  if (!value || typeof value !== 'string') return null;
  return /^[a-z0-9_-]+$/i.test(value) ? value : 'unknown';
}

function getNavigationDiagnostics() {
  const nav = document.querySelector('.mobile-ui-bottom-nav');
  return {
    mounted: !!nav,
    destinations: nav ? nav.querySelectorAll('[data-mobile-ui-bottom-nav]').length : 0
  };
}

function getShellDiagnostics() {
  return {
    topbarStatusRowFound: !!document.querySelector('.mobile-ui-topbar-status-row'),
    topbarStatusRailFound: !!document.querySelector('.mobile-ui-topbar-status-rail'),
    badgeTuner: !!document.getElementById('v3-badge-tuner'),
    badgeInstrument: !!document.getElementById('v3-badge-instrument'),
    badgeProfile: !!document.getElementById('v3-badge-profile')
  };
}
