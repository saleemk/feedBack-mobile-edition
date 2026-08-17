import { DEBUG_STORAGE_KEY, PLUGIN_ID, PLUGIN_VERSION } from './state.js';
import { getHighwayCameraDebugDiagnostics } from './highway.js';

const HIGHWAY_CAMERA_DEBUG_EVENT = 'mobile-ui:highway-camera-debug';
const SHOW_LAYOUT_DEBUG = false;

export function createDebugOverlay({ state }) {
  let overlay = null;
  let collapsed = true;
  let latestDebugText = '';
  let copyStatus = 'Copy';
  let copyStatusTimer = null;
  let debugRefreshFrame = null;

  return {
    isEnabled,
    setEnabled,
    refresh,
    remove
  };

  function isEnabled() {
    try {
      return window.localStorage.getItem(DEBUG_STORAGE_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function setEnabled(value) {
    try {
      if (value) window.localStorage.setItem(DEBUG_STORAGE_KEY, '1');
      else window.localStorage.removeItem(DEBUG_STORAGE_KEY);
    } catch (_) {
      /* private mode */
    }
  }

  function refresh() {
    if (!isEnabled()) {
      remove();
      return;
    }

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'mobile-ui-debug-overlay';
      overlay.addEventListener('click', handleOverlayClick);
      window.addEventListener(HIGHWAY_CAMERA_DEBUG_EVENT, queueDebugOverlayRefresh);
      document.body.appendChild(overlay);
    }

    const viewport = state.viewport || {};
    const rotation = SHOW_LAYOUT_DEBUG ? getRotationDiagnostics() : null;
    const debugLines = getDebugLines(state, viewport, rotation);
    latestDebugText = debugLines.join('\n');
    const summary = [
      PLUGIN_ID,
      viewport.deviceClass || 'unknown',
      viewport.orientation || 'unknown',
      state.screen || 'unknown'
    ].join(' · ');
    overlay.classList.toggle('mobile-ui-debug-overlay-collapsed', collapsed);
    overlay.innerHTML = [
      `<button type="button" class="mobile-ui-debug-toggle" data-mobile-ui-debug-toggle aria-expanded="${collapsed ? 'false' : 'true'}">`,
      `<span>${escapeHtml(summary)}</span>`,
      `<span>${collapsed ? 'Show' : 'Hide'}</span>`,
      '</button>',
      '<div class="mobile-ui-debug-body">',
      '<div class="mobile-ui-debug-actions">',
      '<strong>Diagnostics</strong>',
      `<button type="button" class="mobile-ui-debug-copy" data-mobile-ui-debug-copy>${escapeHtml(copyStatus)}</button>`,
      '</div>',
      `<pre>${escapeHtml(latestDebugText)}</pre>`,
      '</div>'
    ].join('');
  }

  function handleOverlayClick(event) {
    if (event.target.closest('[data-mobile-ui-debug-copy]')) {
      copyDebugText();
      return;
    }

    if (event.target.closest('[data-mobile-ui-debug-toggle]')) {
      collapsed = !collapsed;
      refresh();
    }
  }

  async function copyDebugText() {
    const text = latestDebugText;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        setCopyStatus('Copied');
        return;
      } catch (_) {
        /* fall through to textarea fallback */
      }
    }

    setCopyStatus(copyDebugTextFallback(text) ? 'Copied' : 'Failed');
  }

  function copyDebugTextFallback(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch (_) { copied = false; }
    textarea.remove();
    return copied;
  }

  function setCopyStatus(status) {
    copyStatus = status;
    refresh();

    if (copyStatusTimer) window.clearTimeout(copyStatusTimer);
    copyStatusTimer = window.setTimeout(() => {
      copyStatus = 'Copy';
      copyStatusTimer = null;
      refresh();
    }, 1500);
  }

  function queueDebugOverlayRefresh() {
    if (!isEnabled() || debugRefreshFrame != null || typeof window.requestAnimationFrame !== 'function') return;
    debugRefreshFrame = window.requestAnimationFrame(() => {
      debugRefreshFrame = null;
      refresh();
    });
  }

  function remove() {
    if (debugRefreshFrame != null) {
      if (typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(debugRefreshFrame);
      }
      debugRefreshFrame = null;
    }
    if (copyStatusTimer) {
      window.clearTimeout(copyStatusTimer);
      copyStatusTimer = null;
    }
    if (overlay) {
      overlay.removeEventListener('click', handleOverlayClick);
      window.removeEventListener(HIGHWAY_CAMERA_DEBUG_EVENT, queueDebugOverlayRefresh);
      overlay.remove();
      overlay = null;
    }
  }
}

