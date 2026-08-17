export function createFeature() {
  let statusRow = null;
  let statusRail = null;
  let bottomNav = null;
  let navObserver = null;
  let observedNav = null;
  let navRebuildFrame = null;
  let currentSignature = null;
  let lastState = null;

  const HOME_KEY = 'home';
  const ORDERED_SCROLL_KEYS = [
    'songs',
    'career',
    'progress',
    'shop',
    'feedbarcade',
    'plugins',
    'settings',
    'playlists',
    'lessons',
    'favorites',
    'saved'
  ];

  const LABEL_OVERRIDES = {
    songs: 'Library'
  };

  const SCREEN_TO_NAV_KEY = {
    home: 'home',
    library: 'songs',
    career: 'career',
    progress: 'progress',
    unlockables: 'shop',
    feedbarcade: 'feedbarcade',
    plugins: 'plugins',
    settings: 'settings',
    playlists: 'playlists',
    lessons: 'lessons',
    favorites: 'favorites',
    saved: 'saved'
  };

  return {
    name: 'shell',
    mount(ctx) {
      refresh(ctx);
    },
    refresh,
    unmount
  };

  function refresh(ctx) {
    lastState = ctx?.state || null;
    clearStatusClasses();
    if (_shouldShowBottomNav(ctx?.state)) {
      _ensureNavObserver();
      _ensureBottomNav(ctx?.state, {
        revealActive: ctx?.reason === 'screen:changed',
        smooth: ctx?.reason === 'screen:changed'
      });
    } else {
      _removeBottomNav();
    }

    if (ctx?.state?.disabled || !ctx?.state?.isV3) return;

    var tuner = document.getElementById('v3-badge-tuner');
    var instrument = document.getElementById('v3-badge-instrument');
    var profile = document.getElementById('v3-badge-profile');
    if (!tuner || !instrument || !profile) return;

    var rail = tuner.parentElement;
    if (!rail || instrument.parentElement !== rail || profile.parentElement !== rail) return;

    var row = rail.parentElement;
    if (!row) return;

    statusRail = rail;
    statusRow = row;
    statusRail.classList.add('mobile-ui-topbar-status-rail');
    statusRow.classList.add('mobile-ui-topbar-status-row');
  }

  function unmount() {
    clearStatusClasses();
    _removeBottomNav();
    _removeNavObserver();
    lastState = null;
  }

  function clearStatusClasses() {
    if (statusRail) statusRail.classList.remove('mobile-ui-topbar-status-rail');
    if (statusRow) statusRow.classList.remove('mobile-ui-topbar-status-row');

    document.querySelectorAll('.mobile-ui-topbar-status-rail')
      .forEach(function (el) { el.classList.remove('mobile-ui-topbar-status-rail'); });
    document.querySelectorAll('.mobile-ui-topbar-status-row')
      .forEach(function (el) { el.classList.remove('mobile-ui-topbar-status-row'); });

    statusRail = null;
    statusRow = null;
  }

  function _shouldShowBottomNav(state) {
    if (state?.disabled || !state?.isV3 || state?.screen === 'player') return false;
    var vp = state?.viewport;
    if (!vp) return false;
    var cls = vp.deviceClass;
    return cls === 'phone' || cls === 'tablet';
  }

  // --- Bottom navigation bar -----------------------------------------------

  function _ensureBottomNav(state, options = {}) {
    const model = _buildBottomNavModel();
    const signature = _modelSignature(model);

    if (bottomNav && bottomNav.isConnected && currentSignature === signature) {
      _syncBottomNavActive(state, options);
      return;
    }

    const previousScroll = _getScrollStrip()?.scrollLeft || 0;
    if (bottomNav && bottomNav.isConnected) {
      bottomNav.remove();
      bottomNav = null;
    }

    const nav = document.createElement('nav');
    nav.className = 'mobile-ui-bottom-nav';
    nav.setAttribute('aria-label', 'Primary mobile navigation');

    const fixed = document.createElement('div');
    fixed.className = 'mobile-ui-bottom-nav-fixed';
    if (model.home) fixed.appendChild(_createBottomNavItem(model.home));

    const scroll = document.createElement('div');
    scroll.className = 'mobile-ui-bottom-nav-scroll';
    scroll.setAttribute('aria-label', 'More destinations');
    scroll.tabIndex = 0;
    for (var i = 0; i < model.scroll.length; i++) {
      scroll.appendChild(_createBottomNavItem(model.scroll[i]));
    }

    nav.appendChild(fixed);
    nav.appendChild(scroll);
    document.body.appendChild(nav);
    bottomNav = nav;
    currentSignature = signature;

    if (previousScroll && !options.revealActive) {
      scroll.scrollLeft = previousScroll;
    }

    document.documentElement.classList.add('mobile-ui-has-bottom-nav');
    _syncBottomNavActive(state, options);
  }

  function _removeBottomNav() {
    _removeNavObserver();
    if (bottomNav) {
      bottomNav.remove();
      bottomNav = null;
    }
    document.querySelectorAll('.mobile-ui-bottom-nav').forEach(function (el) { el.remove(); });
    document.documentElement.classList.remove('mobile-ui-has-bottom-nav');
    currentSignature = null;
  }

  function _buildBottomNavModel() {
    const entries = _collectCoreNavEntries();
    const byKey = {};
    const used = {};

    for (var i = 0; i < entries.length; i++) {
      if (!byKey[entries[i].key]) byKey[entries[i].key] = entries[i];
    }

    const home = byKey[HOME_KEY] || null;
    if (home) used[HOME_KEY] = true;

    const scroll = [];
    for (var j = 0; j < ORDERED_SCROLL_KEYS.length; j++) {
      const key = ORDERED_SCROLL_KEYS[j];
      const entry = byKey[key];
      if (!entry || used[key]) continue;
      used[key] = true;
      scroll.push(entry);
    }

    for (var k = 0; k < entries.length; k++) {
      const extra = entries[k];
      if (used[extra.key]) continue;
      used[extra.key] = true;
      scroll.push(extra);
    }

    return { home, scroll };
  }

  function _collectCoreNavEntries() {
    const links = document.querySelectorAll('#v3-nav a[data-v3-nav]');
    const seen = {};
    const result = [];

    for (var i = 0; i < links.length; i++) {
      const el = links[i];
      const key = el.getAttribute('data-v3-nav');
      if (!key || seen[key]) continue;
      if (!_isUsableCoreNavAnchor(el)) continue;

      const label = LABEL_OVERRIDES[key] || _extractCoreNavLabel(el);
      if (!label) continue;

      seen[key] = true;
      result.push({ key, label, original: el });
    }

    return result;
  }

  function _modelSignature(model) {
    const home = model.home ? `${model.home.key}:${model.home.label}` : 'none';
    const scroll = model.scroll.map(function (entry) {
      return `${entry.key}:${entry.label}`;
    }).join('|');

    return `${home}::${scroll}`;
  }

  function _createBottomNavItem(entry) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mobile-ui-bottom-nav-item';
    btn.setAttribute('data-mobile-ui-bottom-nav', entry.key);
    btn.setAttribute('aria-label', entry.label);
    btn.textContent = entry.label;

    btn.addEventListener('click', function () {
      const original = document.querySelector('#v3-nav a[data-v3-nav="' + _escapeCssValue(entry.key) + '"]');
      if (original) original.click();
      window.setTimeout(function () {
        _syncBottomNavActive(lastState, { revealActive: true, smooth: true });
      }, 0);
    });

    return btn;
  }

  function _syncBottomNavActive(state, options = {}) {
    if (!bottomNav || !bottomNav.isConnected) return;

    const activeKey = _getActiveNavKey(state);
    const items = bottomNav.querySelectorAll('.mobile-ui-bottom-nav-item');
    let activeItem = null;

    items.forEach(function (item) {
      const isActive = !!activeKey && item.getAttribute('data-mobile-ui-bottom-nav') === activeKey;
      item.classList.toggle('is-active', isActive);
      if (isActive) {
        item.setAttribute('aria-current', 'page');
        activeItem = item;
      } else {
        item.removeAttribute('aria-current');
      }
    });

    if (options.revealActive && activeItem) {
      _revealActiveItem(activeItem, !!options.smooth);
    }
  }

  function _getActiveNavKey(state) {
    const mapped = SCREEN_TO_NAV_KEY[state?.screen || ''];
    if (mapped) return mapped;

    const activeCoreLink = document.querySelector('#v3-nav a[data-v3-nav].bg-fb-card');
    return activeCoreLink?.getAttribute('data-v3-nav') || null;
  }

  function _revealActiveItem(item, smooth) {
    const scroll = _getScrollStrip();
    if (!scroll || !scroll.contains(item)) return;

    const itemRect = item.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    if (itemRect.left >= scrollRect.left && itemRect.right <= scrollRect.right) return;

    item.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: smooth ? 'smooth' : 'auto'
    });
  }

  function _getScrollStrip() {
    return bottomNav?.querySelector('.mobile-ui-bottom-nav-scroll') || null;
  }

  function _ensureNavObserver() {
    const nav = document.getElementById('v3-nav');
    if (!nav) return;
    if (navObserver && observedNav === nav) return;

    _removeNavObserver();
    navObserver = new MutationObserver(function () {
      _scheduleBottomNavRebuild();
    });
    navObserver.observe(nav, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'data-v3-nav',
        'hidden',
        'aria-hidden',
        'aria-disabled',
        'class',
        'style'
      ]
    });
    observedNav = nav;
  }

  function _removeNavObserver() {
    if (navRebuildFrame) {
      window.cancelAnimationFrame(navRebuildFrame);
      navRebuildFrame = null;
    }
    if (navObserver) navObserver.disconnect();
    navObserver = null;
    observedNav = null;
  }

  function _scheduleBottomNavRebuild() {
    if (navRebuildFrame) return;

    navRebuildFrame = window.requestAnimationFrame(function () {
      navRebuildFrame = null;
      if (!_shouldShowBottomNav(lastState)) return;
      _ensureBottomNav(lastState, { preserveScroll: true });
    });
  }

  function _isUsableCoreNavAnchor(anchor) {
    if (!anchor || anchor.hidden) return false;
    if (anchor.getAttribute('aria-hidden') === 'true') return false;
    if (anchor.getAttribute('aria-disabled') === 'true') return false;

    const style = window.getComputedStyle?.(anchor);
    if (!style) return true;

    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function _extractCoreNavLabel(anchor) {
    const explicit = anchor.querySelector('[data-v3-nav-label], .v3-nav-label');
    const explicitText = _normalizeLabel(explicit?.textContent || '');
    if (explicitText) return explicitText;

    const clone = anchor.cloneNode(true);
    clone.querySelectorAll('svg,[aria-hidden="true"],[hidden],.v3-rail-badge,.fb-acc-badge,[data-badge],[data-counter]')
      .forEach(function (el) { el.remove(); });

    return _normalizeLabel(clone.textContent || '');
  }

  function _normalizeLabel(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function _escapeCssValue(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }

    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
}
