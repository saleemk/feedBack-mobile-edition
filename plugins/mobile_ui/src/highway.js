import { openMobileUiPluginSettings } from './plugins.js';

const STORAGE_KEY = 'mobile_ui.highwayCamera.v5';
const STORAGE_VERSION = 5;
const BRIDGE_OWNER = 'mobile_ui';
const OWNER_FIELD = '__mobileUiOwner';
const DEBUG_REFRESH_EVENT = 'mobile-ui:highway-camera-debug';
const CAMERA_VIEWS_CHANGED_EVENT = 'mobile-ui:highway-camera-views-changed';
const EPSILON = 0.001;
const REQUIRED_RENDERER_BRIDGE_FIELDS = Object.freeze([
  'projectionZoom',
  'viewOffsetX',
  'viewOffsetY',
  'boardAnchor',
  'boardAnchorReadout'
]);

const PROJECTION_ZOOM_MIN = 0.65;
const PROJECTION_ZOOM_MAX = 3.0;
const VIEW_OFFSET_X_MIN = -0.63;
const VIEW_OFFSET_X_MAX = 0.63;
const VIEW_OFFSET_Y_MIN = -0.63;
const VIEW_OFFSET_Y_MAX = 0.63;
const VIEW_OFFSET_Y_ZOOM_EXPANSION = 0.63;
const VIEW_OFFSET_X_PER_PX = 0.00126;
const VIEW_OFFSET_Y_PER_PX = 0.001155;
const PAN_INTENT_THRESHOLD_PX = 10;
const PINCH_INTENT_THRESHOLD = 0.045;
const COHERENT_PAN_INTENT_THRESHOLD_PX = 6;
const COHERENT_PAN_MIN_COSINE = 0.45;
const COHERENT_PAN_MIN_BALANCE = 0.4;
const PINCH_DOMINANCE_RATIO = 1.35;
const PINCH_DOMINANCE_MARGIN_PX = 3;
const AMBIGUOUS_PINCH_DEFER_SAMPLES = 2;
const PAN_AXIS_DEADZONE_PX = 2;
const PAN_SMOOTHING_FACTOR = 0.58;

const DEFAULT_CAMERA = Object.freeze({
  projectionZoom: 1,
  viewOffsetX: 0,
  viewOffsetY: 0
});

const NEUTRAL_CAMERA_BASELINE = Object.freeze({
  heightMul: 1,
  distMul: 1,
  pitch: 0,
  viewOffsetX: 0,
  viewOffsetY: 0
});

const CAMERA_BASELINE_PROFILES = Object.freeze({
  'phone:portrait': Object.freeze({
    ...NEUTRAL_CAMERA_BASELINE,
    heightMul: 0.65,
    distMul: 0.85
  }),
  'phone:landscape': Object.freeze({
    ...NEUTRAL_CAMERA_BASELINE,
    viewOffsetY: 0.175
  }),
  'tablet:portrait': Object.freeze({
    ...NEUTRAL_CAMERA_BASELINE,
    heightMul: 0.8
  }),
  'tablet:landscape': Object.freeze({
    ...NEUTRAL_CAMERA_BASELINE,
    viewOffsetY: 0.105
  })
});
const CAMERA_MODE_KEYS = Object.freeze(Object.keys(CAMERA_BASELINE_PROFILES));

const SELECTORS = {
  player: '#player',
  highway: '#highway',
  vizPicker: '#viz-picker',
  resetButton: '#mobile-ui-highway-camera-reset',
  blockingOverlays: [
    '.mobile-ui-player-controls-picker',
    '#v3-railzone .v3-rail-pop',
    '#section-practice-bar.section-practice-bar--open',
    '#v3-plugin-controls-slot [popover]',
    '#v3-plugin-controls-slot .popover',
    '#v3-plugin-controls-slot [role="dialog"]'
  ],
  ignoredTargets: [
    'button',
    'a',
    'input',
    'select',
    'textarea',
    'label',
    '[role="button"]',
    '[role="slider"]',
    '[contenteditable="true"]',
    '#player-controls',
    '#v3-player-rail',
    '#v3-railzone',
    '#v3-plugin-controls-slot',
    '#section-map',
    '#section-practice-control',
    '#section-practice-pill',
    '.mobile-ui-player-controls-picker',
    '.mobile-ui-player-controls-trigger',
    '.mobile-ui-player-tablet-controls',
    '.mobile-ui-player-landscape-controls',
    '.v3-rail-pop'
  ]
};
const BLOCKING_OVERLAY_SELECTOR = SELECTORS.blockingOverlays.join(',');

let _player = null;
let _vizPicker = null;
let _state = null;
let _camera = { ...DEFAULT_CAMERA };
let _pointers = new Map();
let _gesture = null;
let _cameraGestureActive = false;
let _suppressOneFingerGestures = false;
let _resetButton = null;
let _warnedExternalBridge = false;
let _pendingBridgeReleaseFrame = null;
let _debugRefreshFrame = null;
let _debugGesture = _createDebugGestureState();
let _boardAnchorSequence = 0;
let _inspectedRendererFactory = null;
let _rendererSupportsCompleteBridge = false;
let _cameraSupportNoticeShown = false;

export function isHighwayCameraGestureActive() {
  return _cameraGestureActive;
}

export function shouldSuppressHighwayOneFingerGestures() {
  return _cameraGestureActive || _suppressOneFingerGestures;
}

export function getHighwayCameraSupport() {
  if (typeof window.feedBackViz_highway_3d !== 'function') return 'renderer-unavailable';
  return _rendererHasCompleteBridgeSignature() ? 'ready' : 'core-update-required';
}

export function hasSavedHighwayCameraViews() {
  try {
    return Object.keys(_readCameraStore().views).length > 0;
  } catch (_) {
    return false;
  }
}

export function resetAllHighwayCameraViews() {
  try {
    _writeCameraStore(_createEmptyCameraStore());
  } catch (_) {
    return false;
  }

  _resetCamera('reset-all');
  return true;
}

