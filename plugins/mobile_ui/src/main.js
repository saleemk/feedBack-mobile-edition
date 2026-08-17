import { createDiagnostics } from './diagnostics.js';
import { createDebugOverlay } from './debug.js';
import { createLifecycle } from './lifecycle.js';
import { detectScreen, getActiveScreenId, getScreenClassNames, isV3Ui } from './dom.js';
import {
  createState,
  DEBUG_STORAGE_KEY,
  DISABLED_STORAGE_KEY,
  GLOBAL_KEY,
  PLUGIN_ID,
  PLUGIN_VERSION
} from './state.js';
import { getViewportInfo } from './viewport.js';

import { createFeature as createShellFeature } from './shell.js';
import { createFeature as createHomeFeature } from './home.js';
import { createFeature as createLibraryFeature } from './library.js';
import { createFeature as createPlayerFeature } from './player.js';
import { createFeature as createPluginsFeature } from './plugins.js';
import {
  createFeature as createHighwayFeature,
  getHighwayCameraSupport,
  hasSavedHighwayCameraViews,
  resetAllHighwayCameraViews
} from './highway.js';
import { createFeature as createGesturesFeature } from './gestures.js';
import { createFeature as createSafeAreaFeature } from './safe-area.js';
import { cleanupPreboot } from './preboot.js';

const ROOT_CLASSES = [
  'mobile-ui-enabled',
  'mobile-ui-phone',
  'mobile-ui-tablet',
  'mobile-ui-desktop',
  'mobile-ui-standalone',
  'mobile-ui-landscape',
  'mobile-ui-portrait',
  'mobile-ui-v3',
  'mobile-ui-disabled',
  'mobile-ui-player-more-shelf-mode',
  'mobile-ui-player-tablet-direct-controls-mode',
  ...getScreenClassNames()
];

const IOS_VIEWPORT_FIX_CLASS = 'mobile-ui-ios-vv-offset-bug';
const IOS_VIEWPORT_FIX_VAR = '--mobile-ui-ios-vv-offset-fix';

const reportedFeatureErrors = new Set();

const existingRuntime = window[GLOBAL_KEY];

if (existingRuntime?.installed) {
  existingRuntime.refresh?.('module-reloaded');
  cleanupPreboot();
} else {
  const runtime = createRuntime();
  window[GLOBAL_KEY] = runtime;
  runtime.install();
}

