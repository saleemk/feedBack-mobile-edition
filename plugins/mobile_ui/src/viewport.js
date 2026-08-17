export function getViewportInfo() {
  const width = window.innerWidth || document.documentElement.clientWidth || 0;
  const height = window.innerHeight || document.documentElement.clientHeight || 0;
  const visualViewport = getVisualViewportInfo();
  const orientation = width > height ? 'landscape' : 'portrait';

  return {
    width,
    height,
    devicePixelRatio: window.devicePixelRatio || 1,
    orientation,
    isLandscape: orientation === 'landscape',
    isPortrait: orientation === 'portrait',
    deviceClass: classifyDevice(width, height),
    standalone: isStandaloneMode(),
    visualViewport
  };
}

function classifyDevice(width, height) {
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);

  if (shortSide <= 767 && longSide <= 1024) return 'phone';
  if (width <= 1024) return 'tablet';
  if (isLikelyTabletViewport(shortSide, longSide)) return 'tablet';
  return 'desktop';
}

function isLikelyTabletViewport(shortSide, longSide) {
  const maxTouchPoints = window.navigator?.maxTouchPoints || 0;
  const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches === true;
  const hoverNone = window.matchMedia?.('(hover: none)')?.matches === true;
  const tabletSized = shortSide >= 768 && shortSide <= 1024 && longSide <= 1366;

  // Large tablets can exceed the tablet CSS breakpoint in landscape. Require
  // touch-oriented input signals so ordinary desktop windows remain desktop.
  return tabletSized && maxTouchPoints > 0 && (coarsePointer || hoverNone);
}

function isStandaloneMode() {
  return (
    window.navigator.standalone === true ||
    window.matchMedia?.('(display-mode: standalone)')?.matches === true
  );
}

function getVisualViewportInfo() {
  if (!window.visualViewport) return null;

  return {
    width: window.visualViewport.width,
    height: window.visualViewport.height,
    scale: window.visualViewport.scale,
    offsetLeft: window.visualViewport.offsetLeft,
    offsetTop: window.visualViewport.offsetTop,
    pageLeft: window.visualViewport.pageLeft,
    pageTop: window.visualViewport.pageTop
  };
}