export function getHighwayCameraDebugDiagnostics() {
  const selectedViz = _sanitizeDebugIdentifier(_getCurrentVizSelection() || 'unknown');
  const rendererAvailable = typeof window.feedBackViz_highway_3d === 'function';
  const compatibility = _getCameraCompatibilityState(_state);
  const bridgeInfo = _getBridgeDebugInfo();

  return {
    compatibility,
    eligible: compatibility === 'ready',
    selectedViz,
    rendererAvailable,
    rendererSupportsCompleteBridge: _rendererHasCompleteBridgeSignature(),
    bridgePresent: bridgeInfo.present,
    bridgeOwner: bridgeInfo.owner,
    bridgeEnabled: bridgeInfo.enabled,
    camera: _normalizeCamera(_camera),
    bridge: bridgeInfo.values,
    boardAnchor: bridgeInfo.boardAnchor,
    gestureActive: _cameraGestureActive,
    suppressOneFinger: _suppressOneFingerGestures,
    pointerCount: _pointers.size,
    resetVisible: _isResetVisible(),
    resetReleasePending: _pendingBridgeReleaseFrame != null,
    storageHasCamera: _hasStoredCameraForMode(),
    gestureDebug: _getGestureDebugSnapshot()
  };
}

export function createFeature() {
  return {
    name: 'highway',
    mount(ctx) {
      this.refresh(ctx);
    },
    refresh(ctx) {
      const nextState = ctx?.state || null;
      const previousModeKey = _getCameraBaselineModeKey(_state);
      const nextModeKey = _getCameraBaselineModeKey(nextState);
      if (previousModeKey !== nextModeKey) {
        _cancelCameraGestureForModeChange();
      }

      _state = nextState;
      if (!_cameraGestureActive) {
        _camera = _isCameraFeatureReady(_state)
          ? _readStoredCamera(nextModeKey)
          : { ...DEFAULT_CAMERA };
      }

      if (_isTouchPlayerState(_state)) {
        _bind();
        _bindVizPicker();
        _syncCameraFeatureState();
      } else {
        _unbind();
        _unbindVizPicker();
        _releaseOwnedBridge();
        _removeResetButton();
      }
    },
    unmount() {
      _state = null;
      _unbind();
      _unbindVizPicker();
      _cancelPendingBridgeRelease();
      _cancelDebugRefresh();
      _releaseOwnedBridge();
      _removeResetButton();
    }
  };
}

function _isTouchPlayerState(state) {
  if (!state || state.disabled || state.screen !== 'player' || !state.isV3) return false;
  const deviceClass = state.viewport?.deviceClass;
  return deviceClass === 'phone' || deviceClass === 'tablet';
}

function _isCameraContextEligible(state) {
  return _isTouchPlayerState(state) && _isSupportedGuitar3dViz();
}

function _isSupportedGuitar3dViz() {
  const selected = _getCurrentVizSelection();
  if (selected === 'highway_3d' || selected === 'venue') return true;

  // Auto can resolve through several renderers. Stay inactive unless the
  // visible/core selection is explicit enough to avoid changing 2D/drum/keys.
  return false;
}

function _getCameraCompatibilityState(state) {
  if (!_isTouchPlayerState(state)) return 'inactive';
  if (!_isCameraContextEligible(state)) return 'visualization-ineligible';

  const bridge = window.__h3dCamCtl;
  if (bridge && bridge[OWNER_FIELD] !== BRIDGE_OWNER) return 'bridge-owned-externally';
  if (getHighwayCameraSupport() !== 'ready') return 'core-update-required';
  return 'ready';
}

function _isCameraFeatureReady(state) {
  return _getCameraCompatibilityState(state) === 'ready';
}

function _getCurrentVizSelection() {
  const picker = document.querySelector(SELECTORS.vizPicker);
  const pickerValue = _normalizeVizId(picker?.value);
  if (pickerValue) return pickerValue;

  const venueState = _getVenueState();
  const selectedViz = _normalizeVizId(venueState?.selectedViz);
  if (selectedViz) return selectedViz;

  return _normalizeVizId(_readLocalStorage('vizSelection'));
}

function _getVenueState() {
  const api = window.v3VenueViz;
  if (!api || typeof api.getState !== 'function') return null;
  try {
    return api.getState();
  } catch (_) {
    return null;
  }
}

function _normalizeVizId(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function _readStoredCamera(modeKey = _getCameraBaselineModeKey(_state)) {
  if (!_isKnownCameraModeKey(modeKey)) return { ...DEFAULT_CAMERA };
  const store = _readCameraStore();
  return store.views[modeKey]
    ? _normalizeCamera(store.views[modeKey])
    : { ...DEFAULT_CAMERA };
}

function _readCameraStore() {
  const raw = _readLocalStorage(STORAGE_KEY);
  if (!raw) return _createEmptyCameraStore();

  try {
    const parsed = JSON.parse(raw);
    return _normalizeCameraStore(parsed);
  } catch (_) {
    return _createEmptyCameraStore();
  }
}

function _normalizeCameraStore(value) {
  const store = _createEmptyCameraStore();
  if (!value || value.version !== STORAGE_VERSION || !value.views || typeof value.views !== 'object') {
    return store;
  }

  for (const modeKey of CAMERA_MODE_KEYS) {
    const camera = _normalizeCamera(value.views[modeKey]);
    if (_hasCustomCamera(camera)) store.views[modeKey] = _serializeCamera(camera);
  }

  return store;
}

function _createEmptyCameraStore() {
  return {
    version: STORAGE_VERSION,
    views: {}
  };
}

function _persistCamera(modeKey = _getCameraBaselineModeKey(_state)) {
  if (!_isKnownCameraModeKey(modeKey)) return;

  try {
    const store = _readCameraStore();
    if (_hasCustomCamera()) {
      store.views[modeKey] = _serializeCamera(_camera);
    } else {
      delete store.views[modeKey];
    }

    _writeCameraStore(store);
  } catch (_) {
    /* private mode */
  }
}

function _writeCameraStore(store) {
  const views = {};
  for (const modeKey of CAMERA_MODE_KEYS) {
    const camera = _normalizeCamera(store?.views?.[modeKey]);
    if (_hasCustomCamera(camera)) views[modeKey] = _serializeCamera(camera);
  }

  if (Object.keys(views).length === 0) {
    window.localStorage.removeItem(STORAGE_KEY);
    _notifyCameraViewsChanged();
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
    version: STORAGE_VERSION,
    views
  }));
  _notifyCameraViewsChanged();
}

function _notifyCameraViewsChanged() {
  try {
    window.dispatchEvent(new CustomEvent(CAMERA_VIEWS_CHANGED_EVENT));
  } catch (_) {
    /* Settings availability must not affect camera persistence. */
  }
}

