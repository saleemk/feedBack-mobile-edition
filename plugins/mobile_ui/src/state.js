export const GLOBAL_KEY = '__feedBackMobileUi';
export const PLUGIN_ID = 'mobile_ui';
// Keep synchronized with plugin.json. The host exposes manifest versions through
// plugin listings, but not as a stable runtime value for this module.
export const PLUGIN_VERSION = '0.4.0';
export const DISABLED_STORAGE_KEY = 'mobile_ui.disabled';
export const DEBUG_STORAGE_KEY = 'mobile_ui.debug';

export function createState() {
  return {
    installed: false,
    installedAt: null,
    disabled: false,
    debug: false,
    isV3: false,
    uiVersion: null,
    lastRefreshReason: 'created',
    viewport: null,
    listeners: [],
    refreshTimer: null,
    pendingRefreshReason: null,
    screenId: null,
    screen: 'unknown',
    safeArea: null
  };
}