function createRuntime() {
  const state = createState();
  const iosViewportRepairTimers = new Set();
  const iosViewportRepairFrames = new Set();
  let lastOrientation = null;
  const lifecycle = createLifecycle([
    createShellFeature(),
    createHomeFeature(),
    createLibraryFeature(),
    createPluginsFeature(),
    createPlayerFeature(),
    createHighwayFeature(),
    createGesturesFeature(),
    createSafeAreaFeature()
  ], { reportError: reportFeatureError });
  const debugOverlay = createDebugOverlay({ state });

  const diagnostics = createDiagnostics({
    state,
    getViewport: () => state.viewport,
    getMountedFeatures: () => lifecycle.getMountedFeatureNames()
  });

  const runtime = {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    installed: false,
    installedAt: null,
    refresh,
    destroy,
    snapshot: diagnostics.snapshot,
    getHighwayCameraSupport,
    hasSavedHighwayCameraViews,
    resetAllHighwayCameraViews,
    disable,
    enable,
    isDisabled,
    enableDebug,
    disableDebug,
    toggleDebug
  };

  function install() {
    if (runtime.installed) {
      refresh('install-already-mounted');
      return;
    }

    runtime.installed = true;
    runtime.installedAt = new Date().toISOString();
    state.installed = true;
    state.installedAt = runtime.installedAt;
    lastOrientation = getViewportInfo().orientation;

    // Mount features before the first full refresh so feature boundaries exist
    // for diagnostics immediately; the install refresh below supplies current
    // viewport/screen state and lets features settle into their active modes.
    lifecycle.mount(getContext('install'));
    addListeners();
    refresh('install');

    // Preboot is no longer needed — the real bottom-nav CSS rules
    // (mobile-ui-has-bottom-nav) are now in place.
    cleanupPreboot();

    console.info('[mobile_ui] loaded', runtime.snapshot());
  }

  function refresh(reason = 'manual') {
    state.lastRefreshReason = reason;
    state.viewport = getViewportInfo();
    state.disabled = isDisabled();
    state.debug = isDebugEnabled();
    state.uiVersion = window.feedBack?.uiVersion || null;
    state.isV3 = isV3Ui();
    state.screenId = getActiveScreenId();
    state.screen = detectScreen();

    applyRootClasses(state);
    clearIosViewportOriginFixIfNeeded();
    lifecycle.refresh(getContext(reason));
    debugOverlay.refresh(getContext(reason));
    diagnostics.contribute();
    return runtime.snapshot();
  }

  function destroy() {
    runtime.installed = false;
    state.installed = false;
    clearRefreshTimer();
    clearIosViewportRepairTimers();
    clearIosViewportRepairFrames();
    clearIosViewportOriginFix();
    removeListeners();
    lifecycle.unmount();
    debugOverlay.remove();
    removeRootClasses();

    state.lastRefreshReason = 'destroy';

    return runtime.snapshot();
  }

  function getContext(reason) {
    return {
      runtime,
      state,
      reason,
      viewport: state.viewport,
      refresh
    };
  }

  function disable() {
    setStorageFlag(DISABLED_STORAGE_KEY, true);
    return refresh('disable');
  }

  function enable() {
    setStorageFlag(DISABLED_STORAGE_KEY, false);
    return refresh('enable');
  }

  function isDisabled() {
    return readStorageFlag(DISABLED_STORAGE_KEY);
  }

  function enableDebug() {
    debugOverlay.setEnabled(true);
    return refresh('enable-debug');
  }

  function disableDebug() {
    debugOverlay.setEnabled(false);
    return refresh('disable-debug');
  }

  function toggleDebug() {
    debugOverlay.setEnabled(!debugOverlay.isEnabled());
    return refresh('toggle-debug');
  }

  function isDebugEnabled() {
    return readStorageFlag(DEBUG_STORAGE_KEY);
  }

  function addListeners() {
    if (state.listeners.length) return;

    state.listeners.push(addWindowListener('resize', () => {
      queueRefresh('resize');
      queueIosViewportOriginRepair('resize');
    }));
    state.listeners.push(addWindowListener('orientationchange', () => {
      const previousOrientation = lastOrientation;
      queueRefresh('orientationchange');
      queueIosViewportOriginRepair('orientationchange', previousOrientation);
    }));
    state.listeners.push(addFeedBackListener('screen:changed', () => queueRefresh('screen:changed')));

    if (window.visualViewport?.addEventListener) {
      const resizeHandler = () => {
        queueRefresh('visualViewport.resize');
        queueIosViewportOriginRepair('visualViewport.resize');
      };
      const scrollHandler = () => {
        queueIosViewportOriginRepair('visualViewport.scroll');
      };
      window.visualViewport.addEventListener('resize', resizeHandler, { passive: true });
      window.visualViewport.addEventListener('scroll', scrollHandler, { passive: true });
      state.listeners.push(() => {
        window.visualViewport.removeEventListener('resize', resizeHandler);
        window.visualViewport.removeEventListener('scroll', scrollHandler);
      });
    }
  }

  function removeListeners() {
    state.listeners.splice(0).forEach((remove) => remove());
    clearIosViewportRepairTimers();
  }

  function queueRefresh(reason) {
    state.pendingRefreshReason = reason;
    clearRefreshTimer();
    state.refreshTimer = window.setTimeout(() => {
      const queuedReason = state.pendingRefreshReason || reason;
      state.refreshTimer = null;
      state.pendingRefreshReason = null;
      refresh(queuedReason);
      lastOrientation = state.viewport?.orientation || lastOrientation;
    }, 80);
  }

  function clearRefreshTimer() {
    if (state.refreshTimer) {
      window.clearTimeout(state.refreshTimer);
      state.refreshTimer = null;
    }
  }

  function queueIosViewportOriginRepair(reason, previousOrientation = null) {
    const viewport = getViewportInfo();
    const isPortraitToLandscape = previousOrientation === 'portrait' && viewport.orientation === 'landscape';
    const origin = detectNegativeViewportOrigin();
    const hasActiveFix = document.documentElement.classList.contains(IOS_VIEWPORT_FIX_CLASS);

    if (!isIosViewportOriginRepairScope(viewport)) {
      clearIosViewportOriginFix();
      return;
    }

    if (
      !isPortraitToLandscape &&
      !origin.broken &&
      !hasActiveFix
    ) return;

    clearIosViewportRepairTimers();
    scheduleIosViewportOriginRepair(reason, 90);
    if (isPortraitToLandscape) {
      scheduleIosViewportOriginRepair(`${reason}:settled`, 360);
    }
  }

  function scheduleIosViewportOriginRepair(reason, delay) {
    const timer = window.setTimeout(() => {
      iosViewportRepairTimers.delete(timer);
      repairIosStandaloneViewportOrigin(reason);
    }, delay);

    iosViewportRepairTimers.add(timer);
  }

  function clearIosViewportRepairTimers() {
    iosViewportRepairTimers.forEach((timer) => window.clearTimeout(timer));
    iosViewportRepairTimers.clear();
  }

  function scheduleIosViewportRepairFrame(callback) {
    if (!runtime.installed || typeof window.requestAnimationFrame !== 'function') return;

    const frame = window.requestAnimationFrame(() => {
      iosViewportRepairFrames.delete(frame);
      if (!runtime.installed) return;
      callback();
    });
    iosViewportRepairFrames.add(frame);
  }

  function clearIosViewportRepairFrames() {
    iosViewportRepairFrames.forEach((frame) => window.cancelAnimationFrame(frame));
    iosViewportRepairFrames.clear();
  }

  function repairIosStandaloneViewportOrigin(reason) {
    if (!isIosViewportOriginRepairScope()) {
      clearIosViewportOriginFix();
      return;
    }

    const before = detectNegativeViewportOrigin();
    if (!before.broken && !document.documentElement.classList.contains(IOS_VIEWPORT_FIX_CLASS)) {
      return;
    }

    if (before.broken) {
      resetStandaloneScrollState();
      forceShellLayoutRead();
    }

    scheduleIosViewportRepairFrame(() => {
      scheduleIosViewportRepairFrame(() => {
        if (!isIosViewportOriginRepairScope()) {
          clearIosViewportOriginFix();
          return;
        }

        const after = detectNegativeViewportOrigin();
        if (after.broken) {
          applyIosViewportOriginFix(after.offset);
          forceShellLayoutRead();
          refresh(`ios-vv-origin-fix:${reason}`);
        } else {
          const cleared = clearIosViewportOriginFix();
          if (before.broken || cleared) {
            refresh(`ios-vv-origin-normalized:${reason}`);
          }
        }

        lastOrientation = getViewportInfo().orientation;
      });
    });
  }

  function isIosViewportOriginRepairScope(viewport = getViewportInfo()) {
    return (
      !isDisabled() &&
      isV3Ui() &&
      viewport.standalone &&
      viewport.deviceClass === 'phone' &&
      viewport.orientation === 'landscape'
    );
  }

  function clearIosViewportOriginFixIfNeeded() {
    if (!isIosViewportOriginRepairScope(state.viewport) || !detectNegativeViewportOrigin().broken) {
      clearIosViewportOriginFix();
    }
  }

  function detectNegativeViewportOrigin() {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    const body = document.body;
    const values = [
      toFiniteNumber(viewport?.offsetTop),
      toFiniteNumber(viewport?.pageTop),
      toFiniteNumber(window.scrollY),
      toFiniteNumber(root.scrollTop),
      toFiniteNumber(body?.scrollTop)
    ];
    const minY = Math.min(...values);
    const broken = minY < -1;

    return {
      broken,
      offset: broken ? Math.ceil(Math.abs(minY)) : 0,
      minY,
      values
    };
  }

  function toFiniteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function applyIosViewportOriginFix(offset) {
    const root = document.documentElement;
    root.style.setProperty(IOS_VIEWPORT_FIX_VAR, `${Math.max(0, offset)}px`);
    root.classList.add(IOS_VIEWPORT_FIX_CLASS);
  }

  function clearIosViewportOriginFix() {
    const root = document.documentElement;
    const hadFix = root.classList.contains(IOS_VIEWPORT_FIX_CLASS) ||
      root.style.getPropertyValue(IOS_VIEWPORT_FIX_VAR);
    root.classList.remove(IOS_VIEWPORT_FIX_CLASS);
    root.style.removeProperty(IOS_VIEWPORT_FIX_VAR);
    return !!hadFix;
  }

  function resetStandaloneScrollState() {
    try { window.scrollTo(0, 0); } catch (_) { /* ignore */ }
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    document.getElementById('v3-main')?.scrollTo?.(0, 0);
  }

  function forceShellLayoutRead() {
    void document.documentElement.getBoundingClientRect();
    void document.body.getBoundingClientRect();
    void document.getElementById('v3-main')?.getBoundingClientRect();
    void document.getElementById('v3-topbar')?.getBoundingClientRect();
    void document.querySelector('.screen.active')?.getBoundingClientRect();
    void document.querySelector('.mobile-ui-bottom-nav')?.getBoundingClientRect();
  }

  function addWindowListener(type, handler) {
    window.addEventListener(type, handler, { passive: true });
    return () => window.removeEventListener(type, handler);
  }

  function addFeedBackListener(type, handler) {
    const bus = window.feedBack;
    if (!bus || typeof bus.on !== 'function' || typeof bus.off !== 'function') return () => {};

    bus.on(type, handler);
    return () => bus.off(type, handler);
  }

  function reportFeatureError(phase, featureName, error) {
    if (!isDebugEnabled()) return;
    const key = `${phase}:${featureName}`;
    if (reportedFeatureErrors.has(key)) return;
    reportedFeatureErrors.add(key);
    console.warn('[mobile_ui] feature lifecycle error', {
      phase,
      feature: featureName,
      error
    });
  }

  runtime.install = install;
  return runtime;
}

function applyRootClasses(state) {
  const root = document.documentElement;
  removeRootClasses();

  if (state.disabled) {
    root.classList.add('mobile-ui-disabled');
    return;
  }

  const viewport = state.viewport;
  root.classList.add('mobile-ui-enabled');
  root.classList.add(`mobile-ui-${viewport.deviceClass}`);
  root.classList.add(viewport.orientation === 'landscape' ? 'mobile-ui-landscape' : 'mobile-ui-portrait');
  root.classList.add(`mobile-ui-screen-${state.screen || 'unknown'}`);

  if (viewport.standalone) {
    root.classList.add('mobile-ui-standalone');
  }

  if (state.isV3) {
    root.classList.add('mobile-ui-v3');
  }
}

function removeRootClasses() {
  document.documentElement.classList.remove(...ROOT_CLASSES);
}

function readStorageFlag(key) {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch (_) {
    return false;
  }
}

function setStorageFlag(key, value) {
  try {
    if (value) window.localStorage.setItem(key, '1');
    else window.localStorage.removeItem(key);
  } catch (_) {
    /* private mode */
  }
}