function _serializeCamera(camera) {
  const normalized = _normalizeCamera(camera);
  return {
    projectionZoom: _round(normalized.projectionZoom),
    viewOffsetX: _round(normalized.viewOffsetX),
    viewOffsetY: _round(normalized.viewOffsetY)
  };
}

function _hasStoredCameraForMode(modeKey = _getCameraBaselineModeKey(_state)) {
  if (!_isKnownCameraModeKey(modeKey)) return false;
  try {
    const store = _readCameraStore();
    return !!store.views[modeKey];
  } catch (_) {
    return false;
  }
}

function _isKnownCameraModeKey(modeKey) {
  return CAMERA_MODE_KEYS.includes(modeKey);
}

function _readLocalStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

function _normalizeCamera(value) {
  const projectionZoom = _clamp(
    _toFiniteNumber(value?.projectionZoom, DEFAULT_CAMERA.projectionZoom),
    PROJECTION_ZOOM_MIN,
    PROJECTION_ZOOM_MAX
  );
  const bounds = _getViewOffsetBounds({ projectionZoom });

  return {
    projectionZoom,
    viewOffsetX: _clamp(_toFiniteNumber(value?.viewOffsetX, DEFAULT_CAMERA.viewOffsetX), VIEW_OFFSET_X_MIN, VIEW_OFFSET_X_MAX),
    viewOffsetY: _clamp(_toFiniteNumber(value?.viewOffsetY, DEFAULT_CAMERA.viewOffsetY), bounds.viewOffsetYMin, bounds.viewOffsetYMax)
  };
}

function _getViewOffsetBounds(camera) {
  const projectionZoom = _clamp(
    _toFiniteNumber(camera?.projectionZoom, DEFAULT_CAMERA.projectionZoom),
    PROJECTION_ZOOM_MIN,
    PROJECTION_ZOOM_MAX
  );
  const zoomInRange = PROJECTION_ZOOM_MAX - DEFAULT_CAMERA.projectionZoom;
  const zoomInAmount = zoomInRange > EPSILON
    ? _clamp((projectionZoom - DEFAULT_CAMERA.projectionZoom) / zoomInRange, 0, 1)
    : 0;
  const yExpansion = VIEW_OFFSET_Y_ZOOM_EXPANSION * zoomInAmount;

  return {
    viewOffsetYMin: VIEW_OFFSET_Y_MIN - yExpansion,
    viewOffsetYMax: VIEW_OFFSET_Y_MAX + yExpansion
  };
}

function _hasCustomCamera(camera = _camera) {
  return Math.abs(_toFiniteNumber(camera?.projectionZoom, DEFAULT_CAMERA.projectionZoom) - DEFAULT_CAMERA.projectionZoom) > EPSILON ||
    Math.abs(_toFiniteNumber(camera?.viewOffsetX, DEFAULT_CAMERA.viewOffsetX) - DEFAULT_CAMERA.viewOffsetX) > EPSILON ||
    Math.abs(_toFiniteNumber(camera?.viewOffsetY, DEFAULT_CAMERA.viewOffsetY) - DEFAULT_CAMERA.viewOffsetY) > EPSILON;
}

function _resetCamera(debugEvent = 'reset') {
  _camera = { ...DEFAULT_CAMERA };
  _recordDebugEvent(debugEvent);
  if (!_isCameraFeatureReady(_state)) {
    _releaseOwnedBridge();
    _removeResetButton();
    _queueDebugRefresh();
    return;
  }

  _persistCamera();
  _writeDefaultBridgeForReset();
  if (!_hasNonNeutralCameraBaseline(_state)) {
    _scheduleOwnedBridgeRelease();
  }
  _removeResetButton();
  _queueDebugRefresh();
}

function _applyBridge(forceEnabled = false) {
  _cancelPendingBridgeRelease();
  if (!_isCameraFeatureReady(_state)) {
    _releaseOwnedBridge();
    return false;
  }

  const baseline = _getCameraBaseline(_state);
  const bridgeCamera = _composeBridgeCamera(_camera, baseline);
  const shouldEnable = _isCameraBaselineNonNeutral(baseline) ||
    forceEnabled || _cameraGestureActive || _hasCustomCamera();
  if (!shouldEnable) {
    _releaseOwnedBridge();
    return false;
  }

  const bridge = _getMobileUiBridge({ create: true });
  if (!bridge) {
    _warnExternalBridge();
    return false;
  }

  bridge.enabled = true;
  bridge.heightMul = bridgeCamera.heightMul;
  bridge.distMul = bridgeCamera.distMul;
  bridge.projectionZoom = bridgeCamera.projectionZoom;
  bridge.yaw = 0;
  bridge.pitch = bridgeCamera.pitch;
  bridge.panX = 0;
  bridge.panY = 0;
  bridge.viewOffsetX = bridgeCamera.viewOffsetX;
  bridge.viewOffsetY = bridgeCamera.viewOffsetY;
  bridge.boardAnchor = _getActiveBridgeBoardAnchor();
  _queueDebugRefresh();
  return true;
}

function _writeDefaultBridgeForReset() {
  if (!_isCameraFeatureReady(_state)) {
    _releaseOwnedBridge();
    return false;
  }
  const baseline = _getCameraBaseline(_state);
  const bridgeCamera = _composeBridgeCamera(DEFAULT_CAMERA, baseline);

  const bridge = _getMobileUiBridge({ create: true });
  if (!bridge) {
    _warnExternalBridge();
    return false;
  }

  bridge.enabled = true;
  bridge.heightMul = bridgeCamera.heightMul;
  bridge.distMul = bridgeCamera.distMul;
  bridge.projectionZoom = bridgeCamera.projectionZoom;
  bridge.yaw = 0;
  bridge.pitch = bridgeCamera.pitch;
  bridge.panX = 0;
  bridge.panY = 0;
  bridge.viewOffsetX = bridgeCamera.viewOffsetX;
  bridge.viewOffsetY = bridgeCamera.viewOffsetY;
  bridge.boardAnchor = _getDisabledBridgeBoardAnchor();
  _queueDebugRefresh();
  return true;
}

function _getCameraBaseline(state) {
  if (!_isCameraFeatureReady(state)) return NEUTRAL_CAMERA_BASELINE;
  return CAMERA_BASELINE_PROFILES[_getCameraBaselineModeKey(state)] || NEUTRAL_CAMERA_BASELINE;
}

