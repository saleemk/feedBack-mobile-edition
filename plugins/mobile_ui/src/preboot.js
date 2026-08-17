// Preflight: hide old core navigation immediately on touch devices if
// Mobile UI is enabled, so there is no flash of the sidebar/hamburger
// before the main runtime initialises. The preboot class is cleaned up
// once the real bottom-nav classes are in place.
(function preboot() {
  var disabled = false;
  try { disabled = localStorage.getItem('mobile_ui.disabled') === '1'; } catch (_) { /* private mode */ }
  if (!disabled && looksTouchLayout()) {
    injectPrebootStyle();
    document.documentElement.classList.add('mobile-ui-preboot-touch-nav');
  }
})();

export function cleanupPreboot() {
  document.documentElement.classList.remove('mobile-ui-preboot-touch-nav');
  document.getElementById('mobile-ui-preboot-style')?.remove();
}

function looksTouchLayout() {
  var width = window.innerWidth || document.documentElement.clientWidth || 0;
  var height = window.innerHeight || document.documentElement.clientHeight || 0;
  if (!width || !height) return false;

  var shortSide = Math.min(width, height);
  var longSide = Math.max(width, height);
  var coarsePointer = false;
  try { coarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches === true; } catch (_) { /* ignore */ }
  var maxTouchPoints = navigator.maxTouchPoints || 0;
  var hasTouch = coarsePointer || maxTouchPoints > 1 || 'ontouchstart' in window;

  var looksPhone = hasTouch && shortSide < 768 && longSide <= 1024;
  var looksTablet = hasTouch && shortSide >= 600 && longSide <= 1366;
  return looksPhone || looksTablet;
}

function injectPrebootStyle() {
  if (document.getElementById('mobile-ui-preboot-style')) return;
  var style = document.createElement('style');
  style.id = 'mobile-ui-preboot-style';
  style.textContent = [
    'html.mobile-ui-preboot-touch-nav #v3-sidebar,',
    'html.mobile-ui-preboot-touch-nav #v3-sidebar-backdrop,',
    'html.mobile-ui-preboot-touch-nav #v3-hamburger {',
    '  display: none !important;',
    '}'
  ].join('\n');
  document.head.appendChild(style);
}