function getDebugLines(state, viewport, rotation) {
  const lines = [
    `${PLUGIN_ID} ${PLUGIN_VERSION}`,
    `device: ${viewport.deviceClass || 'unknown'} ${viewport.orientation || 'unknown'} ${window.innerWidth || 0}x${window.innerHeight || 0} standalone ${bool(viewport.standalone)}`,
    `runtime: ${state.screen || 'unknown'} v3 ${bool(state.isV3)} disabled ${bool(state.disabled)}`,
    `reason: ${state.lastRefreshReason || 'unknown'}`,
    '',
    ...getHighwayCameraDebugLines()
  ];

  if (!SHOW_LAYOUT_DEBUG || !rotation) return lines;

  return [
    ...lines,
    '',
    `inner: ${rotation.inner}`,
    `vv: ${rotation.visualViewport}`,
    `ios fix: ${rotation.iosViewportFix}`,
    `scroll win/doc/body/main: ${rotation.scroll}`,
    `main: ${rotation.mainBox}`,
    `topbar: ${rotation.topbarBox}`,
    `active: ${rotation.activeBox}`,
    `nav: ${rotation.navBox}`,
    `nav hit: ${rotation.navHit}`,
    `btn hit: ${rotation.buttonHit}`,
    `focus: ${rotation.focus}`
  ];
}

function getHighwayCameraDebugLines() {
  let info = null;
  try {
    info = getHighwayCameraDebugDiagnostics();
  } catch (_) {
    return ['hwy camera: unavailable'];
  }

  const camera = info.camera || {};
  const bridgeValues = info.bridge ? cameraValues(info.bridge) : 'n/a';
  const gesture = info.gestureDebug || {};
  const lines = [
    `hwy: ${safeLabel(info.selectedViz)} ${safeLabel(info.compatibility)} renderer ${bool(info.rendererAvailable)} contract ${bool(info.rendererSupportsCompleteBridge)}`,
    `bridge: ${bridgeLabel(info, bridgeValues)}`,
    `view: ${cameraValues(camera)} saved ${bool(info.storageHasCamera)} reset ${bool(info.resetVisible)}`,
    `gesture: ${info.gestureActive ? 'active' : 'idle'} p${num(info.pointerCount, 0)} ${safeLabel(gesture.lastIntent || 'none')}/${safeLabel(gesture.lastIntentReason || 'none')} last ${safeLabel(gesture.lastEvent || 'none')} ${ageLabel(gesture.lastApplyAgeMs)}`,
    `anchor: ${boardAnchorState(info.boardAnchor)}`
  ];

  if (info.suppressOneFinger) lines.push('one-finger gestures: suppressed');
  if (gesture.lastClampHitProjectionZoom || gesture.lastClampHitX || gesture.lastClampHitY) {
    lines.push(`limit: z ${bool(gesture.lastClampHitProjectionZoom)} x ${bool(gesture.lastClampHitX)} y ${bool(gesture.lastClampHitY)}`);
  }
  if (info.resetReleasePending) lines.push('bridge release: pending');
  return lines;
}

function getRotationDiagnostics() {
  const root = document.documentElement;
  const body = document.body;
  const main = document.getElementById('v3-main');
  const topbar = document.getElementById('v3-topbar');
  const active = document.querySelector('.screen.active');
  const nav = document.querySelector('.mobile-ui-bottom-nav');
  const navButton = document.querySelector('.mobile-ui-bottom-nav button, .mobile-ui-bottom-nav a');

  return {
    inner: `${window.innerWidth || 0}x${window.innerHeight || 0}`,
    visualViewport: getVisualViewportLabel(),
    iosViewportFix: getIosViewportFixLabel(root),
    scroll: [
      `${Math.round(window.scrollX || 0)},${Math.round(window.scrollY || 0)}`,
      `${Math.round(root.scrollLeft || 0)},${Math.round(root.scrollTop || 0)}`,
      `${Math.round(body?.scrollLeft || 0)},${Math.round(body?.scrollTop || 0)}`,
      `${Math.round(main?.scrollLeft || 0)},${Math.round(main?.scrollTop || 0)}`
    ].join(' / '),
    mainBox: getElementBox(main),
    topbarBox: getElementBox(topbar),
    activeBox: getElementBox(active),
    navBox: getElementBox(nav),
    navHit: getHitLabel(nav),
    buttonHit: getHitLabel(navButton),
    focus: getElementLabel(document.activeElement)
  };
}