function _getCameraBaselineModeKey(state) {
  const viewport = state?.viewport;
  const deviceClass = viewport?.deviceClass;
  const orientation = viewport?.orientation;
  if ((deviceClass !== 'phone' && deviceClass !== 'tablet') ||
      (orientation !== 'portrait' && orientation !== 'landscape')) {
    return null;
  }
  return `${deviceClass}:${orientation}`;
}

function _composeBridgeCamera(camera, baseline = NEUTRAL_CAMERA_BASELINE) {
  return {
    heightMul: baseline.heightMul,
    distMul: baseline.distMul,
    projectionZoom: _clamp(
      _toFiniteNumber(camera?.projectionZoom, DEFAULT_CAMERA.projectionZoom),
      PROJECTION_ZOOM_MIN,
      PROJECTION_ZOOM_MAX
    ),
    pitch: baseline.pitch,
    viewOffsetX: baseline.viewOffsetX + _toFiniteNumber(camera?.viewOffsetX, DEFAULT_CAMERA.viewOffsetX),
    viewOffsetY: baseline.viewOffsetY + _toFiniteNumber(camera?.viewOffsetY, DEFAULT_CAMERA.viewOffsetY)
  };
}

function _hasNonNeutralCameraBaseline(state) {
  return _isCameraBaselineNonNeutral(_getCameraBaseline(state));
}

function _isCameraBaselineNonNeutral(baseline) {
  return Math.abs(_toFiniteNumber(baseline.heightMul, 1) - NEUTRAL_CAMERA_BASELINE.heightMul) > EPSILON ||
    Math.abs(_toFiniteNumber(baseline.distMul, 1) - NEUTRAL_CAMERA_BASELINE.distMul) > EPSILON ||
    Math.abs(_toFiniteNumber(baseline.pitch, 0) - NEUTRAL_CAMERA_BASELINE.pitch) > EPSILON ||
    Math.abs(_toFiniteNumber(baseline.viewOffsetX, 0) - NEUTRAL_CAMERA_BASELINE.viewOffsetX) > EPSILON ||
    Math.abs(_toFiniteNumber(baseline.viewOffsetY, 0) - NEUTRAL_CAMERA_BASELINE.viewOffsetY) > EPSILON;
}

function _getMobileUiBridge({ create = false } = {}) {
  if (create && !_isCameraFeatureReady(_state)) return null;

  const current = window.__h3dCamCtl;
  if (current) {
    if (current[OWNER_FIELD] !== BRIDGE_OWNER) return null;
    if (create) _ensureBridgeBoardAnchorReadout(current);
    return current;
  }

  if (!create) return null;

  const bridge = {
    enabled: false,
    heightMul: 1,
    distMul: 1,
    projectionZoom: 1,
    yaw: 0,
    pitch: 0,
    panX: 0,
    panY: 0,
    viewOffsetX: 0,
    viewOffsetY: 0,
    boardAnchor: _getDisabledBridgeBoardAnchor(),
    boardAnchorReadout: _createBridgeBoardAnchorReadout()
  };

  try {
    Object.defineProperty(bridge, OWNER_FIELD, {
      value: BRIDGE_OWNER,
      enumerable: false,
      configurable: true
    });
  } catch (_) {
    bridge[OWNER_FIELD] = BRIDGE_OWNER;
  }

  window.__h3dCamCtl = bridge;
  return bridge;
}

function _createBridgeBoardAnchorReadout() {
  return {
    active: false,
    requestId: 0,
    viewOffsetDeltaX: 0,
    viewOffsetDeltaY: 0
  };
}

function _ensureBridgeBoardAnchorReadout(bridge) {
  if (!bridge || bridge[OWNER_FIELD] !== BRIDGE_OWNER) return null;
  if (_hasBridgeBoardAnchorReadoutStorage(bridge.boardAnchorReadout)) {
    return bridge.boardAnchorReadout;
  }

  try {
    bridge.boardAnchorReadout = _createBridgeBoardAnchorReadout();
  } catch (_) {
    /* owned bridge shape repair must never affect gestures */
  }

  return _hasBridgeBoardAnchorReadoutStorage(bridge.boardAnchorReadout)
    ? bridge.boardAnchorReadout
    : null;
}

function _hasBridgeBoardAnchorReadoutStorage(readout) {
  return !!readout && typeof readout === 'object';
}

function _releaseOwnedBridge({ cancelPending = true } = {}) {
  if (cancelPending) _cancelPendingBridgeRelease();
  const bridge = _getMobileUiBridge();
  if (!bridge) return;

  if (_rendererHasCompleteBridgeSignature()) {
    bridge.enabled = false;
    bridge.heightMul = 1;
    bridge.distMul = 1;
    bridge.projectionZoom = 1;
    bridge.yaw = 0;
    bridge.pitch = 0;
    bridge.panX = 0;
    bridge.panY = 0;
    bridge.viewOffsetX = 0;
    bridge.viewOffsetY = 0;
    bridge.boardAnchor = _getDisabledBridgeBoardAnchor();
  }

  try {
    delete window.__h3dCamCtl;
  } catch (_) {
    window.__h3dCamCtl = undefined;
  }
}

function _scheduleOwnedBridgeRelease() {
  _cancelPendingBridgeRelease();

  if (typeof window.requestAnimationFrame !== 'function') {
    _releaseOwnedBridge({ cancelPending: false });
    _queueDebugRefresh();
    return;
  }

  _pendingBridgeReleaseFrame = window.requestAnimationFrame(() => {
    _pendingBridgeReleaseFrame = window.requestAnimationFrame(() => {
      _pendingBridgeReleaseFrame = null;
      _releaseOwnedBridge({ cancelPending: false });
      _queueDebugRefresh();
    });
  });
  _queueDebugRefresh();
}

function _cancelPendingBridgeRelease() {
  if (_pendingBridgeReleaseFrame == null) return;
  try {
    window.cancelAnimationFrame?.(_pendingBridgeReleaseFrame);
  } catch (_) {
    /* ignore */
  }
  _pendingBridgeReleaseFrame = null;
}

function _warnExternalBridge() {
  if (_warnedExternalBridge || !_isDebugEnabled()) return;
  _warnedExternalBridge = true;
  console.debug('[mobile_ui] 3D Highway camera bridge already exists; Mobile UI camera gesture inactive');
}

function _isDebugEnabled() {
  try {
    return window.localStorage.getItem('mobile_ui.debug') === '1';
  } catch (_) {
    return false;
  }
}

