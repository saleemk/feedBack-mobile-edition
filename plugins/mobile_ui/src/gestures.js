import { shouldSuppressHighwayOneFingerGestures } from './highway.js';

const TAP_MOVE_THRESHOLD_PX = 12;
const TAP_MAX_DURATION_MS = 650;
const SCRUB_VERTICAL_THRESHOLD_PX = 20;
const SCRUB_SEEK_STEP_SECONDS = 1;
const SCRUB_VERTICAL_DOMINANCE_RATIO = 1.25;

const SELECTORS = {
  player: '#player',
  highway: '#highway',
  playButton: '#btn-play',
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

let _player = null;
let _state = null;
let _activePointer = null;
let _warnedMissingSeekBy = false;

function _isGestureEligible(state) {
  if (!state || state.disabled || state.screen !== 'player' || !state.isV3) return false;
  const deviceClass = state.viewport?.deviceClass;
  return deviceClass === 'phone' || deviceClass === 'tablet';
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
  for (const selector of SELECTORS.blockingOverlays) {
    const match = Array.from(document.querySelectorAll(selector)).find(_isVisible);
    if (match) return { selector, element: match };
  }
  return null;
}

function _hasVisibleBlockingOverlay() {
  return !!_getVisibleBlockingOverlay();
}

function _resetPointerState() {
  _activePointer = null;
}

function _isDebugEnabled() {
  try {
    return window.localStorage.getItem('mobile_ui.debug') === '1';
  } catch (_) {
    return false;
  }
}

function _debugGesture(reason, data = {}) {
  if (!_isDebugEnabled()) return;
  console.debug('[mobile_ui] highway gesture', {
    reason,
    ...data
  });
}

function _getSeekBy() {
  if (typeof window.seekBy === 'function') return window.seekBy;
  if (_isDebugEnabled() && !_warnedMissingSeekBy) {
    _warnedMissingSeekBy = true;
    _debugGesture('seekBy missing', { target: 'window.seekBy' });
  }
  return null;
}

function _canContinuePointerGesture(event, pointer) {
  return _isGestureEligible(_state) &&
    _isTouchPointer(event) &&
    _isCurrentHighwayTarget(pointer.target) &&
    !shouldSuppressHighwayOneFingerGestures() &&
    !_hasVisibleBlockingOverlay();
}

function _onPointerDown(event) {
  if (!_isGestureEligible(_state) || !_isTouchPointer(event) || event.isPrimary === false) return;
  if (shouldSuppressHighwayOneFingerGestures()) return;
  if (!_isCurrentHighwayTarget(event.target) || _isIgnoredTarget(event.target)) return;
  if (_hasVisibleBlockingOverlay()) return;

  _activePointer = {
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    target: event.target,
    x: event.clientX,
    y: event.clientY,
    lastY: event.clientY,
    scrubActive: false,
    scrubAccumulator: 0,
    tapCandidate: true,
    startedAt: Date.now()
  };
}

function _onPointerMove(event) {
  if (!_activePointer || event.pointerId !== _activePointer.pointerId) return;
  if (shouldSuppressHighwayOneFingerGestures()) {
    _resetPointerState();
    return;
  }

  const pointer = _activePointer;
  if (!_canContinuePointerGesture(event, pointer)) {
    _resetPointerState();
    return;
  }

  if (!pointer.scrubActive) {
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const verticalEnough = absDy >= SCRUB_VERTICAL_THRESHOLD_PX;
    const verticalDominates = absDy >= Math.max(absDx * SCRUB_VERTICAL_DOMINANCE_RATIO, SCRUB_VERTICAL_THRESHOLD_PX);
    if (!verticalEnough || !verticalDominates) return;

    pointer.scrubActive = true;
    pointer.tapCandidate = false;
    pointer.scrubAccumulator = dy;
    pointer.lastY = event.clientY;
    _debugGesture('scrub activated', { dx, dy });
  } else {
    pointer.scrubAccumulator += event.clientY - pointer.lastY;
    pointer.lastY = event.clientY;
  }

  event.preventDefault();
  _performScrubSteps(pointer);
}

function _onPointerUp(event) {
  if (!_activePointer || event.pointerId !== _activePointer.pointerId) return;
  if (shouldSuppressHighwayOneFingerGestures()) {
    _resetPointerState();
    return;
  }

  const pointer = _activePointer;
  _resetPointerState();

  if (!_canContinuePointerGesture(event, pointer)) return;
  if (pointer.scrubActive || !pointer.tapCandidate) return;
  if (!_isCurrentHighwayTarget(event.target) || _isIgnoredTarget(event.target)) return;

  const dx = event.clientX - pointer.x;
  const dy = event.clientY - pointer.y;
  const moved = Math.hypot(dx, dy);
  const duration = Date.now() - pointer.startedAt;
  if (moved > TAP_MOVE_THRESHOLD_PX || duration > TAP_MAX_DURATION_MS) return;

  const playButton = document.querySelector(SELECTORS.playButton);
  if (playButton) playButton.click();
}

function _performScrubSteps(pointer) {
  const seekBy = _getSeekBy();
  if (!seekBy) {
    pointer.scrubAccumulator = 0;
    return;
  }

  while (Math.abs(pointer.scrubAccumulator) >= SCRUB_VERTICAL_THRESHOLD_PX) {
    const direction = pointer.scrubAccumulator > 0 ? 1 : -1;
    const seconds = direction * SCRUB_SEEK_STEP_SECONDS;
    _debugGesture('scrub step fired', {
      direction: direction > 0 ? 'forward' : 'backward',
      seconds
    });
    seekBy(seconds);
    pointer.scrubAccumulator -= direction * SCRUB_VERTICAL_THRESHOLD_PX;
  }
}

function _onPointerCancel(event) {
  if (_activePointer && event.pointerId === _activePointer.pointerId) {
    _resetPointerState();
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
}

function _unbind() {
  if (_player) {
    _player.removeEventListener('pointerdown', _onPointerDown);
    _player.removeEventListener('pointermove', _onPointerMove);
    _player.removeEventListener('pointerup', _onPointerUp);
    _player.removeEventListener('pointercancel', _onPointerCancel);
  }
  _player = null;
  _resetPointerState();
}

export function createFeature() {
  return {
    name: 'gestures',
    mount(ctx) {
      this.refresh(ctx);
    },
    refresh(ctx) {
      _state = ctx?.state || null;
      if (_isGestureEligible(_state)) _bind();
      else _unbind();
    },
    unmount() {
      _state = null;
      _unbind();
    }
  };
}