function getIosViewportFixLabel(root) {
  const active = root.classList.contains('mobile-ui-ios-vv-offset-bug');
  const value = root.style.getPropertyValue('--mobile-ui-ios-vv-offset-fix').trim() || '0px';
  return `${active ? 'on' : 'off'} ${value}`;
}

function getVisualViewportLabel() {
  const viewport = window.visualViewport;
  if (!viewport) return 'n/a';
  return [
    `${Math.round(viewport.width)}x${Math.round(viewport.height)}`,
    `s${round2(viewport.scale)}`,
    `o${Math.round(viewport.offsetLeft)},${Math.round(viewport.offsetTop)}`,
    `p${Math.round(viewport.pageLeft)},${Math.round(viewport.pageTop)}`
  ].join(' ');
}

function getElementBox(element) {
  if (!element) return 'missing';
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return [
    `${Math.round(rect.x)},${Math.round(rect.y)}`,
    `${Math.round(rect.width)}x${Math.round(rect.height)}`,
    `pt${style.paddingTop}`,
    `mt${style.marginTop}`,
    `pos:${style.position}`,
    `tr:${style.transform === 'none' ? 'none' : 'yes'}`
  ].join(' ');
}

function getHitLabel(element) {
  if (!element) return 'missing';
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const hit = document.elementFromPoint(x, y);
  return `${Math.round(x)},${Math.round(y)} -> ${getElementLabel(hit)}`;
}

function getElementLabel(element) {
  if (!element) return 'none';
  const id = element.id ? `#${element.id}` : '';
  const cls = typeof element.className === 'string'
    ? `.${element.className.trim().replace(/\s+/g, '.').slice(0, 48)}`
    : '';
  const text = (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
  return `${element.tagName || 'node'}${id}${cls}${text ? ` "${text}"` : ''}`;
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function bool(value) {
  return value ? 'true' : 'false';
}

function num(value, digits) {
  const number = Number(value);
  if (!Number.isFinite(number)) return digits === 0 ? '0' : '0.00';
  return digits === 0 ? String(Math.round(number)) : number.toFixed(digits);
}

function bridgeState(info) {
  if (!info.bridgePresent) return 'absent';
  return info.bridgeEnabled ? 'enabled' : 'disabled';
}

function bridgeLabel(info, values) {
  if (!info.bridgePresent) return 'absent';
  return `${safeLabel(info.bridgeOwner)} ${bridgeState(info)} ${values}`;
}

function cameraValues(values) {
  const parts = [];
  if (Object.prototype.hasOwnProperty.call(values, 'projectionZoom')) {
    parts.push(`z${num(values.projectionZoom, 2)}`);
  }
  if (Object.prototype.hasOwnProperty.call(values, 'distMul')) {
    parts.push(`d${num(values.distMul, 2)}`);
  }
  parts.push(`x${num(values.viewOffsetX, 2)}`);
  parts.push(`y${num(values.viewOffsetY, 2)}`);
  return parts.join(' ');
}

function boardAnchorState(boardAnchor) {
  if (!boardAnchor || !boardAnchor.present) return 'absent';
  const capture = boardAnchor.capturePresent ? '/capture' : '';
  return `${boardAnchor.enabled ? 'on' : 'off'}${capture} request${boardAnchor.requestId == null ? 'n/a' : num(boardAnchor.requestId, 0)}`;
}

function ageLabel(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms)) return 'n/a';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${num(ms / 1000, 1)}s`;
}

function safeLabel(value) {
  return String(value == null ? 'unknown' : value)
    .replace(/[^a-z0-9_-]/gi, '')
    .slice(0, 32) || 'unknown';
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}