function _syncCameraFeatureState() {
  const compatibility = _getCameraCompatibilityState(_state);
  if (compatibility === 'ready') {
    _applyBridge();
    _syncResetButton();
  } else {
    if (_cameraGestureActive || _gesture || _pointers.size > 0 || _suppressOneFingerGestures) {
      _resetGestureState();
    }
    if (
      compatibility === 'core-update-required' &&
      getHighwayCameraSupport() === 'core-update-required'
    ) {
      _showCameraSupportNotice();
    }
    if (compatibility === 'bridge-owned-externally') _warnExternalBridge();
    _releaseOwnedBridge();
    _removeResetButton();
  }
}

function _showCameraSupportNotice() {
  if (_cameraSupportNoticeShown) return;
  const show = window.fbNotify?.show;
  if (typeof show !== 'function') return;

  try {
    const notice = show({
      icon: '⚠️',
      title: '3D camera controls need an update',
      message: 'Open Mobile UI settings for the optional camera setup.',
      durationMs: 8000
    });
    _cameraSupportNoticeShown = true;
    _makeCameraSupportNoticeActionable(notice);
  } catch (_) {
    /* Notifications must never affect Player behavior. */
  }
}

function _makeCameraSupportNoticeActionable(notice) {
  if (!notice || typeof notice.addEventListener !== 'function') return;

  try {
    let activated = false;
    const activate = () => {
      if (activated) return;
      activated = true;
      openMobileUiPluginSettings();
    };

    notice.tabIndex = 0;
    notice.setAttribute?.('role', 'button');
    notice.setAttribute?.('aria-label', 'Open Mobile UI settings for optional 3D camera setup');
    notice.addEventListener('click', activate);
    notice.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (typeof notice.click === 'function') notice.click();
      else activate();
    });
  } catch (_) {
    /* A non-actionable notification must remain harmless. */
  }
}

function _bind() {
  const player = document.querySelector(SELECTORS.player);
  if (!player) {
    _unbind();
    return;
  }

  if (_player === player) return;
  _unbind();
  _player = player;
  _player.addEventListener('pointerdown', _onPointerDown, { passive: true });
  _player.addEventListener('pointermove', _onPointerMove, { passive: false });
  _player.addEventListener('pointerup', _onPointerUp, { passive: true });
  _player.addEventListener('pointercancel', _onPointerCancel, { passive: true });
  _player.addEventListener('lostpointercapture', _onLostPointerCapture, { passive: true });
}

function _unbind() {
  if (_player) {
    _player.removeEventListener('pointerdown', _onPointerDown);
    _player.removeEventListener('pointermove', _onPointerMove);
    _player.removeEventListener('pointerup', _onPointerUp);
    _player.removeEventListener('pointercancel', _onPointerCancel);
    _player.removeEventListener('lostpointercapture', _onLostPointerCapture);
  }

  _player = null;
  _resetGestureState();
}

function _cancelCameraGestureForModeChange() {
  if (!_cameraGestureActive && !_gesture && _pointers.size === 0 && !_suppressOneFingerGestures) return;
  _recordDebugEvent('mode-change');
  _resetGestureState();
}

function _bindVizPicker() {
  const picker = document.querySelector(SELECTORS.vizPicker);
  if (!picker) {
    _unbindVizPicker();
    return;
  }

  if (_vizPicker === picker) return;
  _unbindVizPicker();
  _vizPicker = picker;
  _vizPicker.addEventListener('change', _onVizSelectionChanged);
}

function _unbindVizPicker() {
  if (_vizPicker) {
    _vizPicker.removeEventListener('change', _onVizSelectionChanged);
  }
  _vizPicker = null;
}

function _onVizSelectionChanged() {
  _recordDebugEvent('reset');
  _resetGestureState();
  _camera = _isCameraFeatureReady(_state) ? _readStoredCamera() : { ...DEFAULT_CAMERA };
  _syncCameraFeatureState();
}

function _onPointerDown(event) {
  if (!_canStartPointer(event)) {
    _queueDebugRefresh();
    return;
  }
  if (_pointers.size >= 2) {
    _recordDebugEvent('extra-pointer');
    return;
  }

  _pointers.set(event.pointerId, {
    pointerId: event.pointerId,
    target: event.target,
    x: event.clientX,
    y: event.clientY
  });
  _recordDebugEvent('pointerdown');

  try {
    event.target.setPointerCapture?.(event.pointerId);
  } catch (_) {
    /* ignore */
  }

  if (_pointers.size === 2 && !_cameraGestureActive) {
    _startCameraGesture();
  }
}

function _onPointerMove(event) {
  const pointer = _pointers.get(event.pointerId);
  if (!pointer) return;

  pointer.x = event.clientX;
  pointer.y = event.clientY;
  _recordDebugEvent('move');

  const ready = _isCameraFeatureReady(_state);
  if (!ready || _hasVisibleBlockingOverlay()) {
    _recordDebugEvent(!ready ? 'ineligible' : 'blocked');
    _resetGestureState();
    _syncCameraFeatureState();
    return;
  }

  if (!_cameraGestureActive && _pointers.size === 2) {
    _startCameraGesture();
  }

  if (!_cameraGestureActive) return;

  event.preventDefault();
  _applyCameraGesture();
}

function _onPointerUp(event) {
  _releaseTrackedPointer(event);
}

function _onPointerCancel(event) {
  _recordDebugEvent('cancel');
  _releaseTrackedPointer(event);
}

function _onLostPointerCapture(event) {
  if (!_pointers.has(event.pointerId)) return;
  _recordDebugEvent('lostcapture');
  _releaseTrackedPointer(event, { releaseCapture: false });
}

function _releaseTrackedPointer(event, { releaseCapture = true } = {}) {
  const removed = _removePointer(event, { releaseCapture });
  if (!removed) return;

  if (_cameraGestureActive && _pointers.size < 2) {
    _finishCameraGesture();
  }
  if (_pointers.size === 0) {
    _suppressOneFingerGestures = false;
  }
}

function _canStartPointer(event) {
  if (!_isCameraFeatureReady(_state) || !_isTouchPointer(event)) {
    _recordDebugEvent('ineligible');
    return false;
  }
  if (!_isCurrentHighwayTarget(event.target) || _isIgnoredTarget(event.target)) {
    _recordDebugEvent('blocked');
    return false;
  }
  if (_hasVisibleBlockingOverlay()) {
    _recordDebugEvent('blocked');
    return false;
  }
  if (!_canUseMobileUiBridge()) {
    _recordDebugEvent('blocked');
    return false;
  }
  return true;
}

function _canUseMobileUiBridge() {
  const current = window.__h3dCamCtl;
  return !current || current[OWNER_FIELD] === BRIDGE_OWNER;
}

function _startCameraGesture() {
  if (!_isCameraFeatureReady(_state) || _cameraGestureActive || _pointers.size !== 2) return;
  const points = _getGesturePointers();
  if (points.length !== 2) return;

  const startMidpoint = _midpoint(points[0], points[1]);
  const startBridgeCamera = _composeBridgeCamera(_camera, _getCameraBaseline(_state));
  _suppressOneFingerGestures = true;
  _cameraGestureActive = true;
  _recordDebugEvent('start');
  _gesture = {
    startCamera: { ..._camera },
    startBridgeCamera,
    startDistance: Math.max(1, _distance(points[0], points[1])),
    startMidpoint,
    startPointers: _copyPointerPositions(points),
    boardAnchorRequestId: _nextBoardAnchorRequestId(),
    lastMidpoint: startMidpoint,
    mode: 'undecided',
    lockReason: 'none',
    ambiguousPinchSamples: 0,
    smoothedPanX: 0,
    smoothedPanY: 0
  };
  _debugGesture.lastIntent = 'none';
  _debugGesture.lastIntentReason = 'none';
  _debugGesture.lastClampHitProjectionZoom = false;
  _debugGesture.lastClampHitX = false;
  _debugGesture.lastClampHitY = false;

  _applyBridge(true);
  _syncResetButton();
}

function _applyCameraGesture() {
  if (!_isCameraFeatureReady(_state)) {
    _resetGestureState();
    _syncCameraFeatureState();
    return;
  }

  const points = _getGesturePointers();
  if (!_gesture || points.length < 2) return;

  const distance = Math.max(1, _distance(points[0], points[1]));
  const scale = distance / _gesture.startDistance;
  const midpoint = _midpoint(points[0], points[1]);
  _gesture.lastMidpoint = midpoint;
  const dx = midpoint.x - _gesture.startMidpoint.x;
  const dy = midpoint.y - _gesture.startMidpoint.y;
  const midpointMove = Math.hypot(dx, dy);
  const scaleDelta = Math.abs(scale - 1);
  const distanceChange = Math.abs(distance - _gesture.startDistance);
  const movement = _getPointerMovementMetrics(points);
  const intent = _resolveGestureIntent({
    midpointMove,
    scaleDelta,
    distanceChange,
    movement
  });
  const panActive = intent === 'pan';
  const pinchActive = intent === 'pinch';
  const panDelta = panActive
    ? _getSmoothedPanDelta(dx, dy)
    : _resetSmoothedPanDelta();
  const rawCamera = {
    projectionZoom: pinchActive
      ? _gesture.startCamera.projectionZoom * scale
      : _gesture.startCamera.projectionZoom,
    viewOffsetX: _gesture.startCamera.viewOffsetX +
      panDelta.x,
    viewOffsetY: _gesture.startCamera.viewOffsetY +
      panDelta.y
  };

  _camera = _normalizeCamera(rawCamera);
  _debugGesture.lastIntent = intent;
  _debugGesture.lastIntentReason = _gesture.lockReason;
  _debugGesture.lastClampHitProjectionZoom = Math.abs(rawCamera.projectionZoom - _camera.projectionZoom) > EPSILON;
  _debugGesture.lastClampHitX = Math.abs(rawCamera.viewOffsetX - _camera.viewOffsetX) > EPSILON;
  _debugGesture.lastClampHitY = Math.abs(rawCamera.viewOffsetY - _camera.viewOffsetY) > EPSILON;
  _recordDebugEvent('apply');

  _applyBridge(true);
  _syncResetButton();
}

function _resolveGestureIntent({ midpointMove, scaleDelta, distanceChange, movement }) {
  if (_gesture.mode !== 'undecided') return _gesture.mode;

  const coherentPan = _isCoherentPanMovement(movement, midpointMove);
  const panActive = midpointMove >= PAN_INTENT_THRESHOLD_PX || coherentPan;
  const pinchActive = scaleDelta >= PINCH_INTENT_THRESHOLD;
  const pinchDominates = _doesPinchDominate(distanceChange, midpointMove);

  if (coherentPan && (!pinchActive || !pinchDominates)) {
    _lockGestureMode('pan', 'coherent-pan');
  } else if (panActive && (!pinchActive || !pinchDominates)) {
    _lockGestureMode('pan', 'midpoint-pan');
  } else if (pinchActive && pinchDominates) {
    if (_shouldDeferAmbiguousPinch(movement, midpointMove)) {
      _gesture.ambiguousPinchSamples += 1;
      _gesture.lockReason = 'defer-ambiguous-pinch';
    } else {
      _lockGestureMode('pinch', 'pinch-dominates');
    }
  }

  return _gesture.mode === 'undecided' ? 'none' : _gesture.mode;
}

function _lockGestureMode(mode, reason) {
  _gesture.mode = mode;
  _gesture.lockReason = reason;
}

function _getActiveBridgeBoardAnchor() {
  if (!_gesture || _gesture.mode === 'pan') return _getDisabledBridgeBoardAnchor();

  const startBridgeCamera = _gesture.startBridgeCamera ||
    _composeBridgeCamera(_gesture.startCamera, _getCameraBaseline(_state));
  const midpoint = _gesture.mode === 'pinch'
    ? (_gesture.lastMidpoint || _gesture.startMidpoint)
    : _gesture.startMidpoint;
  if (!midpoint || !Number.isFinite(midpoint.x) || !Number.isFinite(midpoint.y)) {
    return _getDisabledBridgeBoardAnchor();
  }

  return {
    enabled: true,
    requestId: _gesture.boardAnchorRequestId,
    clientX: midpoint.x,
    clientY: midpoint.y,
    capture: {
      clientX: _gesture.startMidpoint.x,
      clientY: _gesture.startMidpoint.y,
      projectionZoom: startBridgeCamera.projectionZoom,
      viewOffsetX: startBridgeCamera.viewOffsetX,
      viewOffsetY: startBridgeCamera.viewOffsetY
    }
  };
}

function _getDisabledBridgeBoardAnchor() {
  return {
    enabled: false
  };
}

function _nextBoardAnchorRequestId() {
  _boardAnchorSequence = (_boardAnchorSequence + 1) % 1000000;
  return _boardAnchorSequence || 1;
}

function _copyPointerPositions(points) {
  return points.map((point) => ({
    pointerId: point.pointerId,
    x: point.x,
    y: point.y
  }));
}

function _getPointerMovementMetrics(points) {
  const fallback = {
    coherence: 0,
    balance: 0,
    maxMove: 0,
    bothMoved: false
  };
  if (!_gesture?.startPointers || points.length < 2) return fallback;

  const movements = points.slice(0, 2).map((point) => {
    const start = _gesture.startPointers.find((candidate) => candidate.pointerId === point.pointerId);
    if (!start) return null;
    const x = point.x - start.x;
    const y = point.y - start.y;
    return {
      x,
      y,
      magnitude: Math.hypot(x, y)
    };
  });

  if (!movements[0] || !movements[1]) return fallback;

  const firstMagnitude = movements[0].magnitude;
  const secondMagnitude = movements[1].magnitude;
  const maxMove = Math.max(firstMagnitude, secondMagnitude);
  if (maxMove <= EPSILON) return fallback;

  const minMove = Math.min(firstMagnitude, secondMagnitude);
  const balance = minMove / maxMove;
  const bothMoved = minMove >= COHERENT_PAN_INTENT_THRESHOLD_PX / 2;
  const coherence = bothMoved
    ? _getVectorCosine(movements[0], movements[1])
    : 0;

  return {
    coherence,
    balance,
    maxMove,
    bothMoved
  };
}

function _isCoherentPanMovement(movement, midpointMove) {
  return midpointMove >= COHERENT_PAN_INTENT_THRESHOLD_PX &&
    movement.bothMoved &&
    movement.coherence >= COHERENT_PAN_MIN_COSINE &&
    movement.balance >= COHERENT_PAN_MIN_BALANCE;
}

function _doesPinchDominate(distanceChange, midpointMove) {
  return distanceChange >= (midpointMove * PINCH_DOMINANCE_RATIO) + PINCH_DOMINANCE_MARGIN_PX;
}

function _shouldDeferAmbiguousPinch(movement, midpointMove) {
  if (_gesture.ambiguousPinchSamples >= AMBIGUOUS_PINCH_DEFER_SAMPLES) return false;
  if (midpointMove < COHERENT_PAN_INTENT_THRESHOLD_PX) return false;
  if (movement.bothMoved && movement.balance >= COHERENT_PAN_MIN_BALANCE) return false;
  return movement.maxMove >= COHERENT_PAN_INTENT_THRESHOLD_PX;
}

function _getVectorCosine(a, b) {
  const denominator = a.magnitude * b.magnitude;
  if (denominator <= EPSILON) return 0;
  return ((a.x * b.x) + (a.y * b.y)) / denominator;
}

function _getSmoothedPanDelta(dx, dy) {
  const targetX = -_applyAxisDeadzone(dx, PAN_AXIS_DEADZONE_PX) * VIEW_OFFSET_X_PER_PX;
  const targetY = -_applyAxisDeadzone(dy, PAN_AXIS_DEADZONE_PX) * VIEW_OFFSET_Y_PER_PX;
  _gesture.smoothedPanX += (targetX - _gesture.smoothedPanX) * PAN_SMOOTHING_FACTOR;
  _gesture.smoothedPanY += (targetY - _gesture.smoothedPanY) * PAN_SMOOTHING_FACTOR;
  return {
    x: _gesture.smoothedPanX,
    y: _gesture.smoothedPanY
  };
}

function _resetSmoothedPanDelta() {
  _gesture.smoothedPanX = 0;
  _gesture.smoothedPanY = 0;
  return { x: 0, y: 0 };
}

function _applyAxisDeadzone(value, deadzone) {
  if (Math.abs(value) <= deadzone) return 0;
  return value > 0 ? value - deadzone : value + deadzone;
}

function _finishCameraGesture() {
  _settleCameraFromBoardAnchorReadout();
  _cameraGestureActive = false;
  _gesture = null;
  _recordDebugEvent('finish');
  _persistCamera();
  _applyBridge();
  _syncResetButton();
}

function _settleCameraFromBoardAnchorReadout() {
  if (_gesture?.mode !== 'pinch') return false;
  const correction = _getBridgeBoardAnchorReadout(_gesture?.boardAnchorRequestId);
  if (!correction) return false;

  _camera = _normalizeCamera({
    ..._camera,
    viewOffsetX: _camera.viewOffsetX + correction.viewOffsetDeltaX,
    viewOffsetY: _camera.viewOffsetY + correction.viewOffsetDeltaY
  });
  return true;
}

function _getBridgeBoardAnchorReadout(boardAnchorRequestId) {
  if (!Number.isFinite(boardAnchorRequestId)) return null;

  const bridge = _getMobileUiBridge();
  const readout = bridge?.boardAnchorReadout;
  if (!readout || readout.active !== true) return null;

  const readoutId = Number(readout.requestId);
  const viewOffsetDeltaX = Number(readout.viewOffsetDeltaX);
  const viewOffsetDeltaY = Number(readout.viewOffsetDeltaY);
  if (!Number.isFinite(readoutId) || readoutId !== boardAnchorRequestId) return null;
  if (!Number.isFinite(viewOffsetDeltaX) || !Number.isFinite(viewOffsetDeltaY)) return null;

  return { viewOffsetDeltaX, viewOffsetDeltaY };
}

function _resetGestureState() {
  const pointers = Array.from(_pointers.values());
  _pointers = new Map();
  _gesture = null;
  _cameraGestureActive = false;
  _suppressOneFingerGestures = false;
  pointers.forEach(_releasePointerCapture);
  _queueDebugRefresh();
}

function _removePointer(event, { releaseCapture = true } = {}) {
  const pointer = _pointers.get(event.pointerId);
  if (!pointer) return false;

  _pointers.delete(event.pointerId);
  if (releaseCapture) _releasePointerCapture(pointer);
  return true;
}

function _releasePointerCapture(pointer) {
  try {
    pointer.target?.releasePointerCapture?.(pointer.pointerId);
  } catch (_) {
    /* ignore */
  }
}

function _getGesturePointers() {
  return Array.from(_pointers.values()).slice(0, 2);
}

function _isTouchPointer(event) {
  return event.pointerType === 'touch' || event.pointerType === 'pen';
}

function _isCurrentHighwayTarget(target) {
  const highway = document.querySelector(SELECTORS.highway);
  return !!highway && target === highway;
}

function _closest(target, selectors) {
  return target && typeof target.closest === 'function'
    ? target.closest(selectors.join(','))
    : null;
}

function _isIgnoredTarget(target) {
  return !!_closest(target, SELECTORS.ignoredTargets);
}

function _isVisible(el) {
  if (!el || el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
  if (el.classList?.contains('hidden')) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function _getVisibleBlockingOverlay() {
  return Array.from(document.querySelectorAll(BLOCKING_OVERLAY_SELECTOR)).find(_isVisible) || null;
}

function _hasVisibleBlockingOverlay() {
  return !!_getVisibleBlockingOverlay();
}

function _syncResetButton() {
  if (!_isCameraFeatureReady(_state) || !_hasCustomCamera() || !_canUseMobileUiBridge()) {
    _removeResetButton();
    return;
  }

  const player = _getConnectedPlayer();
  if (!player) {
    _removeResetButton();
    return;
  }

  if (!_resetButton || !_resetButton.isConnected) {
    _resetButton = document.createElement('button');
    _resetButton.id = 'mobile-ui-highway-camera-reset';
    _resetButton.className = 'mobile-ui-highway-camera-reset';
    _resetButton.type = 'button';
    _resetButton.textContent = 'Reset view';
    _resetButton.setAttribute('aria-label', 'Reset 3D Highway camera view');
    _resetButton.addEventListener('click', _onResetClick);
  }

  if (_resetButton.parentElement === player) return;

  if (_resetButton.parentElement !== player) {
    player.appendChild(_resetButton);
  }
}

function _getConnectedPlayer() {
  if (_player?.isConnected) return _player;
  return document.querySelector(SELECTORS.player);
}

function _removeResetButton() {
  if (_resetButton) {
    _resetButton.removeEventListener('click', _onResetClick);
    _resetButton.remove();
  }
  _resetButton = null;
}

function _onResetClick(event) {
  event.preventDefault();
  _resetCamera();
}

function _distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function _midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2
  };
}

function _toFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function _clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function _round(value) {
  return Math.round(value * 10000) / 10000;
}

function _getBridgeDebugInfo() {
  const bridge = window.__h3dCamCtl;
  if (!bridge) {
    return {
      present: false,
      owner: 'absent',
      enabled: null,
      values: null,
      boardAnchor: null
    };
  }

  const owner = bridge[OWNER_FIELD] === BRIDGE_OWNER ? 'mobile-ui' : 'external';
  const values = {
    distMul: _round(_toFiniteNumber(bridge.distMul, 1)),
    projectionZoom: _round(_toFiniteNumber(bridge.projectionZoom, 1)),
    viewOffsetX: _round(_toFiniteNumber(bridge.viewOffsetX, 0)),
    viewOffsetY: _round(_toFiniteNumber(bridge.viewOffsetY, 0))
  };
  const boardAnchor = _getBridgeBoardAnchorDebugInfo(bridge.boardAnchor);

  return {
    present: true,
    owner,
    enabled: !!bridge.enabled,
    values,
    boardAnchor
  };
}

function _getBridgeBoardAnchorDebugInfo(boardAnchor) {
  if (!boardAnchor || typeof boardAnchor !== 'object') {
    return {
      present: false,
      enabled: false,
      requestId: null
    };
  }

  return {
    present: true,
    enabled: !!boardAnchor.enabled,
    requestId: Number.isFinite(boardAnchor.requestId) ? Math.round(boardAnchor.requestId) : null,
    capturePresent: !!boardAnchor.capture && typeof boardAnchor.capture === 'object'
  };
}

function _rendererHasCompleteBridgeSignature() {
  const factory = window.feedBackViz_highway_3d;
  if (factory === _inspectedRendererFactory) return _rendererSupportsCompleteBridge;

  _inspectedRendererFactory = factory;
  _rendererSupportsCompleteBridge = false;
  if (typeof factory !== 'function') return false;

  try {
    const source = Function.prototype.toString.call(factory);
    _rendererSupportsCompleteBridge = REQUIRED_RENDERER_BRIDGE_FIELDS.every((field) => source.includes(field));
  } catch (_) {
    /* unreadable renderer factories are unsupported */
  }

  return _rendererSupportsCompleteBridge;
}

function _isResetVisible() {
  const button = _resetButton || document.querySelector(SELECTORS.resetButton);
  return !!button && button.isConnected && !button.hidden;
}

function _sanitizeDebugIdentifier(value) {
  return String(value == null ? 'unknown' : value)
    .replace(/[^a-z0-9_-]/gi, '')
    .slice(0, 32) || 'unknown';
}

function _createDebugGestureState() {
  return {
    lastEvent: 'none',
    lastIntent: 'none',
    lastIntentReason: 'none',
    lastClampHitProjectionZoom: false,
    lastClampHitX: false,
    lastClampHitY: false,
    lastApplyAt: 0
  };
}

function _recordDebugEvent(eventName) {
  _debugGesture.lastEvent = _sanitizeDebugIdentifier(eventName || 'none');
  if (eventName === 'apply') _debugGesture.lastApplyAt = _now();
  _queueDebugRefresh();
}

function _getGestureDebugSnapshot() {
  const lastApplyAgeMs = _debugGesture.lastApplyAt
    ? Math.max(0, Math.round(_now() - _debugGesture.lastApplyAt))
    : null;

  return {
    lastEvent: _debugGesture.lastEvent,
    lastIntent: _debugGesture.lastIntent,
    lastIntentReason: _debugGesture.lastIntentReason,
    lastClampHitProjectionZoom: _debugGesture.lastClampHitProjectionZoom,
    lastClampHitX: _debugGesture.lastClampHitX,
    lastClampHitY: _debugGesture.lastClampHitY,
    lastApplyAgeMs
  };
}

function _queueDebugRefresh() {
  if (!_isDebugEnabled() || _debugRefreshFrame != null || typeof window.requestAnimationFrame !== 'function') return;
  _debugRefreshFrame = window.requestAnimationFrame(() => {
    _debugRefreshFrame = null;
    try {
      window.dispatchEvent(new CustomEvent(DEBUG_REFRESH_EVENT));
    } catch (_) {
      /* Debug refresh must never affect gestures. */
    }
  });
}

function _cancelDebugRefresh() {
  if (_debugRefreshFrame == null) return;
  try {
    window.cancelAnimationFrame(_debugRefreshFrame);
  } catch (_) {
    /* ignore */
  }
  _debugRefreshFrame = null;
}

function _now() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
